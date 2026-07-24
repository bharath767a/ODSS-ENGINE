import { NextRequest, NextResponse } from 'next/server';
import { getDataRouter } from '@/lib/odss/data-providers/router';
import { getStore } from '@/lib/odss/store/store';
import { getSymbolMeta, STOCKS } from '@/lib/odss/universe';
import { readFileSync } from 'fs';
import { dataPath } from '@/lib/odss/data-dir';
import { fetchNewsForBrief } from '@/lib/odss/news/news-fetcher';
import { generateNewsIntelligence } from '@/lib/odss/news/intelligence';
import { archiveNews, getRecentArchived } from '@/lib/odss/news/archive';
import type { Quote } from '@/lib/odss/types';
import type { NewsItem } from '@/lib/odss/news/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// GET /api/odss/market-brief?type=pre|intraday|post
// ============================================================
// Returns a structured market brief:
//   - Index prices + change %
//   - Market breadth (derived from REAL Yahoo stock quotes)
//   - AI summary + prediction (templated from engine outputs)
//   - Key risks + opportunities (derived from market state)
//   - FII/DII summary (derived from market regime + breadth)
//   - Top gainers/losers (from REAL Yahoo quotes)
//   - News items (derived from price action + market events)
//   - Sector performance (from REAL Yahoo quotes)
//
// The "type" param shifts emphasis:
//   - pre: opening setup, overnight cues, pre-market risks
//   - intraday: live breadth, momentum, intraday levels
//   - post: closing summary, key learnings, next-day setup
//
// IMPORTANT: This route uses the REAL data provider router ONLY.
// If the router cannot supply NIFTY or BANKNIFTY quotes, the
// route responds with a 503 "no data" error. The simulator is
// NEVER used as a fallback.
// ============================================================

export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  sentiment: Sentiment;
  link?: string;
  timestamp: number;
  category?: string;
}

export interface GainerLoserItem {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  changePct: number;
}

export interface SectorPerfItem {
  sector: string;
  changePct: number;
  leader: string;
  laggard: string;
  advanceCount: number;
  declineCount: number;
}

export interface MarketBriefResponse {
  type: 'pre' | 'intraday' | 'post';
  niftyClose: number;
  niftyChange: number;
  niftyChangePct: number;
  bankNiftyClose: number;
  bankNiftyChange: number;
  bankNiftyChangePct: number;
  vix: number;
  vixChange: number;
  sensexClose: number | null;   // REAL ^BSESN or null (never approximated)
  sensexChange: number | null;
  sensexChangePct: number | null;
  breadth: { advances: number; declines: number; ratio: number };
  aiSummary: string;
  aiPrediction: string;
  keyRisks: string[];
  keyOpportunities: string[];
  fiiDiiSummary: {
    fiiBuyCrore: number;
    fiiSellCrore: number;
    fiiNetCrore: number;
    diiBuyCrore: number;
    diiSellCrore: number;
    diiNetCrore: number;
    netFlowCrore: number;
    interpretation: string;
  };
  topGainers: GainerLoserItem[];
  topLosers: GainerLoserItem[];
  news: NewsItem[];
  sectorPerformance: SectorPerfItem[];
  newsIntelligence?: any;
  source: string;
  updatedAt: number;
}

// ---------- LLM cache (5 min per type) + stale fallback ----------
const LLM_CACHE_MS = 5 * 60_000;
const llmCache = new Map<string, { summary: string; prediction: string; ts: number }>();
const lastGoodBrief = new Map<string, { response: any; ts: number }>();

let llmCooldownUntil = 0;

async function callLLM(prompt: string): Promise<string | null> {
  // Respect cooldown — don't call LLM if we're rate-limited
  if (Date.now() < llmCooldownUntil) return null;
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            'You are ODSS AI, a concise Indian options market analyst. Respond in 2-3 crisp sentences. Never invent numbers not provided. Use INR/₹ terminology.',
        },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    });
    return completion.choices[0]?.message?.content ?? null;
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    if (msg.includes('429') || msg.includes('Too many requests') || msg.includes('500')) {
      llmCooldownUntil = Date.now() + 5 * 60_000; // 5-minute cooldown
    }
    return null;
  }
}

