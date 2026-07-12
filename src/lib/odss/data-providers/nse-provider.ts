/**
 * ODSS - NSE India Public Data Provider
 *
 * Pulls REAL market data directly from NSE India's public API.
 * No credentials required. No account needed.
 *
 * Limitations:
 *   - Rate limited (~20 req/min before NSE blocks temporarily)
 *   - No WebSocket (polling only)
 *   - Unofficial endpoints (can change, but stable for years)
 *
 * Data available:
 *   - Real quotes (LTP, OHLC, volume) for all NSE stocks + indices
 *   - Real option chains (OI, OI change, IV, LTP, bid/ask, volume)
 *   - Real India VIX
 *   - Real market breadth
 *
 * The provider manages cookies (NSE requires a session cookie from
 * the homepage before API calls work) and caches responses aggressively
 * to stay within rate limits.
 */
import type { Provider, ProviderHealth, ProviderName } from './types';
import { rateLimiter } from './types';
import type { Quote, OptionChain, OptionRow, Candle, Moneyness, OptionType } from '../types';
import { getSymbolMeta, ALL_SYMBOLS, roundToStrike, getThursdayExpiry } from '../universe';

// NSE symbol mapping (some symbols differ from our internal names)
const NSE_SYMBOL_MAP: Record<string, string> = {
  'M&M': 'M&M',
  'NIFTY': 'NIFTY',
  'BANKNIFTY': 'BANKNIFTY',
  'FINNIFTY': 'FINNIFTY',
  'MIDCPNIFTY': 'NIFTY%20MIDCAP%20SELECT',
};

function toNseSymbol(symbol: string): string {
  return NSE_SYMBOL_MAP[symbol] ?? symbol;
}

