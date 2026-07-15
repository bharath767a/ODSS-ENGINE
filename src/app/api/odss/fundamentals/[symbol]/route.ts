import { NextRequest, NextResponse } from 'next/server';
import { getFundamentalProvider } from '@/lib/odss/fundamentals/provider';
import { analyzeFundamentals, getBuySellHold } from '@/lib/odss/fundamentals/analyzer';
import { getQuote } from '@/lib/odss/simulator/market-simulator';

export const dynamic = 'force-dynamic';

// GET /api/odss/fundamentals/[symbol] — complete fundamental analysis
//
// Fetches the REAL market price via the data provider router (Yahoo → NSE).
// Falls back to the simulator price only if all real providers fail.
// This ensures the Stock Analysis tab shows REAL market prices.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  const provider = getFundamentalProvider();
  const data = provider.getFundamentalData(sym);
  if (!data) {
    return NextResponse.json({ error: 'Fundamental data not available for this symbol' }, { status: 404 });
  }

  const score = analyzeFundamentals(data);

  // Try real data providers first for the price
  let currentPrice = 0;
  let priceSource = 'SIMULATOR';
  let priceChangePct = 0;
  try {
    const { getDataRouter } = await import('@/lib/odss/data-providers/router');
    const router = getDataRouter();
    const realQuote = await router.getQuote(sym);
    if (realQuote && realQuote.ltp > 0) {
      currentPrice = realQuote.ltp;
      priceChangePct = realQuote.changePct;
      priceSource = router.getPreferredProvider() ?? 'REAL';
    }
  } catch {
    // Real providers failed
  }

  // Fall back to simulator if real providers didn't work
  if (currentPrice === 0) {
    const quote = getQuote(sym);
    currentPrice = quote?.ltp ?? data.profile.marketCap / 10000;
    priceChangePct = quote?.changePct ?? 0;
    priceSource = quote ? 'SIMULATOR' : 'ESTIMATED';
  }

  const recommendation = getBuySellHold(data, score, currentPrice);

  return NextResponse.json({
    data,
    score,
    recommendation,
    currentPrice,
    priceSource,
    priceChangePct,
    timestamp: Date.now(),
  });
}
