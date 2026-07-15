/**
 * ODSS Strategy Lab — Strategy Genome Definition
 * ====================================================================
 *
 * A StrategyGenome is a JSON object that fully describes a trading
 * strategy's parameters. The genetic algorithm (evolution-engine.ts)
 * treats each genome as an individual: it mutates, crosses-over, and
 * scores them via the strategy-performance-tracker / paper-trade P&L.
 *
 * Every parameter is constrained to a documented valid range. After
 * mutation, parameters are clamped back into range so a genome is
 * always executable by the trade-management / entry / exit engines.
 *
 * This module is PURE — no DB, no I/O, no side effects. That keeps
 * it trivially unit-testable and safe to call from server routes,
 * background jobs, and the evolution loop alike.
 * ====================================================================
 */

// ----------------------------------------------------------------------------
// Types & enums
// ----------------------------------------------------------------------------

export type StrategyType =
  | 'LONG_CALL'
  | 'LONG_PUT'
  | 'BULL_CALL_SPREAD'
  | 'BEAR_PUT_SPREAD'
  | 'STRADDLE'
  | 'STRANGLE'
  | 'IRON_CONDOR';

export type EntryType =
  | 'MARKET'
  | 'BREAKOUT'
  | 'RETEST'
  | 'VWAP'
  | 'LIQUIDITY_SWEEP';

export type StrikeType = 'ATM' | 'ITM_1' | 'ITM_2' | 'OTM_1' | 'OTM_2';

export type PositionSizingMethod =
  | 'FIXED'
  | 'KELLY'
  | 'VOLATILITY_ADJUSTED';

export interface StrategyGenome {
  // Strategy type
  strategy: StrategyType;

  // Entry rules
  entryRules: {
    minMarketScore: number;       // -100..100, min market engine score required
    minRSscore: number;           // 0..100, min relative strength rank
    minTechnicalScore: number;    // 0..100, min technical engine score
    minOptionChainScore: number;  // 0..100, min option chain score
    minRR: number;                // 1.0..5.0, min risk-reward ratio
    maxVix: number;               // 8..40, max VIX to enter
    minVix: number;               // 8..40, min VIX to enter
    entryType: EntryType;
    requireConfluence: boolean;   // require aligned votes
  };

  // Strike selection
  strikeSelection: {
    strikeType: StrikeType;
    deltaTarget: number;          // 0.3..0.7
    minOpenInterest: number;      // minimum OI for liquidity
    maxBidAskSpreadPct: number;   // max spread as % of premium
  };

  // Exit rules
  exitRules: {
    stopLossPct: number;          // 0.1..0.5 (10%-50% of premium)
    takeProfit1R: number;         // 1.0..3.0 (exit 50% at 1R)
    takeProfit2R: number;         // 2.0..5.0 (exit 30% at 2R)
    trailingStopPct: number;      // 0.05..0.20 (5%-20% trailing)
    maxHoldTimeMin: number;       // 15..480 (max minutes to hold)
    exitOnVixSpike: boolean;      // exit if VIX spikes > 2 points
    exitOnEOD: boolean;           // exit at end of day
  };

  // Risk management
  riskRules: {
    maxLossPerTradePct: number;     // 0.01..0.05 (1%-5% of capital)
    maxConcurrentPositions: number; // 1..5
    maxDailyLossPct: number;        // 0.02..0.10 (2%-10%)
    profitCapPct: number;           // 0.02..0.15 (2%-15%)
    requireGuardrailCheck: boolean;
  };

  // Position sizing
  positionSizing: {
    method: PositionSizingMethod;
    fixedLots: number;            // 1..5
    kellyFraction: number;        // 0.1..0.5 (Kelly criterion fraction)
    volAdjustBase: number;        // base lots for VOLATILITY_ADJUSTED
  };
}

// ----------------------------------------------------------------------------
// Range tables — single source of truth for clamping & random sampling
// ----------------------------------------------------------------------------

interface NumRange {
  min: number;
  max: number;
  step?: number; // optional quantization (e.g. integers)
}

