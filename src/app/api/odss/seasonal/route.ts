import { NextResponse } from 'next/server';
import { STOCKS, type SymbolMeta } from '@/lib/odss/universe';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/seasonal
 *
 * Returns seasonal performance patterns by month for the Indian market.
 *
 * Uses well-known Indian-market seasonality heuristics:
 *   - Nov–Jan: Historically BULLISH (Diwali rally, Santa rally, new-year inflows)
 *   - Feb–Mar: MIXED, often WEAKENING (election-year uncertainty, fiscal-year-end tax selling)
 *   - Apr–Jun: VOLATILE (elections results, RBI policy, monsoon onset)
 *   - Jul–Sep: BULLISH typically (good monsoon → rural demand, Auto/Tractor strength)
 *   - Oct: WEAKENING historically (Sept-Oct "Sell in May" effect, festival profit-taking)
 *
 * For each month we return the strongest seasonal bullish and bearish
 * symbols from our F&O universe with avgReturn (%) and winRate (%).
 *
 * Output shape:
 *   { months: [{ month, name, bullish:[{symbol,name,sector,avgReturn,winRate}], bearish:[...] }] }
 */
export async function GET() {
  try {
    const months = buildSeasonalCalendar();
    return NextResponse.json({
      months,
      timestamp: Date.now(),
      // HONESTY: these are heuristic patterns, NOT computed from price history.
      // Until real 5y monthly stats are built, the UI must label them as such.
      dataBasis: 'HEURISTIC',
      disclaimer: 'Illustrative seasonal tendencies — not computed from historical price data. Do not trade on these numbers.',
    });
  } catch (err) {
    return NextResponse.json({
      months: buildSeasonalCalendar(),
      timestamp: Date.now(),
      source: 'FALLBACK',
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

// ---------- Deterministic helpers ----------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function seededRand(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Indian-market seasonal bias per month (1=Jan … 12=Dec).
// > 0 = bullish bias, < 0 = bearish bias, magnitude scales effect.
const MONTH_BIAS: Record<number, number> = {
  1: 1.4,   // January — new-year inflows, bullish
  2: 0.3,   // February — mixed, budget reactions
  3: -0.6,  // March — fiscal-year-end weakness
  4: 0.7,   // April — new fiscal year, fresh positioning
  5: 0.2,   // May — pre-monsoon sideways
  6: -0.5,  // June — monsoon onset, defensive
  7: 1.1,   // July — good monsoon rally
  8: 0.9,   // August — continued rural demand
  9: 0.6,   // September — quarter-end window dressing
  10: -0.8, // October — historically the "weak" month
  11: 1.6,  // November — Diwali rally, strong
  12: 1.2,  // December — Santa rally, year-end push
};

// Sector-specific seasonal multipliers per month — based on Indian market patterns.
// e.g. AUTO strong in Jul-Sep (festive + monsoon), IT strong in Jan-Apr (US budget cycle),
// METAL weak in Mar/Jun/Nov (China slowdown fears), BANKING strong in Mar/Nov (credit cycle).
const SECTOR_MONTH_BIAS: Record<string, Record<number, number>> = {
  BANKING:   { 1: 1.5, 3: 1.2, 7: -0.5, 11: 1.8, 12: 1.0 },
  IT:        { 1: 1.8, 4: 1.4, 7: 1.2, 10: -0.6, 12: 1.0 },
  AUTO:      { 2: 0.4, 6: 0.6, 9: 1.6, 10: 1.4, 11: 1.5 },
  PHARMA:    { 3: 1.2, 6: 1.0, 11: 1.4, 12: 1.0 },
  FMCG:      { 6: 1.3, 10: 1.4, 11: 1.8, 12: 1.6 }, // Festive season
  METAL:     { 2: 1.0, 3: -1.4, 6: -1.2, 11: -1.0, 12: 0.6 },
  ENERGY:    { 4: 1.2, 10: 1.4, 11: 1.0 }, // Crude cycles
  FINANCIAL: { 3: 1.4, 11: 1.6, 12: 1.0 },
};

interface SeasonItem {
  symbol: string;
  name: string;
  sector: string;
  avgReturn: number;
  winRate: number;
}

interface MonthEntry {
  month: number;
  name: string;
  bullish: SeasonItem[];
  bearish: SeasonItem[];
}

function buildSeasonalCalendar(): MonthEntry[] {
  const months: MonthEntry[] = [];

  for (let m = 1; m <= 12; m++) {
    const monthBias = MONTH_BIAS[m] ?? 0;
    const bullish: SeasonItem[] = [];
    const bearish: SeasonItem[] = [];

    for (const meta of STOCKS) {
      const sectorBias = SECTOR_MONTH_BIAS[meta.sector]?.[m] ?? 0;
      const combined = monthBias + sectorBias;

      // Hash-based deterministic noise so each symbol looks slightly different
      const rng = seededRand(hashString(`${meta.symbol}-${m}`));
      const noise = (rng() - 0.5) * 1.6; // ±0.8%
      const avgReturn = Number((combined + noise).toFixed(2));

      // Win rate derived from sign & magnitude of avgReturn — bullish returns
      // → higher win rate, bearish → lower. Range [42, 82].
      const base = 60;
      const winShift = Math.max(-18, Math.min(22, avgReturn * 8));
      const winRate = Math.max(40, Math.min(85, Math.round(base + winShift)));

      const item: SeasonItem = {
        symbol: meta.symbol,
        name: meta.name,
        sector: meta.sector,
        avgReturn,
        winRate,
      };

      if (avgReturn >= 0.5) {
        bullish.push(item);
      } else if (avgReturn <= -0.5) {
        bearish.push(item);
      }
    }

    // Sort bullish desc, bearish asc (most negative first) — top 5 each
    bullish.sort((a, b) => b.avgReturn - a.avgReturn);
    bearish.sort((a, b) => a.avgReturn - b.avgReturn);

    months.push({
      month: m,
      name: MONTH_NAMES[m - 1],
      bullish: bullish.slice(0, 5),
      bearish: bearish.slice(0, 5),
    });
  }

  return months;
}
