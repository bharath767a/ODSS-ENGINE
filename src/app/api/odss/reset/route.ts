import { NextResponse } from 'next/server';
import { resetSimulator, tick, getQuote, getIndiaVix } from '@/lib/odss/simulator/market-simulator';
import { getStore } from '@/lib/odss/store/store';
import { setActiveTrade } from '@/lib/odss/store/store';

export const dynamic = 'force-dynamic';

// POST /api/odss/reset — reset the simulator (clears all in-memory state)
export async function POST() {
  resetSimulator();
  for (let i = 0; i < 30; i++) tick();
  const store = getStore();
  store.market = null;
  store.sectors = null;
  store.rs = null;
  store.opportunities = null;
  store.recommendations.clear();
  store.decisionLog = [];
  store.completedTrades = [];
  setActiveTrade(null);
  const nifty = getQuote('NIFTY');
  return NextResponse.json({
    ok: true,
    nifty: nifty?.ltp ?? 0,
    vix: getIndiaVix(),
    timestamp: Date.now(),
  });
}
