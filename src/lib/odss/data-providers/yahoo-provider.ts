/**
 * ODSS - Yahoo Finance Data Provider
 *
 * Yahoo Finance is a FREE, public, no-key source of REAL Indian market data.
 * Verified working symbols:
 *
 *   ^NSEI        → NIFTY 50
 *   ^BSESN       → SENSEX
 *   ^INDIAVIX    → India VIX
 *   ^NSEBANK     → NIFTY BANK
 *   ^CNXFIN      → NIFTY FIN SERVICE (FINNIFTY equivalent)
 *   RELIANCE.NS, TCS.NS, INFY.NS, ... → individual stocks
 *
 * Yahoo does NOT provide Indian option chains — for those, NSE direct is
 * the only free source (needs Mumbai proxy).
 *
 * Yahoo chart API URL format:
 *   https://query2.finance.yahoo.com/v8/finance/chart/{SYMBOL}
 *     ?interval={1d|1mo|1wk}
 *     &range={1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|ytd|max}
 */
import type { Provider, ProviderHealth, ProviderName } from './types';
import { rateLimiter } from './types';
import type { Quote, OptionChain, Candle } from '../types';
import { getSymbolMeta } from '../universe';

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  NIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  FINNIFTY: '^CNXFIN',
  SENSEX: '^BSESN',
  INDIA_VIX: '^INDIAVIX',
};

