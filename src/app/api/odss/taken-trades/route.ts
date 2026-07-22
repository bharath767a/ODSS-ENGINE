import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { dataPath } from '@/lib/odss/data-dir';
import { addTakenTrade, closeTakenTrade, listTaken } from '@/lib/odss/taken-trades';
import type { Direction } from '@/lib/odss/types';

export const dynamic = 'force-dynamic';

function underlyingFor(symbol: string): number {
  try {
    const raw = readFileSync(dataPath('quotes.json'), 'utf-8');
    const all = JSON.parse(raw);
    const q = (all.quotes ?? []).find((x: any) => x.symbol === symbol);
    return q?.ltp ?? 0;
  } catch { return 0; }
}

// GET /api/odss/taken-trades — list open positions (live greeks arrive via socket)
export async function GET() {
  return NextResponse.json({ trades: listTaken('ACTIVE'), closed: listTaken('CLOSED').slice(-20) });
}

// POST /api/odss/taken-trades — mark a pick as taken
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = String(body.symbol || '').toUpperCase();
    const direction = body.direction as Direction;
    const entryPremium = Number(body.entryPrice ?? body.entryPremium);
    if (!symbol || (direction !== 'CE' && direction !== 'PE') || !(entryPremium > 0)) {
      return NextResponse.json({ error: 'symbol, direction (CE/PE) and a positive entry premium are required' }, { status: 400 });
    }
    const entryUnderlying = Number(body.entryUnderlying) > 0 ? Number(body.entryUnderlying) : underlyingFor(symbol);
    const trade = addTakenTrade({ symbol, direction, entryPremium, entryUnderlying, sector: body.sector, strike: Number(body.strike) || 0 });
    return NextResponse.json({ ok: true, trade });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to take trade' }, { status: 500 });
  }
}

// DELETE /api/odss/taken-trades?id=... (or ?symbol=&direction=) — close a position
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let id = searchParams.get('id');
  if (!id) {
    const symbol = (searchParams.get('symbol') || '').toUpperCase();
    const direction = searchParams.get('direction');
    const match = listTaken('ACTIVE').find(t => t.symbol === symbol && (!direction || t.direction === direction));
    id = match?.id ?? null;
  }
  if (!id) return NextResponse.json({ error: 'position not found' }, { status: 404 });
  const closed = closeTakenTrade(id, Number(searchParams.get('exitPremium')) || undefined, searchParams.get('reason') || undefined);
  if (!closed) return NextResponse.json({ error: 'position not found or already closed' }, { status: 404 });
  return NextResponse.json({ ok: true, trade: closed });
}
