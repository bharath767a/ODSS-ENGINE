/**
 * ODSS — Bridge Data Provider (v2 — with Dhan support)
 * =====================================================
 *
 * Connects to the user's local bridge server (v4) running on their India
 * laptop via ngrok. The bridge fetches:
 *   - Dhan Market Data API (primary — real option chains + greeks)
 *   - AngelOne SmartAPI (secondary — real-time quotes)
 *   - Yahoo Finance (fallback — always available)
 *
 * Bridge endpoints:
 *   GET  /health             — status check (no token needed)
 *   GET  /quote/{symbol}     — real quote (Dhan → AngelOne → Yahoo)
 *   POST /quotes/batch       — batch quotes (up to 50 symbols)
 *   GET  /options/{name}     — REAL option chain with OI + Greeks (Dhan)
 *   GET  /indices            — NIFTY/BANKNIFTY/FINNIFTY quotes
 *
 * The bridge handles all credential management. This provider just calls
 * the bridge endpoints via the ngrok URL.
 */

import type { Provider, ProviderHealth, ProviderName } from './types';
import { rateLimiter } from './types';
import type { Quote, OptionChain } from '../types';
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
    // Config file missing or invalid
  }
  return null;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const BRIDGE_NAME = 'BRIDGE' as any as ProviderName;

export class BridgeProvider implements Provider {
  name: ProviderName = BRIDGE_NAME;
  private cache = new Map<string, CacheEntry<any>>();
  private health: ProviderHealth = {
    name: BRIDGE_NAME,
    status: 'NOT_CONFIGURED',
    lastSuccess: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
    rateLimitUntil: null,
  };

