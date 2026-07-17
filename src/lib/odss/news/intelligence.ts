/**
 * ODSS - News Intelligence Engine
 * Deep AI analysis: cross-links stories, assesses sector/stock impact,
 * differentiates intraday vs swing, identifies the key narrative.
 */
import { fetchNewsForBrief } from './news-fetcher';
import { archiveNews, findRelatedNews, getTrendingEntities, getRecentArchived } from './archive';
import type { NewsItem } from './types';

export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface SectorImpact { sector: string; direction: 'BULLISH'|'BEARISH'|'NEUTRAL'; magnitude: 'HIGH'|'MEDIUM'|'LOW'; reasoning: string; }
export interface StockImpact { symbol: string; direction: 'BULLISH'|'BEARISH'|'NEUTRAL'; magnitude: 'HIGH'|'MEDIUM'|'LOW'; timeHorizon: 'INTRADAY'|'SWING'|'POSITIONAL'; reasoning: string; }
export interface CrossLink { currentHeadline: string; linkedHeadline: string; connection: string; }

export interface NewsIntelligence {
  marketSentiment: 'BULLISH'|'BEARISH'|'NEUTRAL';
  sentimentReasoning: string;
  sectorImpacts: SectorImpact[];
  stockImpacts: StockImpact[];
  crossLinks: CrossLink[];
  intradayOutlook: string;
  swingOutlook: string;
  keyNarrative: string;
  analyzedAt: number;
  newsCount: number;
  archiveCount: number;
}

const LLM_CACHE_MS = 10 * 60 * 1000;
const intelligenceCache = new Map<string, { data: NewsIntelligence; ts: number }>();
const inFlight = new Map<string, Promise<NewsIntelligence>>();
let llmCooldownUntil = 0;

async function callLLM(prompt: string): Promise<string | null> {
  if (Date.now() < llmCooldownUntil) return null;
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: `You are ODSS Intelligence, an expert Indian market news analyst. Analyze real-time news from Economic Times, Moneycontrol, Business Standard, LiveMint. Understand HOW news affects market sentiment, sectors, and stocks. CROSS-LINK stories. Differentiate INTRADAY vs SWING impact. Respond in STRICT JSON only.` },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    });
    return completion.choices[0]?.message?.content ?? null;
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    if (msg.includes('429') || msg.includes('Too many requests')) llmCooldownUntil = Date.now() + 5 * 60_000;
    return null;
  }
}

export async function generateNewsIntelligence(briefType: 'pre'|'intraday'|'post'): Promise<NewsIntelligence> {
  const cached = intelligenceCache.get(briefType);
  if (cached && Date.now() - cached.ts < LLM_CACHE_MS) return cached.data;
  const existing = inFlight.get(briefType);
  if (existing) return existing;

  const promise = (async (): Promise<NewsIntelligence> => {
    const currentNews = await fetchNewsForBrief(briefType, 15);
    archiveNews(currentNews);
    if (currentNews.length === 0) return fallbackIntelligence(briefType, 0);

    // Cross-links
    const topHeadlines = currentNews.slice(0, 8);
    const crossLinks: any[] = [];
    for (const news of topHeadlines) {
      const related = findRelatedNews(news, 48, 3);
      if (related.length > 0) crossLinks.push({ current: news, related });
    }

    const trending = getTrendingEntities(12);
    const recentArchive = getRecentArchived(24).slice(0, 10);

    const prompt = buildPrompt(briefType, currentNews, crossLinks, trending, recentArchive);
    const llmResult = await callLLM(prompt);
    let intelligence: NewsIntelligence;
    if (llmResult) intelligence = parseIntelligence(llmResult, briefType, currentNews.length);
    else intelligence = fallbackIntelligence(briefType, currentNews.length);

    intelligenceCache.set(briefType, { data: intelligence, ts: Date.now() });
    return intelligence;
  })();

  inFlight.set(briefType, promise);
  try { return await promise; } finally { inFlight.delete(briefType); }
}

