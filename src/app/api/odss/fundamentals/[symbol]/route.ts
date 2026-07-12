import { NextRequest, NextResponse } from 'next/server';
import { getFundamentalProvider } from '@/lib/odss/fundamentals/provider';
import { analyzeFundamentals, getBuySellHold } from '@/lib/odss/fundamentals/analyzer';
import { getQuote } from '@/lib/odss/simulator/market-simulator';

export const dynamic = 'force-dynamic';

// GET /api/odss/fundamentals/[symbol] — complete fundamental analysis
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  const provider = getFundamentalProvider();
  const data = provider.getFundamentalData(sym);
  if (!data) {
    return NextResponse.json({ error: 'Fundamental data not available for this symbol' }, { status: 404 });
  }

  const score = analyzeFundamentals(data);
  const quote = getQuote(sym);
  const currentPrice = quote?.ltp ?? data.profile.marketCap / 10000;
  const recommendation = getBuySellHold(data, score, currentPrice);

  return NextResponse.json({
    data,
    score,
    recommendation,
    currentPrice,
    timestamp: Date.now(),
  });
}
