/**
 * ODSS — Pick Outcome Tracker (the honesty scoreboard)
 * ====================================================
 *
 * "When the engine displays a pick it must perform" is only enforceable if the
 * engine MEASURES its own displayed signals. Every time a pick first shows
 * BUY NOW or CONSIDER, we freeze a record: entry price, the pick's own stop,
 * and a 1R target (same distance as the stop, mirrored). Live quotes then
 * resolve each record:
 *
 *   TARGET_HIT — price reached +1R before the stop  → the signal worked
 *   STOPPED    — price hit the stop first           → the signal failed
 *   EOD_FLAT   — neither by the close               → scored by final move
 *
 * The daily scoreboard (signals / hit / stopped / hit-rate) is attached to
 * engine state so tuning is evidence-based, not vibes. Records reset each
 * session; a short rolling history of past days is kept for trend.
 *
 * DATA HONESTY: entries are recorded off displayed picks only, resolved off
 * real quotes only. No quote → the record simply stays OPEN.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';

export interface PickOutcome {
  symbol: string; direction: 'CE' | 'PE';
  signal: 'BUY NOW' | 'CONSIDER';
  grade?: string;
  at: number;                 // when the signal was first displayed (epoch ms)
  entryPrice: number; stopLoss: number; target: number;   // 1R
  status: 'OPEN' | 'TARGET_HIT' | 'STOPPED' | 'EOD_FLAT';
  resolvedAt?: number;
  movePct: number;            // current/final % move in the pick's favour
  maxFavorablePct: number;    // best it got (favour-signed)
  maxAdversePct: number;      // worst it got (favour-signed, ≤0)
}

export interface DayStats {
  date: string;               // IST YYYY-MM-DD
  signals: number; targetHit: number; stopped: number; open: number; flat: number;
  hitRatePct: number | null;  // hit / (hit + stopped); null until something resolves
}

interface State { date: string; items: PickOutcome[]; pastDays: DayStats[]; }

const STATE_FILE = dataPath('pick-outcomes.json');
let state: State = { date: '', items: [], pastDays: [] };
let loaded = false, lastSave = 0;

function istDate(now = Date.now()): string {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function load(): void {
  if (loaded) return; loaded = true;
  try {
    const d = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    if (d && Array.isArray(d.items)) state = { date: d.date ?? '', items: d.items, pastDays: d.pastDays ?? [] };
  } catch { /* fresh */ }
}

function save(now: number): void {
  if (now - lastSave < 15_000) return; lastSave = now;
  try { ensureDataDir(); writeFileSync(STATE_FILE, JSON.stringify(state)); } catch { /* best effort */ }
}

/** Roll to a new IST day: archive yesterday's stats, clear the board. */
function rollover(now: number): void {
  const today = istDate(now);
  if (state.date === today) return;
  if (state.date && state.items.length) {
    state.pastDays.push(computeStats());
    state.pastDays = state.pastDays.slice(-10);
  }
  state.date = today;
  state.items = [];
}

/**
 * Record every displayed actionable signal exactly once per symbol+direction
 * per day (the FIRST display is the honest test — that's when the user acts).
 */
export function recordDisplayedPicks(picks: Array<{
  symbol: string; direction: 'CE' | 'PE'; plainAction?: string; grade?: string;
  currentPrice: number; stopLoss: number;
}>): void {
  load();
  const now = Date.now();
  rollover(now);
  for (const p of picks) {
    if (p.plainAction !== 'BUY NOW' && p.plainAction !== 'CONSIDER') continue;
    if (!(p.currentPrice > 0) || !(p.stopLoss > 0)) continue;
    if (state.items.some(o => o.symbol === p.symbol && o.direction === p.direction)) continue;
    const risk = Math.abs(p.currentPrice - p.stopLoss);
    if (risk <= 0 || risk > p.currentPrice * 0.1) continue; // degenerate stop → not measurable
    const target = p.direction === 'CE' ? p.currentPrice + risk : p.currentPrice - risk;
    state.items.push({
      symbol: p.symbol, direction: p.direction,
      signal: p.plainAction, grade: p.grade,
      at: now, entryPrice: p.currentPrice, stopLoss: p.stopLoss, target,
      status: 'OPEN', movePct: 0, maxFavorablePct: 0, maxAdversePct: 0,
    });
  }
  save(now);
}

/** Resolve OPEN records against live quotes (symbol → last traded price). */
export function updateOutcomes(quotes: Record<string, number>): void {
  load();
  const now = Date.now();
  rollover(now);
  for (const o of state.items) {
    if (o.status !== 'OPEN') continue;
    const ltp = quotes[o.symbol];
    if (!(ltp > 0)) continue;
    const favour = o.direction === 'CE' ? 1 : -1;
    o.movePct = +(((ltp - o.entryPrice) / o.entryPrice) * 100 * favour).toFixed(2);
    o.maxFavorablePct = Math.max(o.maxFavorablePct, o.movePct);
    o.maxAdversePct = Math.min(o.maxAdversePct, o.movePct);
    const hitTarget = o.direction === 'CE' ? ltp >= o.target : ltp <= o.target;
    const hitStop = o.direction === 'CE' ? ltp <= o.stopLoss : ltp >= o.stopLoss;
    if (hitStop) { o.status = 'STOPPED'; o.resolvedAt = now; }        // stop first: conservative
    else if (hitTarget) { o.status = 'TARGET_HIT'; o.resolvedAt = now; }
  }
  save(now);
}

/** Mark everything unresolved as EOD_FLAT (call once after the close). */
export function closeOutcomesForDay(): void {
  load();
  const now = Date.now();
  for (const o of state.items) {
    if (o.status === 'OPEN') { o.status = 'EOD_FLAT'; o.resolvedAt = now; }
  }
  lastSave = 0; save(now);
}

function computeStats(): DayStats {
  const hit = state.items.filter(o => o.status === 'TARGET_HIT').length;
  const stop = state.items.filter(o => o.status === 'STOPPED').length;
  return {
    date: state.date,
    signals: state.items.length,
    targetHit: hit, stopped: stop,
    open: state.items.filter(o => o.status === 'OPEN').length,
    flat: state.items.filter(o => o.status === 'EOD_FLAT').length,
    hitRatePct: hit + stop > 0 ? Math.round((hit / (hit + stop)) * 100) : null,
  };
}

export function getPickStats(): { today: DayStats; items: PickOutcome[]; pastDays: DayStats[] } {
  load();
  rollover(Date.now());
  return {
    today: computeStats(),
    items: state.items.slice().sort((a, b) => b.at - a.at).slice(0, 20),
    pastDays: state.pastDays.slice().reverse(),
  };
}
