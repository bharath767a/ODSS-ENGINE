/**
 * ODSS - Fundamental Analysis Engine
 *
 * Scores stocks on 5 dimensions (0-100 each):
 *   1. Valuation (P/E, P/B, EV/EBITDA vs sector)
 *   2. Growth (EPS, revenue, profit growth)
 *   3. Profitability (margins, ROE, ROCE)
 *   4. Financial Health (debt, liquidity, coverage)
 *   5. Quality (ownership, institutional holding, earnings consistency)
 *
 * Produces a total score (0-100) and a Buy/Sell/Hold recommendation.
 *
 * Pure deterministic function — same input always produces same output.
 */
import type {
  FundamentalData,
  FundamentalScore,
  BuySellHoldRecommendation,
} from './types';
import { getSymbolMeta } from '../universe';

// ============================================================
// SCORING — each dimension returns 0-100
// ============================================================

function scoreValuation(data: FundamentalData): { score: number; notes: string[] } {
  const v = data.valuation;
  const notes: string[] = [];
  let score = 50; // start neutral

  // P/E vs sector P/E
  if (v.premiumDiscount < -15) { score += 20; notes.push(`Trading at ${v.premiumDiscount.toFixed(1)}% discount to sector P/E — undervalued`); }
  else if (v.premiumDiscount < -5) { score += 10; notes.push(`Slightly below sector P/E — fairly valued`); }
  else if (v.premiumDiscount > 30) { score -= 15; notes.push(`Trading at ${v.premiumDiscount.toFixed(1)}% premium to sector — expensive`); }
  else if (v.premiumDiscount > 15) { score -= 5; notes.push(`Moderate premium to sector P/E`); }
  else { notes.push(`In line with sector P/E`); }

  // PEG ratio (P/E to growth)
  if (v.pegRatio < 1 && v.pegRatio > 0) { score += 15; notes.push(`PEG ratio ${v.pegRatio.toFixed(2)} — attractively priced for growth`); }
  else if (v.pegRatio < 1.5) { score += 5; notes.push(`PEG ratio ${v.pegRatio.toFixed(2)} — reasonable`); }
  else if (v.pegRatio > 2.5) { score -= 10; notes.push(`PEG ratio ${v.pegRatio.toFixed(2)} — expensive for growth rate`); }

  // Dividend yield bonus
  if (v.dividendYield > 2) { score += 5; notes.push(`Healthy dividend yield of ${v.dividendYield.toFixed(1)}%`); }

  return { score: clamp(score), notes };
}

function scoreGrowth(data: FundamentalData): { score: number; notes: string[] } {
  const e = data.earnings;
  const notes: string[] = [];
  let score = 50;

  if (e.revenueGrowthYoY > 20) { score += 20; notes.push(`Revenue growing at ${e.revenueGrowthYoY.toFixed(1)}% YoY — strong`); }
  else if (e.revenueGrowthYoY > 12) { score += 10; notes.push(`Revenue growing at ${e.revenueGrowthYoY.toFixed(1)}% YoY — healthy`); }
  else if (e.revenueGrowthYoY < 5) { score -= 10; notes.push(`Revenue growth at ${e.revenueGrowthYoY.toFixed(1)}% — slow`); }

  if (e.epsGrowthYoY > 20) { score += 20; notes.push(`EPS growing at ${e.epsGrowthYoY.toFixed(1)}% YoY — excellent`); }
  else if (e.epsGrowthYoY > 12) { score += 10; notes.push(`EPS growing at ${e.epsGrowthYoY.toFixed(1)}% YoY — good`); }
  else if (e.epsGrowthYoY < 5) { score -= 15; notes.push(`EPS growth at ${e.epsGrowthYoY.toFixed(1)}% — weak`); }

  if (e.epsGrowth3Y > 15) { score += 10; notes.push(`3-year EPS CAGR of ${e.epsGrowth3Y.toFixed(1)}% — consistent compounder`); }

  // Quarterly trend
  const recentQuarters = data.quarterly.slice(0, 2);
  const avgProfitGrowth = recentQuarters.reduce((a, q) => a + q.profitGrowthQoQ, 0) / recentQuarters.length;
  if (avgProfitGrowth > 15) { score += 5; notes.push(`Recent quarters showing accelerating profit growth`); }
  else if (avgProfitGrowth < 0) { score -= 10; notes.push(`Recent quarters showing declining profits`); }

  return { score: clamp(score), notes };
}

