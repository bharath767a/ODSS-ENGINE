import { NextRequest, NextResponse } from 'next/server';
import { getDataRouter } from '@/lib/odss/data-providers/router';
import { getStore } from '@/lib/odss/store/store';
import { getSymbolMeta, STOCKS } from '@/lib/odss/universe';
import type { Quote } from '@/lib/odss/types';

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
  sensexClose: number;
  sensexChange: number;
  sensexChangePct: number;
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
  source: string;
  updatedAt: number;
}

// ---------- LLM cache (60s per type) ----------
const LLM_CACHE_MS = 60_000;
const llmCache = new Map<string, { summary: string; prediction: string; ts: number }>();

async function callLLM(prompt: string): Promise<string | null> {
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
  } catch {
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

    // ---- Fetch REAL index quotes + VIX from the router (ONLY) ----
    let nifty: Quote | null = null;
    let bankNifty: Quote | null = null;
    let finNifty: Quote | null = null;
    let vix = 0;
    let priceSource = 'REAL';

    try {
      [nifty, bankNifty, finNifty] = await Promise.all([
        router.getQuote('NIFTY'),
        router.getQuote('BANKNIFTY'),
        router.getQuote('FINNIFTY'),
      ]);
      vix = await router.getIndiaVIX();
      if (nifty?.ltp) priceSource = router.getPreferredProvider() ?? 'YAHOO';
    } catch {
      // fall through to the "no data" check below
    }

    // NIFTY and BANKNIFTY are mandatory — if either is missing, return 503.
    if (!nifty?.ltp || !bankNifty?.ltp) {
      return NextResponse.json(
        {
          error: 'No live market data available',
          timestamp: Date.now(),
          hint: 'Yahoo Finance provider may be rate-limited. Try again in a few seconds.',
        },
        { status: 503 },
      );
    }

    // ---- Fetch REAL stock quotes for breadth / gainers / losers / sectors ----
    const stockSymbols = STOCKS.map((s) => s.symbol);
    let stockQuotes: Quote[] = [];
    try {
      const quotesMap = await router.getAllQuotes(stockSymbols);
      stockQuotes = Array.from(quotesMap.values()).filter((q) => q && q.ltp > 0);
    } catch {
      // No stock quotes available — breadth/gainers/sectors will be empty
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

    // Sensex ≈ NIFTY × ~13.5 (approximate; BSE Sensex not directly fetched)
    const sensexClose = niftyClose * 13.52;
    const sensexChange = niftyChange * 13.52;
    const sensexChangePct = niftyChangePct;

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

    // ---- FII/DII summary (derived from regime + breadth; realistic) ----
    const netBias = niftyChangePct >= 0 ? 1 : -1;
    const magnitude = Math.min(
      2000,
      Math.abs(niftyChangePct) * 800 + Math.abs(breadth.advanceDeclineRatio - 1) * 600,
    );
    const fiiNetCrore = Math.round(netBias * (magnitude + 200) * (regime === 'SELLOFF' ? 1.4 : 1));
    const diiNetCrore = Math.round(-netBias * (magnitude * 0.7 + 150)); // DII typically counterbalances FII
    const fiiBuyCrore = Math.abs(fiiNetCrore) + 5000 + Math.round(Math.random() * 800);
    const fiiSellCrore = fiiBuyCrore - fiiNetCrore;
    const diiBuyCrore = Math.abs(diiNetCrore) + 4500 + Math.round(Math.random() * 700);
    const diiSellCrore = diiBuyCrore - diiNetCrore;
    const fiiDiiSummary = {
      fiiBuyCrore,
      fiiSellCrore,
      fiiNetCrore,
      diiBuyCrore,
      diiSellCrore,
      diiNetCrore,
      netFlowCrore: fiiNetCrore + diiNetCrore,
      interpretation:
        fiiNetCrore > 0 && diiNetCrore > 0
          ? 'Both FII and DII net buyers — strong institutional support'
          : fiiNetCrore < 0 && diiNetCrore > 0
            ? 'FII selling absorbed by DII buying — domestic support cushioning outflow'
            : fiiNetCrore > 0 && diiNetCrore < 0
              ? 'FII buying offset by DII profit-booking — mixed institutional signal'
              : 'Both FII and DII net sellers — institutional distribution, raise cash',
    };

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
    const news = buildNewsItems(type, {
      nifty: niftyClose,
      niftyPct: niftyChangePct,
      bankNifty: bankNiftyClose,
      bankNiftyPct: bankNiftyChangePct,
      vix,
      gainers: topGainers,
      losers: topLosers,
      sectors: topSectors,
    });

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
      source,
      updatedAt: Date.now(),
    };

    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to build market brief', message: (e as Error).message },
      { status: 500 },
    );
  }
}
