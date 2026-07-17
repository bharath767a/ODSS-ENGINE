import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';

export const dynamic = 'force-dynamic';

// GET /api/odss/state — full current ODSS state snapshot
// Reads from the shared state file written by the market service every scan.
const STATE_FILE = '/home/z/odss-data/engine-state.json';
let cache: { data: any; ts: number } = { data: null, ts: 0 };
const CACHE_TTL = 2000;

export async function GET() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({ ...cache.data, timestamp: Date.now() });
  }
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    cache.data = data;
    cache.ts = Date.now();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      timestamp: Date.now(),
      market: null, sectors: null, rs: null,
      opportunities: null, conviction: null,
      activeTrade: null, topRecommendations: [],
      decisionLog: [], completedTrades: [],
      lastScanAt: 0,
    });
  }
}