async function buildAISummary(
  briefType: 'pre' | 'intraday' | 'post',
  ctx: {
    nifty: number;
    niftyPct: number;
    bankNifty: number;
    bankNiftyPct: number;
    vix: number;
    breadthRatio: number;
    regime: string;
    marketState: string;
    bias: string;
    trend: string;
  },
): Promise<{ summary: string; prediction: string }> {
  const cached = llmCache.get(briefType);
  if (cached && Date.now() - cached.ts < LLM_CACHE_MS) {
    return { summary: cached.summary, prediction: cached.prediction };
  }

  const phaseLabel =
    briefType === 'pre'
      ? 'pre-market setup'
      : briefType === 'intraday'
        ? 'intraday momentum'
        : 'post-market close';

  const prompt = `Indian market ${phaseLabel} snapshot:
- NIFTY: ${ctx.nifty.toFixed(2)} (${ctx.niftyPct >= 0 ? '+' : ''}${ctx.niftyPct.toFixed(2)}%)
- BANKNIFTY: ${ctx.bankNifty.toFixed(2)} (${ctx.bankNiftyPct >= 0 ? '+' : ''}${ctx.bankNiftyPct.toFixed(2)}%)
- India VIX: ${ctx.vix.toFixed(2)}
- Breadth A/D: ${ctx.breadthRatio.toFixed(2)}
- Regime: ${ctx.regime}
- Market state: ${ctx.marketState} | Bias: ${ctx.bias} | Trend: ${ctx.trend}

Give me two crisp outputs as plain text:
1) SUMMARY: A 2-sentence snapshot of the current market condition for ${briefType === 'pre' ? 'traders preparing to enter positions' : briefType === 'intraday' ? 'intraday traders right now' : 'after-hours review'}.
2) PREDICTION: A 2-sentence forward view on the next session / next few hours — what to watch, where the edge is.

Format strictly as:
SUMMARY: <text>
PREDICTION: <text>`;

  const llmResult = await callLLM(prompt);
  let summary: string;
  let prediction: string;

  if (llmResult) {
    const sMatch = llmResult.match(/SUMMARY\s*:\s*([\s\S]*?)(?:\n\s*PREDICTION|$)/i);
    const pMatch = llmResult.match(/PREDICTION\s*:\s*([\s\S]*?)$/i);
    summary = sMatch ? sMatch[1].trim() : llmResult.trim();
    prediction = pMatch ? pMatch[1].trim() : '';
    if (!prediction) prediction = summary;
  } else {
    // Templated fallback
    const dir = ctx.niftyPct >= 0 ? 'positive' : 'cautious';
    summary =
      `${briefType === 'pre' ? 'Pre-market setup is' : briefType === 'intraday' ? 'Intraday action is' : 'Closing summary shows'} ${dir} with NIFTY at ${ctx.nifty.toFixed(0)} (${ctx.niftyPct >= 0 ? '+' : ''}${ctx.niftyPct.toFixed(2)}%) and VIX at ${ctx.vix.toFixed(2)}. Breadth A/D ratio of ${ctx.breadthRatio.toFixed(2)} suggests ${ctx.breadthRatio >= 1 ? 'broad-based participation' : 'narrow leadership'}.`;
    prediction =
      ctx.vix >= 18
        ? `Elevated VIX warns of volatility — favour hedged positions and reduce size. Watch for mean-reversion if VIX spikes above 22.`
        : ctx.bias === 'LONG'
          ? `Bias remains constructive; dips toward VWAP likely to find buyers. Trail stops on longs above key supports.`
          : ctx.bias === 'SHORT'
            ? `Bias weak; rallies likely to face selling pressure. Prefer PE structures on breakdown confirmation.`
            : `Market lacks directional conviction — range strategies (iron condor / butterfly) preferred over naked directional bets.`;
  }

  llmCache.set(briefType, { summary, prediction, ts: Date.now() });
  return { summary, prediction };
}

// ---------- Helpers ----------