function scoreProfitability(data: FundamentalData): { score: number; notes: string[] } {
  const e = data.earnings;
  const notes: string[] = [];
  let score = 50;

  if (e.roe > 20) { score += 20; notes.push(`ROE of ${e.roe.toFixed(1)}% — excellent capital efficiency`); }
  else if (e.roe > 15) { score += 10; notes.push(`ROE of ${e.roe.toFixed(1)}% — good`); }
  else if (e.roe < 10) { score -= 10; notes.push(`ROE of ${e.roe.toFixed(1)}% — below average`); }

  if (e.roce > 18) { score += 15; notes.push(`ROCE of ${e.roce.toFixed(1)}% — strong returns on capital`); }
  else if (e.roce < 12) { score -= 10; notes.push(`ROCE of ${e.roce.toFixed(1)}% — capital efficiency concerns`); }

  if (e.netProfitMargin > 18) { score += 15; notes.push(`Net margin of ${e.netProfitMargin.toFixed(1)}% — highly profitable`); }
  else if (e.netProfitMargin > 10) { score += 5; notes.push(`Net margin of ${e.netProfitMargin.toFixed(1)}% — decent`); }
  else if (e.netProfitMargin < 5) { score -= 10; notes.push(`Net margin of ${e.netProfitMargin.toFixed(1)}% — thin margins`); }

  if (e.operatingMargin > 25) { score += 10; notes.push(`Operating margin of ${e.operatingMargin.toFixed(1)}% — strong operational efficiency`); }

  return { score: clamp(score), notes };
}

function scoreFinancialHealth(data: FundamentalData): { score: number; notes: string[] } {
  const h = data.health;
  const isBank = data.profile.sector === 'BANKING' || data.profile.sector === 'FINANCIAL';
  const notes: string[] = [];
  let score = 50;

  // Debt-to-equity (skip for banks — they naturally have high D/E)
  if (!isBank) {
    if (h.debtToEquity < 0.3) { score += 20; notes.push(`Debt-to-equity of ${h.debtToEquity.toFixed(2)} — very low leverage`); }
    else if (h.debtToEquity < 1) { score += 10; notes.push(`Debt-to-equity of ${h.debtToEquity.toFixed(2)} — manageable`); }
    else if (h.debtToEquity > 2) { score -= 15; notes.push(`Debt-to-equity of ${h.debtToEquity.toFixed(2)} — highly leveraged`); }
    else if (h.debtToEquity > 1.5) { score -= 5; notes.push(`Debt-to-equity of ${h.debtToEquity.toFixed(2)} — elevated`); }
  }

  // Current ratio (liquidity)
  if (h.currentRatio > 2) { score += 10; notes.push(`Current ratio of ${h.currentRatio.toFixed(2)} — strong liquidity`); }
  else if (h.currentRatio < 1) { score -= 15; notes.push(`Current ratio of ${h.currentRatio.toFixed(2)} — liquidity concerns`); }

  // Interest coverage
  if (!isBank) {
    if (h.interestCoverage > 10) { score += 15; notes.push(`Interest coverage of ${h.interestCoverage.toFixed(1)}x — very safe`); }
    else if (h.interestCoverage > 4) { score += 5; notes.push(`Interest coverage of ${h.interestCoverage.toFixed(1)}x — adequate`); }
    else if (h.interestCoverage < 2) { score -= 20; notes.push(`Interest coverage of ${h.interestCoverage.toFixed(1)}x — risky`); }
  }

  // Free cash flow
  if (h.freeCashFlow > 0) { score += 10; notes.push(`Positive free cash flow — self-funding`); }
  else { score -= 10; notes.push(`Negative free cash flow — may need external funding`); }

  return { score: clamp(score), notes };
}

