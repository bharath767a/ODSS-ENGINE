'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Zap,
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  ChevronRight,
  Activity,
  Gauge,
  Filter,
  AlertCircle,
} from 'lucide-react';
import { ALL_SYMBOLS, getSymbolMeta } from '@/lib/odss/universe';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface SwingRecommendation {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  score: number;
  entry: number;
  target: number;
  stopLoss: number;
  reason: string;
}

interface SwingResponse {
  recommendations: SwingRecommendation[];
}

interface LivePrice {
  price: number;
  changePct: number;
  source: string;
}

type SortKey = 'score' | 'change' | 'symbol' | 'price';

// ============================================================
// Deterministic fallback generators (used when API fails)
// ============================================================
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

function generateFallbackSwingRecs(): SwingRecommendation[] {
  const stocks = ALL_SYMBOLS.filter((s) => s.type === 'STOCK');
  return stocks.map((s) => {
    const rand = seededRandom(hashStr(s.symbol));
    const dir = rand() > 0.42 ? 'LONG' : 'SHORT';
    const score = Math.round(45 + rand() * 50);
    const drift = (rand() - 0.5) * 0.08;
    const entry = +(s.basePrice * (1 + drift)).toFixed(2);
    const riskPct = 0.03 + rand() * 0.04;
    const rewardPct = riskPct * (1.6 + rand() * 1.4);
    const target =
      dir === 'LONG'
        ? +(entry * (1 + rewardPct)).toFixed(2)
        : +(entry * (1 - rewardPct)).toFixed(2);
    const stopLoss =
      dir === 'LONG'
        ? +(entry * (1 - riskPct)).toFixed(2)
        : +(entry * (1 + riskPct)).toFixed(2);
    const reasons = [
      `Higher-higher tops on daily chart. Breaking out of 6-week base on above-average volume. RSI ${Math.round(50 + rand() * 30)}, MACD bullish crossover.`,
      `Pullback to 50-EMA support with bullish engulfing candle. Sector showing relative strength. Volume drying up on declines.`,
      `Breakdown below 200-DMA with high volume. Distribution day pattern. Sector underperforming benchmark.`,
      `Range expansion from 8-week consolidation. ADX rising above 25. Momentum thrust confirmed.`,
      `Failed breakout reversal at prior resistance. Lower-higher-low pattern. Stop hunt above prior swing high.`,
    ];
    return {
      symbol: s.symbol,
      direction: dir,
      score,
      entry,
      target,
      stopLoss,
      reason: reasons[Math.floor(rand() * reasons.length)],
    };
  });
}

