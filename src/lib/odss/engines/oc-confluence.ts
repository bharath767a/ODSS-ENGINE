/**
 * ODSS — Option-Chain + Delta Confluence Engine (multi-timeframe)
 * ==============================================================
 *
 * Consumes REAL option chains (injected from the Dhan bridge) and tracks how
 * OI, PCR, IV and ATM greeks evolve over three horizons — 5m (timing), 15m
 * (confirmation) and 4h (regime). It turns that into:
 *
 *   • an OI-action classification (long buildup / short covering / short
 *     buildup / long unwinding) — the classic price×OI quadrants applied to
 *     calls and puts,
 *   • a direction-aligned confluence score (0-100),
 *   • an ENTRY-timing signal so a good pick is entered when the chain confirms
 *     the technical setup (not too early, not too late), and
 *   • an EXIT-timing signal so an open position is trimmed/exited the moment the
 *     chain turns against it (e.g. call writing surges against a long call).
 *
 * State (per-symbol minute-resolution history) is PERSISTED to DATA_DIR so the
 * 5m/15m/4h context survives a restart / sudden reset — nothing is lost.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';
import type { OptionChain, Direction } from '../types';

export type OIAction = 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'NEUTRAL';
export type OCEntrySignal = 'ENTER' | 'WAIT' | 'AVOID';
export type OCExitSignal = 'HOLD' | 'TRAIL' | 'REDUCE' | 'EXIT';

export interface Snapshot {
  ts: number; spot: number;
  atmCallDelta: number; atmPutDelta: number; atmIV: number;
  pcr: number; callOI: number; putOI: number; maxPain: number;
}

export interface TFResult {
  tf: '5m' | '15m' | '4h';
  priceChangePct: number;
  callOIChangePct: number;
  putOIChangePct: number;
  pcrChange: number;
  score: number;          // 0-100, direction-aligned
  verdict: string;
}

export interface OCConfluence {
  symbol: string; direction: Direction;
  ocScore: number;         // 0-100 aggregate, direction-aligned
  oiAction: OIAction;
  pcr: number; pcrTrend: 'RISING' | 'FALLING' | 'FLAT';
  ivTrend: 'RISING' | 'FALLING' | 'FLAT';
  atmDelta: number;        // ATM delta of the traded side
  tf: Record<'5m' | '15m' | '4h', TFResult>;
  entrySignal: OCEntrySignal;
  exitSignal: OCExitSignal;
  notes: string[];
  updatedAt: number;
}

const STATE_FILE = dataPath('oc-confluence-state.json');
const HISTORY_CAP = 260;        // ~4h at 1-min resolution
const MIN_RESOLUTION_MS = 60_000;
const TF_MS = { '5m': 5 * 60_000, '15m': 15 * 60_000, '4h': 4 * 3600_000 } as const;

const history = new Map<string, Snapshot[]>();
const latest = new Map<string, OCConfluence>();
let loaded = false;
let lastSave = 0;

function load(): void {
  if (loaded) return; loaded = true;
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    for (const [sym, snaps] of Object.entries(data.history || {})) history.set(sym, snaps as Snapshot[]);
  } catch { /* fresh */ }
}

