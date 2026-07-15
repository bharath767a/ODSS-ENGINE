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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Plus,
  X,
  RefreshCw,
  Loader2,
  Target,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_SYMBOLS, getSymbolMeta } from '@/lib/odss/universe';

/* -------------------------------------------------------------------------- */
/*  Types (mirror API contract)                                               */
/* -------------------------------------------------------------------------- */

interface PaperFundState {
  id: string | null;
  startingCapital: number;
  currentBalance: number;
  realizedPnl: number;
  openPositions: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdown: number;
  peakBalance: number;
  source: string;
}

interface PerformanceState {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgR: number;
  profitFactor: number | null;
  maxDrawdown: number;
  currentBalance: number;
  startingCapital: number;
  returnPct: number;
  source: string;
}

interface PaperTrade {
  id: string;
  symbol: string;
  direction: string; // CE | PE
  strategy: string;
  variantGroup?: string | null;
  variantId?: string | null;
  entryStrike: number;
  entryPrice: number;
  entryTime: string;
  entryUnderlying: number;
  entryType: string;
  quantity: number;
  lotSize: number;
  exitPrice?: number | null;
  exitTime?: string | null;
  exitUnderlying?: number | null;
  exitReason?: string | null;
  grossPnl: number;
  totalCosts: number;
  netPnl: number;
  rMultiple: number;
  marketState?: string | null;
  vixAtEntry?: number | null;
  sectorAtEntry?: string | null;
  status: string; // OPEN | CLOSED
}

interface TradesResponse {
  open: PaperTrade[];
  closed: PaperTrade[];
  source: string;
}

/* -------------------------------------------------------------------------- */
/*  Strategy options (exported by strategy-variants.ts)                       */
/* -------------------------------------------------------------------------- */