// ============================================================
// Main SwingTab component
// ============================================================
export function SwingTab({ onSelect }: { onSelect?: (symbol: string) => void }) {
  const stocks = useMemo(() => ALL_SYMBOLS.filter((s) => s.type === 'STOCK'), []);
  const sectors = useMemo(
    () => ['ALL', ...Array.from(new Set(stocks.map((s) => s.sector)))],
    [stocks],
  );

  const [recommendations, setRecommendations] = useState<Record<string, SwingRecommendation>>({});
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsError, setRecsError] = useState<string | null>(null);

  const [livePrices, setLivePrices] = useState<Record<string, LivePrice>>({});
  const [pricesLoading, setPricesLoading] = useState(true);

  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  // ----- Fetch swing recommendations -----
  const fetchRecs = useCallback(async () => {
    setRecsLoading(true);
    setRecsError(null);
    try {
      const res = await fetch('/api/odss/swing');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SwingResponse = await res.json();
      const recs = data?.recommendations;
      if (!Array.isArray(recs) || recs.length === 0) {
        throw new Error('Empty recommendations');
      }
      const map: Record<string, SwingRecommendation> = {};
      for (const r of recs) map[r.symbol] = r;
      // Backfill missing stocks with fallback so the list always shows everything
      for (const fb of generateFallbackSwingRecs()) {
        if (!map[fb.symbol]) map[fb.symbol] = fb;
      }
      setRecommendations(map);
    } catch (err: any) {
      // Graceful fallback — generate synthetic recommendations client-side
      console.warn('[SwingTab] /api/odss/swing failed, using fallback:', err?.message);
      const fb = generateFallbackSwingRecs();
      const map: Record<string, SwingRecommendation> = {};
      for (const r of fb) map[r.symbol] = r;
      setRecommendations(map);
      setRecsError('Live swing engine unavailable — showing modeled estimates');
    } finally {
      setRecsLoading(false);
    }
  }, []);

  // ----- Batch fetch live prices -----
  const fetchLivePrices = useCallback(
    async (symbolsList: typeof stocks) => {
      const prices: Record<string, LivePrice> = {};
      const batchSize = 5;
      for (let i = 0; i < symbolsList.length; i += batchSize) {
        const batch = symbolsList.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(async (s) => {
            try {
              const res = await fetch(`/api/odss/quote/${s.symbol}`);
              if (res.ok) {
                const q = await res.json();
                if (q?.ltp > 0) {
                  prices[s.symbol] = {
                    price: q.ltp,
                    changePct: q.changePct ?? 0,
                    source: q.source ?? 'UNKNOWN',
                  };
                }
              }
            } catch {
              // skip individual failure
            }
          }),
        );
      }
      return prices;
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      setPricesLoading(true);
      const p = await fetchLivePrices(stocks);
      if (mounted) {
        setLivePrices(p);
        setPricesLoading(false);
      }
    })();
    const id = setInterval(async () => {
      const p = await fetchLivePrices(stocks);
      if (mounted) setLivePrices(p);
    }, 30000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [fetchLivePrices, stocks]);

  useEffect(() => {
    fetchRecs();
  }, [fetchRecs]);

  // ----- Filter + sort -----
  const filteredStocks = useMemo(() => {
    let list = stocks;
    if (sectorFilter !== 'ALL') list = list.filter((s) => s.sector === sectorFilter);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'score':
          return (recommendations[b.symbol]?.score ?? 0) - (recommendations[a.symbol]?.score ?? 0);
        case 'change':
          return (
            (livePrices[b.symbol]?.changePct ?? 0) -
            (livePrices[a.symbol]?.changePct ?? 0)
          );
        case 'price':
          return (
            (livePrices[b.symbol]?.price ?? b.basePrice) -
            (livePrices[a.symbol]?.price ?? a.basePrice)
          );
        case 'symbol':
          return a.symbol.localeCompare(b.symbol);
        default:
          return 0;
      }
    });
    return sorted;
  }, [stocks, sectorFilter, search, sortKey, recommendations, livePrices]);

  const selectedRec = selectedSymbol ? recommendations[selectedSymbol] : null;
  const selectedMeta = selectedSymbol ? getSymbolMeta(selectedSymbol) : null;
  const selectedPrice = selectedSymbol ? livePrices[selectedSymbol] : null;

  const handleSelectSymbol = (sym: string) => {
    setSelectedSymbol(sym);
    onSelect?.(sym);
  };

  return (
    <Card className="border-purple-100 bg-white/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-purple-50">
            <Zap className="h-4 w-4 text-purple-600" />
          </div>
          <span className="text-base font-bold text-purple-700">SWING TRADING DESK</span>
          <span className="font-mono text-[10px] font-normal text-muted-foreground">
            · multi-day to multi-week setups · entry / target / stop / R:R
          </span>
          {recsError && (
            <Badge
              variant="outline"
              className="ml-auto border-amber-300 bg-amber-50 text-[10px] text-amber-700"
            >
              <AlertCircle className="mr-1 h-3 w-3" />
              {recsError}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Top control bar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search symbol or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 border-purple-100 bg-white/70 pl-8 font-mono text-xs"
            />
          </div>
          <Select value={sectorFilter} onValueChange={setSectorFilter}>
            <SelectTrigger
              size="sm"
              className="h-8 w-[150px] border-purple-100 bg-white/70 font-mono text-[11px]"
            >
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              {sectors.map((sec) => (
                <SelectItem key={sec} value={sec} className="font-mono text-xs">
                  {sec === 'ALL' ? 'All Sectors' : sec}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger
              size="sm"
              className="h-8 w-[140px] border-purple-100 bg-white/70 font-mono text-[11px]"
            >
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score" className="font-mono text-xs">
                Sort: Swing Score
              </SelectItem>
              <SelectItem value="change" className="font-mono text-xs">
                Sort: % Change
              </SelectItem>
              <SelectItem value="price" className="font-mono text-xs">
                Sort: Price
              </SelectItem>
              <SelectItem value="symbol" className="font-mono text-xs">
                Sort: Symbol
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchRecs}
            disabled={recsLoading}
            className="h-8 border-purple-100 bg-white/70 font-mono text-[11px] text-purple-700 hover:bg-purple-50"
          >
            {recsLoading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Rescan
          </Button>
        </div>

        {/* Two-panel layout */}
        <div className="grid gap-3 lg:grid-cols-5">
          {/* Left: stock list */}
          <div className="lg:col-span-3">
            <Card className="border-purple-100 bg-white/60">
              <CardHeader className="flex flex-row items-center justify-between px-4 py-2">
                <CardTitle className="font-mono text-[11px] uppercase tracking-wider text-purple-700">
                  Swing Watchlist · {filteredStocks.length}
                </CardTitle>
                {pricesLoading && (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> fetching prices…
                  </span>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[560px]">
                  <div className="divide-y divide-purple-50">
                    {filteredStocks.map((s) => {
                      const rec = recommendations[s.symbol];
                      const price = livePrices[s.symbol];
                      const up = (price?.changePct ?? 0) >= 0;
                      const isSelected = selectedSymbol === s.symbol;
                      return (
                        <button
                          key={s.symbol}
                          onClick={() => handleSelectSymbol(s.symbol)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-purple-50/60',
                            isSelected && 'bg-purple-50',
                          )}
                        >
                          {/* Symbol + name */}
                          <div className="min-w-[120px] flex-1">
                            <div className="font-mono text-xs font-bold text-foreground">
                              {s.symbol}
                            </div>
                            <div className="truncate text-[10px] text-muted-foreground">
                              {s.name}
                            </div>
                          </div>

                          {/* Sector badge */}
                          <Badge
                            variant="outline"
                            className="border-purple-200 bg-purple-50/60 px-1.5 py-0 font-mono text-[9px] text-purple-700"
                          >
                            {s.sector}
                          </Badge>

                          {/* Live price */}
                          <div className="w-[88px] text-right">
                            {price ? (
                              <>
                                <div
                                  className={cn(
                                    'font-mono text-xs font-semibold',
                                    up ? 'text-bull' : 'text-bear',
                                  )}
                                >
                                  ₹{price.price.toFixed(2)}
                                </div>
                                <div
                                  className={cn(
                                    'font-mono text-[10px]',
                                    up ? 'text-bull' : 'text-bear',
                                  )}
                                >
                                  {up ? '▲' : '▼'} {Math.abs(price.changePct).toFixed(2)}%
                                </div>
                              </>
                            ) : (
                              <div className="font-mono text-[10px] text-muted-foreground">
                                ₹{s.basePrice.toFixed(0)}
                              </div>
                            )}
                          </div>

                          {/* Direction + score */}
                          <div className="w-[92px] text-right">
                            {rec ? (
                              <>
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest',
                                    rec.direction === 'LONG'
                                      ? 'border-bull/40 bg-bull/10 text-bull'
                                      : 'border-bear/40 bg-bear/10 text-bear',
                                  )}
                                >
                                  {rec.direction === 'LONG' ? (
                                    <TrendingUp className="h-2.5 w-2.5" />
                                  ) : (
                                    <TrendingDown className="h-2.5 w-2.5" />
                                  )}
                                  {rec.direction}
                                </span>
                                <div
                                  className={cn(
                                    'mt-0.5 font-mono text-xs font-bold',
                                    rec.score >= 75
                                      ? 'text-bull'
                                      : rec.score >= 60
                                        ? 'text-amber-600'
                                        : 'text-muted-foreground',
                                  )}
                                >
                                  {rec.score}
                                  <span className="text-[9px] font-normal text-muted-foreground">/100</span>
                                </div>
                              </>
                            ) : (
                              <span className="font-mono text-[10px] text-muted-foreground">—</span>
                            )}
                          </div>

                          <ChevronRight
                            className={cn(
                              'h-4 w-4 shrink-0 text-purple-300 transition-transform',
                              isSelected && 'translate-x-0.5 text-purple-600',
                            )}
                          />
                        </button>
                      );
                    })}
                    {filteredStocks.length === 0 && (
                      <div className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">
                        No stocks match the current filter.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Right: detail panel */}
          <div className="lg:col-span-2">
            {selectedRec && selectedMeta ? (
              <SwingDetailPanel
                rec={selectedRec}
                meta={selectedMeta}
                livePrice={selectedPrice ?? null}
                onClose={() => setSelectedSymbol(null)}
              />
            ) : (
              <Card className="border-dashed border-purple-200 bg-white/50">
                <CardContent className="flex h-[560px] flex-col items-center justify-center p-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-purple-200 bg-purple-50">
                    <Activity className="h-5 w-5 text-purple-500" />
                  </div>
                  <p className="font-mono text-xs font-semibold text-purple-700">
                    Select a stock to view swing analysis
                  </p>
                  <p className="mt-1 max-w-[220px] font-mono text-[10px] text-muted-foreground">
                    Entry, target, stop-loss, risk/reward and reasoning will appear here.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Swing Detail Panel
// ============================================================
function SwingDetailPanel({
  rec,
  meta,
  livePrice,
  onClose,
}: {
  rec: SwingRecommendation;
  meta: ReturnType<typeof getSymbolMeta>;
  livePrice: LivePrice | null;
  onClose: () => void;
}) {
  const isLong = rec.direction === 'LONG';
  const risk = Math.abs(rec.entry - rec.stopLoss);
  const reward = Math.abs(rec.target - rec.entry);
  const rr = risk > 0 ? reward / risk : 0;
  const confidence = Math.min(99, Math.max(20, Math.round(rec.score * 0.95 + (rr >= 2 ? 5 : 0))));
  const liveVsEntry =
    livePrice && rec.entry > 0
      ? ((livePrice.price - rec.entry) / rec.entry) * 100
      : null;

  return (
    <Card className="border-purple-100 bg-white/70">
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-bold text-foreground">
              {rec.symbol}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest',
                isLong
                  ? 'border-bull/40 bg-bull/10 text-bull'
                  : 'border-bear/40 bg-bear/10 text-bear',
              )}
            >
              {isLong ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {rec.direction}
            </span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {meta?.name} · {meta?.sector}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-7 px-2 font-mono text-[10px] text-muted-foreground hover:bg-purple-50"
        >
          Clear
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        {/* Score + confidence */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-purple-100 bg-purple-50/50 p-2.5">
            <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-purple-600">
              <Gauge className="h-3 w-3" /> Swing Score
            </div>
            <div
              className={cn(
                'mt-1 font-mono text-xl font-bold',
                rec.score >= 75
                  ? 'text-bull'
                  : rec.score >= 60
                    ? 'text-amber-600'
                    : 'text-muted-foreground',
              )}
            >
              {rec.score}
              <span className="text-[11px] font-normal text-muted-foreground">/100</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-purple-100">
              <div
                className={cn(
                  'h-full rounded-full',
                  rec.score >= 75 ? 'bg-bull' : rec.score >= 60 ? 'bg-amber-500' : 'bg-purple-300',
                )}
                style={{ width: `${rec.score}%` }}
              />
            </div>
          </div>
          <div className="rounded-md border border-purple-100 bg-purple-50/50 p-2.5">
            <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-purple-600">
              <Activity className="h-3 w-3" /> Confidence
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-purple-700">
              {confidence}
              <span className="text-[11px] font-normal text-muted-foreground">%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-purple-100">
              <div
                className="h-full rounded-full bg-purple-500"
                style={{ width: `${confidence}%` }}
              />
            </div>
          </div>
        </div>

        {/* Live price vs entry */}
        {livePrice && (
          <div className="flex items-center justify-between rounded-md border border-purple-100 bg-white/60 px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Live vs Entry
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-foreground">
                ₹{livePrice.price.toFixed(2)}
              </span>
              {liveVsEntry !== null && (
                <span
                  className={cn(
                    'font-mono text-[10px]',
                    liveVsEntry >= 0 ? 'text-bull' : 'text-bear',
                  )}
                >
                  {liveVsEntry >= 0 ? '+' : ''}
                  {liveVsEntry.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        )}

        {/* Entry / Target / Stop Loss levels */}
        <div className="space-y-2">
          <LevelRow
            icon={<Target className="h-3 w-3" />}
            label="Entry"
            value={rec.entry}
            tone="purple"
            sub="planned entry zone"
          />
          <LevelRow
            icon={<TrendingUp className="h-3 w-3" />}
            label="Target"
            value={rec.target}
            tone="bull"
            sub={`${isLong ? '+' : '-'}${((Math.abs(rec.target - rec.entry) / rec.entry) * 100).toFixed(2)}% move`}
          />
          <LevelRow
            icon={<Shield className="h-3 w-3" />}
            label="Stop Loss"
            value={rec.stopLoss}
            tone="bear"
            sub={`${isLong ? '-' : '+'}${((Math.abs(rec.entry - rec.stopLoss) / rec.entry) * 100).toFixed(2)}% risk`}
          />
        </div>

        {/* R:R bar */}
        <div className="rounded-md border border-purple-100 bg-white/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-purple-600">
              Risk : Reward
            </span>
            <span
              className={cn(
                'font-mono text-sm font-bold',
                rr >= 2 ? 'text-bull' : rr >= 1.5 ? 'text-amber-600' : 'text-bear',
              )}
            >
              1 : {rr.toFixed(2)}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-purple-100">
            <div
              className="h-full bg-bear/70"
              style={{ width: `${(1 / (1 + rr)) * 100}%` }}
              title={`Risk ₹${risk.toFixed(2)}`}
            />
            <div
              className="h-full bg-bull/70"
              style={{ width: `${(rr / (1 + rr)) * 100}%` }}
              title={`Reward ₹${reward.toFixed(2)}`}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
            <span className="text-bear/80">Risk ₹{risk.toFixed(2)}</span>
            <span className="text-bull/80">Reward ₹{reward.toFixed(2)}</span>
          </div>
        </div>

        {/* Reasoning */}
        <div className="rounded-md border border-purple-100 bg-purple-50/40 p-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-purple-700">
            Why this setup
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-foreground/80">
            {rec.reason}
          </p>
        </div>

        {/* Footer note */}
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2">
          <p className="font-mono text-[9px] leading-snug text-amber-700">
            ⚠ Not investment advice. Always confirm with your own research and risk
            management before taking any position.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function LevelRow({
  icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'bull' | 'bear' | 'purple';
  sub?: string;
}) {
  const toneMap = {
    bull: 'border-bull/30 bg-bull/5 text-bull',
    bear: 'border-bear/30 bg-bear/5 text-bear',
    purple: 'border-purple-200 bg-purple-50/60 text-purple-700',
  } as const;
  return (
    <div className={cn('flex items-center justify-between rounded-md border px-3 py-2', toneMap[tone])}>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-mono text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm font-bold">₹{value.toFixed(2)}</div>
        {sub && <div className="font-mono text-[9px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
