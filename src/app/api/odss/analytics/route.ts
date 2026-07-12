import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/odss/analytics — performance metrics computed from journal
export async function GET() {
  const trades = await db.tradeJournal.findMany({ orderBy: { entryTime: 'desc' } });
  if (trades.length === 0) {
    return NextResponse.json({
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      avgR: 0,
      maxDrawdown: 0,
      bestSector: null,
      bestEntryType: null,
      bestStrikeType: null,
      avgHoldMinutes: 0,
      exitStats: {},
      equityCurve: [],
    });
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const winRate = (wins.length / trades.length) * 100;
  const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;
  const avgR = trades.reduce((a, b) => a + b.rMultiple, 0) / trades.length;

  // Max drawdown from cumulative pnl
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  const equityCurve: { i: number; cum: number; trade: string }[] = [];
  // chronological order
  const chrono = [...trades].reverse();
  chrono.forEach((t, i) => {
    cum += t.pnl;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
    equityCurve.push({ i, cum, trade: t.symbol });
  });

  // Exit reason stats
  const exitStats: Record<string, number> = {};
  trades.forEach((t) => {
    const r = t.exitReason || 'UNKNOWN';
    exitStats[r] = (exitStats[r] ?? 0) + 1;
  });

  // Average hold time
  const avgHoldMinutes = trades.reduce((a, b) => a + (b.holdTimeMinutes ?? 0), 0) / trades.length;

  return NextResponse.json({
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    profitFactor,
    avgR,
    maxDrawdown: maxDD,
    grossProfit,
    grossLoss,
    avgHoldMinutes,
    exitStats,
    equityCurve,
    recentTrades: trades.slice(0, 10),
  });
}