function toYahooSymbol(symbol: string): string | null {
  if (YAHOO_SYMBOL_MAP[symbol]) return YAHOO_SYMBOL_MAP[symbol];
  const meta = getSymbolMeta(symbol);
  if (meta?.type === 'STOCK') {
    return `${symbol.replace(/&/g, '%26')}.NS`;
  }
  return null;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class YahooProvider implements Provider {
  name: ProviderName = 'YAHOO';
  private cache = new Map<string, CacheEntry<any>>();
  private health: ProviderHealth = {
    name: 'YAHOO',
    status: 'ACTIVE',
    lastSuccess: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
    rateLimitUntil: null,
  };

  private readonly QUOTE_TTL = 4000;      // 4 seconds
  private readonly VIX_TTL = 5000;        // 5 seconds
  private readonly HISTORY_TTL = 300_000; // 5 minutes

  isConfigured(): boolean {
    return true;
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

  private async fetchYahooChart(yahooSymbol: string, range = '1d', interval = '1m'): Promise<any | null> {
    if (!rateLimiter.canCall('YAHOO')) {
      throw new Error('YAHOO rate limit reached');
    }
    rateLimiter.recordCall('YAHOO');
    this.health.callCount++;

    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
          },
        });

        if (res.status === 429 || res.status === 503) {
          rateLimiter.blockFor('YAHOO', 10000);
          this.health.rateLimitUntil = Date.now() + 10000;
          this.health.status = 'RATE_LIMITED';
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw new Error(`Yahoo ${res.status} rate limited`);
        }

        if (!res.ok) {
          throw new Error(`Yahoo HTTP ${res.status}`);
        }

        const data = await res.json();
        this.health.lastSuccess = Date.now();
        this.health.status = 'ACTIVE';
        this.health.lastError = null;
        return data;
      } catch (e) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        this.health.errorCount++;
        this.health.lastError = (e as Error).message;
        this.health.status = 'ERROR';
        return null;
      }
    }
    return null;
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const meta = getSymbolMeta(symbol);
    if (!meta) return null;

    const cacheKey = `quote:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) return cached;

    const yahooSymbol = toYahooSymbol(symbol);
    if (!yahooSymbol) return null;

    const data = await this.fetchYahooChart(yahooSymbol, '1d', '1m');
    if (!data?.chart?.result?.[0]) return null;

    const result = data.chart.result[0];
    const meta2 = result.meta || {};
    const indicators = result.indicators?.quote?.[0] || {};

    const ltp = meta2.regularMarketPrice ?? meta2.previousClose ?? 0;
    const prevClose = meta2.chartPreviousClose ?? meta2.previousClose ?? ltp;
    const open = meta2.regularMarketDayHigh ? (indicators.open?.find((v: number | null) => v != null) ?? ltp) : ltp;
    const high = meta2.regularMarketDayHigh ?? Math.max(...(indicators.high || []).filter((v: number | null) => v != null), ltp);
    const low = meta2.regularMarketDayLow ?? Math.min(...(indicators.low || []).filter((v: number | null) => v != null), ltp);
    const volume = (indicators.volume || []).reduce((a: number, b: number | null) => a + (b ?? 0), 0);
    const changePct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0;

    // Build candles from intraday data
    const timestamps = result.timestamp || [];
    const closes = indicators.close || [];
    const opens = indicators.open || [];
    const highs = indicators.high || [];
    const lows = indicators.low || [];
    const volumes = indicators.volume || [];
    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      candles.push({
        timestamp: timestamps[i] * 1000,
        open: opens[i] ?? closes[i],
        high: highs[i] ?? closes[i],
        low: lows[i] ?? closes[i],
        close: closes[i],
        volume: volumes[i] ?? 0,
      });
    }

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
      vwap: (high + low + ltp) / 3,
      changePct,
      candles: candles.length > 0 ? candles : [{
        timestamp: Date.now(),
        open, high, low, close: ltp, volume,
      }],
      timestamp: Date.now(),
    };

    this.setCache(cacheKey, quote, this.QUOTE_TTL);
    return quote;
  }

  async getAllQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const results = new Map<string, Quote>();
    // Fetch in parallel batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async (sym) => {
          const q = await this.getQuote(sym);
          if (q) results.set(sym, q);
        }),
      );
    }
    return results;
  }

  async getOptionChain(_symbol: string): Promise<OptionChain | null> {
    // Yahoo does NOT provide Indian option chains
    return null;
  }

  async getIndiaVIX(): Promise<number> {
    const cached = this.getCached<number>('vix');
    if (cached !== null) return cached;

    const data = await this.fetchYahooChart('^INDIAVIX', '1d', '1m');
    if (!data?.chart?.result?.[0]?.meta) return 0;

    const vix = data.chart.result[0].meta.regularMarketPrice ?? 0;
    if (vix > 0 && vix < 200) {
      this.setCache('vix', vix, this.VIX_TTL);
      return vix;
    }
    return 0;
  }

  async getMarketBreadth(): Promise<{ advanceCount: number; declineCount: number; advanceDeclineRatio: number }> {
    return { advanceCount: 0, declineCount: 0, advanceDeclineRatio: 1 };
  }

  getHealth(): ProviderHealth {
    if (rateLimiter.isBlocked('YAHOO') && this.health.status === 'ACTIVE') {
      this.health.status = 'RATE_LIMITED';
    } else if (!rateLimiter.isBlocked('YAHOO') && this.health.status === 'RATE_LIMITED') {
      this.health.status = 'ACTIVE';
    }
    return { ...this.health };
  }

  /**
   * Fetch REAL historical daily candles for technical analysis.
   * Supports 1mo/3mo/1y/10y ranges with 1d/1wk/1mo intervals.
   */
  async fetchHistoricalCandles(symbol: string, range: string = '3mo', interval: string = '1d'): Promise<Candle[]> {
    const cacheKey = `history:${symbol}:${range}:${interval}`;
    const cached = this.getCached<Candle[]>(cacheKey);
    if (cached) return cached;

    const yahooSymbol = toYahooSymbol(symbol);
    if (!yahooSymbol) return [];

    const data = await this.fetchYahooChart(yahooSymbol, range, interval);
    if (!data?.chart?.result?.[0]) return [];

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const indicators = result.indicators?.quote?.[0] || {};
    const closes = indicators.close || [];
    const opens = indicators.open || [];
    const highs = indicators.high || [];
    const lows = indicators.low || [];
    const volumes = indicators.volume || [];

    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      candles.push({
        timestamp: timestamps[i] * 1000,
        open: opens[i] ?? closes[i],
        high: highs[i] ?? closes[i],
        low: lows[i] ?? closes[i],
        close: closes[i],
        volume: volumes[i] ?? 0,
      });
    }

    this.setCache(cacheKey, candles, this.HISTORY_TTL);
    return candles;
  }
}

// Singleton
let yahooInstance: YahooProvider | null = null;
export function getYahooProvider(): YahooProvider {
  if (!yahooInstance) {
    yahooInstance = new YahooProvider();
  }
  return yahooInstance;
}
