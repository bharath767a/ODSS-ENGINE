/**
 * ODSS — Real Option-Chain Feed
 * =============================
 *
 * Fetches REAL Dhan option chains from the bridge, maps them into the engine's
 * OptionChain shape (per-strike OptionRow[] with a computed OI-change vs the
 * previous snapshot), and injects them into the simulator store so the option
 * chain engine, conviction engine and confluence engine all analyse real data.
 *
 * The previous-OI snapshot per symbol/strike is what lets us compute call/put
 * OI *change* — the raw Dhan lite chain gives absolute OI only. This is the
 * signal the confluence engine needs (buildup vs unwinding vs short covering).
 */
import type { OptionChain, OptionRow, Moneyness } from '../types';
import { getSymbolMeta } from '../universe';
import { injectRealOptionChain } from '../simulator/market-simulator';

// prevOI[symbol][strike] = { c: callOI, p: putOI } from the previous fetch.
const prevOI = new Map<string, Map<number, { c: number; p: number }>>();

function inferStrikeStep(symbol: string, strikes: any[]): number {
  const meta = getSymbolMeta(symbol);
  if (meta?.strikeStep && meta.strikeStep > 0) return meta.strikeStep;
  // Infer from the two closest strike values.
  const ks = strikes.map(s => Number(s.strike)).filter(k => k > 0).sort((a, b) => a - b);
  for (let i = 1; i < ks.length; i++) { const d = ks[i] - ks[i - 1]; if (d > 0) return d; }
  return 50;
}

/**
 * Map a raw bridge/Dhan option chain into the engine OptionChain shape.
 * Splits each combined strike row into CE + PE OptionRows and computes OI change
 * against the last snapshot for this symbol.
 */
export function mapBridgeChain(symbol: string, raw: any): OptionChain | null {
  if (!raw || !Array.isArray(raw.strikes) || raw.strikes.length === 0) return null;
  const spot = Number(raw.spot) || 0;
  if (spot <= 0) return null;
  const step = inferStrikeStep(symbol, raw.strikes);
  const prev = prevOI.get(symbol) ?? new Map<number, { c: number; p: number }>();
  const nextPrev = new Map<number, { c: number; p: number }>();

  const rows: OptionRow[] = [];
  let totalCallOI = 0, totalPutOI = 0, totalCallOIChange = 0, totalPutOIChange = 0;

  for (const s of raw.strikes) {
    const strike = Number(s.strike) || 0;
    if (strike <= 0) continue;
    const callOI = Number(s.callOI) || 0;
    const putOI = Number(s.putOI) || 0;
    const p = prev.get(strike);
    const callOIChange = p ? callOI - p.c : 0;
    const putOIChange = p ? putOI - p.p : 0;
    nextPrev.set(strike, { c: callOI, p: putOI });

    totalCallOI += callOI; totalPutOI += putOI;
    totalCallOIChange += callOIChange; totalPutOIChange += putOIChange;

    const moneyness = (t: 'CE' | 'PE'): Moneyness =>
      Math.abs(strike - spot) < step / 2 ? 'ATM'
        : (t === 'CE' && strike < spot) || (t === 'PE' && strike > spot) ? 'ITM' : 'OTM';

    const callLTP = Number(s.callLTP) || 0;
    const putLTP = Number(s.putLTP) || 0;
    rows.push({
      strike, type: 'CE', ltp: callLTP,
      bid: callLTP > 0 ? +(callLTP * 0.995).toFixed(2) : 0,
      ask: callLTP > 0 ? +(callLTP * 1.005).toFixed(2) : 0,
      iv: Number(s.callIV) || 0, volume: Number(s.callVolume) || 0,
      oi: callOI, oiChange: callOIChange,
      delta: Number(s.callDelta) || 0, gamma: Number(s.callGamma) || 0,
      theta: Number(s.callTheta) || 0, vega: Number(s.callVega) || 0,
      moneyness: moneyness('CE'),
    });
    rows.push({
      strike, type: 'PE', ltp: putLTP,
      bid: putLTP > 0 ? +(putLTP * 0.995).toFixed(2) : 0,
      ask: putLTP > 0 ? +(putLTP * 1.005).toFixed(2) : 0,
      iv: Number(s.putIV) || 0, volume: Number(s.putVolume) || 0,
      oi: putOI, oiChange: putOIChange,
      delta: Number(s.putDelta) || 0, gamma: Number(s.putGamma) || 0,
      theta: Number(s.putTheta) || 0, vega: Number(s.putVega) || 0,
      moneyness: moneyness('PE'),
    });
  }
  prevOI.set(symbol, nextPrev);

  const atmStrike = Number(raw.atmStrike) || rows.reduce((best, r) =>
    Math.abs(r.strike - spot) < Math.abs(best - spot) ? r.strike : best, rows[0]?.strike ?? spot);
  const pcr = Number(raw.pcr) || (totalCallOI > 0 ? totalPutOI / totalCallOI : 1);

  return {
    symbol, expiry: raw.expiry || '', spot, atmStrike, strikes: rows,
    pcr, maxPainStrike: Number(raw.maxPainStrike) || atmStrike,
    totalCallOI, totalPutOI, totalCallOIChange, totalPutOIChange,
    timestamp: Date.now(),
  };
}

/**
 * Fetch real chains for `symbols` from the bridge, inject them, and return the
 * mapped chains. `bridge` is the BridgeProvider (must expose getRawOptionChain).
 */
export async function fetchAndInjectOptionChains(
  bridge: { getRawOptionChain: (s: string) => Promise<any | null> },
  symbols: string[],
): Promise<Map<string, OptionChain>> {
  const out = new Map<string, OptionChain>();
  for (const sym of symbols) {
    try {
      const raw = await bridge.getRawOptionChain(sym);
      if (!raw) continue;
      const chain = mapBridgeChain(sym, raw);
      if (chain) { injectRealOptionChain(sym, chain); out.set(sym, chain); }
    } catch { /* skip this symbol, keep going */ }
  }
  return out;
}
