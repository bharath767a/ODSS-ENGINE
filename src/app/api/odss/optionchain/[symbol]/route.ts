import { NextRequest, NextResponse } from 'next/server';
import { getOptionChain } from '@/lib/odss/simulator/market-simulator';

export const dynamic = 'force-dynamic';

// GET /api/odss/optionchain/[symbol] — option chain for a symbol
//
// Tries the REAL NSE provider first (via the data provider router).
// If NSE is unreachable (geo-blocked, rate-limited, or no proxy
// configured), falls back to the simulator's synthetic option chain.
//
// The response includes a `source` field indicating whether the data
// is REAL (from NSE) or SIMULATED (from the simulator).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  // Try the real NSE provider first
  try {
    const { getDataRouter } = await import('@/lib/odss/data-providers/router');
    const router = getDataRouter();
    const realChain = await router.getOptionChain(sym);
    if (realChain) {
      return NextResponse.json({ ...realChain, source: 'NSE' });
    }
  } catch {
    // NSE failed — fall through to simulator
  }

  // Fall back to simulator
  const chain = getOptionChain(sym);
  if (!chain) return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
  return NextResponse.json({ ...chain, source: 'SIMULATOR' });
}
