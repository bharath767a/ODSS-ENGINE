import { NextRequest, NextResponse } from 'next/server';
import { getQuote } from '@/lib/odss/simulator/market-simulator';
import { getAllQuotes } from '@/lib/odss/simulator/market-simulator';

export const dynamic = 'force-dynamic';

// GET /api/odss/quote/[symbol] — live quote for a symbol
// GET /api/odss/quote?all=true — all quotes
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (symbol === 'all') {
    return NextResponse.json({ quotes: getAllQuotes() });
  }
  const q = getQuote(symbol.toUpperCase());
  if (!q) return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
  return NextResponse.json(q);
}