const STRATEGY_OPTIONS = [
  { value: 'LONG_CALL', label: 'LONG_CALL · Buy CE' },
  { value: 'LONG_PUT', label: 'LONG_PUT · Buy PE' },
  { value: 'MomentumLongCall', label: 'MomentumLongCall · ATM CE' },
  { value: 'TrendFollowLongPut', label: 'TrendFollowLongPut · ATM PE' },
  { value: 'BreakoutITMCall', label: 'BreakoutITMCall · ITM CE' },
  { value: 'MeanReversionOTMPut', label: 'MeanReversionOTMPut · OTM PE' },
  { value: 'VWAPBounceLong', label: 'VWAPBounceLong · ATM CE' },
] as const;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const inr = (n: number, decimals = 2): string => {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}₹${abs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

const num = (n: number, decimals = 2): string => {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/** Bull/bear color class for P&L values. */
function pnlColor(n: number): string {
  if (!Number.isFinite(n) || n === 0) return 'text-muted-foreground';
  return n > 0 ? 'text-emerald-600' : 'text-rose-500';
}

/** Bull/bear color class for R-multiples. */
function rColor(r: number): string {
  if (!Number.isFinite(r) || r === 0) return 'text-muted-foreground';
  return r > 0 ? 'text-emerald-600' : 'text-rose-500';
}

function dirBadgeClass(dir: string): string {
  if (dir === 'CE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (dir === 'PE') return 'border-rose-200 bg-rose-50 text-rose-600';
  return 'border-purple-200 bg-purple-50 text-purple-700';
}

/** Estimate the live premium of an open trade using its entry BS inputs. */
function estimateCurrentPremium(trade: PaperTrade, refUnderlying?: number): number {
  // Without a live feed, we estimate using a simple intrinsic-value proxy:
  //   CE: max(S - K, 0) + time value (~ entry price decay)
  //   PE: max(K - S, 0) + time value
  // This is intentionally rough — the real exit price is computed server-side
  // via Black-Scholes when the user clicks CLOSE.
  const S = refUnderlying ?? trade.entryUnderlying;
  const K = trade.entryStrike;
  const intrinsic = trade.direction === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  // Time-value decay: assume 5% per day since entry, floor 0
  const elapsedDays = (Date.now() - new Date(trade.entryTime).getTime()) / 86_400_000;
  const decay = Math.max(0, 1 - 0.05 * elapsedDays);
  const tv = Math.max(0, trade.entryPrice - (trade.direction === 'CE'
    ? Math.max(trade.entryUnderlying - K, 0)
    : Math.max(K - trade.entryUnderlying, 0)));
  return Math.max(0.05, intrinsic + tv * decay);
}

function estimatePnl(trade: PaperTrade, refUnderlying?: number): number {
  const cur = estimateCurrentPremium(trade, refUnderlying);
  const totalShares = trade.quantity * trade.lotSize;
  return (cur - trade.entryPrice) * totalShares;
}

function estimateR(trade: PaperTrade, refUnderlying?: number): number {
  const pnl = estimatePnl(trade, refUnderlying);
  const totalShares = trade.quantity * trade.lotSize;
  const initialRisk = trade.entryPrice * totalShares * 0.25; // 25% SL default
  return initialRisk > 0 ? pnl / initialRisk : 0;
}

function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function PaperTradingPanel() {
  /* ---- State ---- */
  const [fund, setFund] = useState<PaperFundState | null>(null);
  const [perf, setPerf] = useState<PerformanceState | null>(null);
  const [trades, setTrades] = useState<TradesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-trade form
  const [formSymbol, setFormSymbol] = useState<string>('NIFTY');
  const [formDirection, setFormDirection] = useState<'CE' | 'PE'>('CE');
  const [formStrike, setFormStrike] = useState<string>('');
  const [formUnderlying, setFormUnderlying] = useState<string>('');
  const [formStrategy, setFormStrategy] = useState<string>('LONG_CALL');
  const [formQty, setFormQty] = useState<string>('1');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Close-trade dialog
  const [closeTarget, setCloseTarget] = useState<PaperTrade | null>(null);
  const [closeUnderlying, setCloseUnderlying] = useState<string>('');
  const [closing, setClosing] = useState(false);

  // Reset
  const [resetting, setResetting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  /* ---- Data fetch ---- */
  const fetchAll = useCallback(async () => {
    try {
      const [fRes, pRes, tRes] = await Promise.all([
        fetch('/api/odss/paper-trading/fund', { cache: 'no-store' }),
        fetch('/api/odss/paper-trading/performance', { cache: 'no-store' }),
        fetch('/api/odss/paper-trading/trades', { cache: 'no-store' }),
      ]);
      if (!fRes.ok || !pRes.ok || !tRes.ok) {
        throw new Error(`HTTP ${fRes.status}/${pRes.status}/${tRes.status}`);
      }
      const [f, p, t] = await Promise.all([fRes.json(), pRes.json(), tRes.json()]);
      setFund(f as PaperFundState);
      setPerf(p as PerformanceState);
      setTrades(t as TradesResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load paper-trading data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 10_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  /* ---- Auto-prefill form underlying & strike from symbol meta ---- */
  useEffect(() => {
    const meta = getSymbolMeta(formSymbol);
    if (meta) {
      setFormUnderlying(String(meta.basePrice));
      setFormStrike(String(Math.round(meta.basePrice / meta.strikeStep) * meta.strikeStep));
    }
  }, [formSymbol]);

  /* ---- Actions ---- */
  async function submitNewTrade(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormMsg(null);

    const strike = parseFloat(formStrike);
    const underlying = parseFloat(formUnderlying);
    const qty = parseInt(formQty, 10);

    if (!formSymbol) return setFormMsg({ type: 'err', text: 'Pick a symbol' });
    if (!Number.isFinite(strike) || strike <= 0) return setFormMsg({ type: 'err', text: 'Strike must be > 0' });
    if (!Number.isFinite(underlying) || underlying <= 0) return setFormMsg({ type: 'err', text: 'Underlying must be > 0' });
    if (!Number.isFinite(qty) || qty <= 0) return setFormMsg({ type: 'err', text: 'Quantity must be ≥ 1' });

    setSubmitting(true);
    try {
      const res = await fetch('/api/odss/paper-trading/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: formSymbol,
          direction: formDirection,
          entryStrike: strike,
          entryUnderlying: underlying,
          strategy: formStrategy,
          quantity: qty,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setFormMsg({
        type: 'ok',
        text: `Opened ${formSymbol} ${formDirection} · entry ₹${num(json.entryPrice)} · costs ₹${num(json.costs)}`,
      });
      await fetchAll();
    } catch (e) {
      setFormMsg({ type: 'err', text: e instanceof Error ? e.message : 'Open failed' });
    } finally {
      setSubmitting(false);
      setTimeout(() => setFormMsg(null), 6000);
    }
  }

  async function submitCloseTrade() {
    if (!closeTarget) return;
    const exitUnderlying = parseFloat(closeUnderlying);
    if (!Number.isFinite(exitUnderlying) || exitUnderlying <= 0) return;

    setClosing(true);
    try {
      const res = await fetch('/api/odss/paper-trading/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: closeTarget.id,
          exitUnderlying,
          exitReason: 'MANUAL',
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setCloseTarget(null);
      await fetchAll();
    } catch (e) {
      setFormMsg({ type: 'err', text: e instanceof Error ? e.message : 'Close failed' });
      setTimeout(() => setFormMsg(null), 6000);
    } finally {
      setClosing(false);
    }
  }

  async function submitReset() {
    setResetting(true);
    try {
      const res = await fetch('/api/odss/paper-trading/reset', { method: 'POST' });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setResetOpen(false);
      await fetchAll();
    } catch (e) {
      setFormMsg({ type: 'err', text: e instanceof Error ? e.message : 'Reset failed' });
      setTimeout(() => setFormMsg(null), 6000);
    } finally {
      setResetting(false);
    }
  }

  /* ---- Derived ---- */
  const openTrades = useMemo(() => trades?.open ?? [], [trades]);
  const closedTrades = useMemo(
    () => (trades?.closed ?? []).slice(0, 20),
    [trades],
  );

  const startingCapital = fund?.startingCapital ?? 100_000;
  const currentBalance = fund?.currentBalance ?? 100_000;
  const realizedPnl = fund?.realizedPnl ?? 0;
  const openPositions = fund?.openPositions ?? 0;
  const winRate = perf?.winRate ?? 0;
  const returnPct = perf?.returnPct ?? 0;

  /* ----------------------------------------------------------------------- */
  /*  Render                                                                  */
  /* ----------------------------------------------------------------------- */

  return (
    <Card className="border-purple-100 bg-white/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-purple-50">
              <Wallet className="h-4 w-4 text-purple-600" />
            </span>
            <span className="text-purple-700">PAPER TRADING</span>
            <span className="ml-1 font-mono text-[10px] font-normal tracking-wider text-muted-foreground">
              Simulated options trades · Black-Scholes pricing · Indian-market costs
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            {/* Reset with confirmation */}
            <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-rose-200 bg-white/70 px-2 font-mono text-[10px] tracking-wider text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  RESET FUND
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-purple-100">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm font-bold text-purple-700">
                    Reset Paper Fund?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-muted-foreground">
                    This will close all open trades at their entry price (no P&L) and
                    reset the fund balance to ₹{startingCapital.toLocaleString('en-IN')}.
                    Win/loss tallies and drawdown will be zeroed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-8 font-mono text-[11px]">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={submitReset}
                    disabled={resetting}
                    className="h-8 border border-rose-200 bg-rose-50 font-mono text-[11px] text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                  >
                    {resetting ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    CONFIRM RESET
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <button
              type="button"
              onClick={fetchAll}
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
        {/* ---------------- Fund Summary ---------------- */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <FundStat
            label="Start Capital"
            value={inr(startingCapital, 0)}
            tone="text-purple-600"
            dot="bg-purple-400"
          />
          <FundStat
            label="Balance"
            value={inr(currentBalance, 0)}
            tone={currentBalance >= startingCapital ? 'text-emerald-600' : 'text-rose-500'}
            dot={currentBalance >= startingCapital ? 'bg-emerald-400' : 'bg-rose-400'}
          />
          <FundStat
            label="Realized P&L"
            value={inr(realizedPnl)}
            tone={pnlColor(realizedPnl)}
            dot={realizedPnl >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}
          />
          <FundStat
            label="Return %"
            value={`${returnPct >= 0 ? '+' : ''}${num(returnPct)}%`}
            tone={returnPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}
            dot={returnPct >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}
          />
          <FundStat
            label="Win Rate"
            value={`${num(winRate, 1)}%`}
            tone={winRate >= 50 ? 'text-emerald-600' : winRate > 0 ? 'text-amber-600' : 'text-muted-foreground'}
            dot={winRate >= 50 ? 'bg-emerald-400' : 'bg-amber-400'}
          />
          <FundStat
            label="Open Positions"
            value={String(openPositions)}
            tone={openPositions > 0 ? 'text-purple-600' : 'text-muted-foreground'}
            dot="bg-violet-400"
          />
        </div>

        {/* ---------------- Performance Stats ---------------- */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <PerfStat
            label="Total Trades"
            value={String(perf?.totalTrades ?? 0)}
            icon={<Target className="h-3 w-3" />}
          />
          <PerfStat
            label="Winners"
            value={String(perf?.winningTrades ?? 0)}
            tone="text-emerald-600"
            icon={<TrendingUp className="h-3 w-3" />}
          />
          <PerfStat
            label="Losers"
            value={String(perf?.losingTrades ?? 0)}
            tone="text-rose-500"
            icon={<TrendingDown className="h-3 w-3" />}
          />
          <PerfStat
            label="Avg R"
            value={num(perf?.avgR ?? 0, 2)}
            tone={rColor(perf?.avgR ?? 0)}
          />
          <PerfStat
            label="Profit Factor"
            value={perf?.profitFactor == null ? '∞' : num(perf.profitFactor, 2)}
            tone={(perf?.profitFactor ?? 0) >= 1 ? 'text-emerald-600' : 'text-rose-500'}
          />
          <PerfStat
            label="Max DD"
            value={`${num(perf?.maxDrawdown ?? 0, 1)}%`}
            tone="text-rose-500"
          />
        </div>

        {/* ---------------- Action feedback ---------------- */}
        {formMsg && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-xs',
              formMsg.type === 'ok'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border border-rose-200 bg-rose-50 text-rose-700',
            )}
          >
            {formMsg.type === 'ok' ? (
              <Plus className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            <span className="font-mono">{formMsg.text}</span>
          </div>
        )}

        {error && !fund && (
          <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------------- New Trade Form ---------------- */}
        <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Plus className="h-3 w-3 text-purple-600" />
            <span className="text-sm font-bold text-purple-700">Open New Paper Trade</span>
          </div>
          <form
            onSubmit={submitNewTrade}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          >
            {/* Symbol */}
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Symbol
              </Label>
              <Select value={formSymbol} onValueChange={setFormSymbol}>
                <SelectTrigger className="h-8 w-full border-purple-100 bg-white font-mono text-[11px]">
                  <SelectValue placeholder="Symbol" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectGroup>
                    <SelectLabel className="font-mono text-[10px] text-purple-600">Indices</SelectLabel>
                    {ALL_SYMBOLS.filter((s) => s.type === 'INDEX').map((s) => (
                      <SelectItem key={s.symbol} value={s.symbol} className="font-mono text-[11px]">
                        {s.symbol}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel className="font-mono text-[10px] text-purple-600">Stocks</SelectLabel>
                    {ALL_SYMBOLS.filter((s) => s.type === 'STOCK').map((s) => (
                      <SelectItem key={s.symbol} value={s.symbol} className="font-mono text-[11px]">
                        {s.symbol}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Direction */}
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Direction
              </Label>
              <Select
                value={formDirection}
                onValueChange={(v) => setFormDirection(v as 'CE' | 'PE')}
              >
                <SelectTrigger className="h-8 w-full border-purple-100 bg-white font-mono text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CE" className="font-mono text-[11px]">CE · Call</SelectItem>
                  <SelectItem value="PE" className="font-mono text-[11px]">PE · Put</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Strike */}
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Strike
              </Label>
              <Input
                type="number"
                step="any"
                value={formStrike}
                onChange={(e) => setFormStrike(e.target.value)}
                className="h-8 border-purple-100 bg-white font-mono text-[11px]"
                placeholder="24800"
              />
            </div>

            {/* Underlying */}
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Underlying
              </Label>
              <Input
                type="number"
                step="any"
                value={formUnderlying}
                onChange={(e) => setFormUnderlying(e.target.value)}
                className="h-8 border-purple-100 bg-white font-mono text-[11px]"
                placeholder="24800"
              />
            </div>

            {/* Strategy */}
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Strategy
              </Label>
              <Select value={formStrategy} onValueChange={setFormStrategy}>
                <SelectTrigger className="h-8 w-full border-purple-100 bg-white font-mono text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {STRATEGY_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="font-mono text-[11px]">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Qty + Submit */}
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Qty (lots)
              </Label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={formQty}
                  onChange={(e) => setFormQty(e.target.value)}
                  className="h-8 w-16 border-purple-100 bg-white font-mono text-[11px]"
                  placeholder="1"
                />
                <Button
                  type="submit"
                  disabled={submitting}
                  className="h-8 flex-1 border border-purple-200 bg-purple-50 font-mono text-[10px] font-bold tracking-wider text-purple-700 hover:bg-purple-100 hover:text-purple-800"
                >
                  {submitting ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="mr-1 h-3 w-3" />
                  )}
                  OPEN
                </Button>
              </div>
            </div>
          </form>
        </div>

        {/* ---------------- Loading state ---------------- */}
        {loading && !trades && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
            <span className="font-mono tracking-wider">Loading paper trades…</span>
          </div>
        )}

        {/* ---------------- Open Trades Table ---------------- */}
        {trades && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-sm font-bold text-purple-700">
                Open Positions
                <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                  ({openTrades.length})
                </span>
              </h3>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-purple-100 bg-white/50">
              <Table className="text-xs">
                <TableHeader className="sticky top-0 z-10 bg-purple-50/95 backdrop-blur">
                  <TableRow className="border-purple-100 hover:bg-transparent">
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Symbol</TableHead>
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Dir</TableHead>
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Strategy</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Strike</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Entry ₹</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Cur ₹</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Qty</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Est P&L</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Est R</TableHead>
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Opened</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono">
                  {openTrades.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center font-sans text-xs text-muted-foreground">
                        No open positions. Use the form above to open a paper trade.
                      </TableCell>
                    </TableRow>
                  )}
                  {openTrades.map((t) => {
                    const exitRef = parseFloat(formUnderlying) || undefined;
                    const estPnl = estimatePnl(t, exitRef);
                    const estR = estimateR(t, exitRef);
                    const curPrem = estimateCurrentPremium(t, exitRef);
                    return (
                      <TableRow
                        key={t.id}
                        className="border-purple-50 text-[10px] transition-colors hover:bg-purple-50/40"
                      >
                        <TableCell className="font-sans text-xs font-bold text-purple-700">
                          {t.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'h-5 px-1.5 font-mono text-[9px] font-bold tracking-wider',
                              dirBadgeClass(t.direction),
                            )}
                          >
                            {t.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {t.strategy}
                        </TableCell>
                        <TableCell className="text-right tnum">{num(t.entryStrike, 0)}</TableCell>
                        <TableCell className="text-right tnum">{num(t.entryPrice)}</TableCell>
                        <TableCell className="text-right tnum text-purple-600">{num(curPrem)}</TableCell>
                        <TableCell className="text-right tnum">
                          {t.quantity}×{t.lotSize}
                        </TableCell>
                        <TableCell className={cn('text-right font-bold tnum', pnlColor(estPnl))}>
                          {estPnl >= 0 ? '+' : ''}{inr(estPnl)}
                        </TableCell>
                        <TableCell className={cn('text-right tnum', rColor(estR))}>
                          {estR >= 0 ? '+' : ''}{num(estR, 2)}R
                        </TableCell>
                        <TableCell className="text-left text-[9px] text-muted-foreground">
                          {formatTime(t.entryTime)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCloseTarget(t);
                              setCloseUnderlying(String(t.entryUnderlying));
                            }}
                            className="h-6 border-rose-200 bg-white/70 px-1.5 font-mono text-[9px] tracking-wider text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <X className="mr-0.5 h-3 w-3" />
                            CLOSE
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* ---------------- Trade History Table ---------------- */}
        {trades && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-sm font-bold text-purple-700">
                Trade History
                <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                  (recent {closedTrades.length})
                </span>
              </h3>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border border-purple-100 bg-white/50">
              <Table className="text-xs">
                <TableHeader className="sticky top-0 z-10 bg-purple-50/95 backdrop-blur">
                  <TableRow className="border-purple-100 hover:bg-transparent">
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Symbol</TableHead>
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Dir</TableHead>
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Strategy</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Entry ₹</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Exit ₹</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Underlying</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Net P&L</TableHead>
                    <TableHead className="h-7 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">R</TableHead>
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Reason</TableHead>
                    <TableHead className="h-7 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono">
                  {closedTrades.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="py-8 text-center font-sans text-xs text-muted-foreground">
                        No closed trades yet. Closed positions will appear here with full P&L and R-multiple.
                      </TableCell>
                    </TableRow>
                  )}
                  {closedTrades.map((t) => (
                    <TableRow
                      key={t.id}
                      className="border-purple-50 text-[10px] transition-colors hover:bg-purple-50/40"
                    >
                      <TableCell className="font-sans text-xs font-bold text-purple-700">
                        {t.symbol}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'h-5 px-1.5 font-mono text-[9px] font-bold tracking-wider',
                            dirBadgeClass(t.direction),
                          )}
                        >
                          {t.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">
                        {t.strategy}
                      </TableCell>
                      <TableCell className="text-right tnum">{num(t.entryPrice)}</TableCell>
                      <TableCell className="text-right tnum">
                        {t.exitPrice != null ? num(t.exitPrice) : '—'}
                      </TableCell>
                      <TableCell className="text-right tnum text-muted-foreground">
                        {t.exitUnderlying != null ? num(t.exitUnderlying, 0) : '—'}
                      </TableCell>
                      <TableCell className={cn('text-right font-bold tnum', pnlColor(t.netPnl))}>
                        {t.netPnl >= 0 ? '+' : ''}{inr(t.netPnl)}
                      </TableCell>
                      <TableCell className={cn('text-right tnum', rColor(t.rMultiple))}>
                        {t.rMultiple >= 0 ? '+' : ''}{num(t.rMultiple, 2)}R
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="h-5 px-1.5 font-mono text-[9px] tracking-wider border-purple-100 bg-purple-50/50 text-purple-600"
                        >
                          {t.exitReason ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-left text-[9px] text-muted-foreground">
                        {formatTime(t.exitTime)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>

      {/* ---------------- Close Trade Dialog ---------------- */}
      <AlertDialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)}>
        <AlertDialogContent className="border-purple-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sm font-bold text-purple-700">
              <X className="h-4 w-4 text-rose-500" />
              Close Paper Trade
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              {closeTarget && (
                <span className="font-mono">
                  {closeTarget.symbol}{' '}
                  <span className={cn('font-bold', closeTarget.direction === 'CE' ? 'text-emerald-700' : 'text-rose-600')}>
                    {closeTarget.direction}
                  </span>{' '}
                  · strike {num(closeTarget.entryStrike, 0)} · entry ₹{num(closeTarget.entryPrice)} ·{' '}
                  {closeTarget.quantity}×{closeTarget.lotSize} shares
                </span>
              )}
              <br />
              <span className="mt-1 block">
                Enter the exit underlying price. Exit premium will be computed via Black-Scholes.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Exit Underlying Price
            </Label>
            <Input
              type="number"
              step="any"
              value={closeUnderlying}
              onChange={(e) => setCloseUnderlying(e.target.value)}
              className="h-8 border-purple-100 bg-white font-mono text-[11px]"
              autoFocus
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 font-mono text-[11px]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                submitCloseTrade();
              }}
              disabled={closing}
              className="h-8 border border-rose-200 bg-rose-50 font-mono text-[11px] text-rose-700 hover:bg-rose-100 hover:text-rose-800"
            >
              {closing ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <X className="mr-1 h-3 w-3" />
              )}
              CLOSE TRADE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function FundStat({
  label,
  value,
  tone,
  dot,
}: {
  label: string;
  value: string;
  tone: string;
  dot: string;
}) {
  return (
    <div className="rounded-lg border border-purple-100 bg-white/60 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn('mt-0.5 font-mono text-sm font-bold tnum', tone)}>
        {value}
      </div>
    </div>
  );
}

function PerfStat({
  label,
  value,
  tone = 'text-foreground',
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-purple-100 bg-white/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div className={cn('mt-0.5 font-mono text-sm font-bold tnum', tone)}>
        {value}
      </div>
    </div>
  );
}
