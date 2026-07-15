import { NextRequest, NextResponse } from 'next/server';
import { closePaperTrade } from '@/lib/odss/paper-trading/paper-trade-manager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/odss/paper-trading/close
 *
 * Close an open paper trade at the supplied underlying price.
 *
 * Body:
 *   { tradeId: string, exitUnderlying: number, exitReason?: string }
 *
 * Returns:
 *   { ok: true, exitPrice, grossPnl, netPnl, costs, rMultiple }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const { tradeId, exitUnderlying, exitReason } = body ?? {};

    if (!tradeId || typeof tradeId !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'tradeId is required' },
        { status: 400 },
      );
    }
    if (typeof exitUnderlying !== 'number' || !Number.isFinite(exitUnderlying) || exitUnderlying <= 0) {
      return NextResponse.json(
        { ok: false, error: 'exitUnderlying must be a positive number' },
        { status: 400 },
      );
    }

    const reason = typeof exitReason === 'string' && exitReason ? exitReason : 'MANUAL';

    const result = await closePaperTrade(tradeId, exitUnderlying, reason);

    return NextResponse.json({
      ok: true,
      exitPrice: result.exitPrice,
      grossPnl: result.grossPnl,
      netPnl: result.netPnl,
      costs: result.costs,
      rMultiple: result.rMultiple,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}
