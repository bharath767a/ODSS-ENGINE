'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Loader2,
  RefreshCw,
  Activity,
  Server,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Radio,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Database,
  Cpu,
  Zap,
} from 'lucide-react';

// ============================================================
// Health Monitor Panel + Health Badge
// ------------------------------------------------------------
// HealthMonitorPanel: full panel rendering system health.
//   - Polls /api/odss/health every 30s (plus on mount)
//   - Shows each data provider (NSE / Yahoo / Angel One / etc.)
//   - Shows mini-service (odss-market) connection status
//   - Shows last scan time, error count, rate limit status
//   - Shows overall health score with GREEN/YELLOW/RED tier
//
// HealthBadge: compact badge for the header.
//   - Polls /api/odss/health every 30s
//   - Renders a small dot + tier label
//   - On click, opens a tooltip-style dropdown with quick stats
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
    score: number;
    tier: 'GREEN' | 'YELLOW' | 'RED';
    label: string;
  };
  timestamp: number;
}

const POLL_INTERVAL_MS = 30_000;

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-IN');
}

function tierConfig(tier: 'GREEN' | 'YELLOW' | 'RED') {
  switch (tier) {
    case 'GREEN':
      return {
        Icon: ShieldCheck,
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        dot: 'bg-emerald-500',
        label: 'Healthy',
        gradient: 'from-emerald-400 to-emerald-600',
      };
    case 'YELLOW':
      return {
        Icon: ShieldAlert,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        dot: 'bg-amber-500',
        label: 'Degraded',
        gradient: 'from-amber-400 to-amber-600',
      };
    case 'RED':
      return {
        Icon: ShieldX,
        color: 'text-rose-600',
        bg: 'bg-rose-50',
        border: 'border-rose-200',
        dot: 'bg-rose-500',
        label: 'Critical',
        gradient: 'from-rose-400 to-rose-600',
      };
  }
}

