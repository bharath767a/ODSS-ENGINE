import { NextRequest, NextResponse } from 'next/server';
import { exitTrade } from '@/lib/odss/orchestrator';

export const dynamic = 'force-dynamic';

// POST /api/odss/trade/exit — manually exit active trade
// Body: { reason: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const reason = body.reason || 'Manual exit by user';
    await exitTrade(reason);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
