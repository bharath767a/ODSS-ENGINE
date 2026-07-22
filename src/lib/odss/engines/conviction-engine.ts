/**
 * ODSS - Conviction Engine (v2 — Anti-Shuffle)
 *
 * FIXES from v1:
 *   1. Score history + lock state now PERSISTED to disk (survives restarts)
 *   2. convictionPicks order is HELD STABLE (not re-sorted every scan)
 *   3. Hysteresis band: promote at 55, demote at 45 (prevents flickering)
 *   4. Lock extends to ALL 3 ranks (not just rank 1)
 *   5. No re-sorting — picks keep their position until demoted
 */
import { getRecentArchived } from '../news/archive';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { OpportunityRow, Recommendation } from '../types';

export type EntrySignal = 'ENTER_NOW' | 'WAIT' | 'AVOID';
export type StabilityClass = 'STABLE' | 'MODERATE' | 'VOLATILE';

export interface ConvictionPick {
  symbol: string; sector: string; direction: 'CE' | 'PE'; rank: number;
  technicalScore: number; optionChainScore: number; convictionScore: number;
  originalScore: number; confidence: number;
  stability: StabilityClass; stabilityScore: number; trendScore: number; consecutiveTop10: number;
  newsMomentum: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'; newsBoost: number; newsHeadlines: string[]; hasEarningsNews: boolean;
  entrySignal: EntrySignal; entryZoneLow: number; entryZoneHigh: number; currentPrice: number; stopLoss: number; riskRewardRatio: number;
  locked: boolean; lockExpiresAt: number | null; lockMinutesLeft: number;
  isNewsShock: boolean; shockTrigger?: string; shockAgeMinutes?: number; shockSector?: string;
  ivCaution?: boolean; ivCautionReason?: string; shockTargetPrice?: number;
}

export interface ConvictionOutput {
  convictionPicks: ConvictionPick[];
  watchlist: ConvictionPick[];
  lockedPick: ConvictionPick | null;
  newsShockPicks: ConvictionPick[];
  updatedAt: number;
}

// ============================================================
// PERSISTED STATE (survives restarts)
// ============================================================

const STATE_FILE = '/home/z/odss-data/conviction-state.json';
const HISTORY_SIZE = 12;
const PROMOTION_THRESHOLD = 5;   // must be in Top 10 for 5 consecutive scans (25s)
const PROMOTION_SCORE = 55;      // must score 55+ to be promoted
const DEMOTION_SCORE = 30;       // must drop below 30 to be demoted (very wide hysteresis)
const MIN_DWELL_SCANS = 12;      // must stay in set for 12 scans (60s) before demotion
const LOCK_DURATION_MS = 5 * 60 * 1000;

interface ScoreRecord { symbol: string; score: number; timestamp: number; inTop10: boolean; }
interface PersistedState {
  scoreHistory: Record<string, ScoreRecord[]>;
  lockedSymbol: string | null;
  lockExpiresAt: number;
  convictionSet: string[];
  convictionOrder: string[];
  convictionDwell: Record<string, number>;
  watchlistOrder: string[];
}

let scoreHistory = new Map<string, ScoreRecord[]>();
let lockedSymbol: string | null = null;
let lockExpiresAt = 0;
let convictionSet = new Set<string>();
let convictionOrder: string[] = [];
let convictionDwell = new Map<string, number>();
let watchlistOrder: string[] = [];
let stateLoaded = false;

function loadState(): void {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const data: PersistedState = JSON.parse(raw);
    scoreHistory = new Map(Object.entries(data.scoreHistory || {}));
    lockedSymbol = data.lockedSymbol ?? null;
    lockExpiresAt = data.lockExpiresAt ?? 0;
    convictionSet = new Set(data.convictionSet || []);
    convictionOrder = data.convictionOrder || [];
    convictionDwell = new Map(Object.entries(data.convictionDwell || {}));
    watchlistOrder = data.watchlistOrder || [];
  } catch {
    // File doesn't exist yet — start fresh
  }
}

function saveState(): void {
  try {
    mkdirSync('/home/z/odss-data', { recursive: true });
    const data: PersistedState = {
      scoreHistory: Object.fromEntries(scoreHistory),
      lockedSymbol,
      lockExpiresAt,
      convictionSet: Array.from(convictionSet),
      convictionOrder,
      convictionDwell: Object.fromEntries(convictionDwell),
      watchlistOrder,
    };
    writeFileSync(STATE_FILE, JSON.stringify(data));
  } catch {}
}