  private readonly QUOTE_TTL = 10_000;
  private readonly OPTION_TTL = 30_000;
  private readonly VIX_TTL = 10_000;

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
      const options: RequestInit = {
        headers: {
          'X-Bridge-Token': cfg.token,
          'Accept': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        signal: AbortSignal.timeout(12000),
      };
      if (method === 'POST' && body) {
        options.method = 'POST';
        (options.headers as Record<string, string>)['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url, options);

      if (res.status === 401) {
        this.health.lastError = 'Bridge token invalid';
        this.health.status = 'ERROR';
        this.health.errorCount++;
        return null;
      }
      if (res.status === 429) {
        rateLimiter.blockFor(BRIDGE_NAME, 30_000);
        this.health.rateLimitUntil = Date.now() + 30_000;
        this.health.status = 'RATE_LIMITED';
        this.health.lastError = 'Bridge rate limited';
        this.health.errorCount++;
        return null;
      }
      if (res.status === 503) {
        this.health.lastError = 'Bridge returned 503 (no data)';
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

  async getQuote(symbol: string): Promise<Quote | null> {
    const meta = getSymbolMeta(symbol);
    if (!meta) return null;

    const cacheKey = `quote:${symbol}`;
    const cached = this.getCached<Quote>(cacheKey);
    if (cached) return cached;

    if (!rateLimiter.canCall(BRIDGE_NAME)) return null;
    rateLimiter.recordCall(BRIDGE_NAME);

    const data = await this.callBridge(`/quote/${encodeURIComponent(symbol)}`);
    if (!data || !data.ltp) return null;

    const ltp = Number(data.ltp) || 0;
    const prevClose = Number(data.close) || ltp;
    const open = Number(data.open) || ltp;
    const high = Number(data.high) || ltp;
    const low = Number(data.low) || ltp;
    const volume = Number(data.volume) || 0;
    const vwap = Number(data.vwap) || ltp;
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
      vwap,
      changePct,
      candles: [],
      timestamp: Date.now(),
    };

    this.setCache(cacheKey, quote, this.QUOTE_TTL);
    return quote;
  }

  async getAllQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const result = new Map<string, Quote>();

    // Try batch first (bridge v4 supports POST /quotes/batch)
    if (rateLimiter.canCall(BRIDGE_NAME)) {
      rateLimiter.recordCall(BRIDGE_NAME);
      const batchData = await this.callBridge('/quotes/batch', 'POST', symbols.slice(0, 50));
      if (batchData?.quotes) {
        for (const [sym, q] of Object.entries(batchData.quotes)) {
          const quote = q as any;
          if (quote.ltp) {
            const meta = getSymbolMeta(sym);
            if (meta) {
              const ltp = Number(quote.ltp) || 0;
              const prevClose = Number(quote.close) || ltp;
              result.set(sym, {
                symbol: sym,
                sector: meta.sector,
                ltp,
                prevClose,
                open: Number(quote.open) || ltp,
                high: Number(quote.high) || ltp,
                low: Number(quote.low) || ltp,
                dayHigh: Number(quote.high) || ltp,
                dayLow: Number(quote.low) || ltp,
                volume: Number(quote.volume) || 0,
                vwap: Number(quote.vwap) || ltp,
                changePct: prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0,
                candles: [],
                timestamp: Date.now(),
              });
            }
          }
        }
      }
    }

    // Fallback: fetch remaining individually
    const missing = symbols.filter(s => !result.has(s));
    for (const sym of missing) {
      const q = await this.getQuote(sym);
      if (q) result.set(sym, q);
    }

    return result;
  }

  async getOptionChain(symbol: string): Promise<OptionChain | null> {
    const cacheKey = `oc:${symbol}`;
    const cached = this.getCached<OptionChain>(cacheKey);
    if (cached) return cached;

    if (!rateLimiter.canCall(BRIDGE_NAME)) return null;
    rateLimiter.recordCall(BRIDGE_NAME);

    const data = await this.callBridge(`/options/${encodeURIComponent(symbol)}`);
    if (!data || data.error) return null;

    // Bridge v4 returns option chain in our format already
    const optionChain: OptionChain = {
      symbol: data.symbol || symbol,
      spot: Number(data.spot) || 0,
      atmStrike: Number(data.atmStrike) || 0,
      pcr: Number(data.pcr) || 1,
      maxPainStrike: Number(data.maxPainStrike) || 0,
      strikes: (data.strikes || []).map((s: any) => ({
        strike: Number(s.strike),
        callLTP: Number(s.callLTP) || 0,
        callOI: Number(s.callOI) || 0,
        callVolume: Number(s.callVolume) || 0,
        callIV: Number(s.callIV) || 0,
        callDelta: Number(s.callDelta) || 0,
        callGamma: Number(s.callGamma) || 0,
        callTheta: Number(s.callTheta) || 0,
        callVega: Number(s.callVega) || 0,
        putLTP: Number(s.putLTP) || 0,
        putOI: Number(s.putOI) || 0,
        putVolume: Number(s.putVolume) || 0,
        putIV: Number(s.putIV) || 0,
        putDelta: Number(s.putDelta) || 0,
        putGamma: Number(s.putGamma) || 0,
        putTheta: Number(s.putTheta) || 0,
        putVega: Number(s.putVega) || 0,
      })),
      expiry: data.expiry || '',
      callWritingTrend: data.totalCallOI > data.totalPutOI ? 'LONG' : 'SHORT',
      putWritingTrend: data.totalPutOI > data.totalCallOI ? 'LONG' : 'SHORT',
      pcrSignal: Number(data.pcr) > 1.2 ? 'LONG' : Number(data.pcr) < 0.8 ? 'SHORT' : 'NEUTRAL',
      bias: Number(data.pcr) > 1.2 ? 'LONG' : Number(data.pcr) < 0.8 ? 'SHORT' : 'NEUTRAL',
      unwinding: 'NONE',
    };

    this.setCache(cacheKey, optionChain, this.OPTION_TTL);
    return optionChain;
  }

  async getIndiaVIX(): Promise<number> {
    // Bridge doesn't have a dedicated VIX endpoint — fetch NIFTY quote
    const data = await this.callBridge('/indices');
    if (data?.indices?.INDIA_VIX?.ltp) {
      return Number(data.indices.INDIA_VIX.ltp);
    }
    return 0; // Let Yahoo handle VIX
  }

  async getMarketBreadth(): Promise<{ advanceCount: number; declineCount: number; advanceDeclineRatio: number } | null> {
    return null;
  }

  getHealth(): ProviderHealth {
    return { ...this.health };
  }
}
