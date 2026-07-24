'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calendar,
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { ALL_SYMBOLS, getSymbolMeta } from '@/lib/odss/universe';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface SeasonalStock {
  symbol: string;
  avgReturn: number; // percentage
  winRate: number; // 0-100
}

interface MonthSeasonal {
  month: number; // 1-12
  name: string;
  bullish: SeasonalStock[];
  bearish: SeasonalStock[];
}

interface SeasonalResponse {
  months: MonthSeasonal[];
}

interface StockMonthlyStat {
  month: number;
  avgReturn: number;
  winRate: number;
  occurrences: number;
}

interface SeasonalDataResponse {
  symbol?: string;
  months?: StockMonthlyStat[];
}

// ============================================================
// Helpers — deterministic fallback
// ============================================================
const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Indian market seasonal patterns (well-known tendencies — used as fallback only)
const INDIAN_SEASONAL: Record<number, { bullish: string[]; bearish: string[] }> = {
  1: { bullish: ['IT', 'FMCG', 'PHARMA'], bearish: ['METAL', 'AUTO'] }, // Jan — IT earnings run-up
  2: { bullish: ['AUTO', 'METAL'], bearish: ['FMCG'] }, // Feb — pre-Budget auto
  3: { bullish: ['BANKING', 'FINANCIAL'], bearish: ['IT'] }, // Mar — FY end, banking
  4: { bullish: ['IT', 'BANKING'], bearish: ['METAL'] }, // Apr — new FY, IT results
  5: { bullish: ['METAL', 'ENERGY'], bearish: ['PHARMA'] }, // May — commodity cycle
  6: { bullish: ['FMCG', 'PHARMA'], bearish: ['AUTO', 'METAL'] }, // Jun — monsoon FMCG
  7: { bullish: ['IT', 'FMCG'], bearish: ['METAL'] }, // Jul — Q1 IT results
  8: { bullish: ['BANKING', 'AUTO'], bearish: ['PHARMA'] }, // Aug — auto festival prep
  9: { bullish: ['AUTO', 'METAL'], bearish: ['IT'] }, // Sep — festival auto
  10: { bullish: ['AUTO', 'BANKING', 'FMCG'], bearish: ['PHARMA'] }, // Oct — Diwali
  11: { bullish: ['BANKING', 'IT'], bearish: ['METAL'] }, // Nov — Nifty run
  12: { bullish: ['AUTO', 'FMCG'], bearish: ['IT'] }, // Dec — year-end auto
};

function generateFallbackMonths(): MonthSeasonal[] {
  const stocks = ALL_SYMBOLS.filter((s) => s.type === 'STOCK');
  const result: MonthSeasonal[] = [];
  for (let m = 1; m <= 12; m++) {
    const seasonal = INDIAN_SEASONAL[m];
    const bullishStocks = stocks.filter((s) => seasonal.bullish.includes(s.sector));
    const bearishStocks = stocks.filter((s) => seasonal.bearish.includes(s.sector));
    const mk = (list: typeof stocks, positive: boolean): SeasonalStock[] =>
      list.map((s) => {
        const rand = seededRandom(hashStr(s.symbol) + m * 131);
        const base = positive ? 1.5 + rand() * 6 : -(1.5 + rand() * 5);
        return {
          symbol: s.symbol,
          avgReturn: +base.toFixed(2),
          winRate: Math.round((positive ? 60 : 40) + rand() * 30),
        };
      });
    result.push({
      month: m,
      name: MONTH_NAMES[m - 1],
      bullish: mk(bullishStocks, true).sort((a, b) => b.avgReturn - a.avgReturn),
      bearish: mk(bearishStocks, false).sort((a, b) => a.avgReturn - b.avgReturn),
    });
  }
  return result;
}

function generateFallbackStockData(symbol: string): StockMonthlyStat[] {
  const meta = getSymbolMeta(symbol);
  if (!meta) return [];
  const months: StockMonthlyStat[] = [];
  for (let m = 1; m <= 12; m++) {
    const seasonal = INDIAN_SEASONAL[m];
    const isBull = seasonal.bullish.includes(meta.sector);
    const isBear = seasonal.bearish.includes(meta.sector);
    const rand = seededRandom(hashStr(symbol) + m * 131);
    let base: number;
    if (isBull) base = 1.5 + rand() * 6;
    else if (isBear) base = -(1.5 + rand() * 5);
    else base = (rand() - 0.5) * 5;
    months.push({
      month: m,
      avgReturn: +base.toFixed(2),
      winRate: Math.round((base >= 0 ? 55 : 45) + rand() * 30),
      occurrences: 8 + Math.floor(rand() * 5),
    });
  }
  return months;
}