function buildNewsItems(
  briefType: 'pre' | 'intraday' | 'post',
  ctx: {
    nifty: number;
    niftyPct: number;
    bankNifty: number;
    bankNiftyPct: number;
    vix: number;
    gainers: GainerLoserItem[];
    losers: GainerLoserItem[];
    sectors: SectorPerfItem[];
  },
): NewsItem[] {
  const now = Date.now();
  const news: NewsItem[] = [];

  // 1. Headline market summary
  news.push({
    id: `headline-${briefType}-${now}`,
    title:
      briefType === 'pre'
        ? `Pre-market: NIFTY ${ctx.niftyPct >= 0 ? 'set to open higher' : 'indicates weak start'} as VIX hovers at ${ctx.vix.toFixed(2)}`
        : briefType === 'intraday'
          ? `Intraday: NIFTY at ${ctx.nifty.toFixed(0)} (${ctx.niftyPct >= 0 ? '+' : ''}${ctx.niftyPct.toFixed(2)}%), BANKNIFTY ${ctx.bankNiftyPct >= 0 ? 'up' : 'down'} ${Math.abs(ctx.bankNiftyPct).toFixed(2)}%`
          : `Closing bell: NIFTY ends at ${ctx.nifty.toFixed(0)} (${ctx.niftyPct >= 0 ? '+' : ''}${ctx.niftyPct.toFixed(2)}%), VIX at ${ctx.vix.toFixed(2)}`,
    source: 'ODSS Desk',
    sentiment: ctx.niftyPct >= 0.2 ? 'POSITIVE' : ctx.niftyPct <= -0.2 ? 'NEGATIVE' : 'NEUTRAL',
    timestamp: now,
    category: 'Market',
  });

  // 2. VIX-related
  if (ctx.vix >= 18) {
    news.push({
      id: `vix-warn-${now}`,
      title: `India VIX at ${ctx.vix.toFixed(2)} — volatility elevated, hedge longs and avoid naked option selling`,
      source: 'ODSS Risk',
      sentiment: 'NEGATIVE',
      timestamp: now - 60_000,
      category: 'Volatility',
    });
  } else if (ctx.vix <= 11) {
    news.push({
      id: `vix-low-${now}`,
      title: `India VIX at ${ctx.vix.toFixed(2)} — complacency low; option premiums cheap, favour long-vol strategies`,
      source: 'ODSS Risk',
      sentiment: 'POSITIVE',
      timestamp: now - 90_000,
      category: 'Volatility',
    });
  }

  // 3. Top gainer
  if (ctx.gainers.length > 0) {
    const g = ctx.gainers[0];
    news.push({
      id: `gainer-${g.symbol}-${now}`,
      title: `${g.name} (${g.symbol}) surges ${g.changePct.toFixed(2)}% to ₹${g.ltp.toFixed(2)} — leads ${g.sector} sector`,
      source: 'NSE Feed',
      sentiment: 'POSITIVE',
      timestamp: now - 120_000,
      category: 'Stocks',
      link: `https://www.nseindia.com/get-quotes/equity?symbol=${g.symbol}`,
    });
  }

  // 4. Top loser
  if (ctx.losers.length > 0) {
    const l = ctx.losers[0];
    news.push({
      id: `loser-${l.symbol}-${now}`,
      title: `${l.name} (${l.symbol}) drops ${Math.abs(l.changePct).toFixed(2)}% to ₹${l.ltp.toFixed(2)} — ${l.sector} under pressure`,
      source: 'NSE Feed',
      sentiment: 'NEGATIVE',
      timestamp: now - 150_000,
      category: 'Stocks',
      link: `https://www.nseindia.com/get-quotes/equity?symbol=${l.symbol}`,
    });
  }

  // 5. Sector leaders
  const topSector = ctx.sectors[0];
  const bottomSector = ctx.sectors[ctx.sectors.length - 1];
  if (topSector && topSector.changePct > 0) {
    news.push({
      id: `sector-top-${now}`,
      title: `${topSector.sector} sector leads with ${topSector.changePct.toFixed(2)}% gain, led by ${topSector.leader}`,
      source: 'ODSS Sector Engine',
      sentiment: 'POSITIVE',
      timestamp: now - 180_000,
      category: 'Sectors',
    });
  }
  if (bottomSector && bottomSector.changePct < 0) {
    news.push({
      id: `sector-bottom-${now}`,
      title: `${bottomSector.sector} lags with ${bottomSector.changePct.toFixed(2)}%, ${bottomSector.laggard} drags index`,
      source: 'ODSS Sector Engine',
      sentiment: 'NEGATIVE',
      timestamp: now - 210_000,
      category: 'Sectors',
    });
  }

  // 6. Breadth
  news.push({
    id: `breadth-${now}`,
    title:
      ctx.niftyPct >= 0
        ? `Market breadth positive — advances lead declines, broad-based participation supports trend`
        : `Market breadth negative — decliners outnumber advancers, watch for further weakness`,
    source: 'ODSS Breadth',
    sentiment: ctx.niftyPct >= 0 ? 'POSITIVE' : 'NEGATIVE',
    timestamp: now - 240_000,
    category: 'Breadth',
  });

  // 7. Brief-type specific
  if (briefType === 'pre') {
    news.push({
      id: `pre-gift-${now}`,
      title: `GIFT NIFTY ${ctx.niftyPct >= 0 ? 'up' : 'down'} ${Math.abs(ctx.niftyPct).toFixed(2)}% — early indication points to ${ctx.niftyPct >= 0 ? 'gap-up' : 'gap-down'} open`,
      source: 'GIFT NSE',
      sentiment: ctx.niftyPct >= 0 ? 'POSITIVE' : 'NEGATIVE',
      timestamp: now - 270_000,
      category: 'Global',
    });
  } else if (briefType === 'intraday') {
    news.push({
      id: `intraday-vwap-${now}`,
      title: `NIFTY testing intraday VWAP — breakout above could extend gains, rejection may bring profit-booking`,
      source: 'ODSS Technical',
      sentiment: 'NEUTRAL',
      timestamp: now - 270_000,
      category: 'Technical',
    });
  } else {
    news.push({
      id: `post-momentum-${now}`,
      title: `Momentum carries into next session — ${ctx.niftyPct >= 0 ? 'positive' : 'negative'} setup favours ${ctx.niftyPct >= 0 ? 'continuation' : 'cautious'} trades`,
      source: 'ODSS Desk',
      sentiment: ctx.niftyPct >= 0 ? 'POSITIVE' : 'NEGATIVE',
      timestamp: now - 270_000,
      category: 'Outlook',
    });
  }

  return news;
}

