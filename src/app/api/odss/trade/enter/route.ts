import { NextRequest, NextResponse } from 'next/server';
import { enterTrade } from '@/lib/odss/orchestrator';

export const dynamic = 'force-dynamic';

// POST /api/odss/trade/enter — manually enter a trade
// Body: { symbol: string, direction: 'CE' | 'PE' }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, direction } = body;
    if (!symbol || !direction || (direction !== 'CE' && direction !== 'PE')) {
      return NextResponse.json({ error: 'symbol and direction (CE|PE) required' }, { status: 400 });
    }
    const trade = await enterTrade(symbol.toUpperCase(), direction);
    return NextResponse.json({ ok: true, trade });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
