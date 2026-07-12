import { NextResponse } from 'next/server';
import { getStore } from '@/lib/odss/store/store';

export const dynamic = 'force-dynamic';

// GET /api/odss/state — full current ODSS state snapshot
export async function GET() {
  const store = getStore();
  return NextResponse.json({
    timestamp: Date.now(),
    market: store.market,
    sectors: store.sectors,
    rs: store.rs,
    opportunities: store.opportunities,
    activeTrade: store.activeTrade,
    topRecommendations: Array.from(store.recommendations.values()).slice(0, 10),
    decisionLog: store.decisionLog.slice(0, 50),
    completedTrades: store.completedTrades.slice(0, 20),
    lastScanAt: store.lastScanAt,
  });
}
