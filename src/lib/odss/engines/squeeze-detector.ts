/**
 * ODSS — Short-Covering SQUEEZE Engine (stateful lifecycle)
 * ========================================================
 *
 * The highest-probability options setup: institutions (option writers) get
 * trapped and are forced to buy back — premiums explode. We track it through a
 * clear lifecycle off the REAL Dhan chain (refreshes ~35s; a squeeze runs for
 * minutes, so this is early enough to act):
 *
 *   FORMING  — price is pressing a heavy OI wall and no NEW writers are adding
 *              (OI at the wall has plateaued). Sellers are getting nervous.
 *   LIVE     — price BROKE the wall AND OI there is unwinding (writers covering)
 *              AND the wall's premium is jumping / volume is surging. Squeeze on.
 *   PEAKING  — unwinding + premium momentum are fading. Prepare to exit.
 *   DONE     — OI stabilised, premium normalising. Logged; the log resets at close.
 *
 * A call wall breaking UP = CALL squeeze (buy CE). A put wall breaking DOWN =
 * PUT squeeze (buy PE). Quality-gated so it never fires on a thin/weak wall.
 *
 * DATA HONESTY: driven by the real chain only. No chain → no squeeze (never fake).
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';
import type { OptionChain, OptionRow } from '../types';

export type SqueezeStatus = 'NONE' | 'FORMING' | 'LIVE' | 'PEAKING' | 'DONE';
export type SqueezeDir = 'CALL' | 'PUT';

export interface SqueezeSignal {
  symbol: string; isIndex: boolean;
  status: SqueezeStatus; direction: SqueezeDir;
  wallStrike: number; spot: number;
  proximityPct: number;          // distance to the wall (%)
  wallOI: number; peakOI: number; oiUnwindPct: number;   // how much OI has left the peak
  premiumStart: number; premiumNow: number; premiumChangePct: number;
  ivNow: number; volumeMult: number;                     // volume vs baseline
  deltaNow: number;
  confidence: number;            // 0-100 (quality)
  suggestedStrike: number; stopLoss: number; target: number; action: string;
  detectedAt: number;            // FORMING first seen (epoch ms)
  triggeredAt: number;           // LIVE first seen (epoch ms, 0 if never)
  statusAt: number;              // last status change
  note: string;
}

interface WallTrack {
  type: SqueezeDir; strike: number;
  peakOI: number; lastOI: number;
  premiumStart: number; peakPremium: number;
  volBaseline: number; volSamples: number;
  status: SqueezeStatus;
  detectedAt: number; triggeredAt: number; statusAt: number;
  stableScans: number;           // consecutive scans with no unwinding (→ DONE)
  pressScans: number;            // consecutive scans genuinely pressing the wall
  lastPremium: number;
}

export interface SqueezeCompleted {
  symbol: string; direction: SqueezeDir; wallStrike: number;
  peakPremium: number; premiumStart: number; maxGainPct: number;
  triggeredAt: number; completedAt: number; durationSec: number;
}

const STATE_FILE = dataPath('squeeze-state.json');
const LOG_FILE = dataPath('squeeze-log.json');

const PROX_FORMING = 0.004;   // within 0.4% of the wall → pressing it
const UNWIND_TRIGGER = 0.03;  // ≥3% OI drop from peak = genuine covering
const MIN_WALL_OI_INDEX = 1_500_000;   // quality floor: a wall must be heavy
const MIN_WALL_OI_STOCK = 150_000;

const tracks = new Map<string, WallTrack>();
const latest = new Map<string, SqueezeSignal>();
let completed: SqueezeCompleted[] = [];
let loaded = false, lastSave = 0;

function load(): void {
  if (loaded) return; loaded = true;
  try {
    const d = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    for (const [k, v] of Object.entries(d.tracks || {})) { const t = v as WallTrack; t.pressScans ??= 0; tracks.set(k, t); }
  } catch {}
  try { const l = JSON.parse(readFileSync(LOG_FILE, 'utf-8')); if (Array.isArray(l.items)) completed = l.items; } catch {}
}
function save(now: number): void {
  if (now - lastSave < 15_000) return; lastSave = now;
  try { ensureDataDir(); writeFileSync(STATE_FILE, JSON.stringify({ tracks: Object.fromEntries(tracks), updatedAt: now })); } catch {}
  try { writeFileSync(LOG_FILE, JSON.stringify({ items: completed.slice(-60), updatedAt: now })); } catch {}
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

function nearestStep(strikes: number[]): number {
  const u = Array.from(new Set(strikes)).sort((a, b) => a - b);
  for (let i = 1; i < u.length; i++) { const d = u[i] - u[i - 1]; if (d > 0) return d; }
  return 50;
}

/** Update the squeeze lifecycle for one symbol from its real chain. */
export function updateSqueeze(symbol: string, chain: OptionChain, isIndex = false): SqueezeSignal | null {
  load();
  const now = Date.now();
  const spot = chain.spot;
  if (!spot || !chain.strikes?.length) return null;
  const step = nearestStep(chain.strikes.map(r => r.strike));
  const minWallOI = isIndex ? MIN_WALL_OI_INDEX : MIN_WALL_OI_STOCK;

  const calls = chain.strikes.filter(r => r.type === 'CE');
  const puts = chain.strikes.filter(r => r.type === 'PE');
  // The relevant walls: heaviest call OI at/above spot (resistance), heaviest put
  // OI at/below spot (support) — these are the levels price squeezes through.
  const callWall = calls.filter(r => r.strike >= spot - step).reduce<OptionRow | null>((a, b) => (!a || b.oi > a.oi ? b : a), null);
  const putWall = puts.filter(r => r.strike <= spot + step).reduce<OptionRow | null>((a, b) => (!a || b.oi > a.oi ? b : a), null);

  // Which wall is in play = the closer one that's genuinely heavy.
  const cand: Array<{ type: SqueezeDir; row: OptionRow }> = [];
  if (callWall && callWall.oi >= minWallOI) cand.push({ type: 'CALL', row: callWall });
  if (putWall && putWall.oi >= minWallOI) cand.push({ type: 'PUT', row: putWall });
  cand.sort((a, b) => Math.abs(a.row.strike - spot) - Math.abs(b.row.strike - spot));
  const inPlay = cand[0];

  if (!inPlay || Math.abs(inPlay.row.strike - spot) / spot > 0.008) {
    // No wall pressed → clear any FORMING track (a LIVE one is finalised below by absence too).
    finalizeIfActive(symbol, now);
    tracks.delete(symbol);
    const none: SqueezeSignal = emptySignal(symbol, isIndex, spot);
    latest.set(symbol, none); save(now);
    return none;
  }

  const { type, row } = inPlay;
  const wall = row.strike;
  const wallOI = row.oi;
  const premium = row.ltp;
  const iv = row.iv ?? 0;
  const vol = row.volume ?? 0;
  const delta = row.delta ?? 0;

  // Reset the track if the wall moved to a different strike (new setup).
  let t = tracks.get(symbol);
  if (!t || t.strike !== wall || t.type !== type) {
    t = { type, strike: wall, peakOI: wallOI, lastOI: wallOI, premiumStart: premium, peakPremium: premium, lastPremium: premium, volBaseline: vol || 1, volSamples: 1, status: 'NONE', detectedAt: 0, triggeredAt: 0, statusAt: now, stableScans: 0, pressScans: 0 };
    tracks.set(symbol, t);
  }
  t.peakOI = Math.max(t.peakOI, wallOI);
  t.peakPremium = Math.max(t.peakPremium, premium);
  // Baseline volume is learned ONLY before the squeeze fires (NONE/FORMING).
  // Averaging the surge into its own baseline made volumeMult decay and pushed
  // live squeezes into PEAKING prematurely.
  if (t.status === 'NONE' || t.status === 'FORMING') {
    t.volBaseline = (t.volBaseline * t.volSamples + vol) / (t.volSamples + 1);
    t.volSamples = Math.min(t.volSamples + 1, 20);
  }

  const proximityPct = (Math.abs(spot - wall) / spot) * 100;
  const oiUnwindPct = t.peakOI > 0 ? (t.peakOI - wallOI) / t.peakOI : 0;
  const premiumChangePct = t.premiumStart > 0 ? (premium - t.premiumStart) / t.premiumStart * 100 : 0;
  const volumeMult = t.volBaseline > 0 ? vol / t.volBaseline : 1;
  // Break: price through the wall in the squeeze direction.
  const broke = type === 'CALL' ? spot >= wall : spot <= wall;
  const oiRising = wallOI > t.lastOI * 1.003;

  // ── Status machine ──
  let status: SqueezeStatus = t.status;
  const setStatus = (s: SqueezeStatus) => { if (s !== t!.status) { t!.status = s; t!.statusAt = now; } status = s; };

  const stillUnwinding = (t.lastOI - wallOI) > t.peakOI * 0.003;   // OI dropping THIS scan
  const premRising = premium > t.lastPremium;
  const premFading = premium <= t.peakPremium * 0.97;              // off its peak
  // The wall row's OWN quadrant must read SHORT COVERING: OI leaving the strike
  // WHILE its premium rises. OI down + premium DOWN is longs dumping (long
  // unwinding) — the classic false squeeze that volume alone cannot filter.
  const wallCovering = (row.oiChange ?? 0) < 0 && ((row.ltpChange ?? 0) > 0 || premRising);
  // Confirmed short covering: broke the wall + real cumulative unwinding + the
  // premium itself confirming + (volume surge OR deep unwind) + covering quadrant.
  const confirmed = broke && oiUnwindPct >= UNWIND_TRIGGER && wallCovering
    && premiumChangePct >= 6 && (volumeMult >= 1.5 || oiUnwindPct >= 0.06);

  if (t.status === 'DONE') {
    status = 'DONE'; // stays DONE until the wall/price situation resets (track reset above)
  } else if (confirmed && (stillUnwinding || premRising)) {
    t.triggeredAt = t.triggeredAt || now;
    setStatus('LIVE'); t.stableScans = 0;
  } else if (t.status === 'LIVE' || t.status === 'PEAKING' || (confirmed && !stillUnwinding)) {
    // Fading: no fresh unwinding / premium off peak → PEAKING, then DONE.
    if (!t.triggeredAt) t.triggeredAt = now;
    t.stableScans++;
    if (t.stableScans >= 2 && premFading) { setStatus('DONE'); logCompleted(symbol, t, now); }
    else setStatus('PEAKING');
  } else if (proximityPct <= PROX_FORMING * 100 && !oiRising) {
    t.pressScans++;
    if (t.pressScans >= 2) {                    // ~2 chain refreshes of genuine pressing
      if (t.status === 'NONE') t.detectedAt = now;
      setStatus('FORMING');
    }
  } else {
    setStatus('NONE'); t.detectedAt = 0; t.pressScans = 0;
  }
  t.lastOI = wallOI;
  t.lastPremium = premium;

  // ── Confidence (quality) ──
  const confidence = Math.round(clamp(
    clamp(100 - proximityPct / 0.008) * 0.25 +   // closeness to the wall
    clamp(oiUnwindPct * 400) * 0.30 +            // real unwinding
    clamp(premiumChangePct * 1.5) * 0.20 +       // premium explosion
    clamp((volumeMult - 1) * 40) * 0.15 +        // volume surge
    clamp(Math.abs(delta) * 100) * 0.10,         // near explosive delta
  ));

  // Suggested trade: buy the next OTM strike in the squeeze direction.
  const suggestedStrike = type === 'CALL' ? wall + step : wall - step;
  const nextWall = type === 'CALL'
    ? calls.filter(r => r.strike > wall).reduce<OptionRow | null>((a, b) => (!a || b.oi > a.oi ? b : a), null)
    : puts.filter(r => r.strike < wall).reduce<OptionRow | null>((a, b) => (!a || b.oi > a.oi ? b : a), null);
  const target = nextWall?.strike ?? (type === 'CALL' ? wall + 3 * step : wall - 3 * step);
  const stopLoss = wall; // back below/above the broken wall invalidates the squeeze

  const sig: SqueezeSignal = {
    symbol, isIndex, status, direction: type,
    wallStrike: wall, spot,
    proximityPct: +proximityPct.toFixed(2),
    wallOI, peakOI: t.peakOI, oiUnwindPct: +(oiUnwindPct * 100).toFixed(1),
    premiumStart: +t.premiumStart.toFixed(2), premiumNow: +premium.toFixed(2), premiumChangePct: +premiumChangePct.toFixed(0),
    ivNow: +iv.toFixed(1), volumeMult: +volumeMult.toFixed(1), deltaNow: +delta.toFixed(2),
    confidence,
    suggestedStrike, stopLoss, target,
    action: status === 'LIVE' && premiumChangePct > 40
      ? `LATE (+${premiumChangePct.toFixed(0)}% already) — small size only: ${suggestedStrike} ${type === 'CALL' ? 'CE' : 'PE'}`
      : type === 'CALL' ? `BUY ${suggestedStrike} CE` : `BUY ${suggestedStrike} PE`,
    detectedAt: t.detectedAt, triggeredAt: t.triggeredAt, statusAt: t.statusAt,
    note: statusNote(status, type, wall, oiUnwindPct, premiumChangePct),
  };
  latest.set(symbol, sig);
  save(now);
  return sig;
}

