/**
 * ODSS - Conviction Engine
 * Stabilizes rankings with score history + hysteresis, adds news momentum,
 * produces entry signals, and locks the top pick for 5 minutes.
 */
import { getRecentArchived } from '../news/archive';
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

const HISTORY_SIZE = 12;
const scoreHistory = new Map<string, { symbol: string; score: number; timestamp: number; inTop10: boolean }[]>();
const PROMOTION_THRESHOLD = 3;
const LOCK_DURATION_MS = 5 * 60 * 1000;
let lockedSymbol: string | null = null;
let lockExpiresAt = 0;

function recordScore(symbol: string, score: number, inTop10: boolean): void {
  let h = scoreHistory.get(symbol); if (!h) { h = []; scoreHistory.set(symbol, h); }
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
  const now = Date.now();
  const top10Symbols = new Set(opportunities.slice(0, 10).map(o => o.symbol));
  for (const opp of opportunities) recordScore(opp.symbol, opp.totalScore, top10Symbols.has(opp.symbol));

  const allPicks: ConvictionPick[] = [];
  for (const opp of opportunities.slice(0, 15)) {
    const rec = recommendations.get(opp.symbol); if (!rec) continue;
    const stability = calculateStability(opp.symbol);
    const news = calculateNewsMomentum(opp.symbol, opp.sector);
    const price = liveQuotes[opp.symbol]?.ltp ?? 0;
    const convictionScore = Math.round(opp.totalScore * 0.35 + (opp.optionChainScore ?? 50) * 0.20 + stability.score * 0.20 + (50 + news.boost * 2.5) * 0.15 + (50 + stability.trend * 2) * 0.10);
    let confidence = Math.min(100, Math.max(0, (rec.decision?.confidence ?? 50) + news.boost));
    const zone = calculateEntryZone(price, opp.direction);
    let entrySignal: EntrySignal = 'WAIT';
    if (convictionScore >= 70 && stability.class !== 'VOLATILE' && news.direction !== 'NEGATIVE') entrySignal = 'ENTER_NOW';
    else if (convictionScore < 55 || news.direction === 'NEGATIVE') entrySignal = 'AVOID';
    if (news.direction === 'NEGATIVE' && news.boost <= -10) entrySignal = 'AVOID';
    allPicks.push({
      symbol: opp.symbol, sector: opp.sector, direction: opp.direction, rank: 0,
      technicalScore: Math.round(opp.technicalScore ?? 0), optionChainScore: Math.round(opp.optionChainScore ?? 0),
      convictionScore, originalScore: Math.round(opp.totalScore), confidence: Math.round(confidence),
      stability: stability.class, stabilityScore: Math.round(stability.score), trendScore: Math.round(stability.trend), consecutiveTop10: stability.consecutiveTop10,
      newsMomentum: news.direction, newsBoost: news.boost, newsHeadlines: news.headlines, hasEarningsNews: news.hasEarnings,
      entrySignal, entryZoneLow: zone.low, entryZoneHigh: zone.high, currentPrice: price, stopLoss: zone.stopLoss, riskRewardRatio: zone.riskReward,
      locked: false, lockExpiresAt: null, lockMinutesLeft: 0, isNewsShock: false,
    });
  }
  allPicks.sort((a, b) => b.convictionScore - a.convictionScore);

  const convictionPicks: ConvictionPick[] = [];
  const watchlist: ConvictionPick[] = [];
  for (let i = 0; i < allPicks.length; i++) {
    allPicks[i].rank = i + 1;
    if (allPicks[i].consecutiveTop10 >= PROMOTION_THRESHOLD && allPicks[i].convictionScore >= 50) convictionPicks.push(allPicks[i]);
    else watchlist.push(allPicks[i]);
  }
  const top3 = convictionPicks.slice(0, 3);

  // Lock logic
  let lockedPick: ConvictionPick | null = null;
  if (lockedSymbol && now < lockExpiresAt) {
    const locked = top3.find(p => p.symbol === lockedSymbol);
    if (locked && locked.convictionScore >= 45 && locked.newsMomentum !== 'NEGATIVE') {
      locked.locked = true; locked.lockExpiresAt = lockExpiresAt; locked.lockMinutesLeft = Math.ceil((lockExpiresAt - now) / 60000);
      lockedPick = locked;
    } else { lockedSymbol = null; lockExpiresAt = 0; }
  }
  if (!lockedPick && (!lockedSymbol || now >= lockExpiresAt)) {
    if (top3[0] && top3[0].convictionScore >= 60 && top3[0].stability !== 'VOLATILE') {
      lockedSymbol = top3[0].symbol; lockExpiresAt = now + LOCK_DURATION_MS;
      top3[0].locked = true; top3[0].lockExpiresAt = lockExpiresAt; top3[0].lockMinutesLeft = 5;
      lockedPick = top3[0];
    }
  }
  if (lockedPick && top3[0] && top3[0].symbol !== lockedPick.symbol) {
    const idx = top3.findIndex(p => p.symbol === lockedPick!.symbol);
    if (idx > 0) top3.unshift(top3.splice(idx, 1)[0]);
  }
  top3.forEach((p, i) => p.rank = i + 1);
  watchlist.forEach((p, i) => p.rank = i + 4);

  // News shocks
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

  return { convictionPicks: top3, watchlist: watchlist.slice(0, 7), lockedPick, newsShockPicks, updatedAt: now };
}

export function resetConvictionEngine(): void { scoreHistory.clear(); lockedSymbol = null; lockExpiresAt = 0; }