function buildPrompt(briefType: string, currentNews: NewsItem[], crossLinks: any[], trending: any, recentArchive: any[]): string {
  const phase = briefType === 'pre' ? 'PRE-MARKET' : briefType === 'intraday' ? 'INTRADAY' : 'POST-MARKET';
  const headlines = currentNews.map((n, i) => `${i+1}. (${n.source}, ${n.sentiment}) ${n.title}`).join('\n');
  let crossSection = '';
  if (crossLinks.length > 0) {
    crossSection = '\n\nCROSS-LINKED STORIES:\n';
    for (const cl of crossLinks.slice(0, 5)) {
      crossSection += `\nCURRENT: "${cl.current.title}"\n`;
      for (const r of cl.related) { const age = Math.round((Date.now()-r.timestamp)/3600000); crossSection += `  → LINKED (${age}h ago): "${r.title}"\n`; }
    }
  }
  let trendingSection = '';
  if (trending.stocks?.length > 0 || trending.sectors?.length > 0) {
    trendingSection = '\n\nTRENDING (last 12h):\n';
    if (trending.stocks?.length) trendingSection += `Stocks: ${trending.stocks.map((s:any)=>`${s.symbol}(${s.count})`).join(', ')}\n`;
    if (trending.sectors?.length) trendingSection += `Sectors: ${trending.sectors.map((s:any)=>`${s.sector}(${s.count})`).join(', ')}\n`;
  }
  return `Analyze Indian market news for ${phase}:\n\n${headlines}${crossSection}${trendingSection}\n\nProduce JSON:\n{"marketSentiment":"BULLISH|BEARISH|NEUTRAL","sentimentReasoning":"2-3 sentences","sectorImpacts":[{"sector":"","direction":"BULLISH|BEARISH|NEUTRAL","magnitude":"HIGH|MEDIUM|LOW","reasoning":"1 sentence"}],"stockImpacts":[{"symbol":"","direction":"BULLISH|BEARISH|NEUTRAL","magnitude":"HIGH|MEDIUM|LOW","timeHorizon":"INTRADAY|SWING|POSITIONAL","reasoning":"1 sentence"}],"crossLinks":[{"currentHeadline":"","linkedHeadline":"","connection":"1 sentence"}],"intradayOutlook":"2-3 sentences","swingOutlook":"2-3 sentences","keyNarrative":"The overarching story"}`;
}

function parseIntelligence(raw: string, briefType: string, newsCount: number): NewsIntelligence {
  try {
    const data = JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim());
    let archiveCount = 0; try { archiveCount = getRecentArchived(24).length; } catch {}
    return {
      marketSentiment: data.marketSentiment || 'NEUTRAL',
      sentimentReasoning: data.sentimentReasoning || 'Unable to determine.',
      sectorImpacts: Array.isArray(data.sectorImpacts) ? data.sectorImpacts.slice(0, 6) : [],
      stockImpacts: Array.isArray(data.stockImpacts) ? data.stockImpacts.slice(0, 8) : [],
      crossLinks: Array.isArray(data.crossLinks) ? data.crossLinks.slice(0, 5) : [],
      intradayOutlook: data.intradayOutlook || 'No specific signal.',
      swingOutlook: data.swingOutlook || 'No specific signal.',
      keyNarrative: data.keyNarrative || 'No clear narrative.',
      analyzedAt: Date.now(), newsCount, archiveCount,
    };
  } catch { return fallbackIntelligence(briefType as any, newsCount); }
}