const RANGES = {
  'entryRules.minMarketScore': { min: -100, max: 100 },
  'entryRules.minRSscore': { min: 0, max: 100 },
  'entryRules.minTechnicalScore': { min: 0, max: 100 },
  'entryRules.minOptionChainScore': { min: 0, max: 100 },
  'entryRules.minRR': { min: 1.0, max: 5.0 },
  'entryRules.maxVix': { min: 8, max: 40 },
  'entryRules.minVix': { min: 8, max: 40 },
  'strikeSelection.deltaTarget': { min: 0.3, max: 0.7 },
  'strikeSelection.minOpenInterest': { min: 0, max: 100000, step: 100 },
  'strikeSelection.maxBidAskSpreadPct': { min: 0.01, max: 0.2 },
  'exitRules.stopLossPct': { min: 0.1, max: 0.5 },
  'exitRules.takeProfit1R': { min: 1.0, max: 3.0 },
  'exitRules.takeProfit2R': { min: 2.0, max: 5.0 },
  'exitRules.trailingStopPct': { min: 0.05, max: 0.2 },
  'exitRules.maxHoldTimeMin': { min: 15, max: 480, step: 5 },
  'riskRules.maxLossPerTradePct': { min: 0.01, max: 0.05 },
  'riskRules.maxConcurrentPositions': { min: 1, max: 5, step: 1 },
  'riskRules.maxDailyLossPct': { min: 0.02, max: 0.1 },
  'riskRules.profitCapPct': { min: 0.02, max: 0.15 },
  'positionSizing.fixedLots': { min: 1, max: 5, step: 1 },
  'positionSizing.kellyFraction': { min: 0.1, max: 0.5 },
  'positionSizing.volAdjustBase': { min: 1, max: 5, step: 1 },
} as const;

const STRATEGY_TYPES: StrategyType[] = [
  'LONG_CALL',
  'LONG_PUT',
  'BULL_CALL_SPREAD',
  'BEAR_PUT_SPREAD',
  'STRADDLE',
  'STRANGLE',
  'IRON_CONDOR',
];

const ENTRY_TYPES: EntryType[] = [
  'MARKET',
  'BREAKOUT',
  'RETEST',
  'VWAP',
  'LIQUIDITY_SWEEP',
];

const STRIKE_TYPES: StrikeType[] = ['ATM', 'ITM_1', 'ITM_2', 'OTM_1', 'OTM_2'];

const SIZING_METHODS: PositionSizingMethod[] = [
  'FIXED',
  'KELLY',
  'VOLATILITY_ADJUSTED',
];

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function randUniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(randUniform(min, max + 1));
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(value: number, range: NumRange): number {
  const { min, max, step } = range;
  let v = value;
  if (v < min) v = min;
  if (v > max) v = max;
  if (step && step > 0) {
    v = Math.round((v - min) / step) * step + min;
    // re-clamp in case quantization pushed past max
    if (v > max) v -= step;
    if (v < min) v = min;
  }
  return v;
}

function quantize(value: number, range: NumRange): number {
  return clamp(value, range);
}

