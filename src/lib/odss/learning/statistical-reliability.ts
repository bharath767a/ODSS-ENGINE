/**
 * ODSS — Statistical Reliability Module
 * ===========================================================================
 * Pure (no-DB) statistical helpers used by the Learning Engine and the
 * Strategy Performance Tracker.
 *
 * Responsibilities:
 *   1. Effective sample-size discounting for correlated trades.
 *   2. Reliability tier classification (INSUFFICIENT / PRELIMINARY / RELIABLE).
 *   3. Wilson score 80% confidence intervals for win-rate estimates.
 *   4. Learning-bias deltas applied to engine decision scores.
 *
 * All functions are synchronous and side-effect free so they can be unit
 * tested in isolation and safely called from both server and edge contexts.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/** Minimum effective N for a pattern to escape INSUFFICIENT tier. */
export const PRELIMINARY_THRESHOLD = 10;

/** Minimum effective N for a pattern to be classified RELIABLE. */
export const RELIABLE_THRESHOLD = 30;

/**
 * Per-correlated-trade discount applied to the effective sample size.
 * Each correlated observation is treated as carrying only (1 - 0.15) = 85%
 * of an independent observation's information — the standard effective-sample
 * adjustment used in time-series statistics.
 */
export const CORRELATED_TRADE_DISCOUNT = 0.15;

/** Z-score for an 80% two-sided Wilson confidence interval. */
export const WILSON_Z_80PCT = 1.282;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export type ReliabilityTier = 'INSUFFICIENT' | 'PRELIMINARY' | 'RELIABLE';

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

export interface LearningBias {
  /** Score delta in [-1, +1] to apply to a decision score. */
  delta: number;
  /** Human-readable reason for the bias (for audit logs). */
  reason: string;
  /** The reliability tier that produced this bias. */
  tier: ReliabilityTier;
}

// ---------------------------------------------------------------------------
// EFFECTIVE SAMPLE SIZE
// ---------------------------------------------------------------------------

/**
 * Calculate the effective sample size after discounting for correlated trades.
 *
 * Each correlated trade reduces the effective sample by 15%
 * (CORRELATED_TRADE_DISCOUNT). This accounts for the statistical reality that
 * correlated observations carry less independent information than
 * uncorrelated ones — a standard adjustment in time-series analysis.
 *
 * Example:
 *   rawN=30, correlatedTrades=2  →  factor = 0.70  →  effectiveN = 21
 *   rawN=30, correlatedTrades=0  →  factor = 1.00  →  effectiveN = 30
 *   rawN=30, correlatedTrades=8  →  factor clamped to 0  →  effectiveN = 0
 *
 * Result is always non-negative.
 */
export function calculateEffectiveN(
  rawN: number,
  correlatedTrades: number,
): number {
  const safeRawN = Math.max(0, rawN);
  const ct = Math.max(0, correlatedTrades);
  // Multiplicative discount, clamped so it can never push N below zero.
  const factor = Math.max(0, 1 - CORRELATED_TRADE_DISCOUNT * ct);
  return Math.max(0, safeRawN * factor);
}

// ---------------------------------------------------------------------------
// RELIABILITY TIER CLASSIFICATION
// ---------------------------------------------------------------------------

/**
 * Classify a pattern/variant into a reliability tier based on its effective
 * sample size.
 *
 *   effectiveN <  10 → INSUFFICIENT  (no statistical power; ignore)
 *   effectiveN <  30 → PRELIMINARY   (directional only; wide CI)
 *   effectiveN >= 30 → RELIABLE      (statistically meaningful; act on it)
 */
export function getReliabilityTier(effectiveN: number): ReliabilityTier {
  if (effectiveN < PRELIMINARY_THRESHOLD) return 'INSUFFICIENT';
  if (effectiveN < RELIABLE_THRESHOLD) return 'PRELIMINARY';
  return 'RELIABLE';
}

// ---------------------------------------------------------------------------
// WILSON SCORE CONFIDENCE INTERVAL
// ---------------------------------------------------------------------------

/**
 * Wilson score confidence interval for a binomial win rate.
 *
 * More robust than the naive normal-approximation interval — it behaves
 * correctly for small N and for extreme win rates (near 0% or 100%).
 *
 * Formula (returns fractions in [0, 1]):
 *   p          = wins / total
 *   denom      = 1 + z²/total
 *   center     = (p + z²/(2·total)) / denom
 *   spread     = z · √(p·(1−p)/total + z²/(4·total²)) / denom
 *   lower      = center − spread   (clamped ≥ 0)
 *   upper      = center + spread   (clamped ≤ 1)
 *
 * Defaults to the 80% two-sided Z (WILSON_Z_80PCT = 1.282).
 *
 * Returns { lower: 0, upper: 0 } when total ≤ 0 (no observations).
 */