function fallbackIntelligence(briefType: 'pre'|'intraday'|'post', newsCount: number): NewsIntelligence {
  try {
    const recent = getRecentArchived(12);
    const trending = getTrendingEntities(12);
    const posCount = recent.filter((r:any)=>r.sentiment==='POSITIVE').length;
    const negCount = recent.filter((r:any)=>r.sentiment==='NEGATIVE').length;
    const marketSentiment = posCount > negCount * 1.5 ? 'BULLISH' : negCount > posCount * 1.5 ? 'BEARISH' : 'NEUTRAL';
    const sectorImpacts = trending.sectors.slice(0,5).map((s:any) => {
      const sn = recent.filter((r:any)=>r.entities?.sectors?.includes(s.sector));
      const pos = sn.filter((r:any)=>r.sentiment==='POSITIVE').length;
      const neg = sn.filter((r:any)=>r.sentiment==='NEGATIVE').length;
      return { sector: s.sector, direction: pos>neg?'BULLISH':neg>pos?'BEARISH':'NEUTRAL' as any, magnitude: s.count>=5?'HIGH':s.count>=3?'MEDIUM':'LOW' as any, reasoning: `${s.count} stories. ${pos} pos, ${neg} neg.` };
    });
    const stockImpacts = trending.stocks.slice(0,6).map((s:any) => {
      const sn = recent.filter((r:any)=>r.entities?.stocks?.includes(s.symbol));
      const pos = sn.filter((r:any)=>r.sentiment==='POSITIVE').length;
      const neg = sn.filter((r:any)=>r.sentiment==='NEGATIVE').length;
      const events = sn.flatMap((r:any)=>r.entities?.eventTypes||[]);
      const timeHorizon = events.includes('POLICY')||events.includes('M&A')?'POSITIONAL':events.includes('EARNINGS')||events.includes('GUIDANCE')?'SWING':'INTRADAY';
      return { symbol: s.symbol, direction: pos>neg?'BULLISH':neg>pos?'BEARISH':'NEUTRAL' as any, magnitude: s.count>=4?'HIGH':s.count>=2?'MEDIUM':'LOW' as any, timeHorizon: timeHorizon as any, reasoning: `${s.count} stories. ${pos} pos, ${neg} neg.` };
    });
    const crossLinks: any[] = [];
    for (const news of recent.slice(0,5)) { const related = findRelatedNews(news, 24, 2); for (const r of related) { if (crossLinks.length>=3) break; const shared = [...(news.entities?.stocks||[]).filter((s:string)=>r.entities.stocks.includes(s)), ...(news.entities?.sectors||[]).filter((s:string)=>r.entities.sectors.includes(s))]; crossLinks.push({ currentHeadline: news.title, linkedHeadline: r.title, connection: `Shared: ${shared.join(', ')||'general topic'}` }); } }
    const topSector = trending.sectors[0]; const topStock = trending.stocks[0]; const topEvent = trending.eventTypes[0];
    let archiveCount = 0; try { archiveCount = recent.length; } catch {}
    return {
      marketSentiment, sentimentReasoning: `Based on ${recent.length} archived stories: ${posCount} positive, ${negCount} negative. Entity-based fallback (AI will refresh when rate limit clears).`,
      sectorImpacts, stockImpacts, crossLinks,
      intradayOutlook: `${marketSentiment==='BULLISH'?'Positive news supports intraday longs':marketSentiment==='BEARISH'?'Negative news suggests caution':'Mixed news — range-bound'}. Watch ${topSector?.sector||'broad market'}.`,
      swingOutlook: `${topEvent?.type||'Current themes'} may drive ${topStock?.symbol||'sector'} moves over 2-5 sessions.`,
      keyNarrative: recent.length > 0 ? `Market digesting ${recent.length} stories. Focus on ${topSector?.sector||''} sector${topStock?`, ${topStock.symbol} stock-specific`:''}. Sentiment leans ${marketSentiment.toLowerCase()}.` : 'Limited news flow.',
      analyzedAt: Date.now(), newsCount, archiveCount,
    };
  } catch {
    let archiveCount = 0; try { archiveCount = getRecentArchived(24).length; } catch {}
    return { marketSentiment: 'NEUTRAL', sentimentReasoning: 'News analysis unavailable.', sectorImpacts: [], stockImpacts: [], crossLinks: [], intradayOutlook: 'Monitor headlines.', swingOutlook: 'Monitor developments.', keyNarrative: 'Analysis pending.', analyzedAt: Date.now(), newsCount, archiveCount };
  }
}
