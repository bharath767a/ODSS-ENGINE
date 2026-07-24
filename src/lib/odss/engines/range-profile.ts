/**
 * ODSS — Per-Symbol Intraday RANGE PROFILE (range exhaustion)
 * ===========================================================
 *
 * The user's insight, made statistical: every stock has a characteristic
 * daily range. TVSMOTOR typically travels ~4-5% high-to-low; if it has already
 * swung 3.8% today, the remaining move is small — whatever the setup says.
 *
 * We compute, per symbol, the DISTRIBUTION of daily ranges over the last ~120
 * sessions from REAL Yahoo daily OHLC:
 *
 *     rangePct(day) = (high - low) / prevClose × 100
 *     profile       = { p50, p80, p95 } percentiles
 *
 * Percentiles (not "max") so one crazy day can't poison the read. Intraday,
 * roomToRun compares today's used range against p80:
 *
 *     used 40% of typical range → plenty left (room bonus)
 *     used 90%+                → exhausted (heavy penalty + plain note)
 *
 * DATA HONESTY: profiles refresh once per day from real history and persist to
 * DATA_DIR. No profile / no quote → no adjustment (silent neutral), never a guess.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';

export interface RangeProfile { p50: number; p80: number; p95: number; days: number; }
interface State { updatedDate: string; profiles: Record<string, RangeProfile>; }

const STATE_FILE = dataPath('range-profiles.json');
let state: State = { updatedDate: '', profiles: {} };
let loaded = false;

// Yahoo symbol mapping (mirrors the quote provider's convention).
const INDEX_YAHOO: Record<string, string> = {
  NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', FINNIFTY: 'NIFTY_FIN_SERVICE.NS', MIDCPNIFTY: 'NIFTY_MID_SELECT.NS',
};
const yahooSym = (symbol: string) => INDEX_YAHOO[symbol] ?? `${symbol}.NS`;

function istDate(now = Date.now()): string { return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10); }

function load(): void {
  if (loaded) return; loaded = true;
  try { const d = JSON.parse(readFileSync(STATE_FILE, 'utf-8')); if (d?.profiles) state = d; } catch { /* fresh */ }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** Fetch ~6 months of real daily OHLC and build one symbol's profile. */
async function fetchProfile(symbol: string): Promise<RangeProfile | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(symbol))}?range=6mo&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const r = j?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    const highs: number[] = q?.high ?? [], lows: number[] = q?.low ?? [], closes: number[] = q?.close ?? [];
    const ranges: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      const h = highs[i], l = lows[i], pc = closes[i - 1];
      if (h > 0 && l > 0 && pc > 0 && h >= l) {
        const pct = ((h - l) / pc) * 100;
        if (pct > 0.05 && pct < 25) ranges.push(pct);   // sanity band
      }
    }
    if (ranges.length < 30) return null;                 // too little real history → no profile
    ranges.sort((a, b) => a - b);
    return {
      p50: +percentile(ranges, 50).toFixed(2),
      p80: +percentile(ranges, 80).toFixed(2),
      p95: +percentile(ranges, 95).toFixed(2),
      days: ranges.length,
    };
  } catch { return null; }
}

/** Daily refresh (call from the market service pre-open / startup). Spaced fetches. */
export async function refreshRangeProfiles(symbols: string[]): Promise<{ ok: number; failed: number; skipped: boolean }> {
  load();
  const today = istDate();
  if (state.updatedDate === today && Object.keys(state.profiles).length >= symbols.length * 0.6) {
    return { ok: Object.keys(state.profiles).length, failed: 0, skipped: true };
  }
  let ok = 0, failed = 0;
  for (const sym of symbols) {
    const prof = await fetchProfile(sym);
    if (prof) { state.profiles[sym] = prof; ok++; } else { failed++; }
    await new Promise(r => setTimeout(r, 250));          // be polite to Yahoo
  }
  if (ok > 0) {
    state.updatedDate = today;
    try { ensureDataDir(); writeFileSync(STATE_FILE, JSON.stringify(state)); } catch { /* best effort */ }
  }
  return { ok, failed, skipped: false };
}

export function getRangeProfile(symbol: string): RangeProfile | null {
  load();
  return state.profiles[symbol] ?? null;
}

/**
 * How much of this symbol's TYPICAL day has already been used?
 * Returns null when we can't compute honestly (no profile / bad inputs).
 */
export function getRangeExhaustion(symbol: string, high: number, low: number, prevClose: number):
  { usedPct: number; typicalP80: number; ratio: number } | null {
  load();
  const prof = state.profiles[symbol];
  if (!prof || !(high > 0) || !(low > 0) || !(prevClose > 0) || high < low) return null;
  const usedPct = +(((high - low) / prevClose) * 100).toFixed(2);
  return { usedPct, typicalP80: prof.p80, ratio: +(usedPct / prof.p80).toFixed(2) };
}