function scoreQuality(data: FundamentalData): { score: number; notes: string[] } {
  const o = data.ownership;
  const notes: string[] = [];
  let score = 50;

  // Promoter holding
  if (o.promoterHolding > 55) { score += 15; notes.push(`High promoter holding (${o.promoterHolding.toFixed(1)}%) — strong skin in the game`); }
  else if (o.promoterHolding > 45) { score += 5; notes.push(`Promoter holding at ${o.promoterHolding.toFixed(1)}% — adequate`); }
  else if (o.promoterHolding < 30) { score -= 10; notes.push(`Low promoter holding (${o.promoterHolding.toFixed(1)}%) — less alignment`); }

  // Promoter holding change (pledging/selling is negative)
  if (o.promoterHoldingChange > 0.5) { score += 10; notes.push(`Promoter increased holding by ${o.promoterHoldingChange.toFixed(1)}% — confidence signal`); }
  else if (o.promoterHoldingChange < -0.5) { score -= 10; notes.push(`Promoter reduced holding by ${Math.abs(o.promoterHoldingChange).toFixed(1)}% — concern`); }

  // Institutional holding
  if (o.institutionalHolding > 35) { score += 10; notes.push(`High institutional holding (${o.institutionalHolding.toFixed(1)}%) — trusted by FIIs/DIIs`); }
  else if (o.institutionalHolding > 20) { score += 5; notes.push(`Moderate institutional holding`); }

  // FII trend
  if (o.fiiHoldingChange > 1) { score += 5; notes.push(`FIIs increasing stake — bullish institutional sentiment`); }
  else if (o.fiiHoldingChange < -1.5) { score -= 5; notes.push(`FIIs reducing stake — watch for further exits`); }

  // Earnings consistency (quarterly)
  const beats = data.quarterly.filter((q) => q.surprise === 'BEAT').length;
  if (beats >= 3) { score += 10; notes.push(`Beat estimates in ${beats} of last 4 quarters — consistent performer`); }
  else if (data.quarterly.filter((q) => q.surprise === 'MISS').length >= 2) { score -= 10; notes.push(`Missed estimates in multiple quarters — inconsistency`); }

  return { score: clamp(score), notes };
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

export function analyzeFundamentals(data: FundamentalData): FundamentalScore {
  const val = scoreValuation(data);
  const growth = scoreGrowth(data);
  const profit = scoreProfitability(data);
  const health = scoreFinancialHealth(data);
  const quality = scoreQuality(data);

  // Weighted total: quality and profitability matter most
  const total = Math.round(
    val.score * 0.20 +
    growth.score * 0.25 +
    profit.score * 0.25 +
    health.score * 0.15 +
    quality.score * 0.15
  );

  const rating =
    total >= 80 ? 'EXCELLENT' :
    total >= 65 ? 'GOOD' :
    total >= 50 ? 'AVERAGE' :
    total >= 35 ? 'BELOW_AVERAGE' : 'POOR';

  // Collect strengths (score > 60) and weaknesses (score < 45)
  const allNotes = [
    ...val.notes.map((n) => ({ dimension: 'Valuation', note: n, score: val.score })),
    ...growth.notes.map((n) => ({ dimension: 'Growth', note: n, score: growth.score })),
    ...profit.notes.map((n) => ({ dimension: 'Profitability', note: n, score: profit.score })),
    ...health.notes.map((n) => ({ dimension: 'Health', note: n, score: health.score })),
    ...quality.notes.map((n) => ({ dimension: 'Quality', note: n, score: quality.score })),
  ];

  const strengths = allNotes.filter((n) => n.score > 60).map((n) => n.note).slice(0, 5);
  const weaknesses = allNotes.filter((n) => n.score < 45).map((n) => n.note).slice(0, 5);

  const summary = `${data.profile.name} scores ${total}/100 (${rating}). ` +
    (strengths.length > 0 ? `Key strengths: ${strengths[0]}. ` : '') +
    (weaknesses.length > 0 ? `Watch out: ${weaknesses[0]}.` : 'No major concerns identified.');

  return {
    total,
    valuation: Math.round(val.score),
    growth: Math.round(growth.score),
    profitability: Math.round(profit.score),
    financialHealth: Math.round(health.score),
    quality: Math.round(quality.score),
    rating,
    summary,
    strengths,
    weaknesses,
  };
}

// ============================================================
// BUY / SELL / HOLD RECOMMENDATION
// ============================================================

export function getBuySellHold(data: FundamentalData, score: FundamentalScore, currentPrice: number): BuySellHoldRecommendation {
  const meta = getSymbolMeta(data.profile.symbol);
  const v = data.valuation;
  const e = data.earnings;
  const h = data.health;

  // Fair value estimate using P/E and forward EPS
  const fairValuePE = v.sectorPE * e.forwardEPS;
  // Also consider P/B fair value
  const fairValuePB = v.pbRatio * (e.eps / (v.peRatio / v.pbRatio)); // simplified
  // Average of approaches
  const fairValue = Math.round((fairValuePE * 0.7 + fairValuePB * 0.3 + data.outlook.analystTargetPrice * 0.3) / 1.3);

  const upsideDownside = ((fairValue - currentPrice) / currentPrice) * 100;

  // Key metrics with signals
  const keyMetrics: BuySellHoldRecommendation['keyMetrics'] = [
    { label: 'P/E vs Sector', value: `${v.premiumDiscount > 0 ? '+' : ''}${v.premiumDiscount.toFixed(1)}%`, signal: v.premiumDiscount < -5 ? 'BULLISH' : v.premiumDiscount > 20 ? 'BEARISH' : 'NEUTRAL' },
    { label: 'Revenue Growth', value: `${e.revenueGrowthYoY.toFixed(1)}%`, signal: e.revenueGrowthYoY > 15 ? 'BULLISH' : e.revenueGrowthYoY < 5 ? 'BEARISH' : 'NEUTRAL' },
    { label: 'ROE', value: `${e.roe.toFixed(1)}%`, signal: e.roe > 18 ? 'BULLISH' : e.roe < 10 ? 'BEARISH' : 'NEUTRAL' },
    { label: 'Debt/Equity', value: h.debtToEquity.toFixed(2), signal: h.debtToEquity < 0.5 ? 'BULLISH' : h.debtToEquity > 2 ? 'BEARISH' : 'NEUTRAL' },
    { label: 'Fundamental Score', value: `${score.total}/100`, signal: score.total > 65 ? 'BULLISH' : score.total < 45 ? 'BEARISH' : 'NEUTRAL' },
    { label: 'Analyst Consensus', value: data.outlook.analystConsensus, signal: data.outlook.analystConsensus === 'BUY' ? 'BULLISH' : data.outlook.analystConsensus === 'SELL' ? 'BEARISH' : 'NEUTRAL' },
  ];

  // Determine action based on score + valuation
  const bullishMetrics = keyMetrics.filter((m) => m.signal === 'BULLISH').length;
  const bearishMetrics = keyMetrics.filter((m) => m.signal === 'BEARISH').length;

  let action: BuySellHoldRecommendation['action'];
  let confidence: number;

  if (score.total >= 75 && upsideDownside > 15 && bullishMetrics >= 4) {
    action = 'STRONG_BUY';
    confidence = Math.min(95, score.total + 10);
  } else if (score.total >= 60 && upsideDownside > 0 && bullishMetrics >= 3) {
    action = 'BUY';
    confidence = Math.min(85, score.total + 5);
  } else if (score.total >= 45 && bearishMetrics <= 2) {
    action = 'HOLD';
    confidence = 60;
  } else if (score.total >= 30 || bearishMetrics >= 3) {
    action = 'SELL';
    confidence = 65;
  } else {
    action = 'STRONG_SELL';
    confidence = 75;
  }

  const riskLevel =
    h.debtToEquity > 2 || score.total < 35 ? 'VERY_HIGH' :
    h.debtToEquity > 1.5 || score.total < 45 ? 'HIGH' :
    h.debtToEquity > 1 || score.total < 60 ? 'MODERATE' : 'LOW';

  const timeHorizon =
    action === 'STRONG_BUY' || action === 'BUY' ? 'LONG' :
    action === 'HOLD' ? 'MEDIUM' : 'SHORT';

  const reasoning = `${action === 'STRONG_BUY' ? 'Strong fundamentals with significant upside potential.' :
    action === 'BUY' ? 'Good fundamentals with reasonable valuation.' :
    action === 'HOLD' ? 'Fair fundamentals — hold existing positions, wait for better entry.' :
    action === 'SELL' ? 'Weak fundamentals or overvalued — consider reducing.' :
    'Significant fundamental concerns — exit recommended.'} ` +
    `Fair value estimated at ₹${fairValue} vs current ₹${currentPrice.toFixed(2)} (${upsideDownside > 0 ? '+' : ''}${upsideDownside.toFixed(1)}% ${upsideDownside > 0 ? 'upside' : 'downside'}). ` +
    `${bullishMetrics} bullish / ${bearishMetrics} bearish signals out of ${keyMetrics.length} metrics.`;

  return {
    action,
    confidence,
    reasoning,
    fairValue,
    currentPrice,
    upsideDownside,
    timeHorizon,
    riskLevel,
    keyMetrics,
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