function statusNote(s: SqueezeStatus, type: SqueezeDir, wall: number, unwind: number, prem: number): string {
  const w = type === 'CALL' ? 'call' : 'put';
  switch (s) {
    case 'FORMING': return `Price pressing the ${wall} ${w} wall, writers not adding — squeeze may be near`;
    case 'LIVE': return `${type} SQUEEZE LIVE — ${w} writers covering (OI −${(unwind * 100).toFixed(0)}%), premium +${prem.toFixed(0)}%`;
    case 'PEAKING': return `Squeeze fading — unwinding slowing, prepare to exit`;
    case 'DONE': return `Squeeze completed — premiums will now decay`;
    default: return `Max OI wall at ${wall}, no squeeze`;
  }
}

function emptySignal(symbol: string, isIndex: boolean, spot: number): SqueezeSignal {
  return {
    symbol, isIndex, status: 'NONE', direction: 'CALL', wallStrike: 0, spot,
    proximityPct: 0, wallOI: 0, peakOI: 0, oiUnwindPct: 0,
    premiumStart: 0, premiumNow: 0, premiumChangePct: 0, ivNow: 0, volumeMult: 1, deltaNow: 0,
    confidence: 0, suggestedStrike: 0, stopLoss: 0, target: 0, action: '',
    detectedAt: 0, triggeredAt: 0, statusAt: Date.now(), note: 'No squeeze',
  };
}