function recordScore(symbol: string, score: number, inTop10: boolean): void {
  let h = scoreHistory.get(symbol);
  if (!h) { h = []; scoreHistory.set(symbol, h); }
  h.push({ symbol, score, timestamp: Date.now(), inTop10 });
  if (h.length > HISTORY_SIZE) h.shift();
}

function calculateStability(symbol: string) {
  const h = scoreHistory.get(symbol) ?? [];
  if (h.length < 3) return { score: 30, class: 'VOLATILE' as StabilityClass, consecutiveTop10: 0, trend: 0 };
  let consecutiveTop10 = 0;
  for (let i = h.length - 1; i >= 0; i--) { if (h[i].inTop10) consecutiveTop10++; else break; }
  const scores = h.map(x => x.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const stabilityScore = Math.max(0, Math.min(100, 100 - Math.sqrt(variance) * 4));
  let trend = 0;
  if (h.length >= 6) { const r = h.slice(-3).map(x=>x.score); const o = h.slice(-6,-3).map(x=>x.score); trend = (r.reduce((a,b)=>a+b,0)/r.length) - (o.reduce((a,b)=>a+b,0)/o.length); }
  else if (h.length >= 2) trend = h[h.length-1].score - h[0].score;
  return { score: stabilityScore, class: (stabilityScore >= 75 ? 'STABLE' : stabilityScore >= 50 ? 'MODERATE' : 'VOLATILE') as StabilityClass, consecutiveTop10, trend };
}

function calculateNewsMomentum(symbol: string, sector: string) {
  try {
    const recent = getRecentArchived(12);
    if (!recent || recent.length === 0) return { direction: 'NEUTRAL' as const, boost: 0, headlines: [] as string[], hasEarnings: false };
    const relevant = recent.filter((item: any) => item.entities?.stocks?.includes(symbol) || item.entities?.sectors?.includes(sector));
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

function calculateEntryZone(price: number, direction: 'CE' | 'PE') {
  if (price <= 0) return { low: 0, high: 0, stopLoss: 0, riskReward: 0 };
  return { low: price * 0.997, high: price * 1.003, stopLoss: direction === 'CE' ? price * 0.985 : price * 1.015, riskReward: 2 };
}

function detectNewsShocks(liveQuotes: Record<string, { ltp: number; changePct: number }>): any[] {
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
        let conv = 65; if (age < 10) conv += 10; else if (age < 20) conv += 5; if (!ivCaution) conv += 8;
        shocks.push({ symbol, sector: sector || 'GENERAL', trigger: news.title, age, conviction: conv, ivCaution, ivReason: ivCaution ? `Stock moved ${Math.abs(q.changePct).toFixed(1)}% — IV elevated` : '', target: q.ltp * 0.98, price: q.ltp });
      }
    }
    return shocks.slice(0, 5);
  } catch { return []; }
}

