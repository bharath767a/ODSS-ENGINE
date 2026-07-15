'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  TrendingUp,
  Loader2,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Trophy,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface SectorPerf {
  sector: string;
  ltp: number;
  changePct: number;
  weekReturn: number;
  monthReturn: number;
  quarterReturn: number;
  yearReturn: number;
  pe: number;
  pb: number;
}

interface SectorPerfResponse {
  sectors: SectorPerf[];
}

type SortKey =
  | 'sector'
  | 'ltp'
  | 'changePct'
  | 'weekReturn'
  | 'monthReturn'
  | 'quarterReturn'
  | 'yearReturn'
  | 'pe'
  | 'pb';
type SortDir = 'asc' | 'desc';

// ============================================================
// Fallback data — realistic Indian sector snapshot
// ============================================================
const FALLBACK_SECTORS: SectorPerf[] = [
  { sector: 'NIFTY 50', ltp: 24825.4, changePct: 0.42, weekReturn: 1.18, monthReturn: 2.95, quarterReturn: 6.42, yearReturn: 18.5, pe: 22.8, pb: 4.1 },
  { sector: 'BANK NIFTY', ltp: 54210.15, changePct: 0.58, weekReturn: 1.84, monthReturn: 3.42, quarterReturn: 7.95, yearReturn: 22.1, pe: 18.2, pb: 3.2 },
  { sector: 'BANKING', ltp: 51240.8, changePct: 0.55, weekReturn: 1.79, monthReturn: 3.21, quarterReturn: 7.65, yearReturn: 21.4, pe: 17.9, pb: 3.1 },
  { sector: 'IT', ltp: 42180.55, changePct: -0.32, weekReturn: -0.95, monthReturn: 1.45, quarterReturn: 4.21, yearReturn: 14.8, pe: 28.4, pb: 6.8 },
  { sector: 'AUTO', ltp: 25840.2, changePct: 0.71, weekReturn: 2.42, monthReturn: 5.18, quarterReturn: 9.85, yearReturn: 31.2, pe: 24.1, pb: 4.6 },
  { sector: 'PHARMA', ltp: 20185.6, changePct: 0.18, weekReturn: 0.65, monthReturn: 1.95, quarterReturn: 5.45, yearReturn: 28.7, pe: 26.8, pb: 4.2 },
  { sector: 'FMCG', ltp: 57420.9, changePct: -0.12, weekReturn: -0.42, monthReturn: 0.85, quarterReturn: 2.95, yearReturn: 11.4, pe: 42.5, pb: 9.2 },
  { sector: 'METAL', ltp: 9128.45, changePct: -0.95, weekReturn: -2.85, monthReturn: -4.15, quarterReturn: 1.25, yearReturn: 8.5, pe: 12.4, pb: 1.8 },
  { sector: 'ENERGY', ltp: 38450.3, changePct: 0.34, weekReturn: 1.12, monthReturn: 2.45, quarterReturn: 6.85, yearReturn: 24.2, pe: 14.8, pb: 2.1 },
  { sector: 'FINANCIAL', ltp: 23840.75, changePct: 0.45, weekReturn: 1.55, monthReturn: 3.85, quarterReturn: 8.42, yearReturn: 25.6, pe: 19.5, pb: 3.8 },
];