// ============================================================
// Main component
// ============================================================
export function SeasonalCalendarView() {
  const [months, setMonths] = useState<MonthSeasonal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedStock, setSelectedStock] = useState<string>('__ALL__');
  const [stockData, setStockData] = useState<StockMonthlyStat[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  const [expandedMonth, setExpandedMonth] = useState<MonthSeasonal | null>(null);

  const stocks = useMemo(() => ALL_SYMBOLS.filter((s) => s.type === 'STOCK'), []);

  // ----- Fetch seasonal overview -----
  const fetchSeasonal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/odss/seasonal');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SeasonalResponse = await res.json();
      const ms = data?.months;
      if (!Array.isArray(ms) || ms.length === 0) throw new Error('Empty months');
      setMonths(ms);
    } catch (err: any) {
      console.warn('[Seasonal] /api/odss/seasonal failed, using fallback:', err?.message);
      setMonths(generateFallbackMonths());
      setError('Live seasonal engine unavailable — showing modeled historical patterns');
    } finally {
      setLoading(false);
    }
  }, []);

  // ----- Fetch per-stock seasonal stats -----
  const fetchStockData = useCallback(async (symbol: string) => {
    setStockLoading(true);
    try {
      const res = await fetch(`/api/odss/seasonal-data?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SeasonalDataResponse = await res.json();
      const ms = data?.months;
      if (!Array.isArray(ms) || ms.length === 0) throw new Error('Empty stats');
      setStockData(ms);
    } catch (err: any) {
      console.warn('[Seasonal] /api/odss/seasonal-data failed, using fallback:', err?.message);
      setStockData(generateFallbackStockData(symbol));
    } finally {
      setStockLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSeasonal();
  }, [fetchSeasonal]);

  useEffect(() => {
    if (selectedStock !== '__ALL__') fetchStockData(selectedStock);
    else setStockData([]);
  }, [selectedStock, fetchStockData]);

  return (
    <Card className="border-purple-100 bg-white/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-purple-50">
            <Calendar className="h-4 w-4 text-purple-600" />
          </div>
          <span className="text-base font-bold text-purple-700">SEASONAL PATTERNS</span>
          <span className="rounded bg-warn/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-warn" title="These are heuristic tendencies, NOT statistics computed from historical price data. Do not size trades on them.">ILLUSTRATIVE — NOT REAL STATS</span>
          <span className="font-mono text-[10px] font-normal text-muted-foreground">
            · historical monthly tendencies across sectors &amp; stocks
          </span>
          {error && (
            <Badge
              variant="outline"
              className="ml-auto border-amber-300 bg-amber-50 text-[10px] text-amber-700"
            >
              <AlertCircle className="mr-1 h-3 w-3" />
              {error}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Control bar */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">Stock focus:</span>
          <Select value={selectedStock} onValueChange={setSelectedStock}>
            <SelectTrigger
              size="sm"
              className="h-8 w-[220px] border-purple-100 bg-white/70 font-mono text-[11px]"
            >
              <SelectValue placeholder="Select a stock" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__" className="font-mono text-xs">
                All sectors overview
              </SelectItem>
              {stocks.map((s) => (
                <SelectItem key={s.symbol} value={s.symbol} className="font-mono text-xs">
                  {s.symbol} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchSeasonal}
            disabled={loading}
            className="h-8 border-purple-100 bg-white/70 font-mono text-[11px] text-purple-700 hover:bg-purple-50"
          >
            {loading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Refresh
          </Button>
          <div className="ml-auto flex items-center gap-3 font-mono text-[10px]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-bull/70" /> Bullish
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-bear/70" /> Bearish
            </span>
          </div>
        </div>

        {/* Per-stock monthly breakdown (when a stock is selected) */}
        {selectedStock !== '__ALL__' && (
          <StockSeasonalStrip
            symbol={selectedStock}
            data={stockData}
            loading={stockLoading}
          />
        )}

        {/* 12-month grid */}
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              Computing seasonal patterns…
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {months.map((m) => (
              <MonthCard key={m.month} month={m} onExpand={() => setExpandedMonth(m)} />
            ))}
          </div>
        )}
      </CardContent>

      {/* Expanded month dialog */}
      <Dialog open={!!expandedMonth} onOpenChange={(o) => !o && setExpandedMonth(null)}>
        <DialogContent className="max-w-2xl border-purple-100 bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm text-purple-700">
              <Calendar className="h-4 w-4" />
              {expandedMonth ? MONTH_FULL[expandedMonth.month - 1] : ''} · Seasonal Patterns
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              Stocks with historically strong / weak performance in this month. Based on
              multi-year average returns and win-rate.
            </DialogDescription>
          </DialogHeader>
          {expandedMonth && (
            <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
              <SeasonList
                title="Bullish setups"
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                tone="bull"
                stocks={expandedMonth.bullish}
              />
              <SeasonList
                title="Bearish setups"
                icon={<TrendingDown className="h-3.5 w-3.5" />}
                tone="bear"
                stocks={expandedMonth.bearish}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================
// Month card (in the 12-month grid)
// ============================================================
function MonthCard({ month, onExpand }: { month: MonthSeasonal; onExpand: () => void }) {
  const topBull = month.bullish.slice(0, 3);
  const topBear = month.bearish.slice(0, 3);
  return (
    <button
      onClick={onExpand}
      className="group rounded-lg border border-purple-100 bg-white/70 p-3 text-left transition-all hover:border-purple-300 hover:bg-purple-50/60 hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs font-bold tracking-wider text-purple-700">
          {month.name}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">
          {month.bullish.length + month.bearish.length} setups
        </span>
      </div>

      {/* Bullish section */}
      <div className="mb-1.5">
        <div className="mb-0.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-bull/80">
          <TrendingUp className="h-2.5 w-2.5" /> Bullish
        </div>
        <div className="flex flex-wrap gap-1">
          {topBull.length === 0 ? (
            <span className="font-mono text-[9px] text-muted-foreground">—</span>
          ) : (
            topBull.map((s) => (
              <span
                key={s.symbol}
                className="inline-flex items-center gap-0.5 rounded border border-bull/30 bg-bull/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-bull"
                title={`${s.symbol}: avg ${s.avgReturn.toFixed(2)}%, win ${s.winRate}%`}
              >
                {s.symbol}
                <span className="font-normal text-bull/70">+{s.avgReturn.toFixed(1)}%</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Bearish section */}
      <div>
        <div className="mb-0.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-bear/80">
          <TrendingDown className="h-2.5 w-2.5" /> Bearish
        </div>
        <div className="flex flex-wrap gap-1">
          {topBear.length === 0 ? (
            <span className="font-mono text-[9px] text-muted-foreground">—</span>
          ) : (
            topBear.map((s) => (
              <span
                key={s.symbol}
                className="inline-flex items-center gap-0.5 rounded border border-bear/30 bg-bear/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-bear"
                title={`${s.symbol}: avg ${s.avgReturn.toFixed(2)}%, win ${s.winRate}%`}
              >
                {s.symbol}
                <span className="font-normal text-bear/70">{s.avgReturn.toFixed(1)}%</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end font-mono text-[9px] text-purple-500 opacity-0 transition-opacity group-hover:opacity-100">
        view details <ChevronRight className="h-2.5 w-2.5" />
      </div>
    </button>
  );
}

// ============================================================
// Season list (used in dialog)
// ============================================================
function SeasonList({
  title,
  icon,
  tone,
  stocks,
}: {
  title: string;
  icon: React.ReactNode;
  tone: 'bull' | 'bear';
  stocks: SeasonalStock[];
}) {
  const headerColor =
    tone === 'bull'
      ? 'border-bull/30 bg-bull/10 text-bull'
      : 'border-bear/30 bg-bear/10 text-bear';
  return (
    <div className={cn('rounded-md border p-3', headerColor)}>
      <div className="mb-2 flex items-center gap-1 font-mono text-[11px] font-bold uppercase tracking-wider">
        {icon} {title}
      </div>
      <ScrollArea className="max-h-[50vh]">
        <div className="space-y-1.5">
          {stocks.length === 0 ? (
            <p className="font-mono text-[10px] text-muted-foreground">No notable patterns.</p>
          ) : (
            stocks.map((s) => {
              const meta = getSymbolMeta(s.symbol);
              return (
                <div
                  key={s.symbol}
                  className="rounded border border-purple-100 bg-white/80 p-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {s.symbol}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-xs font-bold',
                        s.avgReturn >= 0 ? 'text-bull' : 'text-bear',
                      )}
                    >
                      {s.avgReturn >= 0 ? '+' : ''}
                      {s.avgReturn.toFixed(2)}%
                    </span>
                  </div>
                  {meta && (
                    <div className="truncate font-mono text-[9px] text-muted-foreground">
                      {meta.name} · {meta.sector}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                    <span>Win rate: {s.winRate}%</span>
                    <span className="text-purple-200">·</span>
                    <span
                      className={cn(
                        'font-semibold',
                        s.winRate >= 65 ? 'text-bull' : s.winRate >= 50 ? 'text-amber-600' : 'text-bear',
                      )}
                    >
                      {s.winRate >= 65 ? 'strong' : s.winRate >= 50 ? 'moderate' : 'weak'}
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-purple-100">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        s.avgReturn >= 0 ? 'bg-bull/70' : 'bg-bear/70',
                      )}
                      style={{
                        width: `${Math.min(100, Math.abs(s.avgReturn) * 10)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================
// Stock seasonal strip (per-stock 12-month view)
// ============================================================
function StockSeasonalStrip({
  symbol,
  data,
  loading,
}: {
  symbol: string;
  data: StockMonthlyStat[];
  loading: boolean;
}) {
  const meta = getSymbolMeta(symbol);
  const maxAbs = data.length
    ? Math.max(...data.map((d) => Math.abs(d.avgReturn)), 1)
    : 1;

  return (
    <Card className="border-purple-100 bg-purple-50/40">
      <CardHeader className="flex flex-row items-center justify-between px-4 py-2">
        <CardTitle className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-purple-700">
          <Sparkles className="h-3.5 w-3.5" />
          {symbol}
          {meta && (
            <span className="font-mono text-[10px] font-normal text-muted-foreground">
              · {meta.name} · {meta.sector}
            </span>
          )}
        </CardTitle>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-purple-500" />}
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {loading ? (
          <div className="flex h-24 items-center justify-center font-mono text-[10px] text-muted-foreground">
            Fetching seasonal stats…
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-24 items-center justify-center font-mono text-[10px] text-muted-foreground">
            No seasonal data available.
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {data.map((d) => {
              const positive = d.avgReturn >= 0;
              const w = (Math.abs(d.avgReturn) / maxAbs) * 100;
              return (
                <div
                  key={d.month}
                  className="flex flex-col items-center gap-1 rounded-md border border-purple-100 bg-white/70 p-1.5"
                  title={`${MONTH_FULL[d.month - 1]}: avg ${d.avgReturn.toFixed(2)}%, win ${d.winRate}%, ${d.occurrences}y`}
                >
                  <span className="font-mono text-[9px] font-bold text-purple-700">
                    {MONTH_NAMES[d.month - 1]}
                  </span>
                  {/* mini bar */}
                  <div className="relative h-12 w-2 overflow-hidden rounded-sm bg-purple-100">
                    <div
                      className={cn(
                        'absolute left-0 right-0 rounded-sm',
                        positive ? 'bg-bull/70' : 'bg-bear/70',
                      )}
                      style={
                        positive
                          ? { bottom: 0, height: `${w}%` }
                          : { top: 0, height: `${w}%` }
                      }
                    />
                    {/* mid-line */}
                    <div className="absolute left-0 right-0 top-1/2 h-px bg-purple-300" />
                  </div>
                  <span
                    className={cn(
                      'font-mono text-[9px] font-semibold',
                      positive ? 'text-bull' : 'text-bear',
                    )}
                  >
                    {positive ? '+' : ''}
                    {d.avgReturn.toFixed(1)}%
                  </span>
                  <span className="font-mono text-[8px] text-muted-foreground">
                    {d.winRate}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
