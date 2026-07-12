/**
 * ODSS - Sector Engine (Phase 4)
 * Ranks every sector.
 * Output: Sector Rank, Sector Strength, Momentum, Leadership.
 */
import type { SectorEngineOutput, SectorScore } from '../types';
import { STOCKS } from '../universe';
import { getQuote } from '../simulator/market-simulator';

export function runSectorEngine(): SectorEngineOutput {
  const sectors = Array.from(new Set(STOCKS.map((s) => s.sector)));
  const rows: SectorScore[] = [];

  for (const sector of sectors) {
    const sectorStocks = STOCKS.filter((s) => s.sector === sector);
    const quotes = sectorStocks.map((s) => getQuote(s.symbol)).filter(Boolean);
    if (quotes.length === 0) continue;

    const avgChange = quotes.reduce((a, q) => a + q!.changePct, 0) / quotes.length;
    const advancers = quotes.filter((q) => q!.changePct > 0).length;
    const decliners = quotes.filter((q) => q!.changePct < 0).length;
    const breadth = advancers / Math.max(advancers + decliners, 1);

    // Strength: -100..100 from avg change scaled
    const strength = Math.max(-100, Math.min(100, avgChange * 25));
    // Momentum: combine avg change with breadth
    const momentum = Math.max(-100, Math.min(100, avgChange * 20 + (breadth - 0.5) * 60));

    // Leadership: compare to NIFTY
    const nifty = getQuote('NIFTY');
    const vsNifty = avgChange - (nifty?.changePct ?? 0);
    let leadership: SectorScore['leadership'] = 'MIXED';
    if (vsNifty > 0.3 && avgChange > 0) leadership = 'LEADING';
    else if (vsNifty < -0.3 && avgChange < 0) leadership = 'LAGGING';

    // Score: 0..100 (higher = bullish sector)
    const score = Math.max(0, Math.min(100, 50 + strength * 0.5));

    rows.push({
      sector,
      rank: 0,
      strength,
      momentum,
      leadership,
      changePct: avgChange,
      score,
      facts: [
        `Avg change ${avgChange.toFixed(2)}%`,
        `${advancers} adv / ${decliners} dec`,
        `${leadership} NIFTY by ${vsNifty.toFixed(2)}%`,
      ],
    });
  }

  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => (r.rank = i + 1));

  return { sectors: rows, timestamp: Date.now() };
}