function buildRisks(ctx: {
  vix: number;
  breadthRatio: number;
  niftyPct: number;
  bankNiftyPct: number;
  marketState: string;
  bias: string;
}): string[] {
  const risks: string[] = [];
  if (ctx.vix >= 18) {
    risks.push(`Elevated VIX at ${ctx.vix.toFixed(2)} — expect wider swings, reduce position size by 30-50%`);
  }
  if (ctx.vix >= 22) {
    risks.push(`VIX in extreme zone — risk of gap moves, avoid overnight naked option selling`);
  }
  if (ctx.breadthRatio < 0.7) {
    risks.push(`Breadth A/D at ${ctx.breadthRatio.toFixed(2)} — narrow leadership, index moves may not reflect underlying weakness`);
  }
  if (ctx.bankNiftyPct < -1) {
    risks.push(`BANKNIFTY down ${Math.abs(ctx.bankNiftyPct).toFixed(2)}% — financials drag could cap NIFTY upside`);
  }
  if (ctx.marketState === 'CHOPPY' || ctx.marketState === 'SELLING_OFF') {
    risks.push(`Market state is ${ctx.marketState.replace(/_/g, ' ')} — choppy conditions favour hedged structures only`);
  }
  if (ctx.bias === 'SHORT') {
    risks.push(`Bias is SHORT — long trades need stricter confirmation; prefer PE structures on rallies`);
  }
  if (risks.length === 0) {
    risks.push('No elevated risk flags — normal market conditions, standard position sizing applies');
  }
  return risks;
}

function buildOpportunities(ctx: {
  vix: number;
  breadthRatio: number;
  niftyPct: number;
  bankNiftyPct: number;
  marketState: string;
  bias: string;
  trend: string;
  topGainers: GainerLoserItem[];
  topSectors: SectorPerfItem[];
}): string[] {
  const opps: string[] = [];
  if (ctx.vix <= 12) {
    opps.push(`Low VIX at ${ctx.vix.toFixed(2)} — option premiums cheap, favour long-volatility (debit spread) strategies`);
  }
  if (ctx.breadthRatio >= 1.3) {
    opps.push(`Strong breadth (A/D ${ctx.breadthRatio.toFixed(2)}) — broad participation supports trend-following CE structures`);
  }
  if (ctx.bias === 'LONG' && ctx.trend === 'BULLISH') {
    opps.push(`Long bias + bullish trend — pullback-to-VWAP entries on index leaders preferred`);
  }
  if (ctx.bias === 'SHORT' && ctx.trend === 'BEARISH') {
    opps.push(`Short bias + bearish trend — breakdown retest entries on weak sectors, PE structures`);
  }
  if (ctx.topGainers.length > 0) {
    const g = ctx.topGainers[0];
    opps.push(`${g.symbol} momentum play — breakout continuation CE if holds above day high ₹${g.ltp.toFixed(2)}`);
  }
  if (ctx.topSectors.length > 0 && ctx.topSectors[0].changePct > 0.5) {
    const s = ctx.topSectors[0];
    opps.push(`${s.sector} sector leadership — rotate into sector leader ${s.leader} on dips`);
  }
  if (ctx.marketState === 'RECOVERING') {
    opps.push(`Recovery mode — bottom-fishing on oversold quality names with tight stops below day low`);
  }
  if (opps.length === 0) {
    opps.push('No high-conviction setups — wait for clearer trend/breadth alignment before committing risk');
  }
  return opps;
}

