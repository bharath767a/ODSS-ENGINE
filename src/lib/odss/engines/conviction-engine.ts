/**
 * ODSS - Conviction Engine (v3 — Stable Dual-Book + Room-to-Run + Prime Picks)
 * ============================================================================
 *
 * WHAT CHANGED vs v2 (and WHY the picks stop reshuffling)
 * ------------------------------------------------------
 * v2 kept a single mixed set of ≤5 picks and the dashboard re-derived CE/PE
 * lists from `topRecommendations`, which re-sorted every 5s scan → visible
 * shuffling. v3 fixes this at the source:
 *
 *   1. TWO independent stable books: up to 5 CE and up to 5 PE, each with its
 *      own hysteresis + dwell-time so membership changes slowly and only for a
 *      good reason. Display order is EVENT-DRIVEN (frozen between promote/demote
 *      events), so a pick never jumps rows on score jitter.
 *
 *   2. Every candidate is scored on an EMA-smoothed composite so single-scan
 *      score spikes cannot promote/demote anything.
 *
 *   3. A real "MOVE-STILL-LEFT" (room) score — the thing the trader actually
 *      cares about: is there room to the target, or is the move exhausted?
 *      Built from RSI zone, extension from VWAP, distance to the nearest
 *      technical level + option-chain OI wall, how much the stock has already
 *      moved today, and whether we're at a fresh breakout / clean pullback.
 *
 *   4. FUNDAMENTAL fit (cached once per trading day) so a pick is "sound" not
 *      just fast — used mainly to break ties and to qualify PRIME picks.
 *
 *   5. PRIME PICKS: the best 1–2 to actually take right now. A pick only earns
 *      PRIME if it is technically sound AND fundamentally acceptable AND still
 *      has room. If nothing qualifies, we return none (better than forcing a
 *      mediocre "best").
 *
 * Backward compatibility: the ConvictionOutput still exposes convictionPicks,
 * watchlist, lockedPick, newsShockPicks, updatedAt. New fields (cePicks,
 * pePicks, primePicks, and the extra per-pick scores) are additive.
 */
import { getRecentArchived } from '../news/archive';
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';
import type {
  OpportunityRow,
  Recommendation,
  Direction,
  TechnicalEngineOutput,
  OptionChainEngineOutput,
} from '../types';
import { getFundamentalProvider } from '../fundamentals/provider';
import { analyzeFundamentals } from '../fundamentals/analyzer';
import { OI_PACK } from '../oi-knowledge-pack';

export type EntrySignal = 'ENTER_NOW' | 'WAIT' | 'AVOID';
export type StabilityClass = 'STABLE' | 'MODERATE' | 'VOLATILE';

export interface ConvictionPick {
  symbol: string; sector: string; direction: Direction; rank: number;
  technicalScore: number; optionChainScore: number; convictionScore: number;
  originalScore: number; confidence: number;
  // ── v3 additive score breakdown ──
  technicalHealth: number;     // 0-100 direction-aware technical soundness
  roomScore: number;           // 0-100 "move still left"
  roomNotes: string[];         // human-readable room rationale
  fundamentalScore: number;    // 0-100 (daily cached)
  fundamentalRating: string;   // EXCELLENT..POOR or N/A
  // ── who's in control (real order flow) ──
  controller?: string;         // BUYERS / SELLERS / BALANCED
  controlScore?: number;       // -100 (sellers) .. +100 (buyers)
  controlStrength?: number;    // 0-100
  controlEvidence?: string[];  // top order-flow reasons
  trap?: boolean;              // chain contradicts this side (trap risk)
  trapNote?: string;
  grade?: string;              // A+ / A / B / C — how many signals align
  gradeScore?: number;         // 0-6 aligned confirmations
  gradeReasons?: string[];     // which signals confirmed
  earlyFlow?: boolean;         // fresh order-flow ignition — early mover
  primeScore: number;          // 0-100 actionability (best-to-take-now)
  isPrime: boolean;            // one of the top-2 to take now
  whyBest: string;             // one-line rationale when isPrime
  // ── stability / news ──
  stability: StabilityClass; stabilityScore: number; trendScore: number; consecutiveTop10: number;
  newsMomentum: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'; newsBoost: number; newsHeadlines: string[]; hasEarningsNews: boolean;
  entrySignal: EntrySignal; entrySignalReason?: string; entryZoneLow: number; entryZoneHigh: number; currentPrice: number; stopLoss: number; riskRewardRatio: number;
  locked: boolean; lockExpiresAt: number | null; lockMinutesLeft: number;
  isNewsShock: boolean; shockTrigger?: string; shockAgeMinutes?: number; shockSector?: string;
  ivCaution?: boolean; ivCautionReason?: string; shockTargetPrice?: number;
}

export interface ConvictionOutput {
  convictionPicks: ConvictionPick[];   // legacy: prime + remaining (top, mixed)
  cePicks: ConvictionPick[];           // v3: stable bullish book (≤5)
  pePicks: ConvictionPick[];           // v3: stable bearish book (≤5)
  primePicks: ConvictionPick[];        // v3: best 1-2 to take right now
  watchlist: ConvictionPick[];
  lockedPick: ConvictionPick | null;
  newsShockPicks: ConvictionPick[];
  updatedAt: number;
}

// ============================================================
// TUNABLES  (5s scan cadence → thresholds are in "scans")
// ============================================================
const STATE_FILE = dataPath('conviction-state.json');
const HISTORY_SIZE = 20;
const EMA_ALPHA = 0.25;            // smoothing for composite score (~4-8 scans)
const CANDIDATE_TOP_K = 8;         // per side, how deep in the book we consider
const PROMO_SCANS = 4;             // consecutive candidacy required to promote (~20s)
const PROMO_SCORE = 55;            // EMA composite needed to promote
const DEMOTE_SCORE = 42;           // below this (EMA) for DWELL_MIN scans → demote
const DWELL_MIN = 10;              // min scans in book before demotion eligible (~50s)
const ABSENCE_LIMIT = 10;          // scans absent from candidate pool → drop
const SWAP_MARGIN = 7;             // challenger must beat weakest incumbent by this…
const SWAP_SCANS = 6;              // …for this many consecutive scans to force a swap
                                   // (7-pt EMA gap held 6 scans ≈ a real regime shift,
                                   //  not jitter — EMA smoothing filters noise)
