import { NextResponse } from 'next/server';
import { getPaperTradePerformance } from '@/lib/odss/paper-trading/paper-trade-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/paper-trading/performance
 *
 * Aggregate paper-trade performance metrics derived from the fund +
 * closed-trade history. Includes win rate, profit factor, average R,
 * max drawdown, return %.
 *
 * Returns zeros on any error so the UI renders cleanly.
 *
 * Response shape:
 *   {
 *     totalTrades, winningTrades, losingTrades, winRate,
 *     totalPnl, avgR, profitFactor, maxDrawdown,
 *     currentBalance, startingCapital, returnPct,
 *     source: 'DB' | 'FALLBACK'
 *   }
 *
 * NOTE: profitFactor may be Infinity when there are wins but zero losses;
 *       the client should guard against non-finite values. We serialize
 *       Infinity as `null` here.
 */
export async function GET() {
  try {
    const perf = await getPaperTradePerformance();

    // Normalize Infinity → null so JSON.stringify doesn't emit "null"
    const profitFactor = Number.isFinite(perf.profitFactor)
      ? perf.profitFactor
      : null;

    return NextResponse.json({
      totalTrades: perf.totalTrades,
      winningTrades: perf.winningTrades,
      losingTrades: perf.losingTrades,
      winRate: perf.winRate,
      totalPnl: perf.totalPnl,
      avgR: perf.avgR,
      profitFactor,
      maxDrawdown: perf.maxDrawdown,
      currentBalance: perf.currentBalance,
      startingCapital: perf.startingCapital,
      returnPct: perf.returnPct,
      source: 'DB',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      avgR: 0,
      profitFactor: null,
      maxDrawdown: 0,
      currentBalance: 100_000,
      startingCapital: 100_000,
      returnPct: 0,
      source: 'FALLBACK',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}
