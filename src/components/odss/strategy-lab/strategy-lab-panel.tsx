'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dna,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Sparkles,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Types (mirror API contract)                                               */
/* -------------------------------------------------------------------------- */

type VariantTier = 'RELIABLE' | 'PRELIMINARY' | 'INSUFFICIENT';
type VariantStatus = 'ACTIVE' | 'CANDIDATE' | 'RETIRED' | 'GRAVEYARD';

interface StrategyVariant {
  name: string;
  genome: string;
  rawN: number;
  effectiveN: number;
  tier: VariantTier;
  winRatePct: number;
  profitFactor: number;
  fitness: number;
  avgR: number;
  status: VariantStatus;
}

interface StrategyStats {
  total: number;
  active: number;
  candidate: number;
  retired: number;
  graveyard: number;
}

interface StrategyLabResponse {
  variants: StrategyVariant[];
  stats: StrategyStats;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const TIER_STYLES: Record<VariantTier, string> = {
  RELIABLE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PRELIMINARY: 'border-amber-200 bg-amber-50 text-amber-700',
  INSUFFICIENT: 'border-gray-200 bg-gray-50 text-gray-500',
};

const STATUS_STYLES: Record<VariantStatus, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANDIDATE: 'border-purple-200 bg-purple-50 text-purple-700',
  RETIRED: 'border-amber-200 bg-amber-50 text-amber-600',
  GRAVEYARD: 'border-gray-200 bg-gray-50 text-gray-500',
};

function TierBadge({ tier }: { tier: VariantTier }) {
  return (
    <Badge
      variant="outline"
      className={cn('h-5 px-1.5 font-mono text-[9px] font-bold tracking-wider', TIER_STYLES[tier])}
    >
      {tier}
    </Badge>
  );
}

function StatusBadge({ status }: { status: VariantStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 px-1.5 font-mono text-[9px] font-bold tracking-wider',
        STATUS_STYLES[status]
      )}
    >
      {status}
    </Badge>
  );
}

function fitnessColor(f: number): string {
  if (f >= 1.5) return 'text-emerald-600';
  if (f >= 1.0) return 'text-purple-600';
  if (f >= 0.5) return 'text-amber-600';
  return 'text-rose-500';
}

function pfColor(pf: number): string {
  if (pf >= 1.5) return 'text-emerald-600';
  if (pf >= 1.0) return 'text-purple-600';
  return 'text-rose-500';
}