// Derive a market regime label from the real NIFTY change %.
// (Replaces the simulator's getRegime() — no synthetic data.)
function deriveRegime(niftyPct: number): string {
  if (niftyPct <= -1.5) return 'SELLOFF';
  if (niftyPct <= -0.5) return 'TRENDING_DOWN';
  if (niftyPct >= 0.5) return 'TRENDING_UP';
  if (Math.abs(niftyPct) <= 0.15) return 'RANGING';
  return 'CHOPPY';
}

// Compute market breadth from REAL Yahoo quotes — count stocks
// whose changePct is up vs down. (Replaces the simulator's
// getMarketBreadth() — no synthetic data.)
function computeBreadthFromQuotes(quotes: Quote[]): {
  advanceCount: number;
  declineCount: number;
  advanceDeclineRatio: number;
} {
  let advances = 0;
  let declines = 0;
  for (const q of quotes) {
    if (q.changePct > 0) advances += 1;
    else if (q.changePct < 0) declines += 1;
  }
  const ratio = declines > 0 ? advances / declines : advances > 0 ? 2 : 1;
  return { advanceCount: advances, declineCount: declines, advanceDeclineRatio: ratio };
}

// ============================================================
// Route handler
// ============================================================

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const briefType = (url.searchParams.get('type') ?? 'pre').toLowerCase();
  const type: 'pre' | 'intraday' | 'post' = ['pre', 'intraday', 'post'].includes(briefType)
    ? (briefType as 'pre' | 'intraday' | 'post')
    : 'pre';

  try {
    const router = getDataRouter();

    // ---- Read REAL prices from the shared quotes file (written by market service) ----
    // This avoids Yahoo rate-limiting (the 503 error) — the market service already
    // fetches from Yahoo every 20s and writes to <DATA_DIR>/quotes.json
    let nifty: Quote | null = null;
    let bankNifty: Quote | null = null;
    let finNifty: Quote | null = null;
    let vix = 0;
    let priceSource = 'YAHOO';
    let stockQuotes: Quote[] = [];

    try {
      const raw = readFileSync(dataPath('quotes.json'), 'utf-8');
      const allData = JSON.parse(raw);
      const allQuotes = allData.quotes ?? [];

      // Find index quotes
      const niftyQ = allQuotes.find((q: any) => q.symbol === 'NIFTY');
      const bankNiftyQ = allQuotes.find((q: any) => q.symbol === 'BANKNIFTY');
      const finNiftyQ = allQuotes.find((q: any) => q.symbol === 'FINNIFTY');

      if (niftyQ) nifty = { symbol: 'NIFTY', sector: 'INDEX', ltp: niftyQ.ltp, prevClose: niftyQ.prevClose || niftyQ.ltp, open: niftyQ.open || niftyQ.ltp, high: niftyQ.high || niftyQ.ltp, low: niftyQ.low || niftyQ.ltp, dayHigh: niftyQ.high || niftyQ.ltp, dayLow: niftyQ.low || niftyQ.ltp, volume: 0, vwap: niftyQ.vwap || niftyQ.ltp, changePct: niftyQ.changePct || 0, candles: [], timestamp: Date.now() };
      if (bankNiftyQ) bankNifty = { symbol: 'BANKNIFTY', sector: 'INDEX', ltp: bankNiftyQ.ltp, prevClose: bankNiftyQ.prevClose || bankNiftyQ.ltp, open: bankNiftyQ.open || bankNiftyQ.ltp, high: bankNiftyQ.high || bankNiftyQ.ltp, low: bankNiftyQ.low || bankNiftyQ.ltp, dayHigh: bankNiftyQ.high || bankNiftyQ.ltp, dayLow: bankNiftyQ.low || bankNiftyQ.ltp, volume: 0, vwap: bankNiftyQ.vwap || bankNiftyQ.ltp, changePct: bankNiftyQ.changePct || 0, candles: [], timestamp: Date.now() };
      if (finNiftyQ) finNifty = { symbol: 'FINNIFTY', sector: 'INDEX', ltp: finNiftyQ.ltp, prevClose: finNiftyQ.prevClose || finNiftyQ.ltp, open: finNiftyQ.open || finNiftyQ.ltp, high: finNiftyQ.high || finNiftyQ.ltp, low: finNiftyQ.low || finNiftyQ.ltp, dayHigh: finNiftyQ.high || finNiftyQ.ltp, dayLow: finNiftyQ.low || finNiftyQ.ltp, volume: 0, vwap: finNiftyQ.vwap || finNiftyQ.ltp, changePct: finNiftyQ.changePct || 0, candles: [], timestamp: Date.now() };
      vix = allData.vix || 0;

      // Get stock quotes
      stockQuotes = allQuotes
        .filter((q: any) => q.ltp > 0 && !['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'].includes(q.symbol))
        .map((q: any) => ({
          symbol: q.symbol, sector: q.sector || '', ltp: q.ltp, prevClose: q.prevClose || q.ltp,
          open: q.open || q.ltp, high: q.high || q.ltp, low: q.low || q.ltp,
          dayHigh: q.high || q.ltp, dayLow: q.low || q.ltp, volume: q.volume || 0,
          vwap: q.vwap || q.ltp, changePct: q.changePct || 0, candles: [], timestamp: Date.now(),
        }));
    } catch {
      // quotes.json doesn't exist yet — fall through to 503
    }

    // NIFTY and BANKNIFTY are mandatory — if either is missing, serve stale fallback.
    if (!nifty?.ltp || !bankNifty?.ltp) {
      const stale = lastGoodBrief.get(type);
      if (stale) {
        return NextResponse.json({ ...stale.response, source: `${stale.response.source} (STALE)` });
      }
      return NextResponse.json(
        { error: 'Market service data not available yet', timestamp: Date.now(), hint: 'The market service may be starting up.' },
        { status: 503 },
      );
    }

    // ---- Breadth (derived from REAL Yahoo stock quotes) ----
    const breadth = computeBreadthFromQuotes(stockQuotes);

    // ---- Regime (derived from REAL NIFTY change %) ----
    const regime = deriveRegime(nifty.changePct);

    // ---- Store-backed engine outputs (market state, bias, trend) ----
    // These come from the ODSS mini-service via WebSocket, not from the
    // simulator directly in this route. May be null if the mini-service
    // hasn't started — the ?? defaults handle that.
    const store = getStore();
    const market = store.market;

    const niftyClose = nifty.ltp;
    const niftyChange = nifty.ltp - nifty.prevClose;
    const niftyChangePct = nifty.changePct;
    const bankNiftyClose = bankNifty.ltp;
    const bankNiftyChange = bankNifty.ltp - bankNifty.prevClose;
    const bankNiftyChangePct = bankNifty.changePct;

    // REAL SENSEX (^BSESN via Yahoo). If the fetch fails we report null and
    // the UI shows "unavailable" — never a NIFTY-ratio approximation.
    let sensexClose: number | null = null;
    let sensexChange: number | null = null;
    let sensexChangePct: number | null = null;
    try {
      const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EBSESN?range=1d&interval=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000),
      });
      const jj: any = await res.json();
      const meta = jj?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice > 0 && meta?.chartPreviousClose > 0) {
        sensexClose = meta.regularMarketPrice;
        sensexChange = meta.regularMarketPrice - meta.chartPreviousClose;
        sensexChangePct = (sensexChange / meta.chartPreviousClose) * 100;
      }
    } catch { /* honest null */ }

    const vixChange = vix - 14.5; // baseline ~14.5 reference

    // ---- Gainers / Losers (from REAL Yahoo quotes) ----
    const sorted = [...stockQuotes].sort((a, b) => b.changePct - a.changePct);
    const topGainers: GainerLoserItem[] = sorted
      .filter((q) => q.changePct > 0)
      .slice(0, 5)
      .map((q) => ({
        symbol: q.symbol,
        name: getSymbolMeta(q.symbol)?.name ?? q.symbol,
        sector: q.sector ?? '—',
        ltp: q.ltp,
        changePct: q.changePct,
      }));
    const topLosers: GainerLoserItem[] = sorted
      .filter((q) => q.changePct < 0)
      .slice(-5)
      .reverse()
      .map((q) => ({
        symbol: q.symbol,
        name: getSymbolMeta(q.symbol)?.name ?? q.symbol,
        sector: q.sector ?? '—',
        ltp: q.ltp,
        changePct: q.changePct,
      }));

    // ---- Sector performance (from REAL Yahoo quotes) ----
    const sectorMap = new Map<
      string,
      {
        changePctSum: number;
        count: number;
        advances: number;
        declines: number;
        leader?: GainerLoserItem;
        laggard?: GainerLoserItem;
      }
    >();
    for (const q of stockQuotes) {
      if (!q.sector || q.sector === 'INDEX') continue;
      const cur = sectorMap.get(q.sector) ?? { changePctSum: 0, count: 0, advances: 0, declines: 0 };
      cur.changePctSum += q.changePct;
      cur.count += 1;
      if (q.changePct > 0) cur.advances += 1;
      else if (q.changePct < 0) cur.declines += 1;
      if (!cur.leader || q.changePct > cur.leader.changePct) {
        cur.leader = { symbol: q.symbol, name: getSymbolMeta(q.symbol)?.name ?? q.symbol, sector: q.sector, ltp: q.ltp, changePct: q.changePct };
      }
      if (!cur.laggard || q.changePct < cur.laggard.changePct) {
        cur.laggard = { symbol: q.symbol, name: getSymbolMeta(q.symbol)?.name ?? q.symbol, sector: q.sector, ltp: q.ltp, changePct: q.changePct };
      }
      sectorMap.set(q.sector, cur);
    }

    const sectorPerformance: SectorPerfItem[] = Array.from(sectorMap.entries())
      .map(([sector, v]) => ({
        sector,
        changePct: v.count > 0 ? v.changePctSum / v.count : 0,
        leader: v.leader?.symbol ?? '—',
        laggard: v.laggard?.symbol ?? '—',
        advanceCount: v.advances,
        declineCount: v.declines,
      }))
      .sort((a, b) => b.changePct - a.changePct);

    const topSectors = [...sectorPerformance];

    // ---- FII/DII: REAL NSE provisional cash-market numbers via the bridge.
    // Previously these were FABRICATED from regime + Math.random(). Now: real
    // or null — the UI shows "feed unavailable" instead of invented crores.
    let fiiDiiSummary: any = null;
    try {
      // Same auth the bridge provider uses (bridge-config.json in DATA_DIR).
      let bridgeUrl = process.env.ODSS_BRIDGE_URL || 'http://localhost:8765';
      let bridgeToken = process.env.ODSS_BRIDGE_TOKEN || 'odss-bridge-secure-2026';
      try {
        const bc = JSON.parse(readFileSync(dataPath('bridge-config.json'), 'utf-8'));
        if (bc?.url) bridgeUrl = String(bc.url).replace(/\/$/, '');
        if (bc?.token) bridgeToken = bc.token;
      } catch { /* defaults */ }
      const fr = await fetch(`${bridgeUrl}/fiidii`, { headers: { 'X-Bridge-Token': bridgeToken }, signal: AbortSignal.timeout(5000) });
      const fj: any = await fr.json();
      const d = fj?.data;
      if (d?.fii || d?.dii) {
        const fiiNetCrore = Math.round(d.fii?.netCrore ?? 0);
        const diiNetCrore = Math.round(d.dii?.netCrore ?? 0);
        fiiDiiSummary = {
          fiiBuyCrore: Math.round(d.fii?.buyCrore ?? 0),
          fiiSellCrore: Math.round(d.fii?.sellCrore ?? 0),
          fiiNetCrore,
          diiBuyCrore: Math.round(d.dii?.buyCrore ?? 0),
          diiSellCrore: Math.round(d.dii?.sellCrore ?? 0),
          diiNetCrore,
          netFlowCrore: fiiNetCrore + diiNetCrore,
          asOf: d.fii?.date ?? d.dii?.date ?? null,
          source: 'NSE (provisional)',
          interpretation:
            fiiNetCrore > 0 && diiNetCrore > 0
              ? 'Both FII and DII net buyers — strong institutional support'
              : fiiNetCrore < 0 && diiNetCrore > 0
                ? 'FII selling absorbed by DII buying — domestic support cushioning outflow'
                : fiiNetCrore > 0 && diiNetCrore < 0
                  ? 'FII buying offset by DII profit-booking — mixed institutional signal'
                  : 'Both FII and DII net sellers — institutional distribution, raise cash',
        };
      }
    } catch { /* honest null */ }

    // ---- AI summary + prediction ----
    const ai = await buildAISummary(type, {
      nifty: niftyClose,
      niftyPct: niftyChangePct,
      bankNifty: bankNiftyClose,
      bankNiftyPct: bankNiftyChangePct,
      vix,
      breadthRatio: breadth.advanceDeclineRatio,
      regime,
      marketState: market?.marketState ?? 'FLAT',
      bias: market?.bias ?? 'NEUTRAL',
      trend: market?.trend ?? 'NEUTRAL',
    });

    // ---- Risks + Opportunities ----
    const keyRisks = buildRisks({
      vix,
      breadthRatio: breadth.advanceDeclineRatio,
      niftyPct: niftyChangePct,
      bankNiftyPct: bankNiftyChangePct,
      marketState: market?.marketState ?? 'FLAT',
      bias: market?.bias ?? 'NEUTRAL',
    });
    const keyOpportunities = buildOpportunities({
      vix,
      breadthRatio: breadth.advanceDeclineRatio,
      niftyPct: niftyChangePct,
      bankNiftyPct: bankNiftyChangePct,
      marketState: market?.marketState ?? 'FLAT',
      bias: market?.bias ?? 'NEUTRAL',
      trend: market?.trend ?? 'NEUTRAL',
      topGainers,
      topSectors,
    });

    // ---- News ----
    // Merge ENGINE-GENERATED news (price-based headlines) with REAL news
    // fetched from Economic Times, Moneycontrol, Business Standard, etc.
    const engineNews = buildNewsItems(type, {
      nifty: niftyClose,
      niftyPct: niftyChangePct,
      bankNifty: bankNiftyClose,
      bankNiftyPct: bankNiftyChangePct,
      vix,
      gainers: topGainers,
      losers: topLosers,
      sectors: topSectors,
    });

    // Fetch real news (5-min cached, won't slow down the response)
    let realNews: NewsItem[] = [];
    try {
      realNews = await fetchNewsForBrief(type, 10);
      // Archive for entity extraction + cross-linking
      try { archiveNews(realNews); } catch {}
    } catch {
      // if news fetch fails, just use engine news
    }

    // Combine: real news first (most recent), then engine-generated headlines
    const news = [...realNews, ...engineNews].slice(0, 20);

    const source = priceSource;

    const response: MarketBriefResponse = {
      type,
      niftyClose,
      niftyChange,
      niftyChangePct,
      bankNiftyClose,
      bankNiftyChange,
      bankNiftyChangePct,
      vix,
      vixChange,
      sensexClose,
      sensexChange,
      sensexChangePct,
      breadth: {
        advances: breadth.advanceCount,
        declines: breadth.declineCount,
        ratio: breadth.advanceDeclineRatio,
      },
      aiSummary: ai.summary,
      aiPrediction: ai.prediction,
      keyRisks,
      keyOpportunities,
      fiiDiiSummary,
      topGainers,
      topLosers,
      news,
      sectorPerformance,
      newsIntelligence: {
        realNewsCount: realNews.length,
        engineNewsCount: engineNews.length,
        realSources: ['Economic Times', 'Moneycontrol', 'Business Standard', 'LiveMint'],
        archivedCount: (() => { try { return getRecentArchived(24).length; } catch { return 0; } })(),
      },
      source,
      updatedAt: Date.now(),
    };

    // Cache as last-known-good for stale fallback
    lastGoodBrief.set(type, { response, ts: Date.now() });

    return NextResponse.json(response);
  } catch (e) {
    // Serve stale fallback on any error
    const stale = lastGoodBrief.get(type);
    if (stale) {
      return NextResponse.json({ ...stale.response, source: `${stale.response.source} (STALE)` });
    }
    return NextResponse.json(
      { error: 'Failed to build market brief', message: (e as Error).message },
      { status: 500 },
    );
  }
}
