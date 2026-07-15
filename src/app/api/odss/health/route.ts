import { NextResponse } from 'next/server';
import { getStore } from '@/lib/odss/store/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// GET /api/odss/health
// ============================================================
// Returns aggregated system health for the ODSS dashboard:
//   - Data provider status (NSE / Yahoo / Angel One / etc.)
//   - Mini-service (odss-market on port 3002) connection status
//   - Last scan time (from the ODSS store)
//   - Aggregated error list + counts
//   - Rate limit status per provider
//   - Overall health score (0-100) and tier (GREEN / YELLOW / RED)
// ============================================================

interface ProviderHealthDTO {
  name: string;
  status: 'ACTIVE' | 'RATE_LIMITED' | 'ERROR' | 'NOT_CONFIGURED' | 'DISABLED';
  lastSuccess: number | null;
  lastError: string | null;
  callCount: number;
  errorCount: number;
  rateLimitUntil: number | null;
}

interface HealthResponse {
  providers: ProviderHealthDTO[];
  marketService: {
    connected: boolean;
    lastTick: number | null;
    port: number;
    url: string;
  };
  lastScan: number | null;
  errors: { timestamp: number; source: string; message: string }[];
  rateLimits: { provider: string; remaining: number; maxPerWindow: number; blocked: boolean }[];
  overall: {
    score: number; // 0-100
    tier: 'GREEN' | 'YELLOW' | 'RED';
    label: string;
  };
  timestamp: number;
}

async function checkMiniService(): Promise<{ connected: boolean; lastTick: number | null }> {
  // The odss-market mini-service runs a Socket.IO server with path '/'.
  // The HTTP /health endpoint is shadowed by Socket.IO, so we use the
  // engine.io polling handshake to verify the service is alive.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('http://localhost:3002/?EIO=4&transport=polling', {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (res.ok) {
      const text = await res.text();
      // engine.io handshake starts with '0' followed by JSON containing 'sid'
      if (text.includes('"sid"')) {
        return { connected: true, lastTick: Date.now() };
      }
    }
    return { connected: false, lastTick: null };
  } catch {
    return { connected: false, lastTick: null };
  }
}

function computeOverallScore(
  providers: ProviderHealthDTO[],
  marketConnected: boolean,
  lastScan: number | null,
  errorCount: number,
): { score: number; tier: 'GREEN' | 'YELLOW' | 'RED'; label: string } {
  let score = 100;

  // Mini-service is critical
  if (!marketConnected) score -= 40;

  // Scan freshness
  if (lastScan) {
    const ageSec = (Date.now() - lastScan) / 1000;
    if (ageSec > 60) score -= 25;
    else if (ageSec > 20) score -= 12;
  } else {
    score -= 20;
  }

  // Provider health
  const configured = providers.filter((p) => p.status !== 'NOT_CONFIGURED');
  const activeProviders = configured.filter((p) => p.status === 'ACTIVE').length;
  if (configured.length === 0) {
    score -= 30;
  } else {
    const errorRatio = configured.reduce((acc, p) => acc + p.errorCount, 0) /
      Math.max(1, configured.reduce((acc, p) => acc + p.callCount, 0));
    if (errorRatio > 0.3) score -= 20;
    else if (errorRatio > 0.1) score -= 10;
    if (activeProviders === 0) score -= 25;
  }

  // Aggregated error count
  if (errorCount > 10) score -= 15;
  else if (errorCount > 3) score -= 7;

  score = Math.max(0, Math.min(100, score));
  const tier: 'GREEN' | 'YELLOW' | 'RED' = score >= 80 ? 'GREEN' : score >= 50 ? 'YELLOW' : 'RED';
  const label =
    tier === 'GREEN'
      ? 'All systems operational'
      : tier === 'YELLOW'
        ? 'Degraded — some issues detected'
        : 'Critical — attention required';
  return { score, tier, label };
}

export async function GET() {
  try {
    // Data provider health
    const { getDataRouter } = await import('@/lib/odss/data-providers/router');
    const { rateLimiter } = await import('@/lib/odss/data-providers/types');
    const router = getDataRouter();
    const providerHealth = router.getAllProviderHealth();

    const providers: ProviderHealthDTO[] = providerHealth.map((h) => ({
      name: h.name,
      status: h.status,
      lastSuccess: h.lastSuccess,
      lastError: h.lastError,
      callCount: h.callCount,
      errorCount: h.errorCount,
      rateLimitUntil: h.rateLimitUntil,
    }));

    // Rate limit status
    const rateLimits = providerHealth.map((h) => {
      const maxPerWindow =
        h.name === 'NSE' ? 20 :
        h.name === 'YAHOO' ? 100 :
        h.name === 'ANGEL_ONE' ? 180 :
        h.name === 'UPSTOX' ? 300 : Infinity;
      const remaining = maxPerWindow === Infinity ? Infinity : rateLimiter.remaining(h.name);
      return {
        provider: h.name,
        remaining,
        maxPerWindow,
        blocked: rateLimiter.isBlocked(h.name),
      };
    });

    // Mini-service connection
    const { connected, lastTick } = await checkMiniService();

    // Last scan time
    const store = getStore();
    const lastScan = store.lastScanAt > 0 ? store.lastScanAt : null;

    // Aggregated errors — derived from provider error counts + recent decision log errors
    const errors: { timestamp: number; source: string; message: string }[] = [];
    for (const p of providerHealth) {
      if (p.lastError) {
        errors.push({
          timestamp: p.lastSuccess ?? Date.now(),
          source: `Provider:${p.name}`,
          message: p.lastError.slice(0, 200),
        });
      }
    }
    // Add recent decision log warnings/errors
    try {
      const recentErrors = store.decisionLog
        .filter((l) => l.level === 'error' || l.level === 'warn')
        .slice(0, 5)
        .map((l) => ({
          timestamp: l.timestamp,
          source: l.engine,
          message: l.message.slice(0, 200),
        }));
      errors.push(...recentErrors);
    } catch {
      // ignore
    }
    errors.sort((a, b) => b.timestamp - a.timestamp);
    const trimmedErrors = errors.slice(0, 20);

    const overall = computeOverallScore(providers, connected, lastScan, trimmedErrors.length);

    const response: HealthResponse = {
      providers,
      marketService: {
        connected,
        lastTick,
        port: 3002,
        url: 'ws://localhost:3002',
      },
      lastScan,
      errors: trimmedErrors,
      rateLimits,
      overall,
      timestamp: Date.now(),
    };

    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to build health status', message: (e as Error).message },
      { status: 500 },
    );
  }
}