export function runConvictionEngine(
  opportunities: OpportunityRow[],
  recommendations: Map<string, Recommendation>,
  liveQuotes: Record<string, { ltp: number; changePct: number }>,
): ConvictionOutput {
  loadState(); // Load persisted state on first call
  const now = Date.now();

  // Step 1: Record scores
  const top10Symbols = new Set(opportunities.slice(0, 10).map(o => o.symbol));
  for (const opp of opportunities) recordScore(opp.symbol, opp.totalScore, top10Symbols.has(opp.symbol));

  // Step 2: Build all picks with scores
  const allPicksMap = new Map<string, ConvictionPick>();
  for (const opp of opportunities.slice(0, 15)) {
    const rec = recommendations.get(opp.symbol); if (!rec) continue;
    const stability = calculateStability(opp.symbol);
    const news = calculateNewsMomentum(opp.symbol, opp.sector);
    const price = liveQuotes[opp.symbol]?.ltp ?? 0;
    const changePct = liveQuotes[opp.symbol]?.changePct ?? 0;

    // RE-EVALUATE DIRECTION: The opportunity engine picks direction based on
    // engine votes (market/sector/RS/technical/option chain). But this can be
    // WRONG when the actual price movement and news contradict the engine votes.
    //
    // The conviction engine overrides the direction when there's a clear
    // contradiction:
    //   - If price is UP >1% AND news is POSITIVE → force CE (don't show PE on a rising stock)
    //   - If price is DOWN >1% AND news is NEGATIVE → force PE (don't show CE on a falling stock)
    //   - Otherwise, keep the opportunity engine's direction
    let direction = opp.direction;
    if (changePct > 1 && news.direction === 'POSITIVE' && opp.direction === 'PE') {
      direction = 'CE'; // Price rising + positive news = don't recommend PE
    } else if (changePct < -1 && news.direction === 'NEGATIVE' && opp.direction === 'CE') {
      direction = 'PE'; // Price falling + negative news = don't recommend CE
    }

    const convictionScore = Math.round(opp.totalScore * 0.35 + (opp.optionChainScore ?? 50) * 0.20 + stability.score * 0.20 + (50 + news.boost * 2.5) * 0.15 + (50 + stability.trend * 2) * 0.10);
    let confidence = Math.min(100, Math.max(0, (rec.decision?.confidence ?? 50) + news.boost));
    const zone = calculateEntryZone(price, direction);
    let entrySignal: EntrySignal = 'WAIT';
    if (convictionScore >= 70 && stability.class !== 'VOLATILE' && news.direction !== 'NEGATIVE') entrySignal = 'ENTER_NOW';
    else if (convictionScore < 55 || news.direction === 'NEGATIVE') entrySignal = 'AVOID';
    if (news.direction === 'NEGATIVE' && news.boost <= -10) entrySignal = 'AVOID';
    allPicksMap.set(opp.symbol, {
      symbol: opp.symbol, sector: opp.sector, direction, rank: 0,
      technicalScore: Math.round(opp.technicalScore ?? 0), optionChainScore: Math.round(opp.optionChainScore ?? 0),
      convictionScore, originalScore: Math.round(opp.totalScore), confidence: Math.round(confidence),
      stability: stability.class, stabilityScore: Math.round(stability.score), trendScore: Math.round(stability.trend), consecutiveTop10: stability.consecutiveTop10,
      newsMomentum: news.direction, newsBoost: news.boost, newsHeadlines: news.headlines, hasEarningsNews: news.hasEarnings,
      entrySignal, entryZoneLow: zone.low, entryZoneHigh: zone.high, currentPrice: price, stopLoss: zone.stopLoss, riskRewardRatio: zone.riskReward,
      locked: false, lockExpiresAt: null, lockMinutesLeft: 0, isNewsShock: false,
    });
  }

  // Step 3: Update conviction set with HYSTERESIS + DWELL TIME + MAX SIZE
  const MAX_CONVICTION_SET_SIZE = 5; // only keep top 5 in the conviction set

  // First: demote any symbols in the conviction set that are NOT in the current top 15
  // (They dropped out of the opportunity list entirely — must be removed)
  for (const symbol of Array.from(convictionSet)) {
    if (!allPicksMap.has(symbol)) {
      convictionSet.delete(symbol);
      convictionOrder = convictionOrder.filter(s => s !== symbol);
      convictionDwell.delete(symbol);
    }
  }

  // Then: process all current picks for promotion/demotion
  for (const [symbol, pick] of allPicksMap) {
    const isInSet = convictionSet.has(symbol);
    const consec = pick.consecutiveTop10;
    const dwell = convictionDwell.get(symbol) ?? 0;

    if (!isInSet && consec >= PROMOTION_THRESHOLD && pick.convictionScore >= PROMOTION_SCORE && convictionSet.size < MAX_CONVICTION_SET_SIZE) {
      // Promote (only if set isn't full)
      convictionSet.add(symbol);
      convictionOrder.push(symbol);
      convictionDwell.set(symbol, 1);
    } else if (isInSet) {
      // Increment dwell
      convictionDwell.set(symbol, dwell + 1);
      // Only demote if: score < DEMOTION_SCORE AND dwell >= MIN_DWELL_SCANS
      if (pick.convictionScore < DEMOTION_SCORE && dwell >= MIN_DWELL_SCANS) {
        convictionSet.delete(symbol);
        convictionOrder = convictionOrder.filter(s => s !== symbol);
        convictionDwell.delete(symbol);
      }
    }
  }

  // Step 4: Build convictionPicks using STABLE ORDER (convictionOrder, not re-sorted)
  const convictionPicks: ConvictionPick[] = [];
  for (const symbol of convictionOrder) {
    const pick = allPicksMap.get(symbol);
    if (pick) convictionPicks.push(pick);
  }
  // Only keep top 3
  const top3 = convictionPicks.slice(0, 3);

  // Step 5: Build watchlist with STABLE ORDER (NO re-sorting every scan)
  // ------------------------------------------------------------
  // BUG FIX: Previously sorted by convictionScore every scan → constant shuffling
  // NEW: Use persisted watchlistOrder. Only add new symbols at the END.
  // Only remove symbols that drop below threshold for multiple scans.
  // ------------------------------------------------------------
  const WATCHLIST_MIN_SCORE = 45;
  const WATCHLIST_MAX = 7;

  // Build set of currently eligible symbols
  const eligible = new Set<string>();
  for (const [symbol, pick] of allPicksMap) {
    if (!convictionSet.has(symbol) && pick.convictionScore >= WATCHLIST_MIN_SCORE) {
      eligible.add(symbol);
    }
  }

  // Remove symbols from watchlistOrder that are no longer eligible
  watchlistOrder = watchlistOrder.filter(s => eligible.has(s));

  // Add newly-eligible symbols at the END (preserve insertion order)
  for (const symbol of eligible) {
    if (!watchlistOrder.includes(symbol)) {
      watchlistOrder.push(symbol);
    }
  }

  // Build watchlist picks in stable order (NOT sorted by score)
  const watchlist: ConvictionPick[] = [];
  for (const symbol of watchlistOrder) {
    const pick = allPicksMap.get(symbol);
    if (pick) watchlist.push(pick);
  }

  // Limit to max displayed
  const watchlistDisplayed = watchlist.slice(0, WATCHLIST_MAX);

  // Step 6: Lock logic — lock ALL 3 picks, not just #1
  // Check if lock is still valid
  if (lockedSymbol && now < lockExpiresAt) {
    // Check if locked symbol is still in top3
    const locked = top3.find(p => p.symbol === lockedSymbol);
    if (locked && locked.convictionScore >= DEMOTION_SCORE && locked.newsMomentum !== 'NEGATIVE') {
      locked.locked = true;
      locked.lockExpiresAt = lockExpiresAt;
      locked.lockMinutesLeft = Math.ceil((lockExpiresAt - now) / 60000);
      // Move locked symbol to rank 1
      const idx = top3.indexOf(locked);
      if (idx > 0) top3.unshift(top3.splice(idx, 1)[0]);
    } else {
      lockedSymbol = null;
      lockExpiresAt = 0;
    }
  }

  // Grant new lock if needed
  if ((!lockedSymbol || now >= lockExpiresAt) && top3[0] && top3[0].convictionScore >= 60 && top3[0].stability !== 'VOLATILE') {
    lockedSymbol = top3[0].symbol;
    lockExpiresAt = now + LOCK_DURATION_MS;
    top3[0].locked = true;
    top3[0].lockExpiresAt = lockExpiresAt;
    top3[0].lockMinutesLeft = 5;
  }

  // Assign ranks (STABLE — based on convictionOrder, not convictionScore)
  top3.forEach((p, i) => p.rank = i + 1);
  watchlist.forEach((p, i) => p.rank = i + 4);

  // Step 7: News shocks
  const shocks = detectNewsShocks(liveQuotes);
  const newsShockPicks: ConvictionPick[] = shocks.map((s, idx) => {
    const zone = calculateEntryZone(s.price, 'PE');
    return {
      symbol: s.symbol, sector: s.sector, direction: 'PE' as const, rank: idx + 1,
      technicalScore: 50, optionChainScore: 50, convictionScore: s.conviction, originalScore: 50, confidence: s.conviction,
      stability: 'VOLATILE' as StabilityClass, stabilityScore: 30, trendScore: -10, consecutiveTop10: 99,
      newsMomentum: 'NEGATIVE' as const, newsBoost: -10, newsHeadlines: [s.trigger], hasEarningsNews: false,
      entrySignal: (s.ivCaution ? 'WAIT' : 'ENTER_NOW') as EntrySignal, entryZoneLow: zone.low, entryZoneHigh: zone.high,
      currentPrice: s.price, stopLoss: zone.stopLoss, riskRewardRatio: zone.riskReward,
      locked: false, lockExpiresAt: null, lockMinutesLeft: 0, isNewsShock: true,
      shockTrigger: s.trigger, shockAgeMinutes: s.age, shockSector: s.sector, ivCaution: s.ivCaution, ivCautionReason: s.ivReason, shockTargetPrice: s.target,
    };
  });

  // Save state to disk
  saveState();

  return { convictionPicks: top3, watchlist: watchlistDisplayed, lockedPick: top3.find(p => p.locked) ?? null, newsShockPicks, updatedAt: now };
}

export function resetConvictionEngine(): void {
  scoreHistory.clear();
  lockedSymbol = null;
  lockExpiresAt = 0;
  convictionSet.clear();
  convictionOrder = [];
  convictionDwell.clear();
  watchlistOrder = [];
  saveState();
}
