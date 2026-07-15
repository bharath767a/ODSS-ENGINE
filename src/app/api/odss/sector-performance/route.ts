import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/sector-performance
 *
 * Returns multi-period returns for the major NSE sectoral indices.
 *
 * Attempts to fetch real data from the NSE provider first via
 * `nse.fetchAllIndicesData()`. If the provider module is missing, the
 * method doesn't exist, or the call fails (geo-block, rate-limit, etc.),
 * we return realistic deterministic fallback data for 10 sectoral indices.
 *
 * Output shape:
 *   {
 *     sectors: [{
 *       sector, ltp, changePct,
 *       weekReturn, monthReturn, quarterReturn, yearReturn,
 *       pe, pb
 *     }, ...],
 *     source: 'NSE' | 'FALLBACK',
 *     timestamp
 *   }
 */
export async function GET() {
  try {
    // Try real provider first
    try {
      const mod: any = await import('@/lib/odss/data-providers/nse-provider');
      if (mod && typeof mod.NSEProvider === 'function') {
        const nse = new mod.NSEProvider();
        if (typeof nse.fetchAllIndicesData === 'function') {
          const data = await nse.fetchAllIndicesData();
          if (Array.isArray(data) && data.length > 0) {
            return NextResponse.json({
              sectors: data,
              source: 'NSE',
              timestamp: Date.now(),
            });
          }
        }
      }
    } catch {
      // fall through to fallback
    }

    // Fallback — realistic deterministic Indian sector data
    return NextResponse.json({
      sectors: buildFallbackSectors(),
      source: 'FALLBACK',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      sectors: buildFallbackSectors(),
      source: 'FALLBACK',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

// ---------- Deterministic fallback ----------

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

interface SectorRow {
  sector: string;
  ltp: number;
  changePct: number;
  weekReturn: number;
  monthReturn: number;
  quarterReturn: number;
  yearReturn: number;
  pe: number;
  pb: number;
}

// Plausible reference LTPs for NSE sectoral indices (rounded).
const SECTOR_LTP: Record<string, number> = {
  'NIFTY IT': 42150,
  'NIFTY BANK': 53890,
  'NIFTY AUTO': 24810,
  'NIFTY FMCG': 58930,
  'NIFTY PHARMA': 21940,
  'NIFTY METAL': 9125,
  'NIFTY ENERGY': 41680,
  'NIFTY REALTY': 1085,
  'NIFTY MEDIA': 1840,
  'NIFTY PSU BANK': 6720,
};

// Plausible valuation multiples by sector.
const SECTOR_PE: Record<string, number> = {
  'NIFTY IT': 28,
  'NIFTY BANK': 16,
  'NIFTY AUTO': 22,
  'NIFTY FMCG': 48,
  'NIFTY PHARMA': 32,
  'NIFTY METAL': 12,
  'NIFTY ENERGY': 18,
  'NIFTY REALTY': 35,
  'NIFTY MEDIA': 24,
  'NIFTY PSU BANK': 9,
};

const SECTOR_PB: Record<string, number> = {
  'NIFTY IT': 8.5,
  'NIFTY BANK': 2.4,
  'NIFTY AUTO': 4.1,
  'NIFTY FMCG': 12.2,
  'NIFTY PHARMA': 6.1,
  'NIFTY METAL': 1.8,
  'NIFTY ENERGY': 2.1,
  'NIFTY REALTY': 2.6,
  'NIFTY MEDIA': 2.0,
  'NIFTY PSU BANK': 1.2,
};

// Per-sector drift baseline — annualized % drift applied to per-period returns.
// Sectors that have been strongly trending (IT, Auto, PSU Bank) get higher baselines.
const SECTOR_DRIFT: Record<string, number> = {
  'NIFTY IT': 22,
  'NIFTY BANK': 14,
  'NIFTY AUTO': 28,
  'NIFTY FMCG': 12,
  'NIFTY PHARMA': 18,
  'NIFTY METAL': 8,
  'NIFTY ENERGY': 20,
  'NIFTY REALTY': 32,
  'NIFTY MEDIA': -6,
  'NIFTY PSU BANK': 38,
};

function buildFallbackSectors(): SectorRow[] {
  const sectors = Object.keys(SECTOR_LTP);
  const out: SectorRow[] = [];

  for (const sector of sectors) {
    const h = hashString(sector);
    const rng = seededRand(h);

    const baseLtp = SECTOR_LTP[sector];
    const drift = SECTOR_DRIFT[sector] ?? 10;

    // Today's change — small ±2% move, deterministic
    const changePct = Number(((rng() - 0.45) * 2.4).toFixed(2));
    const ltp = Number((baseLtp * (1 + changePct / 100)).toFixed(2));

    // Period returns — scaled by annualized drift + seeded noise.
    // 1W ~ drift/52, 1M ~ drift/12, 3M ~ drift/4, 1Y ~ drift
    const weekReturn = Number((drift / 52 + (rng() - 0.5) * 4).toFixed(2));
    const monthReturn = Number((drift / 12 + (rng() - 0.5) * 6).toFixed(2));
    const quarterReturn = Number((drift / 4 + (rng() - 0.5) * 8).toFixed(2));
    const yearReturn = Number((drift + (rng() - 0.5) * 15).toFixed(2));

    out.push({
      sector,
      ltp,
      changePct,
      weekReturn,
      monthReturn,
      quarterReturn,
      yearReturn,
      pe: SECTOR_PE[sector] ?? 20,
      pb: SECTOR_PB[sector] ?? 2,
    });
  }

  return out;
}
