import { NextRequest, NextResponse } from 'next/server';
import { ALL_SYMBOLS, getSymbolMeta } from '@/lib/odss/universe';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/seasonal-data?symbol=RELIANCE
 *
 * Returns 12 months of avgReturn% and winRate% for a specific symbol.
 * Uses deterministic pseudo-random data derived from a hash of the symbol
 * so results are stable across fetches (and consistent with the
 * /api/odss/seasonal endpoint's mental model).
 *
 * Output shape:
 *   { symbol, name, sector, months: [{ month, name, avgReturn, winRate, occurrences }, ...] }
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const rawSymbol = (url.searchParams.get('symbol') ?? '').toUpperCase().trim();
    const symbol = rawSymbol || 'NIFTY';

    const meta = getSymbolMeta(symbol);
    const name = meta?.name ?? symbol;
    const sector = meta?.sector ?? 'INDEX';

    const months = buildMonthsForSymbol(symbol, meta?.beta ?? 1.0);

    return NextResponse.json({
      symbol,
      name,
      sector,
      months,
      timestamp: Date.now(),
    });
  } catch (err) {
    // Last-resort fallback — never 500
    return NextResponse.json({
      symbol: 'NIFTY',
      name: 'Nifty 50',
      sector: 'INDEX',
      months: buildMonthsForSymbol('NIFTY', 1.0),
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

// Indian-market monthly seasonal bias (1=Jan … 12=Dec). Same model as the
// /api/odss/seasonal endpoint so the two stay logically consistent.
const MONTH_BIAS: Record<number, number> = {
  1: 1.4, 2: 0.3, 3: -0.6, 4: 0.7, 5: 0.2, 6: -0.5,
  7: 1.1, 8: 0.9, 9: 0.6, 10: -0.8, 11: 1.6, 12: 1.2,
};

// Sector-specific monthly bias amplifiers.
const SECTOR_MONTH_BIAS: Record<string, Record<number, number>> = {
  BANKING:   { 1: 1.5, 3: 1.2, 7: -0.5, 11: 1.8, 12: 1.0 },
  IT:        { 1: 1.8, 4: 1.4, 7: 1.2, 10: -0.6, 12: 1.0 },
  AUTO:      { 2: 0.4, 6: 0.6, 9: 1.6, 10: 1.4, 11: 1.5 },
  PHARMA:    { 3: 1.2, 6: 1.0, 11: 1.4, 12: 1.0 },
  FMCG:      { 6: 1.3, 10: 1.4, 11: 1.8, 12: 1.6 },
  METAL:     { 2: 1.0, 3: -1.4, 6: -1.2, 11: -1.0, 12: 0.6 },
  ENERGY:    { 4: 1.2, 10: 1.4, 11: 1.0 },
  FINANCIAL: { 3: 1.4, 11: 1.6, 12: 1.0 },
};

interface MonthRow {
  month: number;
  name: string;
  avgReturn: number;
  winRate: number;
  occurrences: number;
}

function buildMonthsForSymbol(
  symbol: string,
  beta: number,
): MonthRow[] {
  const meta = ALL_SYMBOLS.find((s) => s.symbol === symbol);
  const sector = meta?.sector ?? 'INDEX';
  const baseHash = hashString(symbol);

  const rows: MonthRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthBias = MONTH_BIAS[m] ?? 0;
    const sectorBias = SECTOR_MONTH_BIAS[sector]?.[m] ?? 0;
    const combined = monthBias + sectorBias;

    // Per-month seeded noise — stable across fetches
    const rng = seededRand(baseHash + m * 7919);
    const noise = (rng() - 0.5) * 1.8; // ±0.9%
    const avgReturn = Number(((combined + noise) * beta).toFixed(2));

    // Win rate derived from sign & magnitude
    const base = 60;
    const winShift = Math.max(-18, Math.min(22, avgReturn * 8));
    const winRate = Math.max(40, Math.min(85, Math.round(base + winShift)));

    // Occurrences — number of historical years the pattern has been tracked
    // (range 8–15, deterministic per symbol+month)
    const occurrences = 8 + Math.floor(rng() * 8);

    rows.push({
      month: m,
      name: MONTH_NAMES[m - 1],
      avgReturn,
      winRate,
      occurrences,
    });
  }
  return rows;
}
