import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/odss/store/store';
import { getDataRouter } from '@/lib/odss/data-providers/router';
import { runTechnicalEngine } from '@/lib/odss/engines/technical-engine';
import { runOptionChainEngine } from '@/lib/odss/engines/option-chain-engine';
import { runStrikeEngine } from '@/lib/odss/engines/strike-engine';
import { runEntryEngine } from '@/lib/odss/engines/entry-engine';
import { runRiskEngine } from '@/lib/odss/engines/risk-engine';
import { runDecisionEngine } from '@/lib/odss/engines/decision-engine';

export const dynamic = 'force-dynamic';

// GET /api/odss/recommendation/[symbol] — full recommendation for a symbol
//
// Fetches the live quote via the REAL data provider router ONLY
// (NSE → Yahoo → Angel One). If the router cannot supply a quote,
// the route responds with a 503 "no data" error. The simulator is
// NEVER used as a fallback.
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const store = getStore();

  // Check if we have a cached recommendation
  const cached = store.recommendations.get(sym);
  if (cached) return NextResponse.json(cached);

  // Otherwise build one on the fly
  const market = store.market;
  if (!market) return NextResponse.json({ error: 'Market data not ready' }, { status: 503 });

  // ---- Fetch the live quote via the REAL router ONLY ----
  let q;
  try {
    const router = getDataRouter();
    q = await router.getQuote(sym);
  } catch {
    q = null;
  }
  if (!q || q.ltp <= 0) {
    return NextResponse.json(
      {
        error: 'No live data available for recommendation',
        symbol: sym,
        timestamp: Date.now(),
        hint: 'Yahoo Finance provider may be rate-limited. Try again in a few seconds.',
      },
      { status: 503 },
    );
  }

  const sectorMap = store.sectors ? new Map(store.sectors.sectors.map((s) => [s.sector, s])) : new Map();
  const rsMap = store.rs ? new Map(store.rs.rows.map((r) => [r.symbol, r])) : new Map();

  const technical = runTechnicalEngine(sym);
  const optionChain = runOptionChainEngine(sym);
  const sector = sectorMap.get(q.sector ?? '');
  const rsRow = rsMap.get(sym);

  // Determine direction
  const isLong = technical.trend === 'BULLISH' || (sector && sector.strength > 0);
  const direction = isLong ? 'CE' : 'PE';
  const conviction = 50;

  const strike = runStrikeEngine(sym, direction, technical, optionChain, conviction);
  const entry = runEntryEngine(sym, direction, technical);
  const risk = runRiskEngine(sym, direction, entry, technical);
  const decision = runDecisionEngine({
    direction,
    market,
    sector,
    rs: rsRow,
    technical,
    optionChain,
    risk,
  });

  return NextResponse.json({
    symbol: sym,
    sector: q.sector,
    direction,
    market,
    sectorScore: sector,
    rs: rsRow,
    technical,
    optionChain,
    opportunity: {
      symbol: sym,
      sector: q.sector,
      direction,
      marketScore: 50,
      sectorScore: sector?.score ?? 50,
      rsScore: rsRow?.score ?? 50,
      technicalScore: technical.score,
      optionChainScore: optionChain.score,
      totalScore: (technical.score + optionChain.score) / 2,
      confidence: decision.confidence,
      rank: 0,
      rationale: 'On-demand recommendation',
      facts: [],
    },
    strike,
    entry,
    risk,
    decision,
    timestamp: Date.now(),
  });
}
