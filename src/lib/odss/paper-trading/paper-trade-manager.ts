/**
 * ODSS - Paper Trading Manager
 * ----------------------------
 * Simulates options trades with realistic fills, Indian-market transaction
 * costs, and P&L tracking. Used for strategy validation without real money.
 *
 * Architecture:
 *   - PaperTrade   : one row per simulated trade (entry + exit + P&L)
 *   - PaperFund    : single-row account ledger (balance, win/loss stats)
 *
 * Trade lifecycle:
 *   openPaperTrade()
 *     1. Price entry using Black-Scholes (no live premium in sandbox)
 *     2. Compute entry-side costs (brokerage + stamp duty + exchange + GST + SEBI)
 *     3. Insert PaperTrade row with status='OPEN'
 *     4. Debit PaperFund.balance by (entryPremium + entryCosts), ++openPositions
 *
 *   closePaperTrade()
 *     1. Price exit using Black-Scholes at the new underlying level
 *     2. Compute exit-side costs (brokerage + STT + exchange + GST + SEBI)
 *     3. grossPnl = (exitPrice - entryPrice) * qty * lotSize  [long options]
 *     4. netPnl  = grossPnl - totalCosts
 *     5. rMultiple = netPnl / initialRisk   (initialRisk = entryPremium * stopLossPct)
 *     6. Update trade row -> status='CLOSED'
 *     7. Credit PaperFund.balance by (exitPremium - exitCosts), update win/loss tallies
 *     8. Best-effort record outcome to learning engine
 */

import { db } from '@/lib/db';
import { blackScholes, priceOption } from './bs-pricing';
import {
  calculateRoundTripCosts,
  calculateEntryCosts,
  calculateExitCosts,
  extractCostConfig,
  isCostModelDisabled,
  DEFAULT_COST_CONFIG,
  type CostConfig,
} from './transaction-costs';
import { getSymbolMeta } from '@/lib/odss/universe';

// ---------------------------------------------------------------------------
// Constants & defaults
// ---------------------------------------------------------------------------

const DEFAULT_STARTING_CAPITAL = 100_000; // ₹1,00,000
const DEFAULT_LOT_SIZE = 50;
const DEFAULT_IV = 15;             // 15% — typical low-vol NIFTY environment
const DEFAULT_DAYS_TO_EXPIRY = 7;  // weekly Thursday expiry
const DEFAULT_RISK_FREE_RATE = 0.07; // India 10Y G-Sec
const DEFAULT_STOP_LOSS_PCT = 0.25; // 25% premium decay = -1R for long options

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PaperTradeParams {
  symbol: string;
  direction: 'CE' | 'PE';
  strategy?: string;          // default 'LONG_CALL' / 'LONG_PUT'
  entryStrike: number;
  entryUnderlying: number;
  entryType?: string;         // default 'MARKET'
  quantity?: number;          // lots, default 1
  lotSize?: number;           // default from universe or 50
  iv?: number;                // % IV for BS pricing, default 15
  daysToExpiry?: number;      // default 7
  marketState?: string;
  vixAtEntry?: number;
  sector?: string;
  variantGroup?: string;
  variantId?: string;
  /** Optional live premium — if provided, used instead of BS pricing */
  entryPremium?: number;
  /** Stop-loss % used to compute R-multiple (default 0.25) */
  stopLossPct?: number;
}

export interface OpenPaperTradeResult {
  tradeId: string;
  entryPrice: number;
  costs: number;
}

export interface ClosePaperTradeResult {
  exitPrice: number;
  grossPnl: number;
  netPnl: number;
  costs: number;
  rMultiple: number;
}

export interface PaperTradePerformance {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgR: number;
  profitFactor: number;
  maxDrawdown: number;
  currentBalance: number;
  startingCapital: number;
  returnPct: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get the single-row PaperFund, creating it with the default balance if missing. */
async function getOrCreateFund(startingCapital: number = DEFAULT_STARTING_CAPITAL) {
  try {
    let fund = await db.paperFund.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!fund) {
      fund = await db.paperFund.create({
        data: {
          startingCapital,
          currentBalance: startingCapital,
          peakBalance: startingCapital,
        },
      });
    }
    return fund;
  } catch (e) {
    // DB unavailable — return null, callers handle gracefully
    return null;
  }
}