export function getWinRateConfidenceInterval(
  wins: number,
  total: number,
  z: number = WILSON_Z_80PCT,
): ConfidenceInterval {
  if (total <= 0 || wins < 0) {
    return { lower: 0, upper: 0 };
  }

  // Clamp wins into [0, total] to guard against corrupted data.
  const w = Math.min(Math.max(0, wins), total);
  const p = w / total;
  const z2 = z * z;

  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const spread =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) /
    denominator;

  const lower = Math.max(0, center - spread);
  const upper = Math.min(1, center + spread);

  return { lower, upper };
}

// ---------------------------------------------------------------------------
// LEARNING BIAS
// ---------------------------------------------------------------------------

/**
 * Compute the learning-bias delta to apply to a decision score.
 *
 * The delta lives in [-1, +1] and reflects how much historical performance
 * should nudge a fresh decision:
 *
 *   INSUFFICIENT  →  delta = 0                              (too little data)
 *   PRELIMINARY   →  delta = (winRatePct − 50) / 200, capped ±0.3
 *   RELIABLE      →  delta = (winRatePct − 50) / 100, capped ±0.5
 *
 * Examples (RELIABLE tier):
 *   winRatePct = 70  →  delta = +0.20   (meaningful bullish nudge)
 *   winRatePct = 60  →  delta = +0.10   (mild bullish nudge)
 *   winRatePct = 50  →  delta =  0.00   (neutral)
 *   winRatePct = 40  →  delta = −0.10   (mild bearish nudge)
 *   winRatePct = 30  →  delta = −0.20   (meaningful bearish nudge)
 *
 * `winRatePct` is expected in 0-100 scale.
 */
export function getLearningBias(
  effectiveN: number,
  winRatePct: number,
): LearningBias {
  const tier = getReliabilityTier(effectiveN);
  const effStr = effectiveN.toFixed(1);

  if (tier === 'INSUFFICIENT') {
    return {
      delta: 0,
      tier,
      reason: `Insufficient data (effectiveN=${effStr} < ${PRELIMINARY_THRESHOLD}) — no bias applied`,
    };
  }

  if (tier === 'PRELIMINARY') {
    const raw = (winRatePct - 50) / 200;
    const delta = Math.max(-0.3, Math.min(0.3, raw));
    const sign = delta >= 0 ? '+' : '';
    return {
      delta,
      tier,
      reason: `Preliminary data (effectiveN=${effStr}) — bias ${sign}${delta.toFixed(3)} (capped ±0.30)`,
    };
  }

  // RELIABLE
  const raw = (winRatePct - 50) / 100;
  const delta = Math.max(-0.5, Math.min(0.5, raw));
  const sign = delta >= 0 ? '+' : '';
  return {
    delta,
    tier,
    reason: `Reliable data (effectiveN=${effStr}) — bias ${sign}${delta.toFixed(3)} (capped ±0.50)`,
  };
}

// ---------------------------------------------------------------------------
// PATTERN / VARIANT EFFECTIVE-N RECOMPUTATION
// ---------------------------------------------------------------------------

/**
 * Recompute the effective sample size for a LearningPattern row.
 *
 * The pattern object is treated as `any` because Prisma's generated type is
 * not imported here (keeps this module DB-agnostic). The function defensively
 * reads `rawN` and an optional `correlatedTrades` count (which the current
 * schema does not persist — it defaults to 0, treating all recorded trades as
 * independent until future schema extensions add correlation tracking).
 */
export function recomputePatternEffectiveN(pattern: any): number {
  if (!pattern) return 0;
  const rawN = typeof pattern.rawN === 'number' ? pattern.rawN : 0;
  const correlatedTrades =
    typeof pattern.correlatedTrades === 'number' ? pattern.correlatedTrades : 0;
  return calculateEffectiveN(rawN, correlatedTrades);
}

/**
 * Recompute the effective sample size for a StrategyVariant row.
 *
 * Same logic as `recomputePatternEffectiveN` — variants may also carry a
 * `correlatedTrades` metadata count (defaults to 0 when absent).
 */
export function recomputeVariantEffectiveN(variant: any): number {
  if (!variant) return 0;
  const rawN = typeof variant.rawN === 'number' ? variant.rawN : 0;
  const correlatedTrades =
    typeof variant.correlatedTrades === 'number'
      ? variant.correlatedTrades
      : 0;
  return calculateEffectiveN(rawN, correlatedTrades);
}
