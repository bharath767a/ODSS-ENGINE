/**
 * ODSS - Opportunity Engine (Phase 8)
 * Combines Market, Sector, Relative Strength, Technical, Option Chain.
 * Ranks ALL symbols.
 * Output: Top 10 opportunities.
 */
import type {
  OpportunityEngineOutput,
  OpportunityRow,
  Direction,
  MarketEngineOutput,
  SectorEngineOutput,
  RSEngineOutput,
  TechnicalEngineOutput,
  OptionChainEngineOutput,
} from '../types';
import { ALL_SYMBOLS } from '../universe';
import { getConfigSync } from '../config';
import { runTechnicalEngine } from './technical-engine';
import { runOptionChainEngine } from './option-chain-engine';

export interface OpportunityContext {
  market: MarketEngineOutput;
  sector: SectorEngineOutput;
  rs: RSEngineOutput;
}

export function runOpportunityEngine(ctx: OpportunityContext): OpportunityEngineOutput {
  const config = getConfigSync();
  const sectorMap = new Map(ctx.sector.sectors.map((s) => [s.sector, s]));
  const rsMap = new Map(ctx.rs.rows.map((r) => [r.symbol, r]));
  const rows: OpportunityRow[] = [];

  for (const meta of ALL_SYMBOLS) {
    const technical = runTechnicalEngine(meta.symbol);
    const optionChain = runOptionChainEngine(meta.symbol);
    const sector = sectorMap.get(meta.sector);
    const rs = rsMap.get(meta.symbol);

    // Determine direction (CE or PE) from combined bias
    const direction = pickDirection({
      market: ctx.market,
      sector: sector,
      rs: rs,
      technical,
      optionChain,
    });

    // Per-engine scores aligned to direction
    // For CE direction, bullish engines score higher; for PE, bearish.
    const dirMultiplier = direction === 'CE' ? 1 : -1;
    const marketScore = 50 + ctx.market.marketScore * 0.5 * dirMultiplier;
    const sectorScore = sector ? Math.max(0, Math.min(100, 50 + sector.strength * 0.5 * dirMultiplier)) : 50;
    const rsScore = rs ? Math.max(0, Math.min(100, 50 + rs.rsScore * 0.5 * dirMultiplier)) : 50;
    const technicalScore = technical.score; // already 0..100 quality
    const optionChainScore = optionChain.score;

    // Weighted total
    const totalScore =
      marketScore * config.weightMarket +
      sectorScore * config.weightSector +
      rsScore * config.weightRS +
      technicalScore * config.weightTechnical +
      optionChainScore * config.weightOptionChain +
      // Risk weight: implied by RR availability (computed downstream) — use technical+OC as proxy
      Math.min(technicalScore, optionChainScore) * config.weightRisk;
    const total = Math.max(0, Math.min(100, totalScore));

    // Confidence: agreement between engines
    const aligned = [
      ctx.market.marketScore * dirMultiplier > 0 ? 1 : 0,
      (sector?.strength ?? 0) * dirMultiplier > 0 ? 1 : 0,
      (rs?.rsScore ?? 0) * dirMultiplier > 0 ? 1 : 0,
      technical.trend === (direction === 'CE' ? 'BULLISH' : 'BEARISH') ? 1 : 0,
      optionChain.bias === (direction === 'CE' ? 'LONG' : 'SHORT') ? 1 : 0,
    ];
    const alignCount = aligned.reduce((a, b) => a + b, 0);
    const confidence = Math.min(100, (alignCount / 5) * 50 + total * 0.5);

    const rationale = `${meta.symbol} ${direction}: ${alignCount}/5 engines aligned. ${technical.facts[0]}. ${optionChain.facts[0]}.`;

    rows.push({
      symbol: meta.symbol,
      sector: meta.sector,
      direction,
      marketScore,
      sectorScore,
      rsScore,
      technicalScore,
      optionChainScore,
      totalScore: total,
      confidence,
      rank: 0,
      rationale,
      facts: [
        `Market ${marketScore.toFixed(0)} | Sector ${sectorScore.toFixed(0)} | RS ${rsScore.toFixed(0)}`,
        `Technical ${technicalScore.toFixed(0)} | OC ${optionChainScore.toFixed(0)}`,
        `Total ${total.toFixed(1)} | Confidence ${confidence.toFixed(0)}`,
      ],
    });
  }

  rows.sort((a, b) => b.totalScore - a.totalScore);
  rows.forEach((r, i) => (r.rank = i + 1));
  return { rows, timestamp: Date.now() };
}

function pickDirection(args: {
  market: MarketEngineOutput;
  sector?: any;
  rs?: any;
  technical: TechnicalEngineOutput;
  optionChain: OptionChainEngineOutput;
}): Direction {
  let bull = 0;
  let bear = 0;
  if (args.market.marketScore > 0) bull += 1; else if (args.market.marketScore < 0) bear += 1;
  if ((args.sector?.strength ?? 0) > 0) bull += 1; else if ((args.sector?.strength ?? 0) < 0) bear += 1;
  if ((args.rs?.rsScore ?? 0) > 0) bull += 1; else if ((args.rs?.rsScore ?? 0) < 0) bear += 1;
  if (args.technical.trend === 'BULLISH') bull += 2; else if (args.technical.trend === 'BEARISH') bear += 2;
  if (args.optionChain.bias === 'LONG') bull += 1; else if (args.optionChain.bias === 'SHORT') bear += 1;
  return bull >= bear ? 'CE' : 'PE';
}
