import { NextResponse } from 'next/server';
import { getPaperFund } from '@/lib/odss/paper-trading/paper-trade-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/paper-trading/fund
 *
 * Returns the single-row PaperFund ledger state (starting capital,
 * current balance, realized P&L, win/loss tallies, drawdown, etc.).
 *
 * Returns a zeroed-out fallback if the DB is unavailable.
 *
 * Response shape (real):
 *   {
 *     id, startingCapital, currentBalance, realizedPnl,
 *     openPositions, totalTrades, winningTrades, losingTrades,
 *     maxDrawdown, peakBalance, source: 'DB'
 *   }
 */
export async function GET() {
  try {
    const fund = await getPaperFund();
    if (fund) {
      return NextResponse.json({
        id: fund.id,
        startingCapital: fund.startingCapital,
        currentBalance: fund.currentBalance,
        realizedPnl: fund.realizedPnl,
        openPositions: fund.openPositions,
        totalTrades: fund.totalTrades,
        winningTrades: fund.winningTrades,
        losingTrades: fund.losingTrades,
        maxDrawdown: fund.maxDrawdown,
        peakBalance: fund.peakBalance,
        source: 'DB',
        timestamp: Date.now(),
      });
    }

    // Fallback when no fund row exists (DB unavailable or empty)
    return NextResponse.json({
      id: null,
      startingCapital: 100_000,
      currentBalance: 100_000,
      realizedPnl: 0,
      openPositions: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      maxDrawdown: 0,
      peakBalance: 100_000,
      source: 'FALLBACK',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      id: null,
      startingCapital: 100_000,
      currentBalance: 100_000,
      realizedPnl: 0,
      openPositions: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      maxDrawdown: 0,
      peakBalance: 100_000,
      source: 'FALLBACK',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}
