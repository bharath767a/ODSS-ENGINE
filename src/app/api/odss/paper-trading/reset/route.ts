import { NextResponse } from 'next/server';
import { resetPaperFund } from '@/lib/odss/paper-trading/paper-trade-manager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/odss/paper-trading/reset
 *
 * Reset the paper-trading fund to the default starting capital.
 * Any open trades are force-closed (exitReason='RESET') so the
 * ledger is clean. P&L tallies (win/loss/drawdown) are zeroed.
 *
 * Returns: { ok: true }
 */
export async function POST() {
  try {
    await resetPaperFund();
    return NextResponse.json({ ok: true, timestamp: Date.now() });
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
