/**
 * ODSS — Dhan Data Provider (Routes through Bridge)
 * ==================================================
 *
 * Since the sandbox cannot reach Dhan API directly (network restriction),
 * this provider routes Dhan API calls through the user's bridge server
 * (running on their India laptop via ngrok).
 *
 * Architecture:
 *   Sandbox → ngrok tunnel → Bridge (laptop) → Dhan API → Real data back
 *
 * The bridge already has Dhan endpoints:
 *   GET  /dhan/quote/{symbol}   — single quote
 *   POST /dhan/quotes           — batch quotes
 *   GET  /dhan/options/{underlying} — option chain with OI + Greeks
 *
 * SECURITY:
 * - Dhan API key/secret stay on the user's laptop (in bridge_secrets.json)
 * - Sandbox only sends requests to the bridge (via ngrok)
 * - Token authentication required for all calls
 * - NEVER calls order/trading endpoints
 */

import type { Provider, ProviderHealth, ProviderName } from './types';
import { rateLimiter } from './types';
import type { Quote, OptionChain, Candle } from '../types';
import { getSymbolMeta } from '../universe';
import { readFileSync } from 'fs';
import { dataPath } from '../data-dir';

const BRIDGE_CONFIG_FILE = dataPath('bridge-config.json');

interface BridgeConfig {
  url: string;
  token: string;
  enabled: boolean;
}

let cachedConfig: BridgeConfig | null = null;
let configReadAt = 0;

