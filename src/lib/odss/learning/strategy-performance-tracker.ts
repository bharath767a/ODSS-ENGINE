/**
 * ODSS — Strategy Performance Tracker
 * ===========================================================================
 * Tracks StrategyVariant performance over time and runs genetic-algorithm
 * evolution passes (promote / retire / prune) with a full EvolutionLog audit
 * trail.
 *
 * Each variant is identified by a unique `name` and carries a JSON `genome`
 * describing its strategy type, entry/exit/risk rules, and position-sizing
 * policy. Trade outcomes incrementally update the variant's statistics; a
 * fitness score (win-rate, profit factor, avg-R blend) drives evolution
 * decisions.
 *
 * All operations use Prisma `db` from @/lib/db and are wrapped in try/catch
 * with graceful fallbacks so a DB hiccup never crashes the caller.
 *
 * Profit-factor note:
 *   The schema does not persist grossProfit / grossLoss separately. To still
 *   produce a true running profit factor (gross win PnL ÷ gross loss PnL),
 *   we reconstruct the previous (GP, GL) pair from the persisted
 *   (profitFactor, totalPnl) using the identity:
 *
 *       profitFactor = GP / GL
 *       totalPnl     = GP − GL
 *       ⇒  GL = totalPnl / (PF − 1),   GP = PF · GL
 *
 *   This lets each new trade update GP/GL incrementally before recomputing
 *   PF. Edge cases (no wins, no losses, PF≈1) fall back to safe defaults.
 * ===========================================================================
 */

import { db } from '@/lib/db';
import {
  calculateEffectiveN,
  getReliabilityTier,
  recomputeVariantEffectiveN,
} from './statistical-reliability';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/** Default data regime for all real-trade strategy tracking. */
const REAL_REGIME = 'REAL';

/** Sentinel used when profit factor would be infinite (no losing trades yet). */
const PROFIT_FACTOR_CAP = 99;

/** Prune threshold: GRAVEYARD variants older than this are deleted. */
const GRAVEYARD_PRUNE_DAYS = 30;

/** Promote CANDIDATE → ACTIVE when RELIABLE and winRatePct > this. */
const PROMOTE_WIN_RATE = 55;

/** Retire ACTIVE → RETIRED when RELIABLE and winRatePct < this. */
const RETIRE_WIN_RATE = 40;

/** Strategy types the random genome generator picks from. */
const STRATEGY_TYPES = [
  'LONG_CALL',
  'LONG_PUT',
  'BULL_CALL_SPREAD',
  'BEAR_PUT_SPREAD',
  'STRADDLE',
  'STRANGLE',
  'IRON_CONDOR',
  'BUTTERFLY',
] as const;

const ENTRY_TYPES = ['MARKET', 'BREAKOUT', 'RETEST', 'VWAP', 'LIQUIDITY_SWEEP'] as const;
const SIZING_METHODS = ['FIXED', 'KELLY', 'VOLATILITY_SCALED'] as const;
const HOLD_MINUTES = [30, 60, 120, 240, 375, 1440] as const;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface RegisterVariantParams {
  name: string;
  /** JSON string encoding the variant's genome. */
  genome: string;
  parentName?: string;
}

export interface RecordVariantTradeParams {
  variantName: string;
  pnl: number;
  rMultiple: number;
  win: boolean;
}

export interface StrategyLabStats {
  total: number;
  active: number;
  candidate: number;
  retired: number;
  graveyard: number;
}

