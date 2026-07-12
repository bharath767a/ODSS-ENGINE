/**
 * NSE India Proxy — Cloudflare Worker
 *
 * Cloudflare has edge locations in Mumbai, Chennai, Bangalore, Delhi.
 * This worker fetches NSE data from an Indian edge and relays it to ODSS.
 *
 * DEPLOYMENT (3 steps):
 *   1. Create a free account at https://dash.cloudflare.com
 *   2. Go to Workers & Pages → Create → Worker
 *   3. Paste this entire file into the editor → Deploy
 *
 * Then in ODSS Data Sources tab, paste the Worker URL:
 *   https://odss-nse-proxy.<your-subdomain>.workers.dev
 *
 * Optional: Add a secret to protect the proxy:
 *   In Cloudflare dashboard → Settings → Variables → Add NSE_PROXY_SECRET
 */

const NSE_BASE = 'https://www.nseindia.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cookie cache (per worker isolate)
let cachedCookies = null;
let cookieExpiry = 0;

async function getCookies() {
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

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
        },
      });
    }

    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Verify proxy secret (if configured)
    const proxySecret = env?.NSE_PROXY_SECRET;
    if (proxySecret) {
      const provided = request.headers.get('X-Proxy-Secret');
      if (provided !== proxySecret) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    if (!path) {
      return Response.json({
        error: 'Missing path parameter',
        usage: '/?path=/api/option-chain-indices?symbol=NIFTY',
      }, { status: 400 });
    }

    if (!path.startsWith('/api/') && !path.startsWith('/market-data/')) {
      return Response.json({ error: 'Only NSE API paths allowed' }, { status: 403 });
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
        return Response.json({ error: `NSE returned ${nseRes.status}` }, { status: nseRes.status });
      }

      const data = await nseRes.json();
      return Response.json(data, {
        headers: {
          'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  },
};
