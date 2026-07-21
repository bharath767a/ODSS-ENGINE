/**
 * ODSS — Dhan Data Provider (Direct API, No Bridge)
 * ==================================================
 *
 * Connects DIRECTLY to Dhan's Market Data API from the sandbox.
 * No bridge_server.py needed. No ngrok needed. No India laptop needed.
 *
 * SECURITY:
 * - Credentials read from /home/z/odss-data/dhan-config.json
 * - This file is OUTSIDE the project folder → git never tracks it
 * - The AI agent (me) never sees the actual values
 * - Only market data endpoints are called (quotes, option chains, candles)
 * - NEVER calls order/trading endpoints
 *
 * DHAN API ENDPOINTS USED:
 *   POST /v2/marketfeed/lite  — batch quotes (up to 50 symbols per call)
 *   POST /v2/optionchain     — full option chain with OI + Greeks
 *   GET  /v2/history         — historical candles
 *   GET  /v2/marketfeed/ohlc — OHLC data
 *
 * Rate limit: 2000 calls/day (Lite plan ₹500/month)
 * We use 15-second caching to stay well under the limit.
 */

import type { Provider, ProviderHealth, ProviderName } from './types';
import { rateLimiter } from './types';
import type { Quote, OptionChain, Candle } from '../types';
import { getSymbolMeta } from '../universe';
import { readFileSync } from 'fs';

const DHAN_CONFIG_FILE = '/home/z/odss-data/dhan-config.json';
const DHAN_BASE_URL = 'https://api.dhan.in';

interface DhanConfig {
  clientId?: string;
  apiKey: string;
  apiSecret: string;
  accessToken?: string;
  tokenGeneratedAt?: string;
}

let cachedConfig: DhanConfig | null = null;
let configReadAt = 0;

function readDhanConfig(): DhanConfig | null {
  // Re-read every 60 seconds (in case user updates token)
  if (cachedConfig && Date.now() - configReadAt < 60_000) return cachedConfig;
  try {
    const raw = readFileSync(DHAN_CONFIG_FILE, 'utf-8');
    const cfg = JSON.parse(raw);
    if (cfg.apiKey && cfg.accessToken) {
      cachedConfig = cfg;
      configReadAt = Date.now();
      return cfg;
    }
  } catch {
    // Config file missing or invalid
  }
  return null;
}

// Dhan exchange segment codes
// NSE_EQ = National Stock Exchange (Equity)
// NSE_FNO = NSE Futures & Options (for option chains)
const NSE_EQ = 'NSE_EQ';
const NSE_FNO = 'NSE_FNO';

// Map our symbols to Dhan security IDs
// Dhan uses numeric security IDs, not trading symbols.
// We need to build this map from Dhan's instrument master.
// For now, we use a lookup that we'll populate via API.
let securityIdMap: Map<string, string> | null = null;

async function getSecurityId(symbol: string): Promise<string | null> {
  if (!securityIdMap) {
    await loadSecurityIdMap();
  }
  return securityIdMap?.get(symbol) ?? null;
}

