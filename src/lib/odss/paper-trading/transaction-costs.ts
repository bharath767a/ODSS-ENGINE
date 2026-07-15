/**
 * ODSS - Indian Options Transaction Cost Model
 * --------------------------------------------
 * Simulates realistic Indian options transaction costs (Zerodha-style)
 * for paper-trading strategy validation.
 *
 * Components (round-trip for a long-option trade):
 *   1. Brokerage      — ₹20 per executed order (flat) — entry + exit
 *   2. STT            — 0.05% on the SELL side (premium value)
 *   3. Exchange charge — 0.05% on turnover (NSE/BSE transaction charge)
 *   4. GST            — 18% on (brokerage + exchange charge)
 *   5. SEBI charge    — ₹10 per crore of turnover = 0.0001%
 *   6. Stamp duty     — 0.003% on the BUY side (premium value)
 *
 * References (Indian market regulations, 2024):
 *   - STT: Securities Transaction Tax Act
 *   - GST: 18% on brokerage + exchange txn charges
 *   - Stamp duty: Indian Stamp Act 1899 (revised 2020 — uniform across states)
 *   - SEBI: ₹10/crore turnover fee
 */

export interface CostConfig {
  /** Flat brokerage per executed order (₹). Zerodha-style = 20 */
  brokeragePerOrder: number;
  /** STT as % on sell-side premium (0.05 = 0.05%) */
  sttPerLakh: number;
  /** Exchange transaction charge as % (0.05 = 0.05%) */
  exchangeTxnChargePct: number;
  /** GST as % on (brokerage + exchange charge) (18 = 18%) */
  gstPct: number;
  /** SEBI charge as % (0.0001 = 0.0001%, equivalent to ₹10/crore) */
  sebiChargePerLakh: number;
  /** Stamp duty as % on buy-side premium (0.003 = 0.003%) */
  stampDutyPct: number;
}

/**
 * Default Indian options cost model (Zerodha-style retail brokerage).
 * All percentage fields are expressed as the percent number itself
 * (e.g. 0.05 means 0.05%, NOT 0.05 fraction).
 */
export const DEFAULT_COST_CONFIG: CostConfig = {
  brokeragePerOrder: 20,
  sttPerLakh: 0.05, // 0.05%
  exchangeTxnChargePct: 0.05,
  gstPct: 18,
  sebiChargePerLakh: 0.0001,
  stampDutyPct: 0.003,
};

export interface RoundTripCosts {
  entryBrokerage: number;
  exitBrokerage: number;
  stt: number;
  exchangeCharge: number;
  gst: number;
  sebiCharge: number;
  stampDuty: number;
  totalCosts: number;
}

/**
 * Calculate realistic round-trip transaction costs for a long-option trade.
 *
 * @param entryPrice premium per share at entry
 * @param exitPrice  premium per share at exit
 * @param quantity   total shares (lots × lotSize)
 * @param lots       number of lots (kept for API symmetry; brokerage is per ORDER, not per lot)
 * @param config     cost configuration (defaults to DEFAULT_COST_CONFIG)
 */
export function calculateRoundTripCosts(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  _lots: number,
  config: CostConfig = DEFAULT_COST_CONFIG,
): RoundTripCosts {
  // Guard against bad inputs (negative/NaN premiums are treated as zero)
  const safeEntry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 0;
  const safeExit = Number.isFinite(exitPrice) && exitPrice > 0 ? exitPrice : 0;
  const safeQty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;

  const entryPremiumValue = safeEntry * safeQty; // total premium paid (buy side)
  const exitPremiumValue = safeExit * safeQty;   // total premium received (sell side)
  const turnover = entryPremiumValue + exitPremiumValue;

  // 1. Brokerage — flat per order, one entry order + one exit order
  const entryBrokerage = config.brokeragePerOrder;
  const exitBrokerage = config.brokeragePerOrder;

  // 2. STT — sell side only, on premium received
  //    sttPerLakh is the percent value (0.05 means 0.05%)
  const stt = (exitPremiumValue * config.sttPerLakh) / 100;

  // 3. Exchange transaction charge — both sides, on turnover
  const entryExchange = (entryPremiumValue * config.exchangeTxnChargePct) / 100;
  const exitExchange = (exitPremiumValue * config.exchangeTxnChargePct) / 100;
  const exchangeCharge = entryExchange + exitExchange;

  // 4. GST — 18% on (brokerage + exchange charge)
  const totalBrokerage = entryBrokerage + exitBrokerage;
  const gst = ((totalBrokerage + exchangeCharge) * config.gstPct) / 100;

  // 5. SEBI charge — ₹10/crore = 0.0001% on turnover
  const sebiCharge = (turnover * config.sebiChargePerLakh) / 100;

  // 6. Stamp duty — buy side only, on premium paid
  const stampDuty = (entryPremiumValue * config.stampDutyPct) / 100;

  const totalCosts =
    entryBrokerage +
    exitBrokerage +
    stt +
    exchangeCharge +
    gst +
    sebiCharge +
    stampDuty;

  return {
    entryBrokerage,
    exitBrokerage,
    stt,
    exchangeCharge,
    gst,
    sebiCharge,
    stampDuty,
    totalCosts,
  };
}

