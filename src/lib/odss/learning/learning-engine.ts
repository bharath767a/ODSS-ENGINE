/**
 * ODSS — Learning Engine
 * ===========================================================================
 * Records trade outcomes into LearningPattern rows and looks up historical
 * patterns to inform future decisions. Each pattern is keyed by the tuple:
 *
 *   (symbol, direction, marketState, technicalTrend, sector, vixBand,
 *    dataRegime)
 *
 * All operations use Prisma `db` from @/lib/db and are wrapped in try/catch
 * with graceful fallbacks so that DB hiccups never crash callers (a failed
 * learn-write should never break a trade close).
 *
 * Design notes:
 *   - Nullable key fields (marketState, technicalTrend, sector, vixBand) are
 *     normalised to empty strings ('') before persistence. SQLite treats NULL
 *     as distinct inside UNIQUE constraints, which would break idempotent
 *     upserts; empty strings avoid that footgun while remaining falsy for UI
 *     rendering.
 *   - Wilson 80% confidence intervals are recomputed on every write so the
 *     `ciLower` / `ciUpper` columns always reflect the current `wins`/`rawN`.
 *   - Effective N uses a multiplicative correlated-trade discount (see
 *     statistical-reliability.ts). Until the schema gains a correlatedTrades
 *     column, the discount defaults to 0 → effectiveN equals rawN.
 * ===========================================================================
 */

import { db } from '@/lib/db';
import {
  calculateEffectiveN,
  getReliabilityTier,
  getWinRateConfidenceInterval,
} from './statistical-reliability';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/** The default data regime for all real-trade learning. */
const REAL_REGIME = 'REAL';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface TradeOutcomeParams {
  symbol: string;
  direction: 'CE' | 'PE';
  /** Optional group ID (links to the multi-strategy spawner). */
  variantGroup?: string | null;
  /** Optional specific variant ID within the group. */
  variantId?: string | null;
  pnl: number;
  rMultiple: number;
  context: {
    marketState?: string;
    technicalTrend?: string;
    sector?: string;
    vixBand?: string;
  };
}

export interface LookupParams {
  symbol: string;
  direction: 'CE' | 'PE';
  context: {
    marketState?: string;
    technicalTrend?: string;
    sector?: string;
    vixBand?: string;
  };
}

export interface PatternLookup {
  effectiveN: number;
  tier: string;
  winRatePct: number;
  ciLower: number;
  ciUpper: number;
  avgR: number;
}