function round(value: number, digits: number = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function randomNum(range: NumRange): number {
  const { min, max, step } = range;
  let v = randUniform(min, max);
  if (step && step > 0) {
    v = clamp(v, range);
  }
  return v;
}

// ----------------------------------------------------------------------------
// randomGenome
// ----------------------------------------------------------------------------

export function randomGenome(): StrategyGenome {
  // VIX bounds — keep minVix <= maxVix
  const minVix = round(randUniform(8, 25), 1);
  const maxVix = round(randUniform(Math.max(minVix + 1, 14), 40), 1);

  // TP ladders — keep TP1R <= TP2R
  const tp1R = round(randUniform(1.0, 2.5), 2);
  const tp2R = round(randUniform(Math.max(tp1R + 0.5, 2.0), 5.0), 2);

  return {
    strategy: pick(STRATEGY_TYPES),
    entryRules: {
      minMarketScore: round(randUniform(-30, 60), 0),
      minRSscore: round(randUniform(40, 80), 0),
      minTechnicalScore: round(randUniform(45, 80), 0),
      minOptionChainScore: round(randUniform(45, 80), 0),
      minRR: round(randUniform(1.5, 3.0), 2),
      minVix,
      maxVix,
      entryType: pick(ENTRY_TYPES),
      requireConfluence: Math.random() < 0.6,
    },
    strikeSelection: {
      strikeType: pick(STRIKE_TYPES),
      deltaTarget: round(randUniform(0.4, 0.6), 2),
      minOpenInterest: randomNum(RANGES['strikeSelection.minOpenInterest']),
      maxBidAskSpreadPct: round(randUniform(0.05, 0.15), 3),
    },
    exitRules: {
      stopLossPct: round(randUniform(0.2, 0.4), 2),
      takeProfit1R: tp1R,
      takeProfit2R: tp2R,
      trailingStopPct: round(randUniform(0.08, 0.15), 3),
      maxHoldTimeMin: randomNum(RANGES['exitRules.maxHoldTimeMin']),
      exitOnVixSpike: Math.random() < 0.7,
      exitOnEOD: Math.random() < 0.85,
    },
    riskRules: {
      maxLossPerTradePct: round(randUniform(0.02, 0.04), 3),
      maxConcurrentPositions: randInt(1, 3),
      maxDailyLossPct: round(randUniform(0.03, 0.07), 3),
      profitCapPct: round(randUniform(0.05, 0.1), 3),
      requireGuardrailCheck: Math.random() < 0.8,
    },
    positionSizing: {
      method: pick(SIZING_METHODS),
      fixedLots: randInt(1, 3),
      kellyFraction: round(randUniform(0.2, 0.4), 2),
      volAdjustBase: randInt(1, 3),
    },
  };
}

// ----------------------------------------------------------------------------
// mutateGenome
// ----------------------------------------------------------------------------

function maybeMutateNum(
  value: number,
  range: NumRange,
  rate: number,
): number {
  if (Math.random() >= rate) return quantize(value, range);
  // ±10% random walk relative to the *range width*, not the value itself,
  // so parameters near 0 (e.g. minMarketScore) still drift meaningfully.
  const span = range.max - range.min;
  const delta = (Math.random() - 0.5) * 0.2 * span; // ±10% of span
  return quantize(value + delta, range);
}

function maybeMutateBool(value: boolean, rate: number): boolean {
  if (Math.random() >= rate) return value;
  return !value;
}

function maybeMutateEnum<T extends string>(
  value: T,
  options: readonly T[],
  rate: number,
): T {
  if (Math.random() >= rate) return value;
  // Pick a *different* value
  const others = options.filter((o) => o !== value);
  return others[Math.floor(Math.random() * others.length)];
}

export function mutateGenome(
  genome: StrategyGenome,
  mutationRate: number = 0.15,
): StrategyGenome {
  const g = cloneGenome(genome);
  const rate = Math.max(0, Math.min(1, mutationRate));

  g.strategy = maybeMutateEnum(g.strategy, STRATEGY_TYPES, rate);

  // entryRules
  g.entryRules.minMarketScore = maybeMutateNum(
    g.entryRules.minMarketScore,
    RANGES['entryRules.minMarketScore'],
    rate,
  );
  g.entryRules.minRSscore = maybeMutateNum(
    g.entryRules.minRSscore,
    RANGES['entryRules.minRSscore'],
    rate,
  );
  g.entryRules.minTechnicalScore = maybeMutateNum(
    g.entryRules.minTechnicalScore,
    RANGES['entryRules.minTechnicalScore'],
    rate,
  );
  g.entryRules.minOptionChainScore = maybeMutateNum(
    g.entryRules.minOptionChainScore,
    RANGES['entryRules.minOptionChainScore'],
    rate,
  );
  g.entryRules.minRR = maybeMutateNum(
    g.entryRules.minRR,
    RANGES['entryRules.minRR'],
    rate,
  );
  // VIX — mutate each, then enforce minVix <= maxVix
  let minVix = maybeMutateNum(
    g.entryRules.minVix,
    RANGES['entryRules.minVix'],
    rate,
  );
  let maxVix = maybeMutateNum(
    g.entryRules.maxVix,
    RANGES['entryRules.maxVix'],
    rate,
  );
  if (minVix > maxVix) {
    const tmp = minVix;
    minVix = maxVix;
    maxVix = tmp;
  }
  g.entryRules.minVix = minVix;
  g.entryRules.maxVix = maxVix;
  g.entryRules.entryType = maybeMutateEnum(g.entryRules.entryType, ENTRY_TYPES, rate);
  g.entryRules.requireConfluence = maybeMutateBool(
    g.entryRules.requireConfluence,
    rate,
  );

  // strikeSelection
  g.strikeSelection.strikeType = maybeMutateEnum(
    g.strikeSelection.strikeType,
    STRIKE_TYPES,
    rate,
  );
  g.strikeSelection.deltaTarget = maybeMutateNum(
    g.strikeSelection.deltaTarget,
    RANGES['strikeSelection.deltaTarget'],
    rate,
  );
  g.strikeSelection.minOpenInterest = maybeMutateNum(
    g.strikeSelection.minOpenInterest,
    RANGES['strikeSelection.minOpenInterest'],
    rate,
  );
  g.strikeSelection.maxBidAskSpreadPct = maybeMutateNum(
    g.strikeSelection.maxBidAskSpreadPct,
    RANGES['strikeSelection.maxBidAskSpreadPct'],
    rate,
  );

  // exitRules — enforce TP1R <= TP2R after mutation
  let tp1R = maybeMutateNum(
    g.exitRules.takeProfit1R,
    RANGES['exitRules.takeProfit1R'],
    rate,
  );
  let tp2R = maybeMutateNum(
    g.exitRules.takeProfit2R,
    RANGES['exitRules.takeProfit2R'],
    rate,
  );
  if (tp1R > tp2R) {
    const tmp = tp1R;
    tp1R = tp2R;
    tp2R = tmp;
  }
  g.exitRules.takeProfit1R = tp1R;
  g.exitRules.takeProfit2R = tp2R;
  g.exitRules.stopLossPct = maybeMutateNum(
    g.exitRules.stopLossPct,
    RANGES['exitRules.stopLossPct'],
    rate,
  );
  g.exitRules.trailingStopPct = maybeMutateNum(
    g.exitRules.trailingStopPct,
    RANGES['exitRules.trailingStopPct'],
    rate,
  );
  g.exitRules.maxHoldTimeMin = maybeMutateNum(
    g.exitRules.maxHoldTimeMin,
    RANGES['exitRules.maxHoldTimeMin'],
    rate,
  );
  g.exitRules.exitOnVixSpike = maybeMutateBool(g.exitRules.exitOnVixSpike, rate);
  g.exitRules.exitOnEOD = maybeMutateBool(g.exitRules.exitOnEOD, rate);

  // riskRules
  g.riskRules.maxLossPerTradePct = maybeMutateNum(
    g.riskRules.maxLossPerTradePct,
    RANGES['riskRules.maxLossPerTradePct'],
    rate,
  );
  g.riskRules.maxConcurrentPositions = maybeMutateNum(
    g.riskRules.maxConcurrentPositions,
    RANGES['riskRules.maxConcurrentPositions'],
    rate,
  );
  g.riskRules.maxDailyLossPct = maybeMutateNum(
    g.riskRules.maxDailyLossPct,
    RANGES['riskRules.maxDailyLossPct'],
    rate,
  );
  g.riskRules.profitCapPct = maybeMutateNum(
    g.riskRules.profitCapPct,
    RANGES['riskRules.profitCapPct'],
    rate,
  );
  g.riskRules.requireGuardrailCheck = maybeMutateBool(
    g.riskRules.requireGuardrailCheck,
    rate,
  );

  // positionSizing
  g.positionSizing.method = maybeMutateEnum(
    g.positionSizing.method,
    SIZING_METHODS,
    rate,
  );
  g.positionSizing.fixedLots = maybeMutateNum(
    g.positionSizing.fixedLots,
    RANGES['positionSizing.fixedLots'],
    rate,
  );
  g.positionSizing.kellyFraction = maybeMutateNum(
    g.positionSizing.kellyFraction,
    RANGES['positionSizing.kellyFraction'],
    rate,
  );
  g.positionSizing.volAdjustBase = maybeMutateNum(
    g.positionSizing.volAdjustBase,
    RANGES['positionSizing.volAdjustBase'],
    rate,
  );

  return g;
}

// ----------------------------------------------------------------------------
// crossoverGenome — uniform crossover at the field level
// ----------------------------------------------------------------------------

export function crossoverGenome(
  parent1: StrategyGenome,
  parent2: StrategyGenome,
): StrategyGenome {
  const from = <T>(a: T, b: T): T => (Math.random() < 0.5 ? a : b);

  // VIX and TP ladders: if we pick independently from each parent, the
  // min<=max invariant could break, so pick the pair atomically from one
  // parent for those coupled fields.
  const vixFromParent1 = Math.random() < 0.5;
  const tpFromParent1 = Math.random() < 0.5;

  return {
    strategy: from(parent1.strategy, parent2.strategy),
    entryRules: {
      minMarketScore: from(parent1.entryRules.minMarketScore, parent2.entryRules.minMarketScore),
      minRSscore: from(parent1.entryRules.minRSscore, parent2.entryRules.minRSscore),
      minTechnicalScore: from(parent1.entryRules.minTechnicalScore, parent2.entryRules.minTechnicalScore),
      minOptionChainScore: from(parent1.entryRules.minOptionChainScore, parent2.entryRules.minOptionChainScore),
      minRR: from(parent1.entryRules.minRR, parent2.entryRules.minRR),
      minVix: vixFromParent1 ? parent1.entryRules.minVix : parent2.entryRules.minVix,
      maxVix: vixFromParent1 ? parent1.entryRules.maxVix : parent2.entryRules.maxVix,
      entryType: from(parent1.entryRules.entryType, parent2.entryRules.entryType),
      requireConfluence: from(parent1.entryRules.requireConfluence, parent2.entryRules.requireConfluence),
    },
    strikeSelection: {
      strikeType: from(parent1.strikeSelection.strikeType, parent2.strikeSelection.strikeType),
      deltaTarget: from(parent1.strikeSelection.deltaTarget, parent2.strikeSelection.deltaTarget),
      minOpenInterest: from(parent1.strikeSelection.minOpenInterest, parent2.strikeSelection.minOpenInterest),
      maxBidAskSpreadPct: from(parent1.strikeSelection.maxBidAskSpreadPct, parent2.strikeSelection.maxBidAskSpreadPct),
    },
    exitRules: {
      stopLossPct: from(parent1.exitRules.stopLossPct, parent2.exitRules.stopLossPct),
      takeProfit1R: tpFromParent1 ? parent1.exitRules.takeProfit1R : parent2.exitRules.takeProfit1R,
      takeProfit2R: tpFromParent1 ? parent1.exitRules.takeProfit2R : parent2.exitRules.takeProfit2R,
      trailingStopPct: from(parent1.exitRules.trailingStopPct, parent2.exitRules.trailingStopPct),
      maxHoldTimeMin: from(parent1.exitRules.maxHoldTimeMin, parent2.exitRules.maxHoldTimeMin),
      exitOnVixSpike: from(parent1.exitRules.exitOnVixSpike, parent2.exitRules.exitOnVixSpike),
      exitOnEOD: from(parent1.exitRules.exitOnEOD, parent2.exitRules.exitOnEOD),
    },
    riskRules: {
      maxLossPerTradePct: from(parent1.riskRules.maxLossPerTradePct, parent2.riskRules.maxLossPerTradePct),
      maxConcurrentPositions: from(parent1.riskRules.maxConcurrentPositions, parent2.riskRules.maxConcurrentPositions),
      maxDailyLossPct: from(parent1.riskRules.maxDailyLossPct, parent2.riskRules.maxDailyLossPct),
      profitCapPct: from(parent1.riskRules.profitCapPct, parent2.riskRules.profitCapPct),
      requireGuardrailCheck: from(parent1.riskRules.requireGuardrailCheck, parent2.riskRules.requireGuardrailCheck),
    },
    positionSizing: {
      method: from(parent1.positionSizing.method, parent2.positionSizing.method),
      fixedLots: from(parent1.positionSizing.fixedLots, parent2.positionSizing.fixedLots),
      kellyFraction: from(parent1.positionSizing.kellyFraction, parent2.positionSizing.kellyFraction),
      volAdjustBase: from(parent1.positionSizing.volAdjustBase, parent2.positionSizing.volAdjustBase),
    },
  };
}

// ----------------------------------------------------------------------------
// genomeToString — compact display
// ----------------------------------------------------------------------------

const STRATEGY_SHORT: Record<StrategyType, string> = {
  LONG_CALL: 'LongCall',
  LONG_PUT: 'LongPut',
  BULL_CALL_SPREAD: 'BullCallSpread',
  BEAR_PUT_SPREAD: 'BearPutSpread',
  STRADDLE: 'Straddle',
  STRANGLE: 'Strangle',
  IRON_CONDOR: 'IronCondor',
};

export function genomeToString(genome: StrategyGenome): string {
  const parts: string[] = [];
  parts.push(STRATEGY_SHORT[genome.strategy] ?? genome.strategy);
  parts.push(`MS>${Math.round(genome.entryRules.minMarketScore)}`);
  parts.push(`RR>${genome.entryRules.minRR.toFixed(1)}`);
  parts.push(`SL${Math.round(genome.exitRules.stopLossPct * 100)}%`);
  parts.push(`TP${genome.exitRules.takeProfit1R.toFixed(1)}R`);
  if (genome.exitRules.exitOnEOD) parts.push('EOD');
  if (genome.exitRules.exitOnVixSpike) parts.push('VIXx');
  if (genome.entryRules.requireConfluence) parts.push('Conf');
  parts.push(genome.entryRules.entryType);
  return parts.join('|');
}

// ----------------------------------------------------------------------------
// genomeToName — unique-ish human-readable name
// ----------------------------------------------------------------------------

function shortHash(n: number = 4): string {
  return Math.random().toString(36).slice(2, 2 + n);
}

export function genomeToName(genome: StrategyGenome): string {
  const base = STRATEGY_SHORT[genome.strategy] ?? genome.strategy;
  // Pseudo-version: combine a time-slice (minute-of-day modulo) and a 4-char
  // random hash. Good enough for a unique-ish display name in a small DB;
  // the DB unique constraint is the real guarantee.
  const version = 1 + (Math.floor(Date.now() / 60000) % 99);
  return `${base}-v${version}-${shortHash(4)}`;
}

// ----------------------------------------------------------------------------
// parseGenome — defensive JSON parse + shape validation
// ----------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStrIn<T extends string>(
  v: unknown,
  allowed: readonly T[],
): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v);
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseGenome(json: string): StrategyGenome | null {
  try {
    const raw = JSON.parse(json);
    return validateGenome(raw);
  } catch {
    return null;
  }
}

