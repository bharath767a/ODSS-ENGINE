import { NextRequest, NextResponse } from 'next/server';
import { getQuote, getAllQuotes } from '@/lib/odss/simulator/market-simulator';

export const dynamic = 'force-dynamic';

// GET /api/odss/quote/[symbol] — live quote for a symbol
// GET /api/odss/quote/all — all quotes
//
// Tries the REAL data provider router first (Yahoo → NSE → Angel One).
// If all real providers fail, falls back to the simulator's synthetic quote.
//
// The response includes a `source` field: 'YAHOO' | 'NSE' | 'SIMULATOR'
// so the UI can show whether the price is real or simulated.
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (symbol === 'all') {
    return NextResponse.json({ quotes: getAllQuotes() });
  }
  const sym = symbol.toUpperCase();

  // Try real data providers first
  try {
    const { getDataRouter } = await import('@/lib/odss/data-providers/router');
    const router = getDataRouter();
    const realQuote = await router.getQuote(sym);
    if (realQuote && realQuote.ltp > 0) {
      return NextResponse.json({ ...realQuote, source: router.getPreferredProvider() ?? 'REAL' });
    }
  } catch {
    // Real providers failed — fall through to simulator
  }

  // Fall back to simulator
  const q = getQuote(sym);
  if (!q) return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
  return NextResponse.json({ ...q, source: 'SIMULATOR' });
}