/** Resolve lot size: explicit param > universe meta > default. */
function resolveLotSize(symbol: string, lotSize?: number): number {
  if (lotSize && lotSize > 0) return lotSize;
  const meta = getSymbolMeta(symbol);
  if (meta && meta.lotSize > 0) return meta.lotSize;
  return DEFAULT_LOT_SIZE;
}

/** Resolve sector: explicit param > universe meta > null. */
function resolveSector(symbol: string, sector?: string): string | undefined {
  if (sector) return sector;
  const meta = getSymbolMeta(symbol);
  return meta?.sector;
}

/** Best-effort load of cost config. Always falls back to defaults. */
async function loadCostConfig(): Promise<CostConfig> {
  try {
    // Non-literal dynamic import to avoid TS resolution failures
    // when the config module is unreachable in certain build paths.
    const modulePath = '@/lib/odss/config';
    const mod: any = await import(modulePath);
    if (typeof mod.getConfig === 'function') {
      const cfg = await mod.getConfig();
      if (cfg && !isCostModelDisabled(cfg)) {
        return extractCostConfig(cfg);
      }
      if (cfg && isCostModelDisabled(cfg)) {
        // Return a zero-cost config so calculations effectively skip costs
        return {
          brokeragePerOrder: 0,
          sttPerLakh: 0,
          exchangeTxnChargePct: 0,
          gstPct: 0,
          sebiChargePerLakh: 0,
          stampDutyPct: 0,
        };
      }
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_COST_CONFIG };
}

/**
 * Estimate time-to-expiry remaining for an open trade based on its entry time
 * and the original DTE assumption. Decreases linearly with elapsed wall-clock.
 */
function estimateRemainingDte(entryTime: Date, originalDte: number): number {
  const elapsedMs = Date.now() - entryTime.getTime();
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
  return Math.max(0, originalDte - elapsedDays);
}

/**
 * Best-effort record of trade outcome to the learning engine.
 * Wrapped in try/catch so failures never break the close path.
 */
async function recordOutcomeToLearningEngine(
  symbol: string,
  direction: string,
  netPnl: number,
  rMultiple: number,
  marketState: string | null | undefined,
  sector: string | null | undefined,
  vixAtEntry: number | null | undefined,
): Promise<void> {
  try {
    // Non-literal specifier → TS does not statically resolve, runtime import safe
    const modulePath = '../learning/learning-engine';
    const mod: any = await import(modulePath);
    if (typeof mod.recordTradeOutcome !== 'function') return;

    const vixBand = (() => {
      const v = vixAtEntry;
      if (v == null || !Number.isFinite(v)) return undefined;
      if (v < 13) return 'LOW';
      if (v < 18) return 'NORMAL';
      if (v < 25) return 'HIGH';
      return 'EXTREME';
    })();

    await mod.recordTradeOutcome({
      symbol,
      direction,
      pnl: netPnl,
      rMultiple,
      context: {
        marketState: marketState ?? undefined,
        sector: sector ?? undefined,
        vixBand,
      },
    });
  } catch {
    // Learning engine unavailable — silently continue
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a new paper trade.
 *
 * Returns the new trade ID, the entry price (per share), and the entry-side
 * transaction costs incurred.
 */
export async function openPaperTrade(
  params: PaperTradeParams,
): Promise<OpenPaperTradeResult> {
  try {
    const lotSize = resolveLotSize(params.symbol, params.lotSize);
    const quantity = Math.max(1, Math.floor(params.quantity ?? 1));
    const totalShares = quantity * lotSize;

    const iv = params.iv ?? DEFAULT_IV;
    const dte = params.daysToExpiry ?? DEFAULT_DAYS_TO_EXPIRY;
    const strategy =
      params.strategy ?? (params.direction === 'CE' ? 'LONG_CALL' : 'LONG_PUT');
    const entryType = params.entryType ?? 'MARKET';
    const sector = resolveSector(params.symbol, params.sector);

    // --- 1. Determine entry price (per share) ---
    let entryPrice: number;
    if (params.entryPremium != null && Number.isFinite(params.entryPremium) && params.entryPremium > 0) {
      entryPrice = params.entryPremium;
    } else {
      const priced = priceOption({
        spot: params.entryUnderlying,
        strike: params.entryStrike,
        daysToExpiry: dte,
        iv,
        riskFreeRate: DEFAULT_RISK_FREE_RATE,
        type: params.direction,
      });
      entryPrice = priced.price;
    }

    // --- 2. Compute entry-side costs ---
    const costConfig = await loadCostConfig();
    const entryCostBreakdown = calculateEntryCosts(entryPrice, totalShares, costConfig);
    const entryCosts = entryCostBreakdown.totalCosts;

    // --- 3. Create PaperTrade row ---
    const trade = await db.paperTrade.create({
      data: {
        symbol: params.symbol,
        direction: params.direction,
        strategy,
        variantGroup: params.variantGroup,
        variantId: params.variantId,
        entryStrike: params.entryStrike,
        entryPrice,
        entryUnderlying: params.entryUnderlying,
        entryType,
        quantity,
        lotSize,
        totalCosts: entryCosts, // entry-side only at this stage; updated on close
        marketState: params.marketState,
        vixAtEntry: params.vixAtEntry,
        sectorAtEntry: sector,
        regimeAtEntry: 'PAPER',
        status: 'OPEN',
      },
    });

    // --- 4. Debit fund ---
    const fund = await getOrCreateFund();
    if (fund) {
      const debit = entryPrice * totalShares + entryCosts;
      try {
        await db.paperFund.update({
          where: { id: fund.id },
          data: {
            currentBalance: fund.currentBalance - debit,
            openPositions: { increment: 1 },
          },
        });
      } catch {
        // Fund update failure is non-fatal for trade creation
      }
    }

    return { tradeId: trade.id, entryPrice, costs: entryCosts };
  } catch (e) {
    // Last-resort: never throw out of openPaperTrade
    return { tradeId: '', entryPrice: 0, costs: 0 };
  }
}

/**
 * Close an open paper trade at the given underlying price.
 *
 * Computes exit premium via Black-Scholes, applies exit-side costs,
 * derives gross/net P&L + R-multiple, updates the trade row and fund,
 * and best-effort records the outcome to the learning engine.
 */
export async function closePaperTrade(
  tradeId: string,
  exitUnderlying: number,
  exitReason: string,
): Promise<ClosePaperTradeResult> {
  try {
    const trade = await db.paperTrade.findUnique({ where: { id: tradeId } });
    if (!trade) {
      return { exitPrice: 0, grossPnl: 0, netPnl: 0, costs: 0, rMultiple: 0 };
    }

    // Idempotent — closing an already-closed trade returns the stored result
    if (trade.status === 'CLOSED') {
      return {
        exitPrice: trade.exitPrice ?? 0,
        grossPnl: trade.grossPnl,
        netPnl: trade.netPnl,
        costs: trade.totalCosts,
        rMultiple: trade.rMultiple,
      };
    }

    const totalShares = trade.quantity * trade.lotSize;
    const entryCostsAlreadyPaid = trade.totalCosts; // stored at open time

    // --- 2. Compute exit price via BS ---
    // Use 15% IV default since we don't persist IV at entry (could be enhanced).
    // Time-to-expiry: estimate remaining DTE from entry, floor at 1 hour.
    const remainingDte = estimateRemainingDte(trade.entryTime, DEFAULT_DAYS_TO_EXPIRY);
    const Tyears = Math.max(remainingDte / 365, 1 / (365 * 24));
    const sigma = DEFAULT_IV / 100;

    const bs = blackScholes({
      S: exitUnderlying,
      K: trade.entryStrike,
      T: Tyears,
      r: DEFAULT_RISK_FREE_RATE,
      sigma,
      type: trade.direction as 'CE' | 'PE',
    });
    const exitPrice = Math.max(bs.price, 0.05);

    // --- 3. Exit-side costs ---
    const costConfig = await loadCostConfig();
    const exitBreakdown = calculateExitCosts(exitPrice, totalShares, costConfig);
    const exitCosts = exitBreakdown.totalCosts;

    // Total round-trip costs = entry costs (already paid) + exit costs
    const totalCosts = entryCostsAlreadyPaid + exitCosts;

    // --- 4. Gross P&L (long options) ---
    // For long calls/puts: grossPnl = (exitPrice - entryPrice) * totalShares
    // (CE & PE both use +1 multiplier because we paid the premium either way;
    // a PE gains when its premium rises, which happens when spot falls.)
    const grossPnl = (exitPrice - trade.entryPrice) * totalShares;

    // --- 5. Net P&L ---
    const netPnl = grossPnl - totalCosts;

    // --- 6. R-multiple ---
    // initialRisk = entryPremium * totalShares * stopLossPct
    // For long options, losing 100% of premium = -(1/stopLossPct) R,
    // so 25% premium stop = -1R corresponds to losing 25% of premium.
    const stopLossPct = DEFAULT_STOP_LOSS_PCT;
    const initialRisk = trade.entryPrice * totalShares * stopLossPct;
    const rMultiple = initialRisk > 0 ? netPnl / initialRisk : 0;

    // --- 7. Update trade row ---
    try {
      await db.paperTrade.update({
        where: { id: tradeId },
        data: {
          exitPrice,
          exitTime: new Date(),
          exitUnderlying,
          exitReason,
          grossPnl,
          totalCosts,
          netPnl,
          rMultiple,
          status: 'CLOSED',
        },
      });
    } catch {
      // Trade row update failure is non-fatal; fund update may still proceed
    }

    // --- 8. Update fund ---
    const fund = await getOrCreateFund();
    if (fund) {
      const credit = exitPrice * totalShares - exitCosts;
      const newBalance = fund.currentBalance + credit;
      const newRealized = fund.realizedPnl + netPnl;
      const newPeak = Math.max(fund.peakBalance, newBalance);
      const drawdownPct = newPeak > 0 ? ((newPeak - newBalance) / newPeak) * 100 : 0;
      const newMaxDrawdown = Math.max(fund.maxDrawdown, drawdownPct);
      const isWin = netPnl > 0;

      try {
        await db.paperFund.update({
          where: { id: fund.id },
          data: {
            currentBalance: newBalance,
            realizedPnl: newRealized,
            openPositions: { decrement: 1 },
            totalTrades: { increment: 1 },
            winningTrades: isWin ? { increment: 1 } : undefined,
            losingTrades: !isWin ? { increment: 1 } : undefined,
            peakBalance: newPeak,
            maxDrawdown: newMaxDrawdown,
          },
        });
      } catch {
        // Fund update failure is non-fatal
      }
    }

    // --- 9. Record outcome to learning engine (best-effort) ---
    await recordOutcomeToLearningEngine(
      trade.symbol,
      trade.direction,
      netPnl,
      rMultiple,
      trade.marketState,
      trade.sectorAtEntry,
      trade.vixAtEntry,
    );

    return { exitPrice, grossPnl, netPnl, costs: totalCosts, rMultiple };
  } catch (e) {
    return { exitPrice: 0, grossPnl: 0, netPnl: 0, costs: 0, rMultiple: 0 };
  }
}

/** Return all currently OPEN paper trades, newest first. */
export async function getOpenTrades(): Promise<any[]> {
  try {
    return await db.paperTrade.findMany({
      where: { status: 'OPEN' },
      orderBy: { entryTime: 'desc' },
    });
  } catch {
    return [];
  }
}

/** Return recent CLOSED paper trades, most-recently-closed first. */
export async function getTradeHistory(limit: number = 50): Promise<any[]> {
  try {
    return await db.paperTrade.findMany({
      where: { status: 'CLOSED' },
      orderBy: { exitTime: 'desc' },
      take: Math.max(1, Math.min(limit, 500)),
    });
  } catch {
    return [];
  }
}

/** Return the single-row PaperFund (creates with defaults if missing). */
export async function getPaperFund(): Promise<any> {
  try {
    return await getOrCreateFund();
  } catch {
    return null;
  }
}

/**
 * Reset the paper trading fund to starting capital.
 * Closes all OPEN trades at their entry price (no P&L) so the ledger is clean.
 */
export async function resetPaperFund(
  startingCapital: number = DEFAULT_STARTING_CAPITAL,
): Promise<void> {
  try {
    // Close any open trades with exitPrice = entryPrice (no P&L)
    const openTrades = await db.paperTrade.findMany({
      where: { status: 'OPEN' },
    });
    if (openTrades.length > 0) {
      await db.paperTrade.updateMany({
        where: { status: 'OPEN' },
        data: {
          exitPrice: 0, // mark as exited at entry premium (no P&L)
          exitTime: new Date(),
          exitUnderlying: 0,
          exitReason: 'RESET',
          status: 'CLOSED',
        },
      });
    }

    // Reset fund to starting capital
    const fund = await getOrCreateFund();
    if (fund) {
      await db.paperFund.update({
        where: { id: fund.id },
        data: {
          startingCapital,
          currentBalance: startingCapital,
          realizedPnl: 0,
          openPositions: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          maxDrawdown: 0,
          peakBalance: startingCapital,
        },
      });
    }
  } catch {
    // swallow — reset is best-effort
  }
}

/**
 * Aggregate paper-trade performance metrics derived from the fund + closed trades.
 * Returns zeros on any error so callers can render safely.
 */
export async function getPaperTradePerformance(): Promise<PaperTradePerformance> {
  try {
    const fund = await getOrCreateFund();
    if (!fund) {
      return zeroPerformance();
    }

    const closedTrades = await db.paperTrade.findMany({
      where: { status: 'CLOSED', exitReason: { not: 'RESET' } },
      orderBy: { exitTime: 'desc' },
    });

    const totalTrades = closedTrades.length;
    const wins = closedTrades.filter((t) => Number(t.netPnl) > 0);
    const losses = closedTrades.filter((t) => Number(t.netPnl) <= 0);

    const totalWinPnl = wins.reduce((s, t) => s + Number(t.netPnl), 0);
    const totalLossPnl = Math.abs(
      losses.reduce((s, t) => s + Number(t.netPnl), 0),
    );
    const totalPnl = closedTrades.reduce((s, t) => s + Number(t.netPnl), 0);
    const sumR = closedTrades.reduce((s, t) => s + Number(t.rMultiple || 0), 0);
    const avgR = totalTrades > 0 ? sumR / totalTrades : 0;

    const profitFactor =
      totalLossPnl > 0
        ? totalWinPnl / totalLossPnl
        : totalWinPnl > 0
          ? Number.POSITIVE_INFINITY
          : 0;

    const winRate =
      fund.totalTrades > 0 ? (fund.winningTrades / fund.totalTrades) * 100 : 0;

    const returnPct =
      fund.startingCapital > 0
        ? ((fund.currentBalance - fund.startingCapital) / fund.startingCapital) * 100
        : 0;

    return {
      totalTrades,
      winningTrades: fund.winningTrades,
      losingTrades: fund.losingTrades,
      winRate,
      totalPnl,
      avgR,
      profitFactor,
      maxDrawdown: fund.maxDrawdown,
      currentBalance: fund.currentBalance,
      startingCapital: fund.startingCapital,
      returnPct,
    };
  } catch {
    return zeroPerformance();
  }
}

/** Convenience: zero-initialized performance object for fallback paths. */
function zeroPerformance(): PaperTradePerformance {
  return {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalPnl: 0,
    avgR: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    currentBalance: DEFAULT_STARTING_CAPITAL,
    startingCapital: DEFAULT_STARTING_CAPITAL,
    returnPct: 0,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for callers that want one-stop import
// ---------------------------------------------------------------------------

export {
  calculateRoundTripCosts,
  extractCostConfig,
  isCostModelDisabled,
  DEFAULT_COST_CONFIG,
} from './transaction-costs';

export { blackScholes, priceOption } from './bs-pricing';

export { STRATEGY_VARIANTS, getVariantByName, getRandomVariant } from './strategy-variants';
