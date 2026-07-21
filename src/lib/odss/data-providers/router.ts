/**
 * ODSS - Data Provider Router
 *
 * Rotates between all available data providers based on:
 *   1. Which providers are configured
 *   2. Which providers are not rate-limited
 *   3. Which provider last succeeded (prefer consistency)
 *   4. Priority order: NSE > YAHOO > ANGEL_ONE > UPSTOX > SIMULATOR
 *
 * Falls back gracefully: if NSE rate-limits (or geo-blocks), try Yahoo.
 * If Yahoo fails, try Angel One (when configured). If Angel One fails,
 * use the simulator (always works, but data is synthetic).
 *
 * Yahoo Finance is a FREE public source that provides:
 *   - Real quotes for all NSE stocks + indices (RELIANCE.NS, ^NSEI, etc.)
 *   - REAL India VIX from ^INDIAVIX
 *   - Historical daily candles for technical analysis
 *
 * Yahoo does NOT provide option chains — for those, NSE direct is the
 * only free source (needs Mumbai proxy via NSE_PROXY_URL env var).
 */
import type { Provider, ProviderHealth, ProviderName } from './types';
import { rateLimiter } from './types';
import type { Quote, OptionChain } from '../types';
import { NSEProvider } from './nse-provider';
import { YahooProvider } from './yahoo-provider';
import { AngelOneProvider } from './angelone-provider';
import { DhanProvider } from './dhan-provider';
import { ALL_SYMBOLS } from '../universe';

// Priority order — DHAN is highest (real option chains + greeks + quotes),
// then BRIDGE (user's AngelOne bridge), then Yahoo (free fallback), then NSE.
const PRIORITY: ProviderName[] = ['DHAN' as any, 'BRIDGE' as any, 'YAHOO', 'NSE', 'ANGEL_ONE', 'UPSTOX', 'SIMULATOR'];

export class ProviderRouter implements Provider {
  name: ProviderName = 'SIMULATOR';
  private providers: Map<ProviderName, Provider> = new Map();
  private preferredProvider: ProviderName | null = null;

  constructor() {
    // Register all providers
    this.providers.set('DHAN' as any, new DhanProvider());
    this.providers.set('BRIDGE' as any, new (require('./bridge-provider').BridgeProvider)());
    this.providers.set('NSE', new NSEProvider());
    this.providers.set('YAHOO', new YahooProvider());
    this.providers.set('ANGEL_ONE', new AngelOneProvider());
    // UPSTOX would be added here when implemented
    // SIMULATOR is the fallback — handled by the existing market-simulator module
  }

  isConfigured(): boolean {
    return true; // Always configured (at least simulator works)
  }

  private getAvailableProviders(): Provider[] {
    const available: Provider[] = [];
    for (const name of PRIORITY) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      if (!provider.isConfigured()) continue;
      const health = provider.getHealth();
      if (health.status === 'NOT_CONFIGURED') continue;
      if (health.status === 'RATE_LIMITED' || health.status === 'ERROR') {
        // Still try it if not blocked (might have recovered)
        if (rateLimiter.isBlocked(name)) continue;
      }
      available.push(provider);
    }
    return available;
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const providers = this.getAvailableProviders();
    for (const provider of providers) {
      try {
        const q = await provider.getQuote(symbol);
        if (q) {
          this.preferredProvider = provider.name;
          return q;
        }
      } catch {
        continue; // try next provider
      }
    }
    return null;
  }

  async getAllQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const providers = this.getAvailableProviders();
    for (const provider of providers) {
      try {
        const quotes = await provider.getAllQuotes(symbols);
        if (quotes.size > 0) {
          this.preferredProvider = provider.name;
          return quotes;
        }
      } catch {
        continue;
      }
    }
    return new Map();
  }

  async getOptionChain(symbol: string): Promise<OptionChain | null> {
    const providers = this.getAvailableProviders();
    for (const provider of providers) {
      try {
        const chain = await provider.getOptionChain(symbol);
        if (chain) {
          this.preferredProvider = provider.name;
          return chain;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  async getIndiaVIX(): Promise<number> {
    const providers = this.getAvailableProviders();
    for (const provider of providers) {
      try {
        const vix = await provider.getIndiaVIX();
        if (vix > 0) return vix;
      } catch {
        continue;
      }
    }
    return 15; // fallback
  }

  async getMarketBreadth(): Promise<{ advanceCount: number; declineCount: number; advanceDeclineRatio: number }> {
    const providers = this.getAvailableProviders();
    for (const provider of providers) {
      if (!provider.getMarketBreadth) continue;
      try {
        const breadth = await provider.getMarketBreadth();
        if (breadth.advanceCount > 0 || breadth.declineCount > 0) return breadth;
      } catch {
        continue;
      }
    }
    return { advanceCount: 0, declineCount: 0, advanceDeclineRatio: 1 };
  }

  getHealth(): ProviderHealth {
    // Return aggregate health
    const configured = this.getAvailableProviders();
    return {
      name: 'ROUTER',
      status: configured.length > 0 ? 'ACTIVE' : 'ERROR',
      lastSuccess: Date.now(),
      lastError: null,
      callCount: 0,
      errorCount: 0,
      rateLimitUntil: null,
    };
  }

  /** Get health status of ALL providers (for the dashboard) */
  getAllProviderHealth(): ProviderHealth[] {
    return PRIORITY.map((name) => {
      const provider = this.providers.get(name);
      if (!provider) {
        return {
          name,
          status: 'NOT_CONFIGURED' as const,
          lastSuccess: null,
          lastError: null,
          callCount: 0,
          errorCount: 0,
          rateLimitUntil: null,
        };
      }
      return provider.getHealth();
    });
  }

  /** Which provider is currently being used */
  getPreferredProvider(): ProviderName | null {
    return this.preferredProvider;
  }

  /** Get a specific provider by name */
  getProvider(name: ProviderName): Provider | undefined {
    return this.providers.get(name);
  }
}

// Singleton router instance
let routerInstance: ProviderRouter | null = null;

export function getDataRouter(): ProviderRouter {
  if (!routerInstance) {
    routerInstance = new ProviderRouter();
  }
  return routerInstance;
}
