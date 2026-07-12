/**
 * ODSS - Relative Strength Engine (Phase 5)
 * Ranks stocks inside each sector.
 * Output: Strongest stocks, Weakest stocks, Leadership changes.
 */
import type { RSEngineOutput, RSRow } from '../types';
import { STOCKS } from '../universe';
import { getQuote, getRegime } from '../simulator/market-simulator';
import { runSectorEngine } from './sector-engine';

export function runRSEngine(): RSEngineOutput {
  const sectorOut = runSectorEngine();
  const sectorMap = new Map(sectorOut.sectors.map((s) => [s.sector, s]));
  const rows: RSRow[] = [];

  for (const meta of STOCKS) {
    const q = getQuote(meta.symbol);
    if (!q) continue;
    const sector = sectorMap.get(meta.sector);
    const vsSector = q.changePct - (sector?.changePct ?? 0);
    const nifty = getQuote('NIFTY');
    const vsNifty = q.changePct - (nifty?.changePct ?? 0);

    // RS Score: -100..100
    let rsScore = vsNifty * 25 + vsSector * 15;
    // Adjust by volatility-adjusted return
    rsScore = Math.max(-100, Math.min(100, rsScore));

    let leadership: RSRow['leadership'] = 'NEUTRAL';
    if (rsScore > 15) leadership = 'STRONG';
    else if (rsScore < -15) leadership = 'WEAK';

    const score = Math.max(0, Math.min(100, 50 + rsScore * 0.5));

    rows.push({
      symbol: meta.symbol,
      sector: meta.sector,
      rsScore,
      rank: 0,
      leadership,
      changePct: q.changePct,
      vsSector,
      score,
      facts: [
        `RS vs NIFTY ${vsNifty >= 0 ? '+' : ''}${vsNifty.toFixed(2)}%`,
        `RS vs sector ${vsSector >= 0 ? '+' : ''}${vsSector.toFixed(2)}%`,
        `Leadership ${leadership}`,
      ],
    });
  }

  // Rank within sector
  const bySector = new Map<string, RSRow[]>();
  for (const r of rows) {
    if (!bySector.has(r.sector)) bySector.set(r.sector, []);
    bySector.get(r.sector)!.push(r);
  }
  for (const list of bySector.values()) {
    list.sort((a, b) => b.rsScore - a.rsScore);
    list.forEach((r, i) => (r.rank = i + 1));
  }

  // Sort overall by rsScore desc
  rows.sort((a, b) => b.rsScore - a.rsScore);

  return { rows, timestamp: Date.now() };
}