const MAX_PER_SIDE = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;
const WATCHLIST_MIN_SCORE = 45;
const WATCHLIST_MAX = 6;
const WATCHLIST_ABSENCE_LIMIT = 8;
// Prime qualification gates
const PRIME_MIN_TECH = 55;
const PRIME_MIN_ROOM = 48;
const PRIME_MIN_CONVICTION = 58;

// ============================================================
// PERSISTED STATE
// ============================================================
interface ScoreRecord { symbol: string; score: number; timestamp: number; inTop: boolean; }
interface SideState {
  set: string[];                       // authoritative display order (stable)
  dwell: Record<string, number>;       // scans since promoted
  candidacy: Record<string, number>;   // consecutive scans as candidate (pre-promo)
  absence: Record<string, number>;     // scans absent from candidate pool
  challenge: Record<string, number>;   // consecutive scans a challenger beats weakest incumbent
}
interface PersistedState {
  scoreHistory: Record<string, ScoreRecord[]>;
  ema: Record<string, number>;
  ce: SideState;
  pe: SideState;
  fundamentals: { day: string; scores: Record<string, { total: number; rating: string }> };
  lockedSymbol: string | null;
  lockExpiresAt: number;
  watchlistOrder: string[];
  watchlistAbsence: Record<string, number>;
}

function emptySide(): SideState { return { set: [], dwell: {}, candidacy: {}, absence: {}, challenge: {} }; }

let scoreHistory = new Map<string, ScoreRecord[]>();
let ema = new Map<string, number>();
let ce = emptySide();
let pe = emptySide();
let fundamentals: PersistedState['fundamentals'] = { day: '', scores: {} };
let lockedSymbol: string | null = null;
let lockExpiresAt = 0;
let watchlistOrder: string[] = [];
let watchlistAbsence = new Map<string, number>();
let stateLoaded = false;

// In-memory snapshot of the last fully-scored pick per symbol (so a symbol that
// temporarily drops out of the recommendation set keeps rendering its last data).
const lastPick = new Map<string, ConvictionPick>();

function loadState(): void {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const data: PersistedState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    scoreHistory = new Map(Object.entries(data.scoreHistory || {}));
    ema = new Map(Object.entries(data.ema || {}));
    ce = { ...emptySide(), ...(data.ce || {}) };
    pe = { ...emptySide(), ...(data.pe || {}) };
    fundamentals = data.fundamentals || { day: '', scores: {} };
    lockedSymbol = data.lockedSymbol ?? null;
    lockExpiresAt = data.lockExpiresAt ?? 0;
    watchlistOrder = data.watchlistOrder || [];
    watchlistAbsence = new Map(Object.entries(data.watchlistAbsence || {}));
  } catch { /* fresh start */ }
}

function saveState(): void {
  try {
    ensureDataDir();
    const data: PersistedState = {
      scoreHistory: Object.fromEntries(scoreHistory),
      ema: Object.fromEntries(ema),
      ce, pe, fundamentals,
      lockedSymbol, lockExpiresAt,
      watchlistOrder,
      watchlistAbsence: Object.fromEntries(watchlistAbsence),
    };
    writeFileSync(STATE_FILE, JSON.stringify(data));
  } catch { /* best effort */ }
}

// ============================================================
// SMALL HELPERS
// ============================================================
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
/** Triangular preference: 100 at `ideal`, linearly down to 0 at ±`half`. */
function bell(x: number, ideal: number, half: number): number {
  return clamp(100 - (Math.abs(x - ideal) / half) * 100);
}