export interface EvolutionResult {
  promoted: number;
  retired: number;
  pruned: number;
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------

/**
 * Reconstruct (grossProfit, grossLoss) from the persisted
 * (profitFactor, totalPnl, wins, losses) tuple.
 *
 * Identity used:
 *   PF = GP / GL
 *   totalPnl = GP − GL
 *   ⇒ GL = totalPnl / (PF − 1),  GP = PF · GL
 *
 * Edge cases (no wins, no losses, PF≈1, or non-finite results) fall back to
 * sensible defaults so the running PF never goes corrupt.
 */
function reconstructGross(
  prevPF: number,
  prevTotalPnl: number,
  prevWins: number,
  prevLosses: number,
): { gp: number; gl: number } {
  // No trades yet — start fresh.
  if (prevWins === 0 && prevLosses === 0) {
    return { gp: 0, gl: 0 };
  }
  // No losing trades so far → all cumulative PnL is profit.
  if (prevLosses === 0) {
    return { gp: Math.max(0, prevTotalPnl), gl: 0 };
  }
  // No winning trades so far → all cumulative PnL is loss.
  if (prevWins === 0) {
    return { gp: 0, gl: Math.max(0, -prevTotalPnl) };
  }
  // PF ≈ 1 is ambiguous (identity above divides by zero). Fall back to a
  // sign-based split: positive totalPnl ⇒ all-profit, negative ⇒ all-loss.
  if (Math.abs(prevPF - 1) < 1e-9) {
    if (prevTotalPnl >= 0) {
      return { gp: prevTotalPnl, gl: 0 };
    }
    return { gp: 0, gl: -prevTotalPnl };
  }

  const gl = prevTotalPnl / (prevPF - 1);
  const gp = prevPF * gl;

  // Guard against corrupted data producing NaN / negatives.
  if (!Number.isFinite(gp) || !Number.isFinite(gl) || gp < 0 || gl < 0) {
    return {
      gp: Math.max(0, prevTotalPnl),
      gl: Math.max(0, -prevTotalPnl),
    };
  }

  return { gp, gl };
}

/**
 * Compute profit factor from gross profit / gross loss. Returns 0 when there
 * is no profit and no loss; returns PROFIT_FACTOR_CAP when there is profit but
 * no loss (i.e. would be infinite).
 */
function computeProfitFactor(gp: number, gl: number): number {
  if (gp <= 0) return 0;
  if (gl <= 0) return PROFIT_FACTOR_CAP;
  const pf = gp / gl;
  if (!Number.isFinite(pf)) return PROFIT_FACTOR_CAP;
  return Math.min(PROFIT_FACTOR_CAP, Math.max(0, pf));
}

/**
 * Incremental running average.
 */
function runningAverage(prevAvg: number, prevN: number, newValue: number): number {
  if (prevN <= 0) return newValue;
  return (prevAvg * prevN + newValue) / (prevN + 1);
}

/**
 * Compute the genetic-algorithm fitness score.
 *
 *   fitness = winRatePct · 0.4 + profitFactor · 0.3 + avgR · 0.3
 *
 * winRatePct is on a 0-100 scale; profitFactor and avgR are dimensionless.
 */
function computeFitness(
  winRatePct: number,
  profitFactor: number,
  avgR: number,
): number {
  return winRatePct * 0.4 + profitFactor * 0.3 + avgR * 0.3;
}

/**
 * Generate a random variant name (e.g. "Alpha-v1-4823").
 * Deterministic-ish per call (uses Math.random — sufficient for lab seeding).
 */
function generateVariantName(): string {
  const prefixes = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
    'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Sigma', 'Phi', 'Psi', 'Omega',
  ];
  const suffixes = ['v1', 'v2', 'v3', 'X', 'Prime', 'Plus', 'Max', 'Lite', 'Pro'];
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  const s = suffixes[Math.floor(Math.random() * suffixes.length)];
  const n = Math.floor(Math.random() * 9999);
  return `${p}-${s}-${n}`;
}