function save(now: number): void {
  if (now - lastSave < 15_000) return; // debounce disk writes
  lastSave = now;
  try {
    ensureDataDir();
    writeFileSync(STATE_FILE, JSON.stringify({ history: Object.fromEntries(history), updatedAt: now }));
  } catch { /* best effort */ }
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

function snapshotFromChain(chain: OptionChain): Snapshot {
  const atm = chain.atmStrike;
  const atmCall = chain.strikes.find(r => r.type === 'CE' && r.strike === atm)
    ?? chain.strikes.filter(r => r.type === 'CE').sort((a, b) => Math.abs(a.strike - atm) - Math.abs(b.strike - atm))[0];
  const atmPut = chain.strikes.find(r => r.type === 'PE' && r.strike === atm)
    ?? chain.strikes.filter(r => r.type === 'PE').sort((a, b) => Math.abs(a.strike - atm) - Math.abs(b.strike - atm))[0];
  const atmIV = ((atmCall?.iv ?? 0) + (atmPut?.iv ?? 0)) / 2 || (atmCall?.iv ?? atmPut?.iv ?? 0);
  return {
    ts: Date.now(), spot: chain.spot,
    atmCallDelta: atmCall?.delta ?? 0, atmPutDelta: atmPut?.delta ?? 0, atmIV,
    pcr: chain.pcr, callOI: chain.totalCallOI, putOI: chain.totalPutOI, maxPain: chain.maxPainStrike,
  };
}

/** Find the snapshot closest to (now - tfMs); falls back to the oldest we have. */
function lookback(snaps: Snapshot[], tfMs: number): Snapshot | null {
  if (snaps.length < 2) return null;
  const now = snaps[snaps.length - 1].ts;
  const target = now - tfMs;
  let best: Snapshot | null = null;
  for (const s of snaps) { if (s.ts <= target) best = s; else break; }
  return best ?? snaps[0]; // partial history → use oldest
}

const pctChange = (cur: number, prev: number) => (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0);

/**
 * Direction-aligned score for one timeframe from price × OI × PCR behaviour.
 * Bullish (CE) rewards: price up, put OI up (put writing / support), call OI
 * down on up-move (short covering), rising PCR. Mirror for PE.
 */
export function scoreTF(dir: Direction, cur: Snapshot, prev: Snapshot, tf: TFResult['tf']): TFResult {
  const bull = dir === 'CE';
  const priceChangePct = pctChange(cur.spot, prev.spot);
  const callOIChangePct = pctChange(cur.callOI, prev.callOI);
  const putOIChangePct = pctChange(cur.putOI, prev.putOI);
  const pcrChange = cur.pcr - prev.pcr;

  let s = 50;
  const up = priceChangePct > 0.05, down = priceChangePct < -0.05;
  if (bull) {
    if (up && putOIChangePct > 2) s += 18;            // put writing into strength
    if (up && callOIChangePct < -2) s += 14;          // call short covering
    if (up && callOIChangePct > 5) s -= 14;           // fresh call writing caps upside
    if (down && callOIChangePct > 2) s -= 12;         // call writing on weakness
    if (down && putOIChangePct < -2) s -= 8;          // put unwinding = support fading
    s += clamp(pcrChange * 30, -12, 12);              // rising PCR bullish
    s += clamp(priceChangePct * 6, -12, 14);
  } else {
    if (down && callOIChangePct > 2) s += 18;         // call writing into weakness
    if (down && putOIChangePct < -2) s += 14;         // put unwinding (support gone)
    if (down && putOIChangePct > 5) s -= 14;          // put writing builds a floor
    if (up && putOIChangePct > 2) s -= 12;            // put writing on strength
    if (up && callOIChangePct < -2) s -= 8;           // call covering = squeeze risk
    s -= clamp(pcrChange * 30, -12, 12);              // falling PCR bearish
    s += clamp(-priceChangePct * 6, -12, 14);
  }
  const score = Math.round(clamp(s));
  const verdict = score >= 62 ? `${tf} confirms ${bull ? 'bullish' : 'bearish'}` : score <= 38 ? `${tf} contradicts` : `${tf} mixed`;
  return { tf, priceChangePct, callOIChangePct, putOIChangePct, pcrChange, score, verdict };
}

export function classifyOI(dir: Direction, cur: Snapshot, prev: Snapshot): OIAction {
  const priceUp = cur.spot > prev.spot;
  // Use the side that matters for the trade: calls for CE, puts for PE.
  const oiCur = dir === 'CE' ? cur.callOI : cur.putOI;
  const oiPrev = dir === 'CE' ? prev.callOI : prev.putOI;
  const oiUp = oiCur > oiPrev * 1.005;
  const oiDown = oiCur < oiPrev * 0.995;
  // Interpreted from the OPTION WRITER's perspective on that side, then framed
  // for the buyer's direction.
  if (dir === 'CE') {
    if (priceUp && oiUp) return 'SHORT_BUILDUP';    // call writing while price rises (caps)
    if (priceUp && oiDown) return 'SHORT_COVERING';  // calls covering → squeeze up (bullish)
    if (!priceUp && oiUp) return 'SHORT_BUILDUP';
    if (!priceUp && oiDown) return 'LONG_UNWINDING';
  } else {
    if (!priceUp && oiUp) return 'SHORT_BUILDUP';    // put writing? for PE buyer, puts OI up on down = fresh shorts (bearish)
    if (!priceUp && oiDown) return 'SHORT_COVERING';
    if (priceUp && oiUp) return 'LONG_BUILDUP';
    if (priceUp && oiDown) return 'LONG_UNWINDING';
  }
  return 'NEUTRAL';
}

/**
 * Update confluence for a symbol with a fresh chain. `direction` is the side we
 * care about (from the conviction pick). Returns the computed confluence.
 */
export function updateOCConfluence(symbol: string, chain: OptionChain, direction: Direction): OCConfluence {
  load();
  const now = Date.now();
  const snap = snapshotFromChain(chain);

  let snaps = history.get(symbol);
  if (!snaps) { snaps = []; history.set(symbol, snaps); }
  const last = snaps[snaps.length - 1];
  if (!last || now - last.ts >= MIN_RESOLUTION_MS) snaps.push(snap);
  else snaps[snaps.length - 1] = snap; // update within the same minute
  if (snaps.length > HISTORY_CAP) snaps.shift();

  const tf: OCConfluence['tf'] = {} as any;
  for (const key of ['5m', '15m', '4h'] as const) {
    const prev = lookback(snaps, TF_MS[key]);
    tf[key] = prev ? scoreTF(direction, snap, prev, key)
      : { tf: key, priceChangePct: 0, callOIChangePct: 0, putOIChangePct: 0, pcrChange: 0, score: 50, verdict: `${key} warming up` };
  }

  // Aggregate: 5m weighted for timing, 15m confirmation, 4h regime.
  const ocScore = Math.round(clamp(0.45 * tf['5m'].score + 0.35 * tf['15m'].score + 0.20 * tf['4h'].score));

  const prev5 = lookback(snaps, TF_MS['5m']) ?? snaps[0];
  const oiAction = classifyOI(direction, snap, prev5);
  const pcrTrend = tf['15m'].pcrChange > 0.03 ? 'RISING' : tf['15m'].pcrChange < -0.03 ? 'FALLING' : 'FLAT';
  const ivPrev = lookback(snaps, TF_MS['15m']);
  const ivTrend = ivPrev ? (snap.atmIV > ivPrev.atmIV * 1.03 ? 'RISING' : snap.atmIV < ivPrev.atmIV * 0.97 ? 'FALLING' : 'FLAT') : 'FLAT';
  const atmDelta = direction === 'CE' ? snap.atmCallDelta : snap.atmPutDelta;

  // Entry timing: chain must confirm the direction on the fast + confirm frames.
  let entrySignal: OCEntrySignal = 'WAIT';
  if (ocScore >= 60 && tf['5m'].score >= 55 && tf['15m'].score >= 52) entrySignal = 'ENTER';
  else if (ocScore <= 38 || tf['5m'].score <= 35) entrySignal = 'AVOID';

  // Exit timing (for an open position on `direction`).
  let exitSignal: OCExitSignal = 'HOLD';
  if (tf['5m'].score <= 32 && tf['15m'].score <= 45) exitSignal = 'EXIT';
  else if (tf['5m'].score <= 42) exitSignal = 'REDUCE';
  else if (tf['5m'].score >= 68 && tf['15m'].score >= 58) exitSignal = 'TRAIL';
  // IV collapse hurts option buyers regardless of direction confluence.
  if (ivTrend === 'FALLING' && tf['5m'].score < 55 && exitSignal === 'HOLD') exitSignal = 'REDUCE';

  const notes: string[] = [];
  notes.push(`OI action: ${oiAction.replace('_', ' ').toLowerCase()}`);
  notes.push(tf['5m'].verdict);
  if (pcrTrend !== 'FLAT') notes.push(`PCR ${pcrTrend.toLowerCase()} (${chain.pcr.toFixed(2)})`);
  if (ivTrend !== 'FLAT') notes.push(`IV ${ivTrend.toLowerCase()}`);
  notes.push(`ATM Δ ${atmDelta.toFixed(2)}`);

  const result: OCConfluence = {
    symbol, direction, ocScore, oiAction,
    pcr: chain.pcr, pcrTrend, ivTrend, atmDelta,
    tf, entrySignal, exitSignal, notes, updatedAt: now,
  };
  latest.set(symbol, result);
  save(now);
  return result;
}

export function getOCConfluence(symbol: string): OCConfluence | null {
  return latest.get(symbol) ?? null;
}

export function getAllOCConfluence(): Record<string, OCConfluence> {
  return Object.fromEntries(latest);
}

export function resetOCConfluence(): void {
  history.clear(); latest.clear(); lastSave = 0;
  try { ensureDataDir(); writeFileSync(STATE_FILE, JSON.stringify({ history: {}, updatedAt: Date.now() })); } catch {}
}
