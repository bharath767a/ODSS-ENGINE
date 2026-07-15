import { NextRequest, NextResponse } from 'next/server';
import { getDataRouter } from '@/lib/odss/data-providers/router';

export const dynamic = 'force-dynamic';

// GET /api/odss/optionchain/[symbol] — option chain for a symbol
//
// Uses the REAL NSE provider ONLY (via the data provider router).
// If NSE is unreachable (geo-blocked, rate-limited, or no proxy
// configured), the API responds with a "no data" error — it does
// NOT fall back to the simulator's synthetic option chain.
//
// The response includes a `source` field indicating which real
// provider supplied the chain (typically 'NSE').
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const router = getDataRouter();

  try {
    const realChain = await router.getOptionChain(sym);
    if (realChain) {
      return NextResponse.json({ ...realChain, source: router.getPreferredProvider() ?? 'NSE' });
    }
  } catch {
    // fall through to the "no data" response below
  }

  return NextResponse.json(
    {
      error: 'No live option chain available',
      symbol: sym,
      timestamp: Date.now(),
      hint: 'Configure NSE_PROXY_URL for real option chain data',
    },
    { status: 404 },
  );
}