/** Random helper — float in [min, max] rounded to 2 decimals. */
function randFloat(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

/** Random helper — pick one element from a tuple/array. */
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build a random genome JSON string. Optional overrides from the caller
 * (e.g. a fixed strategy type) are honoured when present.
 */
function generateRandomGenome(body?: Record<string, unknown>): string {
  const genome = {
    strategy:
      typeof body?.strategy === 'string' ? body.strategy : pick(STRATEGY_TYPES),
    entryRules: {
      minScore: randFloat(40, 70),
      minConfidence: randFloat(50, 75),
      entryType: pick(ENTRY_TYPES),
      minRR: randFloat(1.5, 3.0),
      minVolumeRatio: randFloat(0.8, 2.0),
    },
    exitRules: {
      tp1R: randFloat(0.5, 1.5),
      tp2R: randFloat(1.5, 2.5),
      tp3R: randFloat(2.5, 4.0),
      slR: randFloat(0.75, 1.25),
      trailATR: randFloat(1.5, 3.0),
      maxHoldMinutes: pick(HOLD_MINUTES),
      breakevenAtR: randFloat(0.75, 1.25),
    },
    riskRules: {
      riskPct: randFloat(0.5, 2.0),
      maxTradesPerDay: pick([1, 2, 3, 4]),
      maxDailyLossPct: randFloat(2.0, 5.0),
      profitCapPct: randFloat(3.0, 6.0),
    },
    positionSizing: {
      method: pick(SIZING_METHODS),
      lots: pick([1, 2, 3]),
    },
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(genome);
}

// ---------------------------------------------------------------------------
// REGISTER VARIANT
// ---------------------------------------------------------------------------

/**
 * Register a new StrategyVariant with status='CANDIDATE', generation=0, and
 * log a CREATE action to EvolutionLog.
 *
 * Uses upsert by `name` to be race-safe against duplicate registrations.
 * Returns the variant's DB id (or empty string on failure).
 */
export async function registerVariant(
  params: RegisterVariantParams,
): Promise<string> {
  try {
    const { name, genome, parentName } = params;

    // Check existence first so we only emit a CREATE log for genuine new
    // variants (keeps the audit trail clean on accidental re-registers).
    const existing = await db.strategyVariant.findUnique({
      where: { name },
      select: { id: true },
    });

    const variant = await db.strategyVariant.upsert({
      where: { name },
      create: {
        name,
        genome,
        status: 'CANDIDATE',
        generation: 0,
        parentName: parentName ?? null,
        dataRegime: REAL_REGIME,
      },
      update: {
        // Do not overwrite stats/genome on re-register — just refresh the
        // timestamp so the row floats to the top of "recently touched".
        lastSeenAt: new Date(),
      },
    });

    if (!existing) {
      try {
        await db.evolutionLog.create({
          data: {
            generation: 0,
            action: 'CREATE',
            variantName: name,
            details: JSON.stringify({
              genome,
              parentName: parentName ?? null,
            }),
          },
        });
      } catch (logErr) {
        console.error('[strategy-tracker] CREATE log failed:', logErr);
      }
    }

    return variant.id;
  } catch (err) {
    console.error('[strategy-tracker] registerVariant failed:', err);
    return '';
  }
}

// ---------------------------------------------------------------------------
// RECORD VARIANT TRADE
// ---------------------------------------------------------------------------

/**
 * Record a single trade outcome against a StrategyVariant.
 *
 * Updates incrementally:
 *   rawN++, wins/losses, profitFactor (true running ratio via GP/GL
 *   reconstruction), avgR, totalPnl.
 *
 * Then recomputes:
 *   effectiveN, tier, winRatePct, fitness.
 *
 * Looks up the variant by `variantName`. If not found, the call is a no-op
 * (logged). Never throws.
 */
export async function recordVariantTrade(
  params: RecordVariantTradeParams,
): Promise<void> {
  try {
    const { variantName, pnl, rMultiple, win } = params;

    const existing = await db.strategyVariant.findUnique({
      where: { name: variantName },
    });

    if (!existing) {
      console.warn(
        '[strategy-tracker] recordVariantTrade: variant not found:',
        variantName,
      );
      return;
    }

    // --- Incremental stat updates -----------------------------------------
    const prevRawN = existing.rawN ?? 0;
    const prevWins = existing.wins ?? 0;
    const prevLosses = existing.losses ?? 0;
    const prevAvgR = existing.avgR ?? 0;
    const prevTotalPnl = existing.totalPnl ?? 0;
    const prevPF = existing.profitFactor ?? 0;
    const correlatedTrades = (existing as any)?.correlatedTrades ?? 0;

    const newRawN = prevRawN + 1;
    const newWins = prevWins + (win ? 1 : 0);
    const newLosses = prevLosses + (win ? 0 : 1);
    const newAvgR = runningAverage(prevAvgR, prevRawN, rMultiple);
    const newTotalPnl = prevTotalPnl + pnl;

    // --- Running profit factor via GP/GL reconstruction -------------------
    const { gp, gl } = reconstructGross(
      prevPF,
      prevTotalPnl,
      prevWins,
      prevLosses,
    );
    const newGp = gp + Math.max(0, pnl);
    const newGl = gl + Math.max(0, -pnl);
    const newPF = computeProfitFactor(newGp, newGl);

    // --- Recompute reliability & fitness ----------------------------------
    const effectiveN = calculateEffectiveN(newRawN, correlatedTrades);
    const tier = getReliabilityTier(effectiveN);
    const winRatePct = newRawN > 0 ? (newWins / newRawN) * 100 : 0;
    const fitness = computeFitness(winRatePct, newPF, newAvgR);

    await db.strategyVariant.update({
      where: { name: variantName },
      data: {
        rawN: newRawN,
        effectiveN,
        wins: newWins,
        losses: newLosses,
        profitFactor: newPF,
        avgR: newAvgR,
        totalPnl: newTotalPnl,
        tier,
        winRatePct,
        fitness,
        lastSeenAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[strategy-tracker] recordVariantTrade failed:', err);
  }
}

// ---------------------------------------------------------------------------
// LIST VARIANTS FOR CURRENT REGIME
// ---------------------------------------------------------------------------

/**
 * Return all StrategyVariant rows under dataRegime='REAL'.
 *
 * Ordered by effectiveN desc (most battle-tested first) then by fitness desc.
 * Falls back to an empty array on error.
 */
export async function listVariantsForCurrentRegime(): Promise<any[]> {
  try {
    return await db.strategyVariant.findMany({
      where: { dataRegime: REAL_REGIME },
      orderBy: [
        { effectiveN: 'desc' },
        { fitness: 'desc' },
        { lastSeenAt: 'desc' },
      ],
    });
  } catch (err) {
    console.error(
      '[strategy-tracker] listVariantsForCurrentRegime failed:',
      err,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET STRATEGY LAB STATS
// ---------------------------------------------------------------------------

/**
 * Aggregate variant counts by status.
 *
 *   { total, active, candidate, retired, graveyard }
 *
 * Falls back to all-zero on error.
 */
export async function getStrategyLabStats(): Promise<StrategyLabStats> {
  const zero: StrategyLabStats = {
    total: 0,
    active: 0,
    candidate: 0,
    retired: 0,
    graveyard: 0,
  };

  try {
    const [total, active, candidate, retired, graveyard] = await Promise.all([
      db.strategyVariant.count({ where: { dataRegime: REAL_REGIME } }),
      db.strategyVariant.count({
        where: { dataRegime: REAL_REGIME, status: 'ACTIVE' },
      }),
      db.strategyVariant.count({
        where: { dataRegime: REAL_REGIME, status: 'CANDIDATE' },
      }),
      db.strategyVariant.count({
        where: { dataRegime: REAL_REGIME, status: 'RETIRED' },
      }),
      db.strategyVariant.count({
        where: { dataRegime: REAL_REGIME, status: 'GRAVEYARD' },
      }),
    ]);

    return { total, active, candidate, retired, graveyard };
  } catch (err) {
    console.error('[strategy-tracker] getStrategyLabStats failed:', err);
    return zero;
  }
}

// ---------------------------------------------------------------------------
// CREATE VARIANT
// ---------------------------------------------------------------------------

/**
 * Create a new random variant: generates a name + genome, then delegates to
 * `registerVariant`.
 *
 * The optional `body` may override genome fields (e.g. `{ strategy: 'LONG_CALL' }`)
 * or supply a `parentName` (for future mutation/crossover lineages).
 *
 * Returns `{ variantId }` — the new variant's DB id (or its name as a
 * fallback when the id is unavailable).
 */
export async function createVariant(
  body?: Record<string, unknown>,
): Promise<{ variantId: string }> {
  try {
    const name =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim()
        : generateVariantName();
    const genome =
      typeof body?.genome === 'string' && body.genome.trim()
        ? body.genome
        : generateRandomGenome(body);
    const parentName =
      typeof body?.parentName === 'string' && body.parentName.trim()
        ? body.parentName.trim()
        : undefined;

    const id = await registerVariant({ name, genome, parentName });
    return { variantId: id || name };
  } catch (err) {
    console.error('[strategy-tracker] createVariant failed:', err);
    return { variantId: '' };
  }
}

// ---------------------------------------------------------------------------
// EVOLVE VARIANTS
// ---------------------------------------------------------------------------

/**
 * Run one genetic-algorithm evolution pass.
 *
 *   1. PROMOTE: CANDIDATE → ACTIVE  when tier=RELIABLE and winRatePct > 55
 *   2. RETIRE:  ACTIVE → RETIRED    when tier=RELIABLE and winRatePct < 40
 *   3. PRUNE:   delete GRAVEYARD variants whose updatedAt is older than 30
 *      days (the EvolutionLog row recording the PRUNE survives the delete).
 *
 * Each action emits an EvolutionLog entry (action=PROMOTE / RETIRE / PRUNE)
 * with a JSON `details` payload. Returns counts of each action taken.
 *
 * Failures on individual variants are logged but do not abort the pass.
 */
export async function evolveVariants(
  _body?: Record<string, unknown>,
): Promise<EvolutionResult> {
  const result: EvolutionResult = { promoted: 0, retired: 0, pruned: 0 };

  try {
    // --- 1. PROMOTE CANDIDATE → ACTIVE ------------------------------------
    try {
      const promotable = await db.strategyVariant.findMany({
        where: {
          status: 'CANDIDATE',
          tier: 'RELIABLE',
          winRatePct: { gt: PROMOTE_WIN_RATE },
          dataRegime: REAL_REGIME,
        },
      });

      for (const v of promotable) {
        try {
          await db.strategyVariant.update({
            where: { name: v.name },
            data: { status: 'ACTIVE' },
          });
          await db.evolutionLog.create({
            data: {
              generation: v.generation,
              action: 'PROMOTE',
              variantName: v.name,
              details: JSON.stringify({
                reason: `RELIABLE + winRate ${v.winRatePct.toFixed(1)}% > ${PROMOTE_WIN_RATE}%`,
                oldStatus: 'CANDIDATE',
                newStatus: 'ACTIVE',
                winRatePct: v.winRatePct,
                effectiveN: v.effectiveN,
                fitness: v.fitness,
                profitFactor: v.profitFactor,
                avgR: v.avgR,
              }),
            },
          });
          result.promoted++;
        } catch (rowErr) {
          console.error(
            '[strategy-tracker] promote failed for',
            v.name,
            rowErr,
          );
        }
      }
    } catch (e) {
      console.error('[strategy-tracker] promote phase failed:', e);
    }

    // --- 2. RETIRE ACTIVE → RETIRED ---------------------------------------
    try {
      const retireable = await db.strategyVariant.findMany({
        where: {
          status: 'ACTIVE',
          tier: 'RELIABLE',
          winRatePct: { lt: RETIRE_WIN_RATE },
          dataRegime: REAL_REGIME,
        },
      });

      for (const v of retireable) {
        try {
          await db.strategyVariant.update({
            where: { name: v.name },
            data: { status: 'RETIRED' },
          });
          await db.evolutionLog.create({
            data: {
              generation: v.generation,
              action: 'RETIRE',
              variantName: v.name,
              details: JSON.stringify({
                reason: `RELIABLE + winRate ${v.winRatePct.toFixed(1)}% < ${RETIRE_WIN_RATE}%`,
                oldStatus: 'ACTIVE',
                newStatus: 'RETIRED',
                winRatePct: v.winRatePct,
                effectiveN: v.effectiveN,
                fitness: v.fitness,
                profitFactor: v.profitFactor,
                avgR: v.avgR,
              }),
            },
          });
          result.retired++;
        } catch (rowErr) {
          console.error(
            '[strategy-tracker] retire failed for',
            v.name,
            rowErr,
          );
        }
      }
    } catch (e) {
      console.error('[strategy-tracker] retire phase failed:', e);
    }

    // --- 3. PRUNE old GRAVEYARD variants ----------------------------------
    try {
      const cutoff = new Date(
        Date.now() - GRAVEYARD_PRUNE_DAYS * 24 * 60 * 60 * 1000,
      );
      const prunable = await db.strategyVariant.findMany({
        where: {
          status: 'GRAVEYARD',
          updatedAt: { lt: cutoff },
          dataRegime: REAL_REGIME,
        },
      });

      for (const v of prunable) {
        try {
          // Log the PRUNE first (while the row still exists) so the audit
          // trail survives the delete.
          await db.evolutionLog.create({
            data: {
              generation: v.generation,
              action: 'PRUNE',
              variantName: v.name,
              details: JSON.stringify({
                reason: `GRAVEYARD > ${GRAVEYARD_PRUNE_DAYS} days (updatedAt=${v.updatedAt.toISOString()})`,
                winRatePct: v.winRatePct,
                effectiveN: v.effectiveN,
                fitness: v.fitness,
                totalPnl: v.totalPnl,
              }),
            },
          });
          await db.strategyVariant.delete({
            where: { name: v.name },
          });
          result.pruned++;
        } catch (rowErr) {
          console.error(
            '[strategy-tracker] prune failed for',
            v.name,
            rowErr,
          );
        }
      }
    } catch (e) {
      console.error('[strategy-tracker] prune phase failed:', e);
    }

    return result;
  } catch (err) {
    console.error('[strategy-tracker] evolveVariants failed:', err);
    return result;
  }
}

// ---------------------------------------------------------------------------
// GET VARIANT DETAIL
// ---------------------------------------------------------------------------

/**
 * Fetch a single StrategyVariant by name. Returns null if not found or on
 * error.
 */
export async function getVariantDetail(name: string): Promise<any> {
  try {
    if (!name) return null;
    return await db.strategyVariant.findUnique({
      where: { name },
    });
  } catch (err) {
    console.error('[strategy-tracker] getVariantDetail failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// RE-EXPORTS (for convenience — single import surface for callers)
// ---------------------------------------------------------------------------

export {
  calculateEffectiveN,
  getReliabilityTier,
  recomputeVariantEffectiveN,
} from './statistical-reliability';
