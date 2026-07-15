import { NextRequest, NextResponse } from 'next/server';
import { getFundamentalProvider } from '@/lib/odss/fundamentals/provider';
import { analyzeFundamentals, getBuySellHold } from '@/lib/odss/fundamentals/analyzer';
import { getDataRouter } from '@/lib/odss/data-providers/router';

export const dynamic = 'force-dynamic';

// GET /api/odss/fundamentals/[symbol] — complete fundamental analysis
//
// Fundamental data (P/E, EPS, debt, quarterly results, etc.) always
// comes from the fundamentals provider — this is curated static data,
// not live market data.
//
// The live market price is fetched via the data provider router ONLY
// (NSE → Yahoo → Angel One). If the router cannot supply a price,
// the response still includes the fundamental data, but the price
// fields are flagged as unavailable:
//   - `priceSource: 'NONE'`
//   - `currentPrice: 0`
//   - `priceError: 'No live price available'`
//
// The simulator is NEVER used as a fallback.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  const provider = getFundamentalProvider();
  const data = provider.getFundamentalData(sym);
  if (!data) {
    return NextResponse.json({ error: 'Fundamental data not available for this symbol' }, { status: 404 });
  }

  const score = analyzeFundamentals(data);

  // Try real data providers ONLY for the price (no simulator fallback)
  let currentPrice = 0;
  let priceSource: 'NSE' | 'YAHOO' | 'ANGEL_ONE' | 'REAL' | 'NONE' = 'NONE';
  let priceChangePct = 0;
  let priceError: string | undefined;
  try {
    const router = getDataRouter();
    const realQuote = await router.getQuote(sym);
    if (realQuote && realQuote.ltp > 0) {
      currentPrice = realQuote.ltp;
      priceChangePct = realQuote.changePct;
      priceSource = router.getPreferredProvider() ?? 'REAL';
    } else {
      priceError = 'No live price available';
    }
  } catch {
    priceError = 'No live price available';
  }

  const recommendation = getBuySellHold(data, score, currentPrice);

  return NextResponse.json({
    data,
    score,
    recommendation,
    currentPrice,
    priceSource,
    priceError,
    priceChangePct,
    timestamp: Date.now(),
  });
}