function winColor(pct: number): string {
  if (pct >= 60) return 'text-emerald-600';
  if (pct >= 50) return 'text-purple-600';
  if (pct >= 40) return 'text-amber-600';
  return 'text-rose-500';
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

type SortKey =
  | 'name'
  | 'rawN'
  | 'effectiveN'
  | 'winRatePct'
  | 'profitFactor'
  | 'fitness'
  | 'avgR';

type SortDir = 'asc' | 'desc';

export function StrategyLabPanel() {
  const [data, setData] = useState<StrategyLabResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('effectiveN');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<StrategyVariant | null>(null);
  const [busy, setBusy] = useState<'create' | 'evolve' | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/odss/strategy-lab', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StrategyLabResponse = await res.json();
      setData(json);
      setError(null);
      setLastFetchedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load strategy lab');
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
    if (!data?.variants) return [];
    const arr = [...data.variants];
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
      setSortDir('desc');
    }
  }

  async function runAction(kind: 'create' | 'evolve') {
    setBusy(kind);
    setActionMsg(null);
    try {
      const endpoint =
        kind === 'create'
          ? '/api/odss/strategy-lab/create'
          : '/api/odss/strategy-lab/evolve';
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${txt ? `: ${txt}` : ''}`);
      }
      const json = await res.json().catch(() => ({}));
      setActionMsg({
        type: 'ok',
        text:
          kind === 'create'
            ? `Variant created${json?.name ? `: ${json.name}` : ''}`
            : `Evolution cycle complete${json?.generations ? ` · ${json.generations} gen` : ''}`,
      });
      await fetchData();
    } catch (e) {
      setActionMsg({
        type: 'err',
        text: e instanceof Error ? e.message : `${kind} failed`,
      });
    } finally {
      setBusy(null);
      // Auto-clear message after 6s
      setTimeout(() => setActionMsg(null), 6000);
    }
  }

  const stats = data?.stats;
  const total = stats?.total ?? 0;
  const active = stats?.active ?? 0;
  const candidate = stats?.candidate ?? 0;
  const retired = stats?.retired ?? 0;
  const graveyard = stats?.graveyard ?? 0;

  const statCards = [
    { label: 'Total', value: total, tone: 'text-purple-600', dot: 'bg-purple-400' },
    { label: 'Active', value: active, tone: 'text-emerald-600', dot: 'bg-emerald-400' },
    { label: 'Candidate', value: candidate, tone: 'text-violet-600', dot: 'bg-violet-400' },
    { label: 'Retired', value: retired, tone: 'text-amber-600', dot: 'bg-amber-400' },
    { label: 'Graveyard', value: graveyard, tone: 'text-gray-500', dot: 'bg-gray-400' },
  ];

  return (
    <Card className="border-purple-100 bg-white/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-purple-50">
              <Dna className="h-4 w-4 text-purple-600" />
            </span>
            <span className="text-purple-700">STRATEGY LAB</span>
            <span className="ml-1 font-mono text-[10px] font-normal tracking-wider text-muted-foreground">
              Genome evolution · fitness scoring
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAction('create')}
              disabled={busy !== null}
              className="h-7 border-purple-200 bg-white/70 px-2 font-mono text-[10px] tracking-wider text-purple-600 hover:bg-purple-50 hover:text-purple-700"
            >
              {busy === 'create' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3 w-3" />
              )}
              CREATE VARIANT
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAction('evolve')}
              disabled={busy !== null}
              className="h-7 border-purple-200 bg-white/70 px-2 font-mono text-[10px] tracking-wider text-purple-600 hover:bg-purple-50 hover:text-purple-700"
            >
              {busy === 'evolve' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3 w-3" />
              )}
              EVOLVE
            </Button>
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-purple-100 bg-white/70 text-purple-600 transition-colors hover:bg-purple-50 disabled:opacity-50"
              title="Refresh now"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Stats header */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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

        {/* Action feedback */}
        {actionMsg && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-xs',
              actionMsg.type === 'ok'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border border-rose-200 bg-rose-50 text-rose-700'
            )}
          >
            {actionMsg.type === 'ok' ? (
              <Sparkles className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            <span className="font-mono">{actionMsg.text}</span>
          </div>
        )}

        {/* Error state */}
        {error && !data && (
          <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
            <span className="font-mono tracking-wider">Loading strategy variants…</span>
          </div>
        )}

        {/* Table */}
        {data && (
          <div className="max-h-96 overflow-y-auto rounded-md border border-purple-100 bg-white/50">
            <Table className="text-xs">
              <TableHeader className="sticky top-0 z-10 bg-purple-50/95 backdrop-blur">
                <TableRow className="border-purple-100 hover:bg-transparent">
                  <Th sortable active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')}>
                    Name
                  </Th>
                  <Th>Genome</Th>
                  <Th sortable active={sortKey === 'rawN'} dir={sortDir} onClick={() => toggleSort('rawN')}>
                    Raw N
                  </Th>
                  <Th sortable active={sortKey === 'effectiveN'} dir={sortDir} onClick={() => toggleSort('effectiveN')}>
                    Eff N
                  </Th>
                  <Th>Tier</Th>
                  <Th sortable active={sortKey === 'winRatePct'} dir={sortDir} onClick={() => toggleSort('winRatePct')}>
                    Win %
                  </Th>
                  <Th sortable active={sortKey === 'profitFactor'} dir={sortDir} onClick={() => toggleSort('profitFactor')}>
                    PF
                  </Th>
                  <Th sortable active={sortKey === 'fitness'} dir={sortDir} onClick={() => toggleSort('fitness')}>
                    Fitness
                  </Th>
                  <Th sortable active={sortKey === 'avgR'} dir={sortDir} onClick={() => toggleSort('avgR')}>
                    Avg R
                  </Th>
                  <Th>Status</Th>
                  <Th></Th>
                </TableRow>
              </TableHeader>
              <TableBody className="font-mono">
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center font-sans text-xs text-muted-foreground">
                      No variants yet. Use CREATE VARIANT to seed the genome pool.
                    </TableCell>
                  </TableRow>
                )}
                {sorted.map((v, i) => {
                  const isSelected = selected?.name === v.name;
                  return (
                    <TableRow
                      key={`${v.name}-${i}`}
                      className={cn(
                        'cursor-pointer border-purple-50 text-[10px] transition-colors hover:bg-purple-50/40',
                        isSelected && 'bg-purple-50/70'
                      )}
                      onClick={() => setSelected(isSelected ? null : v)}
                    >
                      <TableCell className="font-sans text-xs font-bold text-purple-700">
                        {v.name}
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-purple-50/70 px-1.5 py-0.5 font-mono text-[9px] text-purple-600">
                          {v.genome.length > 24 ? `${v.genome.slice(0, 24)}…` : v.genome}
                        </code>
                      </TableCell>
                      <TableCell className="tnum text-muted-foreground">{v.rawN}</TableCell>
                      <TableCell className="tnum font-bold text-foreground">{v.effectiveN}</TableCell>
                      <TableCell>
                        <TierBadge tier={v.tier} />
                      </TableCell>
                      <TableCell className={cn('tnum font-bold', winColor(v.winRatePct))}>
                        {v.winRatePct.toFixed(1)}%
                      </TableCell>
                      <TableCell className={cn('tnum font-bold', pfColor(v.profitFactor))}>
                        {v.profitFactor.toFixed(2)}
                      </TableCell>
                      <TableCell className={cn('tnum font-bold', fitnessColor(v.fitness))}>
                        {v.fitness.toFixed(2)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'tnum font-bold',
                          v.avgR >= 0 ? 'text-emerald-600' : 'text-rose-500'
                        )}
                      >
                        {v.avgR >= 0 ? '+' : ''}
                        {v.avgR.toFixed(2)}R
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={v.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <ChevronRight
                          className={cn(
                            'h-3 w-3 transition-transform',
                            isSelected && 'rotate-90 text-purple-600'
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Selected detail */}
        {selected && (
          <div className="rounded-md border border-purple-200 bg-purple-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-purple-700">
                Variant Detail · {selected.name}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-white/60 hover:text-purple-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] md:grid-cols-4">
              <DetailRow label="Genome" value={selected.genome} mono />
              <DetailRow label="Tier" value={selected.tier} />
              <DetailRow label="Status" value={selected.status} />
              <DetailRow label="Raw N" value={String(selected.rawN)} />
              <DetailRow label="Effective N" value={String(selected.effectiveN)} />
              <DetailRow label="Win Rate" value={`${selected.winRatePct.toFixed(1)}%`} />
              <DetailRow label="Profit Factor" value={selected.profitFactor.toFixed(2)} />
              <DetailRow label="Fitness" value={selected.fitness.toFixed(2)} />
              <DetailRow
                label="Avg R"
                value={`${selected.avgR >= 0 ? '+' : ''}${selected.avgR.toFixed(2)}R`}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        {data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] tracking-wider text-muted-foreground">
            <span>Click any row to inspect the genome</span>
            <span className="ml-auto" suppressHydrationWarning>
              {lastFetchedAt
                ? `last sync ${new Date(lastFetchedAt).toLocaleTimeString('en-IN', { hour12: false })}`
                : ''}{' '}
              · Polling every 30s
            </span>
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

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[8px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span
        className={cn(
          'truncate text-foreground',
          mono ? 'font-mono text-[9px]' : 'text-[10px] font-semibold'
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
