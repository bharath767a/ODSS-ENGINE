/**
 * ODSS - Strategy Variant Templates
 * ----------------------------------
 * Predefined templates for the multi-strategy spawner. Each variant encodes
 * a coherent option-buying play with its own strike selection, risk parameters,
 * and target R-multiples. The spawner instantiates these as independent
 * PaperTrade experiments to discover which configurations perform best in
 * the current market regime.
 *
 * Variant taxonomy (long-options only in V1):
 *   - MomentumLongCall       : bullish momentum, ATM CE
 *   - TrendFollowLongPut     : bearish trend, ATM PE
 *   - BreakoutITMCall        : breakout confirmation, ITM CE (higher delta)
 *   - MeanReversionOTMPut    : overbought fade, OTM PE (cheaper leverage)
 *   - VWAPBounceLong         : VWAP reclaim, ATM CE
 */

export interface StrategyVariantTemplate {
  /** Unique variant name (used as variantId seed) */
  name: string;
  /** Underlying strategy family */
  strategy: string;
  /** Human-readable description of entry trigger */
  description: string;
  /** Option direction this variant trades */
  direction: 'CE' | 'PE' | 'BOTH';
  /** Default parameters used when spawning a paper trade from this variant */
  defaultParams: {
    strikeType: 'ATM' | 'ITM_1' | 'OTM_1';
    /** Stop-loss as fraction of entry premium (0.25 = 25% = -1R) */
    stopLossPct: number;
    /** First take-profit target, in R multiples */
    takeProfit1R: number;
    /** Second take-profit target, in R multiples */
    takeProfit2R: number;
    /** Maximum hold time in minutes before time-based exit */
    maxHoldTimeMin: number;
    /** Max loss per trade as fraction of fund capital (risk budget cap) */
    maxLossPerTradePct: number;
  };
}

/**
 * Canonical set of strategy variants shipped with ODSS V1.
 * The multi-strategy spawner instantiates each variant as an independent
 * paper-trade experiment, then the learning engine promotes/retires them
 * based on realized R-multiples.
 */
export const STRATEGY_VARIANTS: StrategyVariantTemplate[] = [
  {
    name: 'MomentumLongCall',
    strategy: 'LONG_CALL',
    description:
      'Buy ATM call when market score > 30 and technical score > 60',
    direction: 'CE',
    defaultParams: {
      strikeType: 'ATM',
      stopLossPct: 0.25,
      takeProfit1R: 1.5,
      takeProfit2R: 3.0,
      maxHoldTimeMin: 120,
      maxLossPerTradePct: 0.02,
    },
  },
  {
    name: 'TrendFollowLongPut',
    strategy: 'LONG_PUT',
    description:
      'Buy ATM put when market score < -30 and technical score > 60 (bearish)',
    direction: 'PE',
    defaultParams: {
      strikeType: 'ATM',
      stopLossPct: 0.25,
      takeProfit1R: 1.5,
      takeProfit2R: 3.0,
      maxHoldTimeMin: 120,
      maxLossPerTradePct: 0.02,
    },
  },
  {
    name: 'BreakoutITMCall',
    strategy: 'LONG_CALL',
    description: 'Buy ITM call on breakout with high volume',
    direction: 'CE',
    defaultParams: {
      strikeType: 'ITM_1',
      stopLossPct: 0.2,
      takeProfit1R: 2.0,
      takeProfit2R: 4.0,
      maxHoldTimeMin: 180,
      maxLossPerTradePct: 0.03,
    },
  },
  {
    name: 'MeanReversionOTMPut',
    strategy: 'LONG_PUT',
    description:
      'Buy OTM put on overbought conditions expecting mean reversion',
    direction: 'PE',
    defaultParams: {
      strikeType: 'OTM_1',
      stopLossPct: 0.3,
      takeProfit1R: 1.0,
      takeProfit2R: 2.0,
      maxHoldTimeMin: 60,
      maxLossPerTradePct: 0.015,
    },
  },
  {
    name: 'VWAPBounceLong',
    strategy: 'LONG_CALL',
    description: 'Buy call on VWAP bounce with volume confirmation',
    direction: 'CE',
    defaultParams: {
      strikeType: 'ATM',
      stopLossPct: 0.2,
      takeProfit1R: 1.5,
      takeProfit2R: 2.5,
      maxHoldTimeMin: 90,
      maxLossPerTradePct: 0.02,
    },
  },
];

/**
 * Look up a variant template by its unique name.
 * Returns undefined if no match.
 */
export function getVariantByName(name: string): StrategyVariantTemplate | undefined {
  if (!name || typeof name !== 'string') return undefined;
  return STRATEGY_VARIANTS.find((v) => v.name === name);
}

/**
 * Pick a uniformly random variant from the catalog.
 * Useful for fuzz-testing the paper trader and for the genetic spawner's
 * initial seeding phase.
 */
export function getRandomVariant(): StrategyVariantTemplate {
  const idx = Math.floor(Math.random() * STRATEGY_VARIANTS.length);
  // Guard against empty catalog (defensive; STRATEGY_VARIANTS is always non-empty)
  if (idx < 0 || idx >= STRATEGY_VARIANTS.length) {
    return STRATEGY_VARIANTS[0];
  }
  return STRATEGY_VARIANTS[idx];
}

/**
 * Return all variants matching the given direction filter.
 * Pass 'BOTH' to receive all variants regardless of direction.
 */
export function getVariantsByDirection(direction: 'CE' | 'PE' | 'BOTH'): StrategyVariantTemplate[] {
  if (direction === 'BOTH') return STRATEGY_VARIANTS;
  return STRATEGY_VARIANTS.filter(
    (v) => v.direction === direction || v.direction === 'BOTH',
  );
}
