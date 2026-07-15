/**
 * ODSS - Data Provider Abstraction
 *
 * All providers implement this interface. The router rotates between them
 * based on availability and rate limits. The engines consume the typed
 * Quote/OptionChain interfaces, so swapping providers doesn't touch them.
 */

export type ProviderName = 'NSE' | 'YAHOO' | 'ANGEL_ONE' | 'UPSTOX' | 'SIMULATOR';
export type ProviderStatus = 'ACTIVE' | 'RATE_LIMITED' | 'ERROR' | 'NOT_CONFIGURED' | 'DISABLED';

export interface ProviderHealth {
  name: ProviderName;
  status: ProviderStatus;
  lastSuccess: number | null;
  lastError: string | null;
  callCount: number;
  errorCount: number;
  rateLimitUntil: number | null;
}

export interface Provider {
  name: ProviderName;
  /** Whether this provider has valid credentials configured */
  isConfigured(): boolean;
  /** Get a single quote for a symbol */
  getQuote(symbol: string): Promise<Quote | null>;
  /** Get quotes for all symbols in the universe */
  getAllQuotes(symbols: string[]): Promise<Map<string, Quote>>;
  /** Get the full option chain for a symbol */
  getOptionChain(symbol: string): Promise<OptionChain | null>;
  /** Get India VIX */
  getIndiaVIX(): Promise<number>;
  /** Get market breadth (advances/declines) */
  getMarketBreadth?(): Promise<{ advanceCount: number; declineCount: number; advanceDeclineRatio: number }>;
  /** Health check */
  getHealth(): ProviderHealth;
}

// Re-export the types that providers must return (from the main types file)
import type { Quote, OptionChain } from '../types';

// Rate limit manager — shared across providers
export class RateLimitManager {
  private limits = new Map<ProviderName, { calls: number[]; maxPerWindow: number; windowMs: number; blockedUntil: number }>();

  configure(name: ProviderName, maxPerWindow: number, windowMs: number = 60000) {
    this.limits.set(name, { calls: [], maxPerWindow, windowMs, blockedUntil: 0 });
  }

  canCall(name: ProviderName): boolean {
    const lim = this.limits.get(name);
    if (!lim) return true;
    if (Date.now() < lim.blockedUntil) return false;
    const now = Date.now();
    lim.calls = lim.calls.filter((t) => now - t < lim.windowMs);
    return lim.calls.length < lim.maxPerWindow;
  }

  recordCall(name: ProviderName) {
    const lim = this.limits.get(name);
    if (lim) lim.calls.push(Date.now());
  }

  blockFor(name: ProviderName, ms: number) {
    const lim = this.limits.get(name);
    if (lim) lim.blockedUntil = Date.now() + ms;
  }

  remaining(name: ProviderName): number {
    const lim = this.limits.get(name);
    if (!lim) return Infinity;
    if (Date.now() < lim.blockedUntil) return 0;
    const now = Date.now();
    lim.calls = lim.calls.filter((t) => now - t < lim.windowMs);
    return Math.max(0, lim.maxPerWindow - lim.calls.length);
  }

  isBlocked(name: ProviderName): boolean {
    const lim = this.limits.get(name);
    if (!lim) return false;
    return Date.now() < lim.blockedUntil;
  }
}

export const rateLimiter = new RateLimitManager();

// Configure rate limits per provider
rateLimiter.configure('NSE', 20, 60000);        // 20 req/min (NSE blocks aggressive callers)
rateLimiter.configure('YAHOO', 100, 60000);     // 100 req/min (Yahoo is generous but rate-limits on abuse)
rateLimiter.configure('ANGEL_ONE', 180, 60000); // 3 req/sec
rateLimiter.configure('UPSTOX', 300, 60000);    // 5 req/sec
rateLimiter.configure('SIMULATOR', Infinity, 0); // unlimited
