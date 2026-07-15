'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Brain, Loader2, AlertTriangle, RefreshCw, ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Types (mirror API contract)                                               */
/* -------------------------------------------------------------------------- */

type LearningTier = 'RELIABLE' | 'PRELIMINARY' | 'INSUFFICIENT';

interface LearningPattern {
  symbol: string;
  direction: string;
  marketState: string;
  technicalTrend: string;
  sector: string;
  vixBand: string;
  rawN: number;
  effectiveN: number;
  tier: LearningTier;
  winRatePct: number;
  ciLower: number;
  ciUpper: number;
  avgR: number;
  lastSeenAt: string;
}

interface LearningStats {
  total: number;
  reliable: number;
  preliminary: number;
  insufficient: number;
}

interface LearningResponse {
  patterns: LearningPattern[];
  stats: LearningStats;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const TIER_STYLES: Record<LearningTier, string> = {
  RELIABLE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PRELIMINARY: 'border-amber-200 bg-amber-50 text-amber-700',
  INSUFFICIENT: 'border-gray-200 bg-gray-50 text-gray-500',
};

function TierBadge({ tier }: { tier: LearningTier }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 px-1.5 font-mono text-[9px] font-bold tracking-wider',
        TIER_STYLES[tier]
      )}
    >
      {tier}
    </Badge>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 0) return 'now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function winRateColor(pct: number): string {
  if (pct >= 60) return 'text-emerald-600';
  if (pct >= 50) return 'text-purple-600';
  if (pct >= 40) return 'text-amber-600';
  return 'text-rose-500';
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

type SortKey = 'effectiveN' | 'rawN' | 'winRatePct' | 'avgR' | 'lastSeenAt';
type SortDir = 'asc' | 'desc';