export interface LearningStats {
  total: number;
  reliable: number;
  preliminary: number;
  insufficient: number;
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------

/**
 * Normalise an optional string key field to a non-null string.
 *
 * `undefined` / `null` → '' (empty string) so SQLite UNIQUE constraints work
 * correctly (NULLs are distinct in SQLite, which would break upserts).
 */
function normalizeKey(v: string | undefined | null): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

/**
 * Wilson CI bounds expressed as percentages (0-100) rather than fractions.
 */
function wilsonPct(wins: number, total: number): { lower: number; upper: number } {
  const { lower, upper } = getWinRateConfidenceInterval(wins, total);
  return { lower: lower * 100, upper: upper * 100 };
}

/**
 * Incremental running average: combine a previous average (over `prevN`
 * observations) with one new observation `newValue`.
 */
function runningAverage(prevAvg: number, prevN: number, newValue: number): number {
  if (prevN <= 0) return newValue;
  return (prevAvg * prevN + newValue) / (prevN + 1);
}

// ---------------------------------------------------------------------------
// RECORD TRADE OUTCOME
// ---------------------------------------------------------------------------

/**
 * Record a completed trade's outcome against the matching LearningPattern.
 *
 * Steps:
 *   1. Look up (or implicitly create via upsert) the pattern matching
 *      (symbol, direction, marketState, trend, sector, vixBand, REAL).
 *   2. Increment rawN; bump wins/losses based on `pnl > 0`; update avgR and
 *      totalPnl incrementally.
 *   3. Recompute effectiveN, tier, winRatePct, and the Wilson 80% CI.
 *   4. Persist via upsert (race-safe — concurrent writers converge).
 *
 * Never throws — failures are logged and swallowed so trade-state machines
 * can't be blocked by a learning-engine hiccup.
 */
export async function recordTradeOutcome(
  params: TradeOutcomeParams,
): Promise<void> {
  try {
    const {
      symbol,
      direction,
      pnl,
      rMultiple,
      context,
    } = params;

    // Normalise key fields (null/undefined → '') for safe SQLite unique.
    const marketState = normalizeKey(context.marketState);
    const technicalTrend = normalizeKey(context.technicalTrend);
    const sector = normalizeKey(context.sector);
    const vixBand = normalizeKey(context.vixBand);

    // Prisma's generated composite-unique selector name.
    const compositeWhere = {
      symbol_direction_marketState_technicalTrend_sector_vixBand_dataRegime: {
        symbol,
        direction,
        marketState,
        technicalTrend,
        sector,
        vixBand,
        dataRegime: REAL_REGIME,
      },
    };

    // 1. Read existing row (if any) so we can compute incremental updates.
    const existing = await db.learningPattern.findUnique({
      where: compositeWhere,
    });

    const prevRawN = existing?.rawN ?? 0;
    const prevWins = existing?.wins ?? 0;
    const prevLosses = existing?.losses ?? 0;
    const prevAvgR = existing?.avgR ?? 0;
    const prevTotalPnl = existing?.totalPnl ?? 0;
    // correlatedTrades is not in the schema yet — default to 0.
    const correlatedTrades =
      (existing as any)?.correlatedTrades ?? 0;

    // 2. Incremental stat updates.
    const isWin = pnl > 0;
    const newRawN = prevRawN + 1;
    const newWins = prevWins + (isWin ? 1 : 0);
    const newLosses = prevLosses + (isWin ? 0 : 1);
    const newAvgR = runningAverage(prevAvgR, prevRawN, rMultiple);
    const newTotalPnl = prevTotalPnl + pnl;

    // 3. Recompute reliability fields.
    const effectiveN = calculateEffectiveN(newRawN, correlatedTrades);
    const tier = getReliabilityTier(effectiveN);
    const winRatePct = newRawN > 0 ? (newWins / newRawN) * 100 : 0;
    const { lower: ciLower, upper: ciUpper } = wilsonPct(newWins, newRawN);
    const now = new Date();

    // 4. Upsert (race-safe).
    await db.learningPattern.upsert({
      where: compositeWhere,
      create: {
        symbol,
        direction,
        marketState,
        technicalTrend,
        sector,
        vixBand,
        dataRegime: REAL_REGIME,
        rawN: newRawN,
        effectiveN,
        wins: newWins,
        losses: newLosses,
        avgR: newAvgR,
        totalPnl: newTotalPnl,
        tier,
        winRatePct,
        ciLower,
        ciUpper,
        lastSeenAt: now,
      },
      update: {
        rawN: newRawN,
        effectiveN,
        wins: newWins,
        losses: newLosses,
        avgR: newAvgR,
        totalPnl: newTotalPnl,
        tier,
        winRatePct,
        ciLower,
        ciUpper,
        lastSeenAt: now,
      },
    });
  } catch (err) {
    // Graceful fallback — never propagate to caller.
    console.error('[learning-engine] recordTradeOutcome failed:', err);
  }
}

// ---------------------------------------------------------------------------
// LOOKUP PATTERN
// ---------------------------------------------------------------------------

/**
 * Look up the learned pattern matching the given key, under the current
 * dataRegime='REAL'.
 *
 * Returns null when no pattern exists (or when the DB is unreachable).
 */
export async function lookupPattern(
  params: LookupParams,
): Promise<PatternLookup | null> {
  try {
    const { symbol, direction, context } = params;

    const marketState = normalizeKey(context.marketState);
    const technicalTrend = normalizeKey(context.technicalTrend);
    const sector = normalizeKey(context.sector);
    const vixBand = normalizeKey(context.vixBand);

    const pattern = await db.learningPattern.findUnique({
      where: {
        symbol_direction_marketState_technicalTrend_sector_vixBand_dataRegime: {
          symbol,
          direction,
          marketState,
          technicalTrend,
          sector,
          vixBand,
          dataRegime: REAL_REGIME,
        },
      },
    });

    if (!pattern) return null;

    return {
      effectiveN: pattern.effectiveN,
      tier: pattern.tier,
      winRatePct: pattern.winRatePct,
      ciLower: pattern.ciLower,
      ciUpper: pattern.ciUpper,
      avgR: pattern.avgR,
    };
  } catch (err) {
    console.error('[learning-engine] lookupPattern failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// LIST PATTERNS FOR CURRENT REGIME
// ---------------------------------------------------------------------------

/**
 * Return all LearningPattern rows under dataRegime='REAL'.
 *
 * Rows are returned newest-first (by lastSeenAt) so the UI surfaces recently
 * active patterns. Falls back to an empty array on error.
 */
export async function listPatternsForCurrentRegime(): Promise<any[]> {
  try {
    return await db.learningPattern.findMany({
      where: { dataRegime: REAL_REGIME },
      orderBy: [{ lastSeenAt: 'desc' }, { effectiveN: 'desc' }],
    });
  } catch (err) {
    console.error('[learning-engine] listPatternsForCurrentRegime failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET LEARNING STATS
// ---------------------------------------------------------------------------

/**
 * Aggregate pattern counts by reliability tier.
 *
 *   { total, reliable, preliminary, insufficient }
 *
 * Falls back to all-zero on error.
 */
export async function getLearningStats(): Promise<LearningStats> {
  const zero: LearningStats = {
    total: 0,
    reliable: 0,
    preliminary: 0,
    insufficient: 0,
  };

  try {
    const [total, reliable, preliminary, insufficient] = await Promise.all([
      db.learningPattern.count({ where: { dataRegime: REAL_REGIME } }),
      db.learningPattern.count({
        where: { dataRegime: REAL_REGIME, tier: 'RELIABLE' },
      }),
      db.learningPattern.count({
        where: { dataRegime: REAL_REGIME, tier: 'PRELIMINARY' },
      }),
      db.learningPattern.count({
        where: { dataRegime: REAL_REGIME, tier: 'INSUFFICIENT' },
      }),
    ]);

    return { total, reliable, preliminary, insufficient };
  } catch (err) {
    console.error('[learning-engine] getLearningStats failed:', err);
    return zero;
  }
}

// ---------------------------------------------------------------------------
// BACKFILL ALL PATTERN EFFECTIVE N
// ---------------------------------------------------------------------------

/**
 * Recompute and persist `effectiveN` (and tier) for every LearningPattern row.
 *
 * Useful after a constants change (e.g. adjusting CORRELATED_TRADE_DISCOUNT)
 * or after back-filling a `correlatedTrades` column. Safe to run repeatedly —
 * idempotent. Failures on individual rows are logged but do not abort the
 * overall pass.
 */
export async function backfillAllPatternEffectiveN(): Promise<void> {
  try {
    // NOTE: only select columns that exist in the schema. `correlatedTrades`
    // is not yet a persisted column — it defaults to 0 (see statistical-
    // reliability.ts). When the schema gains that column, the defensive read
    // below will pick it up automatically.
    const patterns = await db.learningPattern.findMany({
      select: { id: true, rawN: true },
    });

    for (const p of patterns) {
      try {
        const rawN = p.rawN ?? 0;
        const correlatedTrades =
          (p as any)?.correlatedTrades ?? 0;
        const effectiveN = calculateEffectiveN(rawN, correlatedTrades);
        const tier = getReliabilityTier(effectiveN);

        await db.learningPattern.update({
          where: { id: p.id },
          data: { effectiveN, tier },
        });
      } catch (rowErr) {
        console.error(
          '[learning-engine] backfill row failed for id=',
          (p as any)?.id,
          rowErr,
        );
      }
    }
  } catch (err) {
    console.error(
      '[learning-engine] backfillAllPatternEffectiveN failed:',
      err,
    );
  }
}
