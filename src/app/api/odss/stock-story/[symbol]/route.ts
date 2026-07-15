import { NextRequest, NextResponse } from 'next/server';
import { getFundamentalProvider } from '@/lib/odss/fundamentals/provider';
import { analyzeFundamentals, getBuySellHold } from '@/lib/odss/fundamentals/analyzer';
import { generateStockStory } from '@/lib/odss/fundamentals/ai-story';
import { getDataRouter } from '@/lib/odss/data-providers/router';

export const dynamic = 'force-dynamic';

// POST /api/odss/stock-story/[symbol] — AI-generated plain-English stock story
//
// Fetches the live price via the REAL data provider router ONLY.
// If the router cannot supply a price, the route falls back to a
// marketCap-based estimate (fundamental-data-derived, not simulator)
// and flags it with `priceSource: 'ESTIMATED'`. The simulator is
// NEVER used as a fallback.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  const provider = getFundamentalProvider();
  const data = provider.getFundamentalData(sym);
  if (!data) {
    return NextResponse.json({ error: 'Fundamental data not available' }, { status: 404 });
  }

  const score = analyzeFundamentals(data);

  // ---- Try the REAL router for a live price (no simulator fallback) ----
  let currentPrice = 0;
  let priceSource: 'NSE' | 'YAHOO' | 'ANGEL_ONE' | 'REAL' | 'ESTIMATED' = 'ESTIMATED';
  try {
    const router = getDataRouter();
    const realQuote = await router.getQuote(sym);
    if (realQuote && realQuote.ltp > 0) {
      currentPrice = realQuote.ltp;
      priceSource = router.getPreferredProvider() ?? 'REAL';
    }
  } catch {
    // fall through to the marketCap-based estimate below
  }

  // ---- If the router didn't return a price, use the marketCap-based estimate ----
  // This is derived from the fundamental data (not the simulator), so it's
  // flagged with `priceSource: 'ESTIMATED'` to make the source clear.
  if (currentPrice <= 0) {
    currentPrice = data.profile.marketCap / 10000;
    priceSource = 'ESTIMATED';
  }

  const rec = getBuySellHold(data, score, currentPrice);

  try {
    const story = await generateStockStory(data, score, rec);
    return NextResponse.json({ ok: true, story, priceSource });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