export function LearningPanel() {
  const [data, setData] = useState<LearningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('effectiveN');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/odss/learning', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LearningResponse = await res.json();
      setData(json);
      setError(null);
      setLastFetchedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load learning data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const sorted = useMemo(() => {
    if (!data?.patterns) return [];
    const arr = [...data.patterns];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (av as number) - (bv as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'lastSeenAt' ? 'desc' : 'desc');
    }
  }

  const stats = data?.stats;
  const total = stats?.total ?? 0;
  const reliable = stats?.reliable ?? 0;
  const preliminary = stats?.preliminary ?? 0;
  const insufficient = stats?.insufficient ?? 0;

  const statCards = [
    {
      label: 'Total Patterns',
      value: total,
      tone: 'text-purple-600',
      dot: 'bg-purple-400',
    },
    {
      label: 'Reliable',
      value: reliable,
      tone: 'text-emerald-600',
      dot: 'bg-emerald-400',
    },
    {
      label: 'Preliminary',
      value: preliminary,
      tone: 'text-amber-600',
      dot: 'bg-amber-400',
    },
    {
      label: 'Insufficient',
      value: insufficient,
      tone: 'text-gray-500',
      dot: 'bg-gray-400',
    },
  ];

  return (
    <Card className="border-purple-100 bg-white/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-purple-50">
              <Brain className="h-4 w-4 text-purple-600" />
            </span>
            <span className="text-purple-700">PATTERN LEARNING</span>
            <span className="ml-1 font-mono text-[10px] font-normal tracking-wider text-muted-foreground">
              Wilson CI · Tier classification
            </span>
          </span>
          <span className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground">
            {lastFetchedAt && (
              <span suppressHydrationWarning>
                updated {new Date(lastFetchedAt).toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            )}
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-purple-100 bg-white/70 text-purple-600 transition-colors hover:bg-purple-50 disabled:opacity-50"
              title="Refresh now"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Stats header */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {statCards.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-purple-100 bg-white/60 px-3 py-2"
            >
              <div className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {s.label}
                </span>
              </div>
              <div className={cn('mt-0.5 font-mono text-lg font-bold tnum', s.tone)}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Error state */}
        {error && !data && (
          <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
            <span className="font-mono tracking-wider">Loading learned patterns…</span>
          </div>
        )}

        {/* Table */}
        {data && (
          <div className="max-h-96 overflow-y-auto rounded-md border border-purple-100 bg-white/50">
            <Table className="text-xs">
              <TableHeader className="sticky top-0 z-10 bg-purple-50/95 backdrop-blur">
                <TableRow className="border-purple-100 hover:bg-transparent">
                  <Th>Symbol</Th>
                  <Th>Dir</Th>
                  <Th>Mkt State</Th>
                  <Th>Trend</Th>
                  <Th>Sector</Th>
                  <Th>VIX Band</Th>
                  <Th>Raw N</Th>
                  <Th sortable active={sortKey === 'effectiveN'} dir={sortDir} onClick={() => toggleSort('effectiveN')}>
                    Eff N
                  </Th>
                  <Th>Tier</Th>
                  <Th sortable active={sortKey === 'winRatePct'} dir={sortDir} onClick={() => toggleSort('winRatePct')}>
                    Win % (CI)
                  </Th>
                  <Th sortable active={sortKey === 'avgR'} dir={sortDir} onClick={() => toggleSort('avgR')}>
                    Avg R
                  </Th>
                  <Th sortable active={sortKey === 'lastSeenAt'} dir={sortDir} onClick={() => toggleSort('lastSeenAt')}>
                    Last Seen
                  </Th>
                </TableRow>
              </TableHeader>
              <TableBody className="font-mono">
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-8 text-center font-sans text-xs text-muted-foreground">
                      No learned patterns yet. Engine collects outcomes over time.
                    </TableCell>
                  </TableRow>
                )}
                {sorted.map((p, i) => (
                  <TableRow
                    key={`${p.symbol}-${p.direction}-${p.marketState}-${i}`}
                    className="border-purple-50 text-[10px] hover:bg-purple-50/40"
                  >
                    <TableCell className="font-sans text-xs font-bold text-purple-700">
                      {p.symbol}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider',
                          p.direction === 'CE'
                            ? 'bg-emerald-50 text-emerald-700'
                            : p.direction === 'PE'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-gray-50 text-gray-600'
                        )}
                      >
                        {p.direction}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.marketState}</TableCell>
                    <TableCell className="text-muted-foreground">{p.technicalTrend}</TableCell>
                    <TableCell className="text-muted-foreground">{p.sector}</TableCell>
                    <TableCell className="text-muted-foreground">{p.vixBand}</TableCell>
                    <TableCell className="tnum text-muted-foreground">{p.rawN}</TableCell>
                    <TableCell className="tnum font-bold text-foreground">{p.effectiveN}</TableCell>
                    <TableCell>
                      <TierBadge tier={p.tier} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col leading-tight">
                        <span className={cn('font-bold tnum', winRateColor(p.winRatePct))}>
                          {p.winRatePct.toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          [{p.ciLower.toFixed(0)}–{p.ciUpper.toFixed(0)}]
                        </span>
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'tnum font-bold',
                        p.avgR >= 0 ? 'text-emerald-600' : 'text-rose-500'
                      )}
                    >
                      {p.avgR >= 0 ? '+' : ''}
                      {p.avgR.toFixed(2)}R
                    </TableCell>
                    <TableCell className="text-muted-foreground" suppressHydrationWarning>
                      {formatRelative(p.lastSeenAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Footer legend */}
        {data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm border border-emerald-200 bg-emerald-50" />
              RELIABLE · eff N ≥ 30
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm border border-amber-200 bg-amber-50" />
              PRELIMINARY · 10 ≤ eff N &lt; 30
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm border border-gray-200 bg-gray-50" />
              INSUFFICIENT · eff N &lt; 10
            </span>
            <span className="ml-auto">Polling every 30s · auto-refresh</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sortable table header                                                      */
/* -------------------------------------------------------------------------- */

function Th({
  children,
  sortable,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
}) {
  return (
    <TableHead
      className={cn(
        'h-7 px-2 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground',
        sortable && 'cursor-pointer select-none hover:text-purple-600',
        active && 'text-purple-700'
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {sortable && active && (
          dir === 'asc' ? (
            <ArrowUp className="h-2.5 w-2.5" />
          ) : (
            <ArrowDown className="h-2.5 w-2.5" />
          )
        )}
      </span>
    </TableHead>
  );
}