async function loadSecurityIdMap(): Promise<void> {
  if (securityIdMap) return;
  securityIdMap = new Map();
  try {
    // Dhan publishes an instrument master CSV
    // URL: https://images.dhan.co/api-data/api-scrip-master.csv
    const res = await fetch('https://images.dhan.co/api-data/api-scrip-master.csv', {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return;
    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      // CSV format: EXCH,SECURITY_ID,TRADING_SYMBOL,SEM_EXM_EXCH_ID,...
      // We want NSE_EQ entries
      const parts = line.split(',');
      if (parts.length < 3) continue;
      const exchange = parts[0]?.trim();
      const secId = parts[1]?.trim();
      const tradingSymbol = parts[2]?.trim()?.toUpperCase();
      if (exchange === 'NSE' && tradingSymbol && secId) {
        // Only store the first match per symbol
        if (!securityIdMap!.has(tradingSymbol)) {
          securityIdMap!.set(tradingSymbol, secId);
        }
      }
    }
  } catch {
    // If CSV download fails, we can't use Dhan
  }
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const DHAN_NAME = 'DHAN' as any as ProviderName;

export class DhanProvider implements Provider {
  name: ProviderName = DHAN_NAME;
  private cache = new Map<string, CacheEntry<any>>();
  private health: ProviderHealth = {
    name: DHAN_NAME,
    status: 'NOT_CONFIGURED',
    lastSuccess: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
    rateLimitUntil: null,
  };

  private readonly QUOTE_TTL = 10_000;     // 10 seconds
  private readonly OPTION_TTL = 30_000;    // 30 seconds
  private readonly CANDLE_TTL = 300_000;   // 5 minutes

  isConfigured(): boolean {
    const cfg = readDhanConfig();
    if (cfg) {
      this.health.status = 'ACTIVE';
      return true;
    }
    this.health.status = 'NOT_CONFIGURED';
    return false;
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

  private getHeaders(config: DhanConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'access-token': config.accessToken || '',
    };
  }

  /**
   * Get a single quote for a symbol.
   * Dhan's marketfeed/lite endpoint accepts batch requests (up to 50 symbols).
   */
  async getQuote(symbol: string): Promise<Quote | null> {
    const meta = getSymbolMeta(symbol);
    if (!meta) return null;

    const cacheKey = `quote:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) return cached;

    const config = readDhanConfig();
    if (!config) return null;

    if (!rateLimiter.canCall(DHAN_NAME)) return null;
    rateLimiter.recordCall(DHAN_NAME);

    const secId = await getSecurityId(symbol);
    if (!secId) return null;

    try {
      // Dhan marketfeed/lite: POST with list of securities
      const res = await fetch(`${DHAN_BASE_URL}/v2/marketfeed/lite`, {
        method: 'POST',
        headers: this.getHeaders(config),
        body: JSON.stringify({
          'NSE_EQ': [parseInt(secId)],
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 401) {
        this.health.lastError = 'Dhan token invalid/expired';
        this.health.status = 'ERROR';
        this.health.errorCount++;
        return null;
      }
      if (res.status === 429) {
        rateLimiter.blockFor(DHAN_NAME, 60_000);
        this.health.rateLimitUntil = Date.now() + 60_000;
        this.health.status = 'RATE_LIMITED';
        this.health.lastError = 'Dhan rate limited (429)';
        return null;
      }
      if (!res.ok) {
        this.health.lastError = `Dhan HTTP ${res.status}`;
        this.health.errorCount++;
        return null;
      }

      const data = await res.json();
      const quoteData = data?.data?.NSE_EQ?.[0];
      if (!quoteData) return null;

      const ltp = Number(quoteData.last_price) || 0;
      const open = Number(quoteData.open) || ltp;
      const high = Number(quoteData.high) || ltp;
      const low = Number(quoteData.low) || ltp;
      const close = Number(quoteData.close) || ltp;
      const volume = Number(quoteData.volume) || 0;
      const changePct = close > 0 ? ((ltp - close) / close) * 100 : 0;
      const vwap = Number(quoteData.avg_trade_price) || ltp;

      const quote: Quote = {
        symbol,
        sector: meta.sector,
        ltp,
        prevClose: close,
        open,
        high,
        low,
        dayHigh: high,
        dayLow: low,
        volume,
        vwap,
        changePct,
        candles: [],
        timestamp: Date.now(),
      };

      this.setCache(cacheKey, quote, this.QUOTE_TTL);
      this.health.lastSuccess = Date.now();
      this.health.status = 'ACTIVE';
      this.health.lastError = null;
      this.health.callCount++;
      return quote;
    } catch (e: any) {
      this.health.lastError = e?.message || 'Dhan quote failed';
      this.health.errorCount++;
      this.health.status = 'ERROR';
      return null;
    }
  }

  /**
   * Get quotes for multiple symbols in one API call (batch).
   * Dhan supports up to 50 symbols per marketfeed/lite call.
   */
  async getAllQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const result = new Map<string, Quote>();

    const config = readDhanConfig();
    if (!config) return result;

    // Build batch of security IDs
    const BATCH_SIZE = 50;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const secIds: number[] = [];
      const symToId = new Map<string, number>();

      for (const sym of batch) {
        const secId = await getSecurityId(sym);
        if (secId) {
          secIds.push(parseInt(secId));
          symToId.set(sym, parseInt(secId));
        }
      }

      if (secIds.length === 0) continue;

      if (!rateLimiter.canCall(DHAN_NAME)) break;
      rateLimiter.recordCall(DHAN_NAME);

      try {
        const res = await fetch(`${DHAN_BASE_URL}/v2/marketfeed/lite`, {
          method: 'POST',
          headers: this.getHeaders(config),
          body: JSON.stringify({ 'NSE_EQ': secIds }),
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
          this.health.lastError = `Dhan batch HTTP ${res.status}`;
          this.health.errorCount++;
          continue;
        }

        const data = await res.json();
        const quotesData = data?.data?.NSE_EQ || [];

        for (const q of quotesData) {
          // Find which symbol this security ID maps to
          for (const [sym, id] of symToId.entries()) {
            if (id === q.security_id) {
              const meta = getSymbolMeta(sym);
              if (!meta) continue;
              const ltp = Number(q.last_price) || 0;
              const close = Number(q.close) || ltp;
              const open = Number(q.open) || ltp;
              const high = Number(q.high) || ltp;
              const low = Number(q.low) || ltp;
              const volume = Number(q.volume) || 0;
              const changePct = close > 0 ? ((ltp - close) / close) * 100 : 0;

              const quote: Quote = {
                symbol: sym,
                sector: meta.sector,
                ltp,
                prevClose: close,
                open,
                high,
                low,
                dayHigh: high,
                dayLow: low,
                volume,
                vwap: Number(q.avg_trade_price) || ltp,
                changePct,
                candles: [],
                timestamp: Date.now(),
              };

              result.set(sym, quote);
              this.setCache(`quote:${sym}`, quote, this.QUOTE_TTL);
              break;
            }
          }
        }

        this.health.lastSuccess = Date.now();
        this.health.status = 'ACTIVE';
        this.health.callCount++;
      } catch (e: any) {
        this.health.lastError = e?.message || 'Dhan batch failed';
        this.health.errorCount++;
      }
    }

    return result;
  }

  /**
   * Get the full option chain for a symbol with REAL OI + Greeks.
   * This is the key advantage of Dhan over AngelOne/Yahoo.
   */
  async getOptionChain(symbol: string): Promise<OptionChain | null> {
    const cacheKey = `oc:${symbol}`;
    const cached = this.getCached<OptionChain>(cacheKey);
    if (cached) return cached;

    const config = readDhanConfig();
    if (!config) return null;

    if (!rateLimiter.canCall(DHAN_NAME)) return null;
    rateLimiter.recordCall(DHAN_NAME);

    try {
      // Dhan option chain endpoint
      // Underlying: NIFTY, BANKNIFTY, FINNIFTY or stock symbol
      const underlying = symbol;

      const res = await fetch(`${DHAN_BASE_URL}/v2/optionchain`, {
        method: 'POST',
        headers: this.getHeaders(config),
        body: JSON.stringify({
          underlyings: [{
            underlying_scrip: underlying,
            underlying_seg: 'IDX_I' === underlying ? 'INDEX' : 'NSE_EQ',
          }],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        this.health.lastError = `Dhan option chain HTTP ${res.status}`;
        this.health.errorCount++;
        return null;
      }

      const data = await res.json();
      const ocData = data?.data?.[0];

      if (!ocData) return null;

      // Parse Dhan's option chain format into our OptionChain type
      // Dhan returns: { strike_prices: [{ ce: {...}, pe: {...} }, ...] }
      const strikes = ocData.strike_prices || [];
      const spot = Number(ocData.spot_price) || 0;
      const atmStrike = strikes.length > 0
        ? strikes.reduce((closest: any, s: any) => {
            const dist = Math.abs(Number(s.strike) - spot);
            return (!closest || dist < Math.abs(Number(closest.strike) - spot)) ? s : closest;
          }, null)?.strike
        : 0;

      // Calculate PCR (Put-Call Ratio) from OI
      let totalCallOI = 0;
      let totalPutOI = 0;
      let maxCallOIStrike = 0;
      let maxPutOIStrike = 0;
      let maxCallOI = 0;
      let maxPutOI = 0;

      for (const s of strikes) {
        const callOI = Number(s?.ce?.oi) || 0;
        const putOI = Number(s?.pe?.oi) || 0;
        totalCallOI += callOI;
        totalPutOI += putOI;
        if (callOI > maxCallOI) { maxCallOI = callOI; maxCallOIStrike = Number(s.strike); }
        if (putOI > maxPutOI) { maxPutOI = putOI; maxPutOIStrike = Number(s.strike); }
      }

      const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;

      // Max pain = strike where total option writers' loss is minimized
      let maxPainStrike = 0;
      let minLoss = Infinity;
      for (const testStrike of strikes) {
        const testStrikePrice = Number(testStrike.strike);
        let totalLoss = 0;
        for (const s of strikes) {
          const strikePrice = Number(s.strike);
          // Call writers lose if price > strike
          if (testStrikePrice > strikePrice) {
            totalLoss += (testStrikePrice - strikePrice) * (Number(s?.ce?.oi) || 0);
          }
          // Put writers lose if price < strike
          if (testStrikePrice < strikePrice) {
            totalLoss += (strikePrice - testStrikePrice) * (Number(s?.pe?.oi) || 0);
          }
        }
        if (totalLoss < minLoss) { minLoss = totalLoss; maxPainStrike = testStrikePrice; }
      }

      // Build option chain rows
      const optionRows = strikes.slice(0, 30).map((s: any) => {
        const strike = Number(s.strike);
        return {
          strike,
          callLTP: Number(s?.ce?.last_price) || 0,
          callOI: Number(s?.ce?.oi) || 0,
          callVolume: Number(s?.ce?.volume) || 0,
          callIV: Number(s?.ce?.implied_volatility) || 0,
          callDelta: Number(s?.ce?.greeks?.delta) || 0,
          callGamma: Number(s?.ce?.greeks?.gamma) || 0,
          callTheta: Number(s?.ce?.greeks?.theta) || 0,
          callVega: Number(s?.ce?.greeks?.vega) || 0,
          putLTP: Number(s?.pe?.last_price) || 0,
          putOI: Number(s?.pe?.oi) || 0,
          putVolume: Number(s?.pe?.volume) || 0,
          putIV: Number(s?.pe?.implied_volatility) || 0,
          putDelta: Number(s?.pe?.greeks?.delta) || 0,
          putGamma: Number(s?.pe?.greeks?.gamma) || 0,
          putTheta: Number(s?.pe?.greeks?.theta) || 0,
          putVega: Number(s?.pe?.greeks?.vega) || 0,
        };
      });

      const optionChain: OptionChain = {
        symbol,
        spot,
        atmStrike,
        pcr,
        maxPainStrike,
        strikes: optionRows,
        expiry: ocData.expiry || '',
        callWritingTrend: totalCallOI > totalPutOI ? 'LONG' : 'SHORT',
        putWritingTrend: totalPutOI > totalCallOI ? 'LONG' : 'SHORT',
        pcrSignal: pcr > 1.2 ? 'LONG' : pcr < 0.8 ? 'SHORT' : 'NEUTRAL',
        bias: pcr > 1.2 ? 'LONG' : pcr < 0.8 ? 'SHORT' : 'NEUTRAL',
        unwinding: 'NONE',
      };

      this.setCache(cacheKey, optionChain, this.OPTION_TTL);
      this.health.lastSuccess = Date.now();
      this.health.callCount++;
      return optionChain;
    } catch (e: any) {
      this.health.lastError = e?.message || 'Dhan option chain failed';
      this.health.errorCount++;
      return null;
    }
  }

  /**
   * Get India VIX.
   * Dhan provides this via the marketfeed for security ID of INDIA VIX.
   */
  async getIndiaVIX(): Promise<number> {
    const cached = this.getCached<number>('vix');
    if (cached !== null) return cached;

    const config = readDhanConfig();
    if (!config) return 0;

    // India VIX security ID on Dhan (we'll need to look this up)
    // For now, return 0 and let Yahoo handle VIX
    return 0;
  }

  async getMarketBreadth(): Promise<{ advanceCount: number; declineCount: number; advanceDeclineRatio: number } | null> {
    return null; // Let the simulator compute from quotes
  }

  getHealth(): ProviderHealth {
    return { ...this.health };
  }
}
