/**
 * ODSS - Real News Fetcher
 * Fetches REAL market news from Indian financial RSS feeds.
 */
import type { Sentiment, NewsItem } from './types';

const RSS_SOURCES = [
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', category: 'Market' },
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/stocks/rssfeeds/2143740214.cms', category: 'Stocks' },
  { name: 'Moneycontrol', url: 'https://www.moneycontrol.com/rss/marketpulse.xml', category: 'Market' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', category: 'Market' },
  { name: 'LiveMint', url: 'https://www.livemint.com/rss/markets', category: 'Market' },
];

const NEWS_CACHE_MS = 5 * 60 * 1000;
let newsCache: { items: NewsItem[]; ts: number } | null = null;
let fetchInFlight: Promise<NewsItem[]> | null = null;

function analyzeSentiment(title: string): Sentiment {
  const u = title.toUpperCase();
  const pos = ['SURGE','JUMP','RALLY','GAIN','RISE','UP','HIGH','BEAT','PROFIT','GROWTH','BUY','BULLISH','RECORD','STRONG','BOOST','POSITIVE'];
  const neg = ['FALL','DROP','DECLINE','LOSS','DOWN','LOW','MISS','SELL','BEARISH','CRASH','WEAK','SLUMP','PLUNGE','TUMBLE','NEGATIVE','RISK','WARNING','CONCERN'];
  let p = 0, n = 0;
  for (const w of pos) if (u.includes(w)) p++;
  for (const w of neg) if (u.includes(w)) n++;
  return p > n ? 'POSITIVE' : n > p ? 'NEGATIVE' : 'NEUTRAL';
}

function parseRSS(xml: string, source: string, category: string): NewsItem[] {
  const items: NewsItem[] = [];
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const m of matches) {
    try {
      const tm = m.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || m.match(/<title>([\s\S]*?)<\/title>/i);
      const lm = m.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/i) || m.match(/<link>([\s\S]*?)<\/link>/i);
      const dm = m.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      if (!tm) continue;
      const title = tm[1].trim().replace(/&amp;/g,'&').replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'');
      const link = lm ? lm[1].trim().replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'') : '';
      const ts = dm ? new Date(dm[1].trim()).getTime() : Date.now();
      if (Date.now() - ts > 24*60*60*1000) continue;
      items.push({ id: `${source}-${ts}-${title.substring(0,30)}`, title, source, sentiment: analyzeSentiment(title), link, timestamp: ts, category });
    } catch {}
  }
  return items;
}

async function fetchRSS(source: any): Promise<NewsItem[]> {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    return parseRSS(await res.text(), source.name, source.category);
  } catch { return []; }
}

export async function fetchRealNews(maxItems: number = 50): Promise<NewsItem[]> {
  if (newsCache && Date.now() - newsCache.ts < NEWS_CACHE_MS) return newsCache.items.slice(0, maxItems);
  if (fetchInFlight) return fetchInFlight.then(items => items.slice(0, maxItems));
  fetchInFlight = (async () => {
    const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchRSS(s)));
    const all: NewsItem[] = [];
    for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
    const seen = new Set<string>(); const deduped: NewsItem[] = [];
    for (const item of all) { const key = item.title.toLowerCase().substring(0,60); if (!seen.has(key)) { seen.add(key); deduped.push(item); } }
    deduped.sort((a,b) => b.timestamp - a.timestamp);
    newsCache = { items: deduped, ts: Date.now() }; fetchInFlight = null;
    return deduped;
  })();
  return fetchInFlight.then(items => items.slice(0, maxItems));
}

export async function fetchNewsForBrief(briefType: 'pre'|'intraday'|'post', maxItems: number = 15): Promise<NewsItem[]> {
  const all = await fetchRealNews(100);
  const now = Date.now();
  const window = briefType === 'pre' ? 12*60*60*1000 : briefType === 'intraday' ? 2*60*60*1000 : 4*60*60*1000;
  return all.filter(n => now - n.timestamp < window).slice(0, maxItems);
}

export async function fetchBreakingNews(maxItems: number = 5): Promise<NewsItem[]> {
  const all = await fetchRealNews(50);
  const now = Date.now();
  return all.filter(n => now - n.timestamp < 30*60*1000).slice(0, maxItems);
}