export function validateGenome(raw: unknown): StrategyGenome | null {
  if (!isObject(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (!isStrIn(r.strategy, STRATEGY_TYPES)) return null;

  const e = r.entryRules;
  if (!isObject(e)) return null;
  if (!isNum(e.minMarketScore)) return null;
  if (!isNum(e.minRSscore)) return null;
  if (!isNum(e.minTechnicalScore)) return null;
  if (!isNum(e.minOptionChainScore)) return null;
  if (!isNum(e.minRR)) return null;
  if (!isNum(e.maxVix)) return null;
  if (!isNum(e.minVix)) return null;
  if (!isStrIn(e.entryType, ENTRY_TYPES)) return null;
  if (!isBool(e.requireConfluence)) return null;

  const s = r.strikeSelection;
  if (!isObject(s)) return null;
  if (!isStrIn(s.strikeType, STRIKE_TYPES)) return null;
  if (!isNum(s.deltaTarget)) return null;
  if (!isNum(s.minOpenInterest)) return null;
  if (!isNum(s.maxBidAskSpreadPct)) return null;

  const x = r.exitRules;
  if (!isObject(x)) return null;
  if (!isNum(x.stopLossPct)) return null;
  if (!isNum(x.takeProfit1R)) return null;
  if (!isNum(x.takeProfit2R)) return null;
  if (!isNum(x.trailingStopPct)) return null;
  if (!isNum(x.maxHoldTimeMin)) return null;
  if (!isBool(x.exitOnVixSpike)) return null;
  if (!isBool(x.exitOnEOD)) return null;

  const k = r.riskRules;
  if (!isObject(k)) return null;
  if (!isNum(k.maxLossPerTradePct)) return null;
  if (!isNum(k.maxConcurrentPositions)) return null;
  if (!isNum(k.maxDailyLossPct)) return null;
  if (!isNum(k.profitCapPct)) return null;
  if (!isBool(k.requireGuardrailCheck)) return null;

  const p = r.positionSizing;
  if (!isObject(p)) return null;
  if (!isStrIn(p.method, SIZING_METHODS)) return null;
  if (!isNum(p.fixedLots)) return null;
  if (!isNum(p.kellyFraction)) return null;
  if (!isNum(p.volAdjustBase)) return null;

  // Re-clamp every numeric to its valid range — trust nothing from disk.
  return {
    strategy: r.strategy,
    entryRules: {
      minMarketScore: quantize(e.minMarketScore, RANGES['entryRules.minMarketScore']),
      minRSscore: quantize(e.minRSscore, RANGES['entryRules.minRSscore']),
      minTechnicalScore: quantize(e.minTechnicalScore, RANGES['entryRules.minTechnicalScore']),
      minOptionChainScore: quantize(e.minOptionChainScore, RANGES['entryRules.minOptionChainScore']),
      minRR: quantize(e.minRR, RANGES['entryRules.minRR']),
      minVix: quantize(e.minVix, RANGES['entryRules.minVix']),
      maxVix: quantize(e.maxVix, RANGES['entryRules.maxVix']),
      entryType: e.entryType,
      requireConfluence: e.requireConfluence,
    },
    strikeSelection: {
      strikeType: s.strikeType,
      deltaTarget: quantize(s.deltaTarget, RANGES['strikeSelection.deltaTarget']),
      minOpenInterest: quantize(s.minOpenInterest, RANGES['strikeSelection.minOpenInterest']),
      maxBidAskSpreadPct: quantize(s.maxBidAskSpreadPct, RANGES['strikeSelection.maxBidAskSpreadPct']),
    },
    exitRules: {
      stopLossPct: quantize(x.stopLossPct, RANGES['exitRules.stopLossPct']),
      takeProfit1R: quantize(x.takeProfit1R, RANGES['exitRules.takeProfit1R']),
      takeProfit2R: quantize(x.takeProfit2R, RANGES['exitRules.takeProfit2R']),
      trailingStopPct: quantize(x.trailingStopPct, RANGES['exitRules.trailingStopPct']),
      maxHoldTimeMin: quantize(x.maxHoldTimeMin, RANGES['exitRules.maxHoldTimeMin']),
      exitOnVixSpike: x.exitOnVixSpike,
      exitOnEOD: x.exitOnEOD,
    },
    riskRules: {
      maxLossPerTradePct: quantize(k.maxLossPerTradePct, RANGES['riskRules.maxLossPerTradePct']),
      maxConcurrentPositions: quantize(k.maxConcurrentPositions, RANGES['riskRules.maxConcurrentPositions']),
      maxDailyLossPct: quantize(k.maxDailyLossPct, RANGES['riskRules.maxDailyLossPct']),
      profitCapPct: quantize(k.profitCapPct, RANGES['riskRules.profitCapPct']),
      requireGuardrailCheck: k.requireGuardrailCheck,
    },
    positionSizing: {
      method: p.method,
      fixedLots: quantize(p.fixedLots, RANGES['positionSizing.fixedLots']),
      kellyFraction: quantize(p.kellyFraction, RANGES['positionSizing.kellyFraction']),
      volAdjustBase: quantize(p.volAdjustBase, RANGES['positionSizing.volAdjustBase']),
    },
  };
}

// ----------------------------------------------------------------------------
// Utility — clone a genome deeply
// ----------------------------------------------------------------------------

export function cloneGenome(g: StrategyGenome): StrategyGenome {
  return JSON.parse(JSON.stringify(g)) as StrategyGenome;
}

// Export ranges for downstream tooling (e.g. UI sliders)
export { RANGES, STRATEGY_TYPES, ENTRY_TYPES, STRIKE_TYPES, SIZING_METHODS };