function providerStatusConfig(status: ProviderHealthDTO['status']) {
  switch (status) {
    case 'ACTIVE':
      return { Icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Active' };
    case 'RATE_LIMITED':
      return { Icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Rate Limited' };
    case 'ERROR':
      return { Icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', label: 'Error' };
    case 'NOT_CONFIGURED':
      return { Icon: XCircle, color: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-purple-100', label: 'Not Configured' };
    case 'DISABLED':
      return { Icon: XCircle, color: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-purple-100', label: 'Disabled' };
  }
}

// ============================================================
// Hook: shared polling logic for both Panel and Badge
// ============================================================

function useHealthPolling() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/odss/health', { cache: 'no-store' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message ?? `HTTP ${res.status}`);
      }
      const data: HealthResponse = await res.json();
      setHealth(data);
    } catch (e) {
      setError((e as Error).message || 'Failed to load health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchHealth]);

  return { health, loading, error, refetch: fetchHealth };
}

// ============================================================
// HealthMonitorPanel
// ============================================================

export function HealthMonitorPanel() {
  const { health, loading, error, refetch } = useHealthPolling();
  const tier = health?.overall.tier ?? 'GREEN';
  const cfg = tierConfig(tier);

  return (
    <Card className="border-purple-100 bg-white/70 shadow-card-soft backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-gradient-to-br from-purple-100 to-violet-50">
              <Activity className="h-3.5 w-3.5 text-purple-600" />
            </div>
            <div className="leading-tight">
              <h2 className="text-sm font-bold tracking-tight">
                <span className="text-gradient-ai">System Health</span>
              </h2>
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
                DATA PROVIDERS · MINI-SERVICE · RATE LIMITS
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={refetch}
              disabled={loading}
              className="h-7 border-purple-200 bg-white/70 px-2 font-mono text-[10px] tracking-wider text-purple-700 hover:bg-purple-50 hover:text-purple-800"
            >
              {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              REFRESH
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Loading state */}
        {loading && !health && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-purple-600">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground">
              CHECKING SYSTEM HEALTH...
            </p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-4 text-center">
            <AlertTriangle className="h-6 w-6 text-rose-500" />
            <p className="text-sm font-bold text-rose-700">Health check failed</p>
            <p className="font-mono text-[10px] text-rose-600">{error}</p>
            <Button size="sm" variant="outline" onClick={refetch} className="mt-1 border-rose-200 bg-white text-rose-700 hover:bg-rose-50">
              <RefreshCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          </div>
        )}

        {/* Content */}
        {health && !error && (
          <>
            {/* Overall health score */}
            <div className={cn('rounded-lg border p-3', cfg.border, cfg.bg)}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-full border-2', cfg.border, cfg.bg)}>
                    <cfg.Icon className={cn('h-5 w-5', cfg.color)} />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-foreground">{health.overall.score}</span>
                      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">/ 100</span>
                    </div>
                    <p className={cn('text-xs font-bold uppercase tracking-wider', cfg.color)}>
                      {cfg.label}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">SCAN</div>
                  <div className="font-mono text-xs font-bold text-foreground">
                    {formatRelativeTime(health.lastScan)}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] italic leading-snug text-foreground/70">{health.overall.label}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-purple-100">
                <div
                  className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', cfg.gradient)}
                  style={{ width: `${health.overall.score}%` }}
                />
              </div>
            </div>

            {/* Mini-service status */}
            <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
              <div className="mb-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <Server className="h-3 w-3 text-purple-500" /> Mini-Service (odss-market)
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest',
                      health.marketService.connected
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        health.marketService.connected ? 'bg-emerald-500 live-dot' : 'bg-rose-500',
                      )}
                    />
                    {health.marketService.connected ? 'CONNECTED' : 'OFFLINE'}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    :{health.marketService.port}
                  </span>
                </div>
                <div className="text-right font-mono text-[10px] text-muted-foreground">
                  <div>LAST TICK: {formatRelativeTime(health.marketService.lastTick)}</div>
                </div>
              </div>
            </div>

            {/* Data providers */}
            <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Database className="h-3 w-3 text-purple-500" /> Data Providers
                </span>
                <Badge variant="outline" className="border-purple-200 bg-purple-50 font-mono text-[10px] text-purple-700">
                  {health.providers.filter((p) => p.status === 'ACTIVE').length} / {health.providers.length} ACTIVE
                </Badge>
              </div>
              <div className="space-y-1.5">
                {health.providers.map((p) => {
                  const pcfg = providerStatusConfig(p.status);
                  const errRate = p.callCount > 0 ? (p.errorCount / p.callCount) * 100 : 0;
                  return (
                    <div
                      key={p.name}
                      className="grid grid-cols-[80px_1fr_auto] items-center gap-2 rounded border border-purple-100 bg-white/70 px-2 py-1.5 font-mono text-[10px]"
                    >
                      <span className="font-bold text-foreground/90">{p.name}</span>
                      <div className="flex items-center gap-1.5">
                        <pcfg.Icon className={cn('h-3 w-3', pcfg.color)} />
                        <span className={pcfg.color}>{pcfg.label}</span>
                        <span className="text-purple-200">·</span>
                        <span className="text-muted-foreground">
                          {p.callCount} calls
                        </span>
                        {p.errorCount > 0 && (
                          <>
                            <span className="text-purple-200">·</span>
                            <span className="text-rose-600">{p.errorCount} err ({errRate.toFixed(0)}%)</span>
                          </>
                        )}
                      </div>
                      <span className="text-right text-[9px] text-muted-foreground">
                        {formatRelativeTime(p.lastSuccess)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rate limits */}
            <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
              <div className="mb-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <Zap className="h-3 w-3 text-purple-500" /> Rate Limits
              </div>
              <div className="space-y-1">
                {health.rateLimits.map((rl) => {
                  const pct =
                    rl.maxPerWindow === Infinity
                      ? 100
                      : Math.max(0, Math.min(100, (rl.remaining / rl.maxPerWindow) * 100));
                  return (
                    <div
                      key={rl.provider}
                      className="grid grid-cols-[80px_1fr_70px] items-center gap-2 font-mono text-[10px]"
                    >
                      <span className="font-bold text-foreground/80">{rl.provider}</span>
                      <div className="relative h-2 overflow-hidden rounded-full bg-purple-100">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            rl.blocked
                              ? 'bg-rose-500'
                              : pct > 50
                                ? 'bg-emerald-500'
                                : pct > 20
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={cn('text-right text-[9px]', rl.blocked ? 'text-rose-600' : 'text-muted-foreground')}>
                        {rl.blocked
                          ? 'BLOCKED'
                          : rl.maxPerWindow === Infinity
                            ? '∞'
                            : `${rl.remaining}/${rl.maxPerWindow}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Errors */}
            {health.errors.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-rose-700">
                    <AlertTriangle className="h-3 w-3" /> Recent Errors
                  </span>
                  <Badge variant="outline" className="border-rose-200 bg-white font-mono text-[10px] text-rose-700">
                    {health.errors.length}
                  </Badge>
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                  {health.errors.map((e, i) => (
                    <div
                      key={`${e.timestamp}-${i}`}
                      className="rounded border border-rose-100 bg-white/70 px-2 py-1 font-mono text-[10px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-rose-700">{e.source}</span>
                        <span className="text-[9px] text-muted-foreground">
                          {formatRelativeTime(e.timestamp)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-snug text-foreground/80">{e.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-purple-100 pt-2 font-mono text-[10px] tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3 text-purple-500" />
                POLLS EVERY 30s
              </span>
              <span className="text-purple-600">
                {new Date(health.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// HealthBadge — compact badge for the header
// ============================================================

export function HealthBadge() {
  const { health, loading, error } = useHealthPolling();
  const [open, setOpen] = useState(false);

  const tier = error ? 'RED' : health?.overall.tier ?? 'GREEN';
  const cfg = tierConfig(tier);
  const Icon = error ? AlertTriangle : cfg.Icon;

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('[data-health-badge]')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" data-health-badge>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] font-semibold tracking-widest transition-all hover:shadow-sm',
          cfg.border,
          cfg.bg,
          cfg.color,
        )}
        title={health?.overall.label ?? 'System health'}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot, health && 'live-pulse-soft')} />
        )}
        <span className="hidden sm:inline">HEALTH</span>
        <span className="sm:hidden">{cfg.label.toUpperCase().slice(0, 4)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-purple-200 bg-white p-3 shadow-xl">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-purple-100 pb-2">
            <div className={cn('flex h-8 w-8 items-center justify-center rounded-full border-2', cfg.border, cfg.bg)}>
              <Icon className={cn('h-4 w-4', cfg.color)} />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-bold text-foreground">
                  {error ? '—' : health?.overall.score ?? '—'}
                </span>
                <span className="font-mono text-[9px] tracking-widest text-muted-foreground">/100</span>
              </div>
              <p className={cn('text-[10px] font-bold uppercase tracking-wider', cfg.color)}>
                {error ? 'Unavailable' : cfg.label}
              </p>
            </div>
          </div>

          {/* Body */}
          {!error && health && (
            <div className="space-y-1.5 py-2 font-mono text-[10px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Radio className="h-3 w-3" /> Mini-Service
                </span>
                <span className={health.marketService.connected ? 'text-emerald-600' : 'text-rose-600'}>
                  {health.marketService.connected ? '● CONNECTED' : '● OFFLINE'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Activity className="h-3 w-3" /> Last Scan
                </span>
                <span className="text-foreground/80">{formatRelativeTime(health.lastScan)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Database className="h-3 w-3" /> Providers
                </span>
                <span className="text-foreground/80">
                  {health.providers.filter((p) => p.status === 'ACTIVE').length}/{health.providers.length} active
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" /> Errors
                </span>
                <span className={health.errors.length > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                  {health.errors.length}
                </span>
              </div>
              <p className="mt-1 border-t border-purple-100 pt-1 text-[10px] italic leading-snug text-foreground/70">
                {health.overall.label}
              </p>
            </div>
          )}

          {error && (
            <div className="py-2 text-center font-mono text-[10px] text-rose-600">
              Health check unavailable
              <br />
              <span className="text-[9px] text-muted-foreground">{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