function readBridgeConfig(): BridgeConfig | null {
  if (cachedConfig && Date.now() - configReadAt < 30_000) return cachedConfig;
  try {
    const raw = readFileSync(BRIDGE_CONFIG_FILE, 'utf-8');
    const cfg = JSON.parse(raw);
    if (cfg.url && cfg.token && cfg.enabled !== false) {
      cachedConfig = { url: cfg.url.replace(/\/$/, ''), token: cfg.token, enabled: true };
      configReadAt = Date.now();
      return cachedConfig;
    }
  } catch {
    // Config file missing
  }
  return null;
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
    const cfg = readBridgeConfig();
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

  private async callBridge(path: string, method: 'GET' | 'POST' = 'GET', body?: any): Promise<any | null> {
    const cfg = readBridgeConfig();
    if (!cfg) {
      this.health.status = 'NOT_CONFIGURED';
      return null;
    }

    const url = `${cfg.url}${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'X-Bridge-Token': cfg.token,
          'Accept': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 401) {
        this.health.lastError = 'Bridge token invalid';
        this.health.status = 'ERROR';
        this.health.errorCount++;
        return null;
      }
      if (res.status === 429) {
        rateLimiter.blockFor(DHAN_NAME, 60_000);
        this.health.rateLimitUntil = Date.now() + 60_000;
        this.health.status = 'RATE_LIMITED';
        this.health.lastError = 'Bridge rate limited';
        return null;
      }
      if (res.status === 503) {
        this.health.lastError = 'Bridge returned 503 (Dhan not configured on laptop?)';
        this.health.errorCount++;
        return null;
      }
      if (!res.ok) {
        this.health.lastError = `Bridge HTTP ${res.status}`;
        this.health.errorCount++;
        return null;
      }

      const data = await res.json();
      this.health.lastSuccess = Date.now();
      this.health.status = 'ACTIVE';
      this.health.lastError = null;
      this.health.callCount++;
      return data;
    } catch (e: any) {
      this.health.lastError = e?.message || 'Bridge call failed';
      this.health.errorCount++;
      this.health.status = 'ERROR';
      return null;
    }
  }

  /**
   * Get a single quote for a symbol via bridge → Dhan.
   */
  async getQuote(symbol: string): Promise<Quote | null> {
    const meta = getSymbolMeta(symbol);
    if (!meta) return null;

    const cacheKey = `quote:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) return cached;

    if (!rateLimiter.canCall(DHAN_NAME)) return null;
    rateLimiter.recordCall(DHAN_NAME);

    const data = await this.callBridge(`/dhan/quote/${encodeURIComponent(symbol)}`);
    if (!data || !data.ltp) return null;

    const ltp = Number(data.ltp) || 0;
    const prevClose = Number(data.close) || ltp;
    const open = Number(data.open) || ltp;
    const high = Number(data.high) || ltp;
    const low = Number(data.low) || ltp;
    const volume = Number(data.volume) || 0;
    const changePct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0;

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
      vwap: Number(data.vwap) || ltp,
      changePct,
      candles: [],
      timestamp: Date.now(),
    };

    this.setCache(cacheKey, quote, this.QUOTE_TTL);
    return quote;
  }

  /**
   * Get quotes for multiple symbols via bridge → Dhan (batch).
   */
  async getAllQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const result = new Map<string, Quote>();

    if (!rateLimiter.canCall(DHAN_NAME)) return result;
    rateLimiter.recordCall(DHAN_NAME);

    // Use batch endpoint — bridge forwards to Dhan's marketfeed/lite
    const data = await this.callBridge('/dhan/quotes', 'POST', { symbols });

    if (!data || !data.quotes) return result;

    for (const [sym, q] of Object.entries(data.quotes)) {
      const meta = getSymbolMeta(sym);
      if (!meta) continue;
      const quoteData = q as any;
      const ltp = Number(quoteData.ltp) || 0;
      const prevClose = Number(quoteData.close) || ltp;
      const open = Number(quoteData.open) || ltp;
      const high = Number(quoteData.high) || ltp;
      const low = Number(quoteData.low) || ltp;

      const quote: Quote = {
        symbol: sym,
        sector: meta.sector,
        ltp,
        prevClose,
        open,
        high,
        low,
        dayHigh: high,
        dayLow: low,
        volume: Number(quoteData.volume) || 0,
        vwap: Number(quoteData.vwap) || ltp,
        changePct: prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0,
        candles: [],
        timestamp: Date.now(),
      };

      result.set(sym, quote);
      this.setCache(`quote:${sym}`, quote, this.QUOTE_TTL);
    }

    return result;
  }

  /**
   * Get the full option chain for a symbol with REAL OI + Greeks.
   * This is the key advantage of Dhan — real option chain data.
   */
  async getOptionChain(symbol: string): Promise<OptionChain | null> {
    const cacheKey = `oc:${symbol}`;
    const cached = this.getCached<OptionChain>(cacheKey);
    if (cached) return cached;

    if (!rateLimiter.canCall(DHAN_NAME)) return null;
    rateLimiter.recordCall(DHAN_NAME);

    const data = await this.callBridge(`/dhan/options/${encodeURIComponent(symbol)}`);
    if (!data || !data.strike_prices) return null;

    // Parse Dhan's option chain format
    const strikes = data.strike_prices || [];
    const spot = Number(data.spot_price) || 0;

    // Find ATM strike
    const atmStrike = strikes.length > 0
      ? strikes.reduce((closest: any, s: any) => {
          const dist = Math.abs(Number(s.strike) - spot);
          return (!closest || dist < Math.abs(Number(closest.strike) - spot)) ? s : closest;
        }, null)?.strike
      : 0;

    // Calculate PCR + Max Pain + detect short covering
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

    // Max pain calculation
    let maxPainStrike = 0;
    let minLoss = Infinity;
    for (const testStrike of strikes) {
      const testStrikePrice = Number(testStrike.strike);
      let totalLoss = 0;
      for (const s of strikes) {
        const strikePrice = Number(s.strike);
        if (testStrikePrice > strikePrice) {
          totalLoss += (testStrikePrice - strikePrice) * (Number(s?.ce?.oi) || 0);
        }
        if (testStrikePrice < strikePrice) {
          totalLoss += (strikePrice - testStrikePrice) * (Number(s?.pe?.oi) || 0);
        }
      }
      if (totalLoss < minLoss) { minLoss = totalLoss; maxPainStrike = testStrikePrice; }
    }

    // Detect short covering (Idea 3 from agent review)
    // Short covering = call OI decreasing + price rising near max call OI strike
    const nearMaxCallOI = Math.abs(spot - maxCallOIStrike) / spot < 0.002; // within 0.2%
    const callUnwinding = strikes.some((s: any) => {
      const ce = s?.ce;
      return ce && Number(ce.oi) > 0 && Number(ce.oi_change || 0) < 0;
    });
    const shortCoveringSignal = nearMaxCallOI && callUnwinding;

    // Build option chain rows with real greeks
    const optionRows = strikes.slice(0, 30).map((s: any) => ({
      strike: Number(s.strike),
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
    }));

    const optionChain: any = {
      symbol,
      spot,
      atmStrike,
      pcr,
      maxPainStrike,
      strikes: optionRows,
      expiry: data.expiry || '',
      callWritingTrend: totalCallOI > totalPutOI ? 'LONG' : 'SHORT',
      putWritingTrend: totalPutOI > totalCallOI ? 'LONG' : 'SHORT',
      pcrSignal: pcr > 1.2 ? 'LONG' : pcr < 0.8 ? 'SHORT' : 'NEUTRAL',
      bias: pcr > 1.2 ? 'LONG' : pcr < 0.8 ? 'SHORT' : 'NEUTRAL',
      unwinding: callUnwinding ? 'CALL_UNWINDING' : 'NONE',
      // NEW: Short covering squeeze detection
      shortCoveringSignal,
      maxCallOIStrike,
      maxPutOIStrike,
      nearMaxCallOI,
    };

    this.setCache(cacheKey, optionChain, this.OPTION_TTL);
    return optionChain;
  }

  async getIndiaVIX(): Promise<number> {
    const cached = this.getCached<number>('vix');
    if (cached !== null) return cached;

    if (!rateLimiter.canCall(DHAN_NAME)) return 0;
    rateLimiter.recordCall(DHAN_NAME);

    const data = await this.callBridge('/vix');
    if (data && data.vix) {
      const vix = Number(data.vix);
      this.setCache('vix', vix, this.QUOTE_TTL);
      return vix;
    }
    return 0;
  }

  async getMarketBreadth(): Promise<{ advanceCount: number; declineCount: number; advanceDeclineRatio: number } | null> {
    return null;
  }

  getHealth(): ProviderHealth {
    return { ...this.health };
  }
}
