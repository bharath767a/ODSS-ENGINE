import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/odss/store/store';
import { getQuote } from '@/lib/odss/simulator/market-simulator';
import { runTechnicalEngine } from '@/lib/odss/engines/technical-engine';
import { runOptionChainEngine } from '@/lib/odss/engines/option-chain-engine';
import { runStrikeEngine } from '@/lib/odss/engines/strike-engine';
import { runEntryEngine } from '@/lib/odss/engines/entry-engine';
import { runRiskEngine } from '@/lib/odss/engines/risk-engine';
import { runDecisionEngine } from '@/lib/odss/engines/decision-engine';

export const dynamic = 'force-dynamic';

// GET /api/odss/recommendation/[symbol] — full recommendation for a symbol
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const store = getStore();
  // Check if we have a cached recommendation
  const cached = store.recommendations.get(symbol.toUpperCase());
  if (cached) return NextResponse.json(cached);

  // Otherwise build one on the fly
  const market = store.market;
  if (!market) return NextResponse.json({ error: 'Market data not ready' }, { status: 503 });

  const sectorMap = store.sectors ? new Map(store.sectors.sectors.map((s) => [s.sector, s])) : new Map();
  const rsMap = store.rs ? new Map(store.rs.rows.map((r) => [r.symbol, r])) : new Map();
  const q = getQuote(symbol.toUpperCase());
  if (!q) return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });

  const technical = runTechnicalEngine(symbol.toUpperCase());
  const optionChain = runOptionChainEngine(symbol.toUpperCase());
  const sector = sectorMap.get(q.sector ?? '');
  const rsRow = rsMap.get(symbol.toUpperCase());

  // Determine direction
  const isLong = technical.trend === 'BULLISH' || (sector && sector.strength > 0);
  const direction = isLong ? 'CE' : 'PE';
  const conviction = 50;

  const strike = runStrikeEngine(symbol.toUpperCase(), direction, technical, optionChain, conviction);
  const entry = runEntryEngine(symbol.toUpperCase(), direction, technical);
  const risk = runRiskEngine(symbol.toUpperCase(), direction, entry, technical);
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
    symbol: symbol.toUpperCase(),
    sector: q.sector,
    direction,
    market,
    sectorScore: sector,
    rs: rsRow,
    technical,
    optionChain,
    opportunity: {
      symbol: symbol.toUpperCase(),
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
