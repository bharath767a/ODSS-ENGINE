import { NextRequest, NextResponse } from 'next/server';
import { openPaperTrade, getOpenTrades, getTradeHistory } from '@/lib/odss/paper-trading/paper-trade-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/paper-trading/trades
 *
 * Returns all paper trades: currently-open trades + closed history.
 * Open trades are listed newest-first; closed trades are listed
 * most-recently-closed first.
 *
 * Response shape:
 *   { open: PaperTrade[], closed: PaperTrade[], source: 'DB' | 'FALLBACK' }
 */
export async function GET() {
  try {
    const [open, closed] = await Promise.all([
      getOpenTrades(),
      getTradeHistory(100),
    ]);
    return NextResponse.json({
      open: Array.isArray(open) ? open : [],
      closed: Array.isArray(closed) ? closed : [],
      source: 'DB',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      open: [],
      closed: [],
      source: 'FALLBACK',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

/**
 * POST /api/odss/paper-trading/trades
 *
 * Open a new paper trade.
 *
 * Body:
 *   {
 *     symbol: string,
 *     direction: 'CE' | 'PE',
 *     entryStrike: number,
 *     entryUnderlying: number,
 *     strategy?: string,
 *     quantity?: number,
 *     lotSize?: number,
 *     iv?: number,
 *     daysToExpiry?: number
 *   }
 *
 * Returns: { ok: true, tradeId, entryPrice, costs }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // --- Validate required fields ---
    const {
      symbol,
      direction,
      entryStrike,
      entryUnderlying,
      strategy,
      quantity,
      lotSize,
      iv,
      daysToExpiry,
    } = body ?? {};

    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'symbol is required' },
        { status: 400 },
      );
    }
    if (direction !== 'CE' && direction !== 'PE') {
      return NextResponse.json(
        { ok: false, error: "direction must be 'CE' or 'PE'" },
        { status: 400 },
      );
    }
    if (typeof entryStrike !== 'number' || !Number.isFinite(entryStrike) || entryStrike <= 0) {
      return NextResponse.json(
        { ok: false, error: 'entryStrike must be a positive number' },
        { status: 400 },
      );
    }
    if (typeof entryUnderlying !== 'number' || !Number.isFinite(entryUnderlying) || entryUnderlying <= 0) {
      return NextResponse.json(
        { ok: false, error: 'entryUnderlying must be a positive number' },
        { status: 400 },
      );
    }

    const result = await openPaperTrade({
      symbol: symbol.toUpperCase(),
      direction,
      entryStrike,
      entryUnderlying,
      strategy: typeof strategy === 'string' && strategy ? strategy : undefined,
      quantity: typeof quantity === 'number' && quantity > 0 ? quantity : undefined,
      lotSize: typeof lotSize === 'number' && lotSize > 0 ? lotSize : undefined,
      iv: typeof iv === 'number' && iv > 0 ? iv : undefined,
      daysToExpiry: typeof daysToExpiry === 'number' && daysToExpiry > 0 ? daysToExpiry : undefined,
    });

    return NextResponse.json({
      ok: true,
      tradeId: result.tradeId,
      entryPrice: result.entryPrice,
      costs: result.costs,
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