const NSE_BASE = 'https://www.nseindia.com';
const NSE_API = 'https://www.nseindia.com/api';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class NSEProvider implements Provider {
  name: ProviderName = 'NSE';
  private cookies: string | null = null;
  private cookieExpiry = 0;
  private cache = new Map<string, CacheEntry<any>>();
  private health: ProviderHealth = {
    name: 'NSE',
    status: 'ACTIVE',
    lastSuccess: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
    rateLimitUntil: null,
  };

  private readonly QUOTE_TTL = 3000;      // 3 seconds for quotes
  private readonly CHAIN_TTL = 10000;     // 10 seconds for option chains
  private readonly VIX_TTL = 5000;        // 5 seconds for VIX

  isConfigured(): boolean {
    return true; // NSE is always "configured" — no credentials needed
  }

  private async fetchWithCookies(url: string, retries = 2): Promise<any> {
    // Check rate limit
    if (!rateLimiter.canCall('NSE')) {
      throw new Error('NSE rate limit reached');
    }

    // Ensure we have cookies (NSE requires a session cookie)
    if (!this.cookies || Date.now() > this.cookieExpiry) {
      await this.refreshCookies();
    }

    rateLimiter.recordCall('NSE');
    this.health.callCount++;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': this.cookies ?? '',
            'Referer': NSE_BASE + '/',
          },
        });

        if (res.status === 429 || res.status === 403) {
          // Rate limited — block for 30 seconds
          rateLimiter.blockFor('NSE', 30000);
          this.health.rateLimitUntil = Date.now() + 30000;
          this.health.status = 'RATE_LIMITED';
          throw new Error(`NSE returned ${res.status} — rate limited`);
        }

        if (!res.ok) {
          throw new Error(`NSE HTTP ${res.status}`);
        }

        const data = await res.json();
        this.health.lastSuccess = Date.now();
        this.health.status = 'ACTIVE';
        this.health.lastError = null;
        return data;
      } catch (e) {
        if (attempt < retries) {
          // Wait and retry with fresh cookies
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          await this.refreshCookies();
          continue;
        }
        this.health.errorCount++;
        this.health.lastError = (e as Error).message;
        this.health.status = 'ERROR';
        throw e;
      }
    }
  }

  private async refreshCookies(): Promise<void> {
    try {
      const res = await fetch(NSE_BASE, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const setCookies = res.headers.get('set-cookie');
      if (setCookies) {
        // Parse cookies — NSE sends multiple Set-Cookie headers
        const cookies = setCookies.split(',').map((c) => c.split(';')[0].trim()).filter(Boolean);
        this.cookies = cookies.join('; ');
        this.cookieExpiry = Date.now() + 30 * 60 * 1000; // 30 min
      }
    } catch (e) {
      // If cookie refresh fails, continue without cookies (some endpoints still work)
    }
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      return entry.data;
    }
    return null;
  }

  private setCache<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, { data, timestamp: Date.now(), ttl });
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const meta = getSymbolMeta(symbol);
    if (!meta) return null;

    const cacheKey = `quote:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) return cached;

    try {
      // For indices, use the index quote endpoint
      const isIndex = meta.type === 'INDEX';
      const nseSym = toNseSymbol(symbol);
      const endpoint = isIndex
        ? `${NSE_API}/quote-derivative?symbol=${encodeURIComponent(nseSym)}&identifier=${encodeURIComponent(nseSym)}`
        : `${NSE_API}/quote-equity?symbol=${encodeURIComponent(nseSym)}`;

      const data = await this.fetchWithCookies(endpoint);

      // Parse NSE response into our Quote format
      const priceInfo = isIndex ? data?.priceInfo ?? data?.data?.priceInfo : data?.priceInfo;
      if (!priceInfo) return null;

      const ltp = priceInfo.lastPrice ?? 0;
      const prevClose = priceInfo.previousClose ?? priceInfo.close ?? ltp;
      const open = priceInfo.open ?? ltp;
      const high = priceInfo.intraDayHighLow?.high ?? priceInfo.weekHighLow?.high ?? ltp;
      const low = priceInfo.intraDayHighLow?.low ?? priceInfo.weekHighLow?.low ?? ltp;
      const volume = data?.securityWiseDP?.quantityTraded ?? data?.marketDeptOrderBook?.totalBuyQuantity ?? 0;
      const changePct = priceInfo.pChange ?? ((ltp - prevClose) / prevClose) * 100;

      // Build a synthetic VWAP (NSE doesn't always provide it in the quote endpoint)
      const vwap = priceInfo.vwap ?? ((high + low + ltp) / 3);

      // We don't have intraday candles from this endpoint, so create a minimal candle
      const candle: Candle = {
        timestamp: Date.now(),
        open,
        high,
        low,
        close: ltp,
        volume,
      };

      const quote: Quote = {
        symbol,
        sector: meta.sector,
        ltp,
        prevClose,
        open,
        high,
        low,
        dayHigh: high,
        dayLow: low,
        volume,
        vwap,
        changePct,
        candles: [candle], // NSE quote endpoint doesn't give full candle history
        timestamp: Date.now(),
      };

      this.setCache(cacheKey, quote, this.QUOTE_TTL);
      return quote;
    } catch (e) {
      return null;
    }
  }

  async getAllQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const results = new Map<string, Quote>();
    // Fetch sequentially to respect rate limits (NSE is strict)
    for (const sym of symbols) {
      const q = await this.getQuote(sym);
      if (q) results.set(sym, q);
      // Small delay between calls
      await new Promise((r) => setTimeout(r, 150));
    }
    return results;
  }

  async getOptionChain(symbol: string): Promise<OptionChain | null> {
    const meta = getSymbolMeta(symbol);
    if (!meta) return null;

    const cacheKey = `chain:${symbol}`;
    const cached = this.getCached<OptionChain>(cacheKey);
    if (cached) return cached;

    try {
      const nseSym = toNseSymbol(symbol);
      const isIndex = meta.type === 'INDEX';
      const endpoint = isIndex
        ? `${NSE_API}/option-chain-indices?symbol=${encodeURIComponent(nseSym)}`
        : `${NSE_API}/option-chain-equities?symbol=${encodeURIComponent(nseSym)}`;

      const data = await this.fetchWithCookies(endpoint);
      const records = data?.records ?? [];
      if (records.length === 0) return null;

      const spot = data?.records?.[0]?.CE?.underlyingValue ?? data?.records?.[0]?.PE?.underlyingValue ?? 0;
      const atmStrike = roundToStrike(spot, meta.strikeStep);
      const expiry = data?.records?.[0]?.expiryDate ?? getThursdayExpiry(0);

      const strikes: OptionRow[] = [];
      let totalCallOI = 0, totalPutOI = 0, totalCallOIChange = 0, totalPutOIChange = 0;

      for (const rec of records) {
        const strikePrice = rec.strikePrice;
        for (const type of ['CE', 'PE'] as OptionType[]) {
          const opt = rec[type];
          if (!opt) continue;

          const moneyness: Moneyness =
            Math.abs(strikePrice - spot) < meta.strikeStep / 2
              ? 'ATM'
              : (type === 'CE' && strikePrice < spot) || (type === 'PE' && strikePrice > spot)
              ? 'ITM'
              : 'OTM';

          const oi = opt.openInterest ?? 0;
          const oiChange = opt.changeinOpenInterest ?? 0;
          totalCallOI += type === 'CE' ? oi : 0;
          totalPutOI += type === 'PE' ? oi : 0;
          totalCallOIChange += type === 'CE' ? oiChange : 0;
          totalPutOIChange += type === 'PE' ? oiChange : 0;

          strikes.push({
            strike: strikePrice,
            type,
            ltp: opt.lastPrice ?? 0,
            bid: opt.bidPrice ?? (opt.lastPrice ?? 0) * 0.99,
            ask: opt.askPrice ?? (opt.lastPrice ?? 0) * 1.01,
            iv: opt.impliedVolatility ?? 0,
            volume: opt.totalTradedVolume ?? 0,
            oi,
            oiChange,
            // NSE doesn't provide greeks in this endpoint — we compute them
            delta: 0, gamma: 0, theta: 0, vega: 0,
            moneyness,
          });
        }
      }

      // Compute greeks for each strike using Black-Scholes (since NSE doesn't provide them)
      const { blackScholes } = await import('../simulator/greeks');
      const T = Math.max((new Date(expiry).getTime() - Date.now()) / (365 * 24 * 60 * 60 * 1000), 1 / 365);
      const r = 0.07;
      for (const row of strikes) {
        const bs = blackScholes({
          S: spot,
          K: row.strike,
          T,
          r,
          sigma: row.iv / 100,
          type: row.type,
        });
        row.delta = bs.delta;
        row.gamma = bs.gamma;
        row.theta = bs.theta;
        row.vega = bs.vega;
      }

      const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;

      // Max pain calculation
      let maxPainStrike = atmStrike;
      let minPain = Infinity;
      const allStrikes = [...new Set(strikes.map((s) => s.strike))].sort((a, b) => a - b);
      for (const testStrike of allStrikes) {
        let pain = 0;
        for (const row of strikes) {
          if (row.type === 'CE') pain += Math.max(testStrike - row.strike, 0) * row.oi;
          else pain += Math.max(row.strike - testStrike, 0) * row.oi;
        }
        if (pain < minPain) {
          minPain = pain;
          maxPainStrike = testStrike;
        }
      }

      const chain: OptionChain = {
        symbol,
        expiry,
        spot,
        atmStrike,
        strikes,
        pcr,
        maxPainStrike,
        totalCallOI,
        totalPutOI,
        totalCallOIChange,
        totalPutOIChange,
        timestamp: Date.now(),
      };

      this.setCache(cacheKey, chain, this.CHAIN_TTL);
      return chain;
    } catch (e) {
      return null;
    }
  }

  async getIndiaVIX(): Promise<number> {
    const cached = this.getCached<number>('vix');
    if (cached !== null) return cached;

    try {
      const data = await this.fetchWithCookies(`${NSE_API}/allIndices`);
      const vixData = data?.data?.find((d: any) => d.index === 'INDIA VIX');
      const vix = vixData?.last ?? 15; // fallback to 15 if not found
      this.setCache('vix', vix, this.VIX_TTL);
      return vix;
    } catch {
      return 15; // fallback
    }
  }

  async getMarketBreadth(): Promise<{ advanceCount: number; declineCount: number; advanceDeclineRatio: number }> {
    try {
      const data = await this.fetchWithCookies(`${NSE_API}/market-status`);
      const advDecl = data?.marketStatus?.[0]?.advDec ?? data?.data?.advDec;
      if (advDecl) {
        const advances = advDecl.advances ?? 0;
        const declines = advDecl.declines ?? 0;
        return {
          advanceCount: advances,
          declineCount: declines,
          advanceDeclineRatio: declines > 0 ? advances / declines : advances,
        };
      }
    } catch {}
    // Fallback
    return { advanceCount: 0, declineCount: 0, advanceDeclineRatio: 1 };
  }

  getHealth(): ProviderHealth {
    if (rateLimiter.isBlocked('NSE') && this.health.status === 'ACTIVE') {
      this.health.status = 'RATE_LIMITED';
    } else if (!rateLimiter.isBlocked('NSE') && this.health.status === 'RATE_LIMITED') {
      this.health.status = 'ACTIVE';
    }
    return { ...this.health };
  }
}
