/**
 * NSE India Proxy — Vercel Serverless Function
 *
 * Deploys to Vercel's Mumbai region (bom1) — an Indian IP that NSE doesn't geo-block.
 * ODSS calls this function, which fetches NSE data and relays it back.
 *
 * DEPLOYMENT (3 commands):
 *   1. npm i -g vercel           (install CLI)
 *   2. cd nse-proxy/vercel && vercel   (deploy)
 *   3. vercel env add NSE_PROXY_SECRET production  (set a secret)
 *
 * Then in ODSS Data Sources tab, paste the Vercel URL.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const NSE_BASE = 'https://www.nseindia.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let cachedCookies: string | null = null;
let cookieExpiry = 0;
const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 20;

async function getCookies(): Promise<string> {
  if (cachedCookies && Date.now() < cookieExpiry) return cachedCookies;
  const res = await fetch(NSE_BASE, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    cachedCookies = setCookies.map((c) => c.split(';')[0]).join('; ');
    cookieExpiry = Date.now() + 30 * 60 * 1000;
    return cachedCookies;
  }
  return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const proxySecret = process.env.NSE_PROXY_SECRET;
  if (proxySecret) {
    const provided = req.headers['x-proxy-secret'] as string;
    if (provided !== proxySecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 20 req/min.' });
  }
  requestTimestamps.push(now);

  const path = req.query.path as string;
  if (!path) {
    return res.status(400).json({ error: 'Missing path parameter. Usage: /?path=/api/option-chain-indices?symbol=NIFTY' });
  }
  if (!path.startsWith('/api/') && !path.startsWith('/market-data/')) {
    return res.status(403).json({ error: 'Only NSE API paths allowed' });
  }

  try {
    const cookies = await getCookies();
    const nseUrl = `${NSE_BASE}${path}`;
    const nseRes = await fetch(nseUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': cookies,
        'Referer': `${NSE_BASE}/`,
      },
    });
    if (!nseRes.ok) {
      return res.status(nseRes.status).json({ error: `NSE returned ${nseRes.status}` });
    }
    const data = await nseRes.json();
    res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=5');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