// ============================================================
// Main component
// ============================================================
export function SectorPerformancePanel() {
  const [sectors, setSectors] = useState<SectorPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('quarterReturn');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchSectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/odss/sector-performance');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SectorPerfResponse = await res.json();
      const secs = data?.sectors;
      if (!Array.isArray(secs) || secs.length === 0) throw new Error('Empty sectors');
      setSectors(secs);
    } catch (err: any) {
      console.warn('[SectorPerf] /api/odss/sector-performance failed, using fallback:', err?.message);
      setSectors(FALLBACK_SECTORS);
      setError('Live sector engine unavailable — showing snapshot estimates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSectors();
  }, [fetchSectors]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'sector' ? 'asc' : 'desc');
    }
  };

  const sortedSectors = useMemo(() => {
    const list = [...sectors];
    list.sort((a, b) => {
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
    return list;
  }, [sectors, sortKey, sortDir]);

  // Best/worst by quarter return (3M) — highlight
  const best3M = useMemo(() => {
    if (sectors.length === 0) return null;
    return [...sectors].sort((a, b) => b.quarterReturn - a.quarterReturn)[0];
  }, [sectors]);
  const worst3M = useMemo(() => {
    if (sectors.length === 0) return null;
    return [...sectors].sort((a, b) => a.quarterReturn - b.quarterReturn)[0];
  }, [sectors]);

  // Max abs return across return columns — for bar scaling
  const maxAbsReturn = useMemo(() => {
    if (sectors.length === 0) return 1;
    const all: number[] = [];
    for (const s of sectors) {
      all.push(s.changePct, s.weekReturn, s.monthReturn, s.quarterReturn, s.yearReturn);
    }
    return Math.max(...all.map((n) => Math.abs(n)), 1);
  }, [sectors]);

  return (
    <Card className="border-purple-100 bg-white/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-purple-50">
            <TrendingUp className="h-4 w-4 text-purple-600" />
          </div>
          <span className="text-base font-bold text-purple-700">SECTOR PERFORMANCE</span>
          <span className="font-mono text-[10px] font-normal text-muted-foreground">
            · multi-period returns · P/E · P/B
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchSectors}
            disabled={loading}
            className="ml-auto h-7 border-purple-100 bg-white/70 font-mono text-[10px] text-purple-700 hover:bg-purple-50"
          >
            {loading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Refresh
          </Button>
        </CardTitle>
        {error && (
          <div className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1">
            <AlertCircle className="h-3 w-3 text-amber-600" />
            <span className="font-mono text-[10px] text-amber-700">{error}</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="px-2 pb-2 sm:px-4">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              Loading sector returns…
            </span>
          </div>
        ) : sortedSectors.length === 0 ? (
          <div className="flex h-48 items-center justify-center font-mono text-xs text-muted-foreground">
            No sector data available.
          </div>
        ) : (
          <>
            {/* Best/Worst summary chips */}
            <div className="mb-3 flex flex-wrap gap-2">
              {best3M && (
                <Badge
                  variant="outline"
                  className="border-bull/40 bg-bull/10 px-2 py-1 font-mono text-[10px] text-bull"
                >
                  <Trophy className="mr-1 h-3 w-3" />
                  Best 3M: {best3M.sector} +{best3M.quarterReturn.toFixed(2)}%
                </Badge>
              )}
              {worst3M && (
                <Badge
                  variant="outline"
                  className="border-bear/40 bg-bear/10 px-2 py-1 font-mono text-[10px] text-bear"
                >
                  <Trophy className="mr-1 h-3 w-3 rotate-180" />
                  Worst 3M: {worst3M.sector} {worst3M.quarterReturn.toFixed(2)}%
                </Badge>
              )}
            </div>

            <div className="overflow-x-auto">
              <Table className="font-mono">
                <TableHeader>
                  <TableRow className="border-purple-100 hover:bg-transparent">
                    <SortHeader
                      label="SECTOR"
                      sortKey="sector"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="min-w-[120px]"
                    />
                    <SortHeader
                      label="LTP"
                      sortKey="ltp"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                    <SortHeader
                      label="TODAY"
                      sortKey="changePct"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                    <SortHeader
                      label="1W"
                      sortKey="weekReturn"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                    <SortHeader
                      label="1M"
                      sortKey="monthReturn"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                    <SortHeader
                      label="3M"
                      sortKey="quarterReturn"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                    <SortHeader
                      label="1Y"
                      sortKey="yearReturn"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                    <SortHeader
                      label="P/E"
                      sortKey="pe"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                    <SortHeader
                      label="P/B"
                      sortKey="pb"
                      current={sortKey}
                      dir={sortDir}
                      onClick={handleSort}
                      className="text-right"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSectors.map((s) => {
                    const isBest = best3M?.sector === s.sector;
                    const isWorst = worst3M?.sector === s.sector;
                    return (
                      <TableRow
                        key={s.sector}
                        className={cn(
                          'border-purple-50 transition-colors',
                          isBest && 'bg-bull/5 hover:bg-bull/10',
                          isWorst && 'bg-bear/5 hover:bg-bear/10',
                          !isBest && !isWorst && 'hover:bg-purple-50/60',
                        )}
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-foreground">
                              {s.sector}
                            </span>
                            {isBest && (
                              <span
                                title="Best 3M performer"
                                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bull/20 text-bull"
                              >
                                <Trophy className="h-2 w-2" />
                              </span>
                            )}
                            {isWorst && (
                              <span
                                title="Worst 3M performer"
                                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bear/20 text-bear"
                              >
                                <Trophy className="h-2 w-2 rotate-180" />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-right text-[11px] font-semibold text-foreground">
                          {s.ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </TableCell>
                        <ReturnCell value={s.changePct} maxAbs={maxAbsReturn} />
                        <ReturnCell value={s.weekReturn} maxAbs={maxAbsReturn} />
                        <ReturnCell value={s.monthReturn} maxAbs={maxAbsReturn} />
                        <ReturnCell value={s.quarterReturn} maxAbs={maxAbsReturn} />
                        <ReturnCell value={s.yearReturn} maxAbs={maxAbsReturn} />
                        <ValuationCell value={s.pe} />
                        <ValuationCell value={s.pb} />
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Footnote */}
            <p className="mt-2 px-1 font-mono text-[9px] text-muted-foreground">
              Click any column header to sort. Bars are scaled to the largest absolute
              return in the table. P/E &amp; P/B are weighted-average sector valuations.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Sortable header
// ============================================================
function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onClick,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  const isActive = current === sortKey;
  return (
    <TableHead className={cn('h-8 px-2', className)}>
      <button
        onClick={() => onClick(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider transition-colors hover:text-purple-700',
          isActive ? 'text-purple-700' : 'text-muted-foreground',
          className?.includes('right') && 'flex-row-reverse',
        )}
      >
        {label}
        {isActive ? (
          dir === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

// ============================================================
// Return cell — value + horizontal bar
// ============================================================
function ReturnCell({ value, maxAbs }: { value: number; maxAbs: number }) {
  const positive = value >= 0;
  const pct = Math.min(100, (Math.abs(value) / maxAbs) * 100);
  return (
    <TableCell className="py-2">
      <div className="flex flex-col items-end gap-0.5">
        <span
          className={cn(
            'text-[11px] font-bold',
            positive ? 'text-bull' : 'text-bear',
          )}
        >
          {positive ? '+' : ''}
          {value.toFixed(2)}%
        </span>
        {/* Bar — anchored to a mid-line, grows left (negative) or right (positive) */}
        <div className="relative h-1 w-20 overflow-hidden rounded-full bg-purple-100">
          <div className="absolute left-1/2 top-0 h-full w-px bg-purple-300" />
          {positive ? (
            <div
              className="absolute left-1/2 top-0 h-full rounded-r-full bg-bull/70"
              style={{ width: `${pct / 2}%` }}
            />
          ) : (
            <div
              className="absolute right-1/2 top-0 h-full rounded-l-full bg-bear/70"
              style={{ width: `${pct / 2}%` }}
            />
          )}
        </div>
      </div>
    </TableCell>
  );
}

// ============================================================
// Valuation cell (P/E, P/B) — colored by relative cheapness
// ============================================================
function ValuationCell({ value }: { value: number }) {
  // Heuristic thresholds for Indian sector indices
  const tone =
    value <= 15
      ? 'text-bull'
      : value <= 25
        ? 'text-foreground'
        : value <= 35
          ? 'text-amber-600'
          : 'text-bear';
  return (
    <TableCell className="py-2 text-right">
      <span className={cn('text-[11px] font-semibold', tone)}>{value.toFixed(1)}</span>
    </TableCell>
  );
}
