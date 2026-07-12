import { NextRequest, NextResponse } from 'next/server';
import { getFundamentalProvider } from '@/lib/odss/fundamentals/provider';
import { analyzeFundamentals, getBuySellHold } from '@/lib/odss/fundamentals/analyzer';
import { generateStockStory } from '@/lib/odss/fundamentals/ai-story';
import { getQuote } from '@/lib/odss/simulator/market-simulator';

export const dynamic = 'force-dynamic';

// POST /api/odss/stock-story/[symbol] — AI-generated plain-English stock story
export async function POST(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  const provider = getFundamentalProvider();
  const data = provider.getFundamentalData(sym);
  if (!data) {
    return NextResponse.json({ error: 'Fundamental data not available' }, { status: 404 });
  }

  const score = analyzeFundamentals(data);
  const quote = getQuote(sym);
  const currentPrice = quote?.ltp ?? data.profile.marketCap / 10000;
  const rec = getBuySellHold(data, score, currentPrice);

  try {
    const story = await generateStockStory(data, score, rec);
    return NextResponse.json({ ok: true, story });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