function istDayKey(now: number): string {
  // IST = UTC+5:30. Trading day rolls at midnight IST.
  const ist = new Date(now + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${ist.getUTCMonth() + 1}-${ist.getUTCDate()}`;
}

function recordScore(symbol: string, score: number, inTop: boolean): void {
  let h = scoreHistory.get(symbol);
  if (!h) { h = []; scoreHistory.set(symbol, h); }
  h.push({ symbol, score, timestamp: Date.now(), inTop });
  if (h.length > HISTORY_SIZE) h.shift();
  const prev = ema.get(symbol);
  ema.set(symbol, prev === undefined ? score : prev + EMA_ALPHA * (score - prev));
}
const emaOf = (symbol: string) => ema.get(symbol) ?? 0;

function calculateStability(symbol: string) {
  const h = scoreHistory.get(symbol) ?? [];
  if (h.length < 3) return { score: 35, class: 'VOLATILE' as StabilityClass, consecutiveTop: 0, trend: 0 };
  let consecutiveTop = 0;
  for (let i = h.length - 1; i >= 0; i--) { if (h[i].inTop) consecutiveTop++; else break; }
  const scores = h.map(x => x.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const stabilityScore = clamp(100 - Math.sqrt(variance) * 4);
  let trend = 0;
  if (h.length >= 6) { const r = h.slice(-3).map(x => x.score); const o = h.slice(-6, -3).map(x => x.score); trend = (r.reduce((a, b) => a + b, 0) / r.length) - (o.reduce((a, b) => a + b, 0) / o.length); }
  else if (h.length >= 2) trend = h[h.length - 1].score - h[0].score;
  return { score: stabilityScore, class: (stabilityScore >= 75 ? 'STABLE' : stabilityScore >= 50 ? 'MODERATE' : 'VOLATILE') as StabilityClass, consecutiveTop, trend };
}

// ─── Fundamentals: computed once per trading day, cached in state ───
function getFundamentalScore(symbol: string, now: number): { total: number; rating: string } {
  const day = istDayKey(now);
  if (fundamentals.day !== day) fundamentals = { day, scores: {} };
  const cached = fundamentals.scores[symbol];
  if (cached) return cached;
  let out = { total: 50, rating: 'N/A' };
  try {
    const data = getFundamentalProvider().getFundamentalData(symbol);
    if (data) { const s = analyzeFundamentals(data); out = { total: Math.round(s.total), rating: s.rating }; }
  } catch { /* keep neutral default */ }
  fundamentals.scores[symbol] = out;
  return out;
}

// ============================================================
// DIRECTION-AWARE SUB-SCORES
// ============================================================

/** Technical soundness in the trade's direction (0-100). */
function technicalHealth(dir: Direction, t: TechnicalEngineOutput): number {
  if (!t) return 50;
  const bull = dir === 'CE';
  let s = 0, w = 0;
  const add = (val: number, weight: number) => { s += val * weight; w += weight; };
  // Trend / EMA alignment
  add(t.trend === (bull ? 'BULLISH' : 'BEARISH') ? 100 : t.trend === 'NEUTRAL' ? 50 : 10, 1.2);
  add(t.emaAlignment === (bull ? 'BULLISH' : 'BEARISH') ? 100 : t.emaAlignment === 'MIXED' ? 50 : 15, 1.0);
  // ADX = trend strength (direction-agnostic, but strong trend helps a directional trade)
  add(clamp((t.adx ?? 15) * 2.5), 0.8);
  // VWAP position confirms side
  add(t.vwapPosition === (bull ? 'ABOVE' : 'BELOW') ? 100 : t.vwapPosition === 'AT' ? 55 : 20, 0.9);
  // Momentum sign
  add(clamp(50 + (bull ? 1 : -1) * (t.momentum ?? 0) * 5), 0.8);
  // Volume backing the move
  add(t.volumeStructure === 'RISING' ? 85 : t.volumeStructure === 'FLAT' ? 50 : 30, 0.5);
  // Base engine score as a prior
  add(clamp(t.score ?? 50), 0.8);
  return clamp(w > 0 ? s / w : 50);
}

/** Option-chain confluence in the trade's direction (0-100). */
function optionChainHealth(dir: Direction, oc: OptionChainEngineOutput): number {
  if (!oc) return 50;
  const bull = dir === 'CE';
  let s = 0, w = 0;
  const add = (val: number, weight: number) => { s += val * weight; w += weight; };
  // Engine's own OC score
  add(clamp(oc.score ?? 50), 1.0);
  // Bias / PCR agreement (bull wants LONG bias / higher PCR)
  add(oc.bias === (bull ? 'LONG' : 'SHORT') ? 100 : oc.bias === 'NEUTRAL' ? 50 : 20, 1.0);
  add(oc.pcrSignal === (bull ? 'LONG' : 'SHORT') ? 90 : oc.pcrSignal === 'NEUTRAL' ? 50 : 25, 0.7);
  // Writing trends: bull → put writing increasing (support) / call writing decreasing
  if (bull) {
    add(oc.putWritingTrend === 'INCREASING' ? 90 : oc.putWritingTrend === 'FLAT' ? 55 : 30, 0.6);
    add(oc.callWritingTrend === 'DECREASING' ? 85 : oc.callWritingTrend === 'FLAT' ? 55 : 35, 0.5);
  } else {
    add(oc.callWritingTrend === 'INCREASING' ? 90 : oc.callWritingTrend === 'FLAT' ? 55 : 30, 0.6);
    add(oc.putWritingTrend === 'DECREASING' ? 85 : oc.putWritingTrend === 'FLAT' ? 55 : 35, 0.5);
  }
  // Unwinding that supports the side
  add(oc.unwinding === (bull ? 'CALL_UNWINDING' : 'PUT_UNWINDING') ? 80 : 50, 0.4);
  return clamp(w > 0 ? s / w : 50);
}

/**
 * "MOVE STILL LEFT" (room) score, 0-100, with human-readable notes.
 * High = fresh move with room to target. Low = exhausted / at a wall / already run.
 */
function roomToRun(
  dir: Direction, ltp: number, changePct: number,
  t: TechnicalEngineOutput, oc: OptionChainEngineOutput,
): { score: number; notes: string[] } {
  const notes: string[] = [];
  if (!t || ltp <= 0) return { score: 50, notes: ['Insufficient data for room estimate'] };
  const bull = dir === 'CE';
  const atr = (t.atr && t.atr > 0) ? t.atr : Math.max(ltp * 0.008, 0.01);
  let s = 0, w = 0;
  const add = (val: number, weight: number) => { s += clamp(val) * weight; w += weight; };

  // 1) RSI zone — trending with room, not exhausted
  const rsi = t.rsi ?? 50;
  if (bull) {
    // ideal ~60, still-has-room band 50-70; >78 exhausted; <45 no thrust
    let r = bell(rsi, 60, 22);
    if (rsi > 78) { r = Math.min(r, 15); notes.push(`RSI ${rsi.toFixed(0)} overbought — move likely exhausted`); }
    else if (rsi >= 52 && rsi <= 68) notes.push(`RSI ${rsi.toFixed(0)} — trending with room`);
    add(r, 1.2);
  } else {
    let r = bell(rsi, 40, 22);
    if (rsi < 22) { r = Math.min(r, 15); notes.push(`RSI ${rsi.toFixed(0)} oversold — bounce risk`); }
    else if (rsi >= 32 && rsi <= 48) notes.push(`RSI ${rsi.toFixed(0)} — falling with room`);
    add(r, 1.2);
  }

  // 2) Extension from VWAP (in ATRs). Close to VWAP = room; far = stretched.
  if (t.vwap && t.vwap > 0) {
    const extAtr = (ltp - t.vwap) / atr * (bull ? 1 : -1); // + = in-favor extension
    // 0-1 ATR beyond vwap = healthy(100→70); >2.5 ATR = stretched(→10); below vwap in-favor side handled as room
    let r: number;
    if (extAtr <= 0) r = 85;                       // pulled back to/through vwap: lots of room
    else if (extAtr <= 1) r = 100 - extAtr * 20;   // 100→80
    else if (extAtr <= 2.5) r = 80 - (extAtr - 1) * 40; // 80→20
    else { r = 12; notes.push(`Stretched ${extAtr.toFixed(1)} ATR from VWAP — extended`); }
    add(r, 1.0);
  }

  // 3) Distance to the nearest blocking level (technical + OI wall), in ATRs
  const levels: number[] = [];
  if (bull) {
    for (const r of (t.resistance ?? [])) if (r > ltp) levels.push(r);
    if (oc?.resistanceStrike && oc.resistanceStrike > ltp) levels.push(oc.resistanceStrike);
  } else {
    for (const sup of (t.support ?? [])) if (sup < ltp) levels.push(sup);
    if (oc?.supportStrike && oc.supportStrike < ltp && oc.supportStrike > 0) levels.push(oc.supportStrike);
  }
  if (levels.length) {
    const nearest = bull ? Math.min(...levels) : Math.max(...levels);
    const distAtr = Math.abs(nearest - ltp) / atr;
    // <0.5 ATR to wall = capped(15); >3 ATR = wide open(100)
    const r = clamp((distAtr / 3) * 100);
    if (distAtr < 0.6) notes.push(`Only ${distAtr.toFixed(1)} ATR to ${bull ? 'resistance' : 'support'} ${nearest.toFixed(0)} — capped`);
    else if (distAtr > 2) notes.push(`~${distAtr.toFixed(1)} ATR of clear room to ${nearest.toFixed(0)}`);
    add(r, 1.1);
  } else {
    add(75, 0.6); // no visible wall in-path → assume room
  }

  // 4) How much has it already moved today? Big move already = less left + IV rich.
  const absMove = Math.abs(changePct);
  const inFavor = bull ? changePct > 0 : changePct < 0;
  if (inFavor) {
    const r = absMove <= 1 ? 95 : absMove <= 2 ? 80 : absMove <= 3 ? 60 : absMove <= 4 ? 40 : 20;
    if (absMove > 3.5) notes.push(`Already ${changePct.toFixed(1)}% today — much of the move may be done`);
    add(r, 0.9);
  } else {
    add(70, 0.5); // moving against/flat → fresh entry potential if setup valid
  }

  // 5) Fresh-move bonuses: breakout in-favor / clean pullback entry
  const bo = t.breakout?.status;
  if (bo === (bull ? 'BREAKING_OUT' : 'BREAKING_DOWN')) { add(95, 0.7); notes.push('Fresh breakout — early in the move'); }
  const pb = t.pullback?.status;
  if (pb === 'AT_VWAP' || pb === 'AT_SUPPORT') { add(88, 0.6); notes.push(`Clean ${pb === 'AT_VWAP' ? 'VWAP' : 'support'} pullback entry`); }

  const score = clamp(w > 0 ? s / w : 50);
  if (!notes.length) notes.push(score >= 60 ? 'Room to target intact' : 'Limited room remaining');
  return { score: Math.round(score), notes };
}

/** Fundamental fit for the direction (bull rewards strong; bear rewards weak, but mildly). */
function fundamentalFit(dir: Direction, total: number): number {
  return dir === 'CE' ? total : clamp(40 + (100 - total) * 0.5);
}

// ============================================================
// NEWS + ENTRY + SHOCKS  (reused from v2)
// ============================================================
function calculateNewsMomentum(symbol: string, sector: string) {
  try {
    const recent = getRecentArchived(12);
    if (!recent || recent.length === 0) return { direction: 'NEUTRAL' as const, boost: 0, headlines: [] as string[], hasEarnings: false };
    // STOCK-SPECIFIC news only drives sentiment AND is the only thing we display
    // as the pick's headline. Sector news is far too noisy to pin on one stock
    // (it caused unrelated headlines to show on the wrong ticker).
    const stockNews = recent.filter((item: any) => item.entities?.stocks?.includes(symbol));
    const relevant = stockNews;
    if (relevant.length === 0) return { direction: 'NEUTRAL' as const, boost: 0, headlines: [] as string[], hasEarnings: false };
    const positive = relevant.filter((r: any) => r.sentiment === 'POSITIVE').length;
    const negative = relevant.filter((r: any) => r.sentiment === 'NEGATIVE').length;
    const hasEarnings = relevant.some((r: any) => r.entities?.eventTypes?.includes('EARNINGS') || r.entities?.eventTypes?.includes('GUIDANCE'));
    let boost = 0; let direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' = 'NEUTRAL';
    if (hasEarnings && positive > negative) boost += 8;
    if (positive >= 3 && positive > negative * 2) { boost += 5; direction = 'POSITIVE'; }
    else if (negative >= 2 && negative > positive * 2) { boost -= 10; direction = 'NEGATIVE'; }
    else if (positive > negative) { boost += 3; direction = 'POSITIVE'; }
    else if (negative > positive) { boost -= 5; direction = 'NEGATIVE'; }
    if (relevant.some((r: any) => r.entities?.impactMagnitude === 'HIGH')) boost = direction === 'NEGATIVE' ? Math.min(boost - 5, -10) : boost + 3;
    boost = Math.max(-20, Math.min(20, boost));
    return { direction, boost, headlines: relevant.slice(0, 3).map((r: any) => r.title), hasEarnings };
  } catch { return { direction: 'NEUTRAL' as const, boost: 0, headlines: [] as string[], hasEarnings: false }; }
}

function calculateEntryZone(price: number, direction: Direction) {
  if (price <= 0) return { low: 0, high: 0, stopLoss: 0, riskReward: 0 };
  return { low: price * 0.997, high: price * 1.003, stopLoss: direction === 'CE' ? price * 0.985 : price * 1.015, riskReward: 2 };
}

function detectNewsShocks(
  liveQuotes: Record<string, { ltp: number; changePct: number }>,
  recommendations: Map<string, Recommendation>,
): any[] {
  try {
    const recent = getRecentArchived(1);
    if (!recent || recent.length === 0) return [];
    const now = Date.now();
    const freshNegative = recent.filter((item: any) => (now - item.timestamp) < 30 * 60 * 1000 && item.sentiment === 'NEGATIVE' && item.entities?.impactMagnitude === 'HIGH');
    if (freshNegative.length === 0) return [];
    const shocks: any[] = [];
    for (const news of freshNegative) {
      const age = Math.round((now - news.timestamp) / 60000);
      const sector = news.entities?.sectors?.[0];
      for (const symbol of news.entities?.stocks ?? []) {
        const q = liveQuotes[symbol]; if (!q) continue;
        const ivCaution = Math.abs(q.changePct) > 4;
        // CROSS-VERIFY the bad news against real order flow + price. Bad news is a
        // clean PE only if SELLERS control the chain AND the stock is actually
        // falling. If buyers are defending / it's recovering, the news is likely
        // already priced in (e.g. gap-down then bounce) — flag, don't scream PE.
        const control = recommendations.get(symbol)?.control;
        const cs = control?.controlScore ?? 0;
        const buyersDefending = cs > 15 || q.changePct > 0.3;
        let conv = 65; if (age < 10) conv += 10; else if (age < 20) conv += 5; if (!ivCaution) conv += 8;
        let verified = true; let controlNote = '';
        if (buyersDefending) {
          verified = false;
          conv = Math.max(35, conv - 28);
          controlNote = cs > 15
            ? `⚠ Buyers control the chain (${control?.strength ?? 0}%) — news likely PRICED IN, reversal risk`
            : `⚠ Stock ${q.changePct >= 0 ? `up ${q.changePct.toFixed(1)}%` : 'not falling'} despite the news — likely priced in`;
        } else if (cs < -15) {
          conv += 6; controlNote = `Order flow confirms — sellers in control (${control?.strength ?? 0}%)`;
        }
        shocks.push({
          symbol, sector: sector || 'GENERAL', trigger: news.title, age,
          conviction: conv, verified, controlNote,
          ivCaution, ivReason: ivCaution ? `Stock moved ${Math.abs(q.changePct).toFixed(1)}% — IV elevated` : '',
          target: q.ltp * 0.98, price: q.ltp,
        });
      }
    }
    // Verified (flow-confirmed) shocks first.
    return shocks.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || b.conviction - a.conviction).slice(0, 5);
  } catch { return []; }
}

// ============================================================
// PER-SIDE STABLE BOOK MANAGEMENT
// ============================================================
function processSide(
  side: SideState,
  dir: Direction,
  candidatesRanked: string[],           // this side's candidates, best→worst (by EMA)
  scored: Map<string, ConvictionPick>,  // fully-scored picks available this scan
): void {
  const candidateSet = new Set(candidatesRanked);

  // Drop members that flipped side or vanished from the universe for too long.
  for (const sym of [...side.set]) {
    const pick = scored.get(sym) ?? lastPick.get(sym);
    if (pick && pick.direction !== dir) { removeFromSide(side, sym); continue; }
    if (candidateSet.has(sym)) side.absence[sym] = 0;
    else side.absence[sym] = (side.absence[sym] ?? 0) + 1;
    if ((side.absence[sym] ?? 0) >= ABSENCE_LIMIT) removeFromSide(side, sym);
  }

  // Increment dwell for current members.
  for (const sym of side.set) side.dwell[sym] = (side.dwell[sym] ?? 0) + 1;

  // Candidacy counters (for promotion) — only for non-members.
  for (const sym of candidatesRanked) {
    if (side.set.includes(sym)) continue;
    const emaScore = emaOf(sym);
    side.candidacy[sym] = emaScore >= PROMO_SCORE ? (side.candidacy[sym] ?? 0) + 1 : 0;
  }
  // Reset candidacy for anything not currently a candidate.
  for (const sym of Object.keys(side.candidacy)) {
    if (!candidateSet.has(sym)) side.candidacy[sym] = 0;
  }

  // Promote into free slots (best candidates first).
  for (const sym of candidatesRanked) {
    if (side.set.length >= MAX_PER_SIDE) break;
    if (side.set.includes(sym)) continue;
    const cand = side.candidacy[sym] ?? 0;
    const ema = emaOf(sym);
    // Normal promote, OR express-promote a genuinely strong fresh signal (high
    // EMA) after just 2 scans so early movers aren't held back by the 4-scan gate.
    if ((cand >= PROMO_SCANS && ema >= PROMO_SCORE) || (cand >= 2 && ema >= 68)) {
      side.set.push(sym);
      side.dwell[sym] = 1;
      side.candidacy[sym] = 0;
      side.absence[sym] = 0;
    }
  }

  // Demote members that have gone cold (only after minimum dwell).
  for (const sym of [...side.set]) {
    if (emaOf(sym) < DEMOTE_SCORE && (side.dwell[sym] ?? 0) >= DWELL_MIN) removeFromSide(side, sym);
  }

  // Challenge swap: when the book is full, a clearly-better outsider can force in
  // the weakest incumbent — but only after sustained outperformance.
  if (side.set.length >= MAX_PER_SIDE) {
    const weakest = side.set.reduce((a, b) => (emaOf(b) < emaOf(a) ? b : a));
    const weakestEma = emaOf(weakest);
    let swapped = false;
    for (const sym of candidatesRanked) {
      if (side.set.includes(sym)) { side.challenge[sym] = 0; continue; }
      if (emaOf(sym) >= weakestEma + SWAP_MARGIN) {
        side.challenge[sym] = (side.challenge[sym] ?? 0) + 1;
        if (!swapped && (side.dwell[weakest] ?? 0) >= DWELL_MIN && side.challenge[sym] >= SWAP_SCANS) {
          removeFromSide(side, weakest);
          side.set.push(sym);
          side.dwell[sym] = 1; side.absence[sym] = 0; side.challenge[sym] = 0;
          swapped = true;
        }
      } else {
        side.challenge[sym] = 0;
      }
    }
  }

  // Event-driven ordering: keep display order STABLE, but if membership changed
  // we re-sort by EMA once so the book stays roughly quality-ordered. We detect
  // "changed" by comparing to a stored signature.
  const sig = side.set.join(',');
  if ((side as any)._sig !== sig) {
    side.set.sort((a, b) => emaOf(b) - emaOf(a));
    (side as any)._sig = side.set.join(',');
  }
}

function removeFromSide(side: SideState, sym: string): void {
  side.set = side.set.filter(s => s !== sym);
  delete side.dwell[sym]; delete side.absence[sym]; delete side.candidacy[sym]; delete side.challenge[sym];
}

// ============================================================
// MAIN
// ============================================================
export function runConvictionEngine(
  opportunities: OpportunityRow[],
  recommendations: Map<string, Recommendation>,
  liveQuotes: Record<string, { ltp: number; changePct: number }>,
): ConvictionOutput {
  loadState();
  const now = Date.now();

  // ── Step 1: score every opportunity that has a full recommendation ──
  const topSymbols = new Set(opportunities.slice(0, 12).map(o => o.symbol));
  const scored = new Map<string, ConvictionPick>();

  for (const opp of opportunities) {
    const rec = recommendations.get(opp.symbol);
    if (!rec) continue; // need technical + option chain to score properly
    const price = liveQuotes[opp.symbol]?.ltp ?? 0;
    const changePct = liveQuotes[opp.symbol]?.changePct ?? 0;

    // Re-evaluate direction on clear price/news contradiction (kept from v2).
    const news = calculateNewsMomentum(opp.symbol, opp.sector ?? '');
    let direction: Direction = opp.direction;
    if (changePct > 1 && news.direction === 'POSITIVE' && opp.direction === 'PE') direction = 'CE';
    else if (changePct < -1 && news.direction === 'NEGATIVE' && opp.direction === 'CE') direction = 'PE';

    const th = technicalHealth(direction, rec.technical);
    const ocH = optionChainHealth(direction, rec.optionChain);
    const fund = getFundamentalScore(opp.symbol, now);
    const fundFit = fundamentalFit(direction, fund.total);
    const room = roomToRun(direction, price, changePct, rec.technical, rec.optionChain);
    const stability = calculateStability(opp.symbol);

    // ── Who's in control (real order flow) → direction-aligned fit 0-100 ──
    const control = rec.control;
    const controlScore = control?.controlScore ?? 0;             // -100..+100
    const controlFit = control
      ? clamp(direction === 'CE' ? 50 + controlScore / 2 : 50 - controlScore / 2)
      : 50; // no real chain → neutral, don't help or hurt
    // Trap contradicts THIS side (bull trap hurts CE, bear trap hurts PE).
    const controlContradicts = !!control && controlFit < 40;
    const trapAgainst = !!control?.trap && controlContradicts;

    // EARLY MOVER: fresh, aggressive, one-sided order flow on OUR side while the
    // move still has room = smart money igniting before price confirms. Boost it
    // so the engine surfaces the mover near the START, not after it's 60% done.
    const earlyMover = !!control?.earlyFlow && controlFit >= 60 && room.score >= 55;

    // Composite conviction — ROOM-TO-TARGET is now a top driver (22%) so the
    // stocks that surface are the ones with the move still ahead of them, not
    // the ones that already ran. Technical + real order-flow control follow.
    let conviction = Math.round(
      0.24 * th +
      0.14 * ocH +
      0.16 * controlFit +
      0.06 * fundFit +
      0.06 * clamp(50 + news.boost * 2.5) +
      0.22 * room.score +
      0.12 * stability.score,
    );
    if (earlyMover) conviction = Math.min(100, conviction + 9);

    // Record smoothed composite BEFORE building the pick (drives promote/demote).
    recordScore(opp.symbol, conviction, topSymbols.has(opp.symbol));

    const confidence = clamp((rec.decision?.confidence ?? 50) + news.boost);
    const zone = calculateEntryZone(price, direction);
    // Direction (who's in control) and TIMING (is there room now) are different
    // questions. AVOID means the flow is on the WRONG side / setup is broken.
    // A strong pick that has simply run too far is WAIT (buy the pullback), not
    // AVOID — otherwise "BUYERS 84%" next to "AVOID" reads as a contradiction.
    let entrySignal: EntrySignal = 'WAIT';
    let entrySignalReason = '';
    const flowAgainst = controlContradicts || (news.direction === 'NEGATIVE' && news.boost <= -10);
    if (flowAgainst) {
      entrySignal = 'AVOID';
      entrySignalReason = trapAgainst ? 'trap — order flow against the price move'
        : control && controlFit < 40 ? `order flow ${direction === 'CE' ? 'bearish (sellers in control)' : 'bullish (buyers in control)'} — wrong side`
        : 'negative news flow';
    } else if (conviction < 45) {
      entrySignal = 'AVOID'; entrySignalReason = 'setup too weak';
    } else if (conviction >= 68 && room.score >= 50 && controlFit >= 50 && stability.class !== 'VOLATILE') {
      entrySignal = 'ENTER_NOW'; entrySignalReason = 'flow + room aligned — move still ahead';
    } else if (room.score < 40) {
      entrySignal = 'WAIT'; entrySignalReason = `extended (room ${room.score}) — wait for a pullback${(rec.technical?.vwap ?? 0) > 0 ? ` toward ${Math.round(rec.technical.vwap)}` : ''}`;
    } else {
      entrySignal = 'WAIT'; entrySignalReason = 'building — wait for confirmation';
    }

    // primeScore — actionability of taking this RIGHT NOW (control-aware).
    const primeScore = Math.round(
      0.24 * th + 0.16 * ocH + 0.18 * controlFit + 0.12 * room.score + 0.10 * fundFit + 0.10 * confidence + 0.10 * stability.score,
    );

    // ── CONFIDENCE GRADE — how many INDEPENDENT signals agree, GATED on order
    // flow (knowledge pack). You cannot be A/A+ if the chain is against you. ──
    const G = OI_PACK.grade;
    const confirmations: Array<[boolean, string]> = [
      [th >= G.tech, 'technical'],
      [controlFit >= G.control, 'order-flow'],
      [room.score >= G.room, 'room-to-target'],
      [ocH >= G.oc, 'option-chain'],
      [fundFit >= G.fund, 'fundamentals'],
      [news.direction !== 'NEGATIVE', 'no news headwind'],
    ];
    const gradeReasons = confirmations.filter(c => c[0]).map(c => c[1]);
    const gradeScore = gradeReasons.length;
    const flowWith = controlFit >= G.control;              // order flow on our side
    const grade = controlContradicts ? 'C'                  // chain against us → never above C
      : (gradeScore >= 5 && controlFit >= G.aPlusControl && room.score >= G.aRoom) ? 'A+'
      : (gradeScore >= 4 && flowWith) ? 'A'
      : gradeScore >= 3 ? 'B'
      : 'C';

    const pick: ConvictionPick = {
      symbol: opp.symbol, sector: opp.sector ?? '', direction, rank: 0,
      technicalScore: Math.round(opp.technicalScore ?? 0),
      optionChainScore: Math.round(ocH),
      convictionScore: conviction,
      originalScore: Math.round(opp.totalScore),
      confidence: Math.round(confidence),
      technicalHealth: Math.round(th),
      roomScore: room.score, roomNotes: room.notes,
      fundamentalScore: fund.total, fundamentalRating: fund.rating,
      controller: control?.controller, controlScore: control?.controlScore,
      controlStrength: control?.strength, controlEvidence: control?.evidence?.slice(0, 3),
      trap: trapAgainst, trapNote: trapAgainst ? control?.trapNote : undefined,
      grade, gradeScore, gradeReasons, earlyFlow: earlyMover,
      primeScore, isPrime: false, whyBest: '',
      stability: stability.class, stabilityScore: Math.round(stability.score), trendScore: Math.round(stability.trend), consecutiveTop10: stability.consecutiveTop,
      newsMomentum: news.direction, newsBoost: news.boost, newsHeadlines: news.headlines, hasEarningsNews: news.hasEarnings,
      entrySignal, entrySignalReason, entryZoneLow: zone.low, entryZoneHigh: zone.high, currentPrice: price, stopLoss: zone.stopLoss, riskRewardRatio: zone.riskReward,
      locked: false, lockExpiresAt: null, lockMinutesLeft: 0, isNewsShock: false,
    };
    scored.set(opp.symbol, pick);
    lastPick.set(opp.symbol, pick);
  }

  // ── Step 2: build per-side candidate pools (best→worst by EMA) ──
  const ceCandidates = [...scored.values()].filter(p => p.direction === 'CE').sort((a, b) => emaOf(b.symbol) - emaOf(a.symbol)).slice(0, CANDIDATE_TOP_K).map(p => p.symbol);
  const peCandidates = [...scored.values()].filter(p => p.direction === 'PE').sort((a, b) => emaOf(b.symbol) - emaOf(a.symbol)).slice(0, CANDIDATE_TOP_K).map(p => p.symbol);

  processSide(ce, 'CE', ceCandidates, scored);
  processSide(pe, 'PE', peCandidates, scored);

  // ── Step 3: materialise the stable books (fall back to last snapshot) ──
  const materialise = (order: string[]): ConvictionPick[] => {
    const out: ConvictionPick[] = [];
    order.forEach((sym, i) => {
      const p = scored.get(sym) ?? lastPick.get(sym);
      if (p) { const c = { ...p, rank: i + 1 }; out.push(c); }
    });
    return out;
  };
  const cePicks = materialise(ce.set);
  const pePicks = materialise(pe.set);

  // ── Step 4: PRIME picks — best 1-2 to take now (gated on soundness + room) ──
  const primeCandidates = [...cePicks, ...pePicks]
    .filter(p => p.technicalHealth >= PRIME_MIN_TECH && p.roomScore >= PRIME_MIN_ROOM && p.convictionScore >= PRIME_MIN_CONVICTION && p.newsMomentum !== 'NEGATIVE'
      // Never crown a PRIME pick that the real order flow is fighting.
      && !p.trap && (p.controlScore === undefined || (p.direction === 'CE' ? p.controlScore >= -10 : p.controlScore <= 10)))
    .sort((a, b) => b.primeScore - a.primeScore);
  const primePicks = primeCandidates.slice(0, 2);
  for (const p of primePicks) {
    p.isPrime = true;
    p.whyBest = buildWhyBest(p);
    // reflect prime flag back onto the book copies
    const book = (p.direction === 'CE' ? cePicks : pePicks).find(x => x.symbol === p.symbol);
    if (book) { book.isPrime = true; book.whyBest = p.whyBest; }
  }

  // ── Step 5: lock the single best prime pick (visual "conviction lock") ──
  if (lockedSymbol && now < lockExpiresAt) {
    const stillTop = primePicks.find(p => p.symbol === lockedSymbol);
    if (stillTop && stillTop.convictionScore >= DEMOTE_SCORE && stillTop.newsMomentum !== 'NEGATIVE') {
      stillTop.locked = true; stillTop.lockExpiresAt = lockExpiresAt; stillTop.lockMinutesLeft = Math.ceil((lockExpiresAt - now) / 60000);
    } else { lockedSymbol = null; lockExpiresAt = 0; }
  }
  if ((!lockedSymbol || now >= lockExpiresAt) && primePicks[0] && primePicks[0].convictionScore >= 60) {
    lockedSymbol = primePicks[0].symbol; lockExpiresAt = now + LOCK_DURATION_MS;
    primePicks[0].locked = true; primePicks[0].lockExpiresAt = lockExpiresAt; primePicks[0].lockMinutesLeft = 5;
    const book = (primePicks[0].direction === 'CE' ? cePicks : pePicks).find(x => x.symbol === lockedSymbol);
    if (book) { book.locked = true; book.lockExpiresAt = lockExpiresAt; book.lockMinutesLeft = 5; }
  }

  // ── Step 6: watchlist — near-miss symbols not yet in either book ──
  const inBook = new Set([...ce.set, ...pe.set]);
  const eligible = new Set<string>();
  for (const [sym, p] of scored) {
    if (!inBook.has(sym) && p.convictionScore >= WATCHLIST_MIN_SCORE) eligible.add(sym);
  }
  for (const sym of watchlistOrder) {
    if (eligible.has(sym) || inBook.has(sym)) watchlistAbsence.set(sym, 0);
    else watchlistAbsence.set(sym, (watchlistAbsence.get(sym) ?? 0) + 1);
  }
  watchlistOrder = watchlistOrder.filter(s => {
    if (inBook.has(s)) return false;
    if ((watchlistAbsence.get(s) ?? 0) >= WATCHLIST_ABSENCE_LIMIT) { watchlistAbsence.delete(s); return false; }
    return true;
  });
  for (const sym of eligible) {
    if (!watchlistOrder.includes(sym)) { watchlistOrder.push(sym); watchlistAbsence.set(sym, 0); }
  }
  const watchlist: ConvictionPick[] = [];
  watchlistOrder.forEach((sym, i) => { const p = scored.get(sym); if (p) watchlist.push({ ...p, rank: i + 1 }); });
  const watchlistDisplayed = watchlist.slice(0, WATCHLIST_MAX);

  // ── Step 7: news shocks (unchanged) ──
  const shocks = detectNewsShocks(liveQuotes, recommendations);
  const newsShockPicks: ConvictionPick[] = shocks.map((sh, idx) => {
    const zone = calculateEntryZone(sh.price, 'PE');
    // Only ENTER when the news is flow-VERIFIED (sellers control + falling) and IV
    // isn't already blown out; otherwise WAIT and show why (priced-in / reversal).
    const entrySignal: EntrySignal = (sh.verified && !sh.ivCaution) ? 'ENTER_NOW' : 'WAIT';
    const headlines = sh.controlNote ? [sh.trigger, sh.controlNote] : [sh.trigger];
    return {
      symbol: sh.symbol, sector: sh.sector, direction: 'PE' as Direction, rank: idx + 1,
      technicalScore: 50, optionChainScore: 50, convictionScore: sh.conviction, originalScore: 50, confidence: sh.conviction,
      technicalHealth: 50, roomScore: 55, roomNotes: ['News-driven move'], fundamentalScore: 50, fundamentalRating: 'N/A',
      controller: sh.verified ? 'SELLERS' : undefined,
      primeScore: sh.conviction, isPrime: false, whyBest: '',
      stability: 'VOLATILE' as StabilityClass, stabilityScore: 30, trendScore: -10, consecutiveTop10: 99,
      newsMomentum: 'NEGATIVE' as const, newsBoost: -10, newsHeadlines: headlines, hasEarningsNews: false,
      entrySignal, entrySignalReason: sh.verified ? 'flow-confirmed news shock' : sh.controlNote, entryZoneLow: zone.low, entryZoneHigh: zone.high,
      currentPrice: sh.price, stopLoss: zone.stopLoss, riskRewardRatio: zone.riskReward,
      locked: false, lockExpiresAt: null, lockMinutesLeft: 0, isNewsShock: true,
      shockTrigger: sh.trigger, shockAgeMinutes: sh.age, shockSector: sh.sector, ivCaution: sh.ivCaution, ivCautionReason: sh.ivReason, shockTargetPrice: sh.target,
    };
  });

  // Legacy convictionPicks = prime first, then the rest of both books (deduped).
  const legacySeen = new Set<string>();
  const convictionPicks: ConvictionPick[] = [];
  for (const p of [...primePicks, ...cePicks, ...pePicks]) {
    if (!legacySeen.has(p.symbol)) { legacySeen.add(p.symbol); convictionPicks.push(p); }
  }

  saveState();

  return {
    convictionPicks: convictionPicks.slice(0, 6),
    cePicks, pePicks, primePicks,
    watchlist: watchlistDisplayed,
    lockedPick: primePicks.find(p => p.locked) ?? null,
    newsShockPicks,
    updatedAt: now,
  };
}

function buildWhyBest(p: ConvictionPick): string {
  const bits: string[] = [];
  bits.push(`${p.direction === 'CE' ? 'Bullish' : 'Bearish'} setup`);
  bits.push(`tech ${p.technicalHealth}`);
  bits.push(`room ${p.roomScore}`);
  if (p.controller && p.controller !== 'BALANCED') bits.push(`${p.controller.toLowerCase()} in control (${p.controlStrength ?? 0}%)`);
  if (p.fundamentalRating && p.fundamentalRating !== 'N/A') bits.push(`fundamentals ${p.fundamentalRating.toLowerCase()}`);
  const lead = p.controlEvidence?.[0] ?? p.roomNotes?.[0];
  return `${bits.join(', ')}${lead ? ` — ${lead}` : ''}`;
}

export function resetConvictionEngine(): void {
  scoreHistory.clear(); ema.clear();
  ce = emptySide(); pe = emptySide();
  fundamentals = { day: '', scores: {} };
  lockedSymbol = null; lockExpiresAt = 0;
  watchlistOrder = []; watchlistAbsence.clear();
  lastPick.clear();
  saveState();
}
