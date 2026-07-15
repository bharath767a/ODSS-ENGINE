import { NextRequest, NextResponse } from 'next/server';
import { getDataRouter } from '@/lib/odss/data-providers/router';
import { ALL_SYMBOLS } from '@/lib/odss/universe';

export const dynamic = 'force-dynamic';

// GET /api/odss/quote/[symbol] — live quote for a symbol
// GET /api/odss/quote/all — all quotes
//
// Uses the REAL data provider router ONLY (NSE → Yahoo → Angel One).
// If no real provider can return a quote, the API responds with a
// "no data" error — it does NOT fall back to the simulator.
//
// The response includes a `source` field: 'NSE' | 'YAHOO' | 'ANGEL_ONE'
// so the UI can show which provider supplied the price.
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const router = getDataRouter();

  // ---- /quote/all — bulk fetch via the router ----
  if (symbol === 'all') {
    try {
      const symbols = ALL_SYMBOLS.map((s) => s.symbol);
      const quotesMap = await router.getAllQuotes(symbols);
      if (quotesMap.size === 0) {
        return NextResponse.json(
          {
            error: 'No live data available',
            timestamp: Date.now(),
            hint: 'Yahoo Finance provider may be rate-limited. Try again in a few seconds.',
          },
          { status: 503 },
        );
      }
      const quotes = Array.from(quotesMap.values());
      const source = router.getPreferredProvider() ?? 'REAL';
      return NextResponse.json({ quotes, source });
    } catch {
      return NextResponse.json(
        {
          error: 'No live data available',
          timestamp: Date.now(),
          hint: 'Yahoo Finance provider may be rate-limited. Try again in a few seconds.',
        },
        { status: 503 },
      );
    }
  }

  const sym = symbol.toUpperCase();

  // ---- Single-symbol quote — router only, no simulator fallback ----
  try {
    const realQuote = await router.getQuote(sym);
    if (realQuote && realQuote.ltp > 0) {
      return NextResponse.json({ ...realQuote, source: router.getPreferredProvider() ?? 'REAL' });
    }
  } catch {
    // fall through to the "no data" response below
  }

  return NextResponse.json(
    {
      error: 'No live data available',
      symbol: sym,
      timestamp: Date.now(),
      hint: 'Yahoo Finance provider may be rate-limited. Try again in a few seconds.',
    },
    { status: 404 },
  );
}
