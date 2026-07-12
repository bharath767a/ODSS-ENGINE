import { NextRequest, NextResponse } from 'next/server';
import { explainDecision } from '@/lib/odss/ai/explainer';
import type { Recommendation } from '@/lib/odss/types';

export const dynamic = 'force-dynamic';

// POST /api/odss/explain/[symbol] — AI explanation for a recommendation
// Body: { mode: 'SELECTED' | 'REJECTED', recommendation: Recommendation }
// The client sends the full recommendation (from the live WS feed) since the
// mini-service owns the live state, not this Next.js process.
export async function POST(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === 'REJECTED' ? 'REJECTED' : 'SELECTED';
  const rec = body.recommendation as Recommendation | undefined;

  if (!rec) {
    return NextResponse.json({ error: 'recommendation field required in body' }, { status: 400 });
  }

  try {
    const explanation = await explainDecision(rec, mode);
    return NextResponse.json({ ok: true, explanation });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