function logCompleted(symbol: string, t: WallTrack, now: number): void {
  if (!t.triggeredAt) return;
  completed.push({
    symbol, direction: t.type, wallStrike: t.strike,
    peakPremium: +t.peakPremium.toFixed(2), premiumStart: +t.premiumStart.toFixed(2),
    maxGainPct: t.premiumStart > 0 ? +(((t.peakPremium - t.premiumStart) / t.premiumStart) * 100).toFixed(0) : 0,
    triggeredAt: t.triggeredAt, completedAt: now, durationSec: Math.round((now - t.triggeredAt) / 1000),
  });
  if (completed.length > 60) completed = completed.slice(-60);
}

function finalizeIfActive(symbol: string, now: number): void {
  const t = tracks.get(symbol);
  if (t && (t.status === 'LIVE' || t.status === 'PEAKING')) logCompleted(symbol, t, now);
}

export function getActiveSqueezes(): SqueezeSignal[] {
  return Array.from(latest.values())
    .filter(s => s.status !== 'NONE' && s.status !== 'DONE')
    // NIFTY/indices first, then by confidence.
    .sort((a, b) => (b.isIndex ? 1 : 0) - (a.isIndex ? 1 : 0) || b.confidence - a.confidence);
}
export function getSqueezeFor(symbol: string): SqueezeSignal | null {
  const s = latest.get(symbol);
  return s && s.status !== 'NONE' ? s : null;
}
export function getCompletedSqueezes(): SqueezeCompleted[] {
  load();
  return completed.slice().reverse();
}
/** Reset the completed log (call after market close for a fresh day). */
export function resetSqueezeLog(): void { load(); completed = []; try { writeFileSync(LOG_FILE, JSON.stringify({ items: [], updatedAt: Date.now() })); } catch {} }
export function resetSqueezeDetector(): void { tracks.clear(); latest.clear(); }