/**
 * Compute entry-side costs only (brokerage + stamp duty on buy side +
 * exchange + GST + SEBI). Used when opening a paper trade to debit
 * the fund immediately for the entry costs.
 */
export function calculateEntryCosts(
  entryPrice: number,
  quantity: number,
  config: CostConfig = DEFAULT_COST_CONFIG,
): {
  brokerage: number;
  exchangeCharge: number;
  gst: number;
  sebiCharge: number;
  stampDuty: number;
  totalCosts: number;
} {
  const safeEntry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 0;
  const safeQty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  const premiumValue = safeEntry * safeQty;

  const brokerage = config.brokeragePerOrder;
  const exchangeCharge = (premiumValue * config.exchangeTxnChargePct) / 100;
  const sebiCharge = (premiumValue * config.sebiChargePerLakh) / 100;
  const stampDuty = (premiumValue * config.stampDutyPct) / 100;
  const gst = ((brokerage + exchangeCharge) * config.gstPct) / 100;

  return {
    brokerage,
    exchangeCharge,
    gst,
    sebiCharge,
    stampDuty,
    totalCosts: brokerage + exchangeCharge + sebiCharge + stampDuty + gst,
  };
}

/**
 * Compute exit-side costs only (brokerage + STT on sell side +
 * exchange + GST + SEBI). Used when closing a paper trade.
 */
export function calculateExitCosts(
  exitPrice: number,
  quantity: number,
  config: CostConfig = DEFAULT_COST_CONFIG,
): {
  brokerage: number;
  exchangeCharge: number;
  gst: number;
  sebiCharge: number;
  stt: number;
  totalCosts: number;
} {
  const safeExit = Number.isFinite(exitPrice) && exitPrice > 0 ? exitPrice : 0;
  const safeQty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  const premiumValue = safeExit * safeQty;

  const brokerage = config.brokeragePerOrder;
  const exchangeCharge = (premiumValue * config.exchangeTxnChargePct) / 100;
  const stt = (premiumValue * config.sttPerLakh) / 100;
  const sebiCharge = (premiumValue * config.sebiChargePerLakh) / 100;
  const gst = ((brokerage + exchangeCharge) * config.gstPct) / 100;

  return {
    brokerage,
    exchangeCharge,
    gst,
    sebiCharge,
    stt,
    totalCosts: brokerage + exchangeCharge + stt + sebiCharge + gst,
  };
}

/**
 * Extract a CostConfig from an arbitrary ODSS config object.
 * Falls back to DEFAULT_COST_CONFIG for any missing/invalid fields.
 *
 * Accepts several shapes:
 *   - CostConfig as-is
 *   - ODSSConfig with a nested .paperTrading or .costs object
 *   - Any object with sibling brokerage/stt/etc fields
 */
export function extractCostConfig(config: any): CostConfig {
  if (!config || typeof config !== 'object') {
    return { ...DEFAULT_COST_CONFIG };
  }

  // Allow nested shapes
  const src: any =
    config.paperTrading?.costs ??
    config.paperTrading ??
    config.costs ??
    config;

  const num = (v: any, fallback: number): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    brokeragePerOrder: num(src.brokeragePerOrder, DEFAULT_COST_CONFIG.brokeragePerOrder),
    sttPerLakh: num(src.sttPerLakh, DEFAULT_COST_CONFIG.sttPerLakh),
    exchangeTxnChargePct: num(src.exchangeTxnChargePct, DEFAULT_COST_CONFIG.exchangeTxnChargePct),
    gstPct: num(src.gstPct, DEFAULT_COST_CONFIG.gstPct),
    sebiChargePerLakh: num(src.sebiChargePerLakh, DEFAULT_COST_CONFIG.sebiChargePerLakh),
    stampDutyPct: num(src.stampDutyPct, DEFAULT_COST_CONFIG.stampDutyPct),
  };
}

/**
 * Check if the cost model has been explicitly disabled in the config.
 * When disabled, paper trades bypass all transaction cost calculations
 * (useful for backtest comparisons against a frictionless baseline).
 */
export function isCostModelDisabled(config: any): boolean {
  if (!config || typeof config !== 'object') return false;
  if (config.disableCosts === true) return true;
  if (config.enableCosts === false) return true;
  if (config.paperTrading?.disableCosts === true) return true;
  if (config.paperTrading?.enableCosts === false) return true;
  if (config.costs?.disabled === true) return true;
  if (config.costs?.enabled === false) return true;
  return false;
}
