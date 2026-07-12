import { NextRequest, NextResponse } from 'next/server';
import { getOptionChain } from '@/lib/odss/simulator/market-simulator';

export const dynamic = 'force-dynamic';

// GET /api/odss/optionchain/[symbol] — option chain for a symbol
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const chain = getOptionChain(symbol.toUpperCase());
  if (!chain) return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
  return NextResponse.json(chain);
}
