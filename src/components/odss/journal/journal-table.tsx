'use client';

/* =============================================================================
 * ODSS · Trade Journal (rebuilt)
 * -----------------------------------------------------------------------------
 * Three-tab filter UI:
 *   · Active    — live trade from useODSS().activeTrade
 *   · Positional — open paper trades from /api/odss/paper-trading/trades
 *   · Closed    — completed trades merged from BOTH /api/odss/journal AND the
 *                 closed array of /api/odss/paper-trading/trades, sorted by
 *                 exitTime desc.
 *
 * Click any row to expand an inline detail card with the complete analytics:
 * entry/exit details, P&L breakdown, R-multiple bar, market context, risk levels,
 * entry/exit reasons, and AI explanation when available.
 *
 * LAVENDER theme — auto-refresh every 10s.
 * ========================================================================== */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useODSS } from '@/hooks/use-odss';
import {
  BookOpen,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Clock,
  Target,
  Wallet,
  Activity,
  X,
  Loader2,
  RefreshCw,
  Gauge,
  Calendar,
  Crosshair,
  Brain,
  Tag,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

/** TradeJournal row from /api/odss/journal */
interface JournalTrade {
  id: string;
  symbol: string;
  direction: 'CE' | 'PE' | string;
  sector: string | null;
  entryStrike: number;
  entryPrice: number;
  entryTime: string;
  entryType: string;
  underlyingEntryPrice: number;
  exitPrice: number;
  exitTime: string;
  exitReason: string;
  underlyingExitPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  pnl: number;
  rMultiple: number;
  confidence: number;
  marketState: string;
  entryReasons: string;
  exitReasons: string;
  holdTimeMinutes: number;
  tags: string | null;
}

/** PaperTrade row from /api/odss/paper-trading/trades */
interface PaperTrade {
  id: string;
  symbol: string;
  direction: string;
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
  status: string;
}

/** Unified shape used for the Closed tab — merges both sources */
interface UnifiedClosedTrade {
  id: string;
  source: 'journal' | 'paper';
  symbol: string;
  direction: string;
  strategy: string;
  sector: string | null;
  entryStrike: number | null;
  entryPrice: number | null;
  entryTime: string;
  entryType: string;
  underlyingEntryPrice: number | null;
  exitPrice: number | null;
  exitTime: string | null;
  underlyingExitPrice: number | null;
  exitReason: string | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  grossPnl: number | null;
  totalCosts: number | null;
  netPnl: number;
  rMultiple: number;
  confidence: number | null;
  marketState: string | null;
  vixAtEntry: number | null;
  entryReasons: string | null;
  exitReasons: string | null;
  holdTimeMinutes: number | null;
  tags: string | null;
  quantity: number | null;
  lotSize: number | null;
  aiExplanation?: string | null;
}

type FilterTab = 'active' | 'positional' | 'closed';

/* -------------------------------------------------------------------------- */
/*  Formatting helpers                                                         */
/* -------------------------------------------------------------------------- */

const inr = (n: number | null | undefined, decimals = 2): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}₹${abs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

const num = (n: number | null | undefined, decimals = 2): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const rStr = (r: number | null | undefined): string => {
  if (r == null || !Number.isFinite(r)) return '—';
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(2)}R`;
};

const fmtDateTime = (iso: string | number | null | undefined): string => {
  if (iso == null) return '—';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const fmtDateShort = (iso: string | number | null | undefined): string => {
  if (iso == null) return '—';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const fmtHoldTime = (mins: number | null | undefined): string => {
  if (mins == null || !Number.isFinite(mins)) return '—';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

const pnlColor = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n) || n === 0) return 'text-muted-foreground';
  return n > 0 ? 'text-emerald-600' : 'text-rose-500';
};

const dirBadgeClass = (dir: string): string => {
  if (dir === 'CE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (dir === 'PE') return 'border-rose-200 bg-rose-50 text-rose-600';
  return 'border-purple-200 bg-purple-50 text-purple-700';
};

const safeParseJson = (s: string | null | undefined): any => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function JournalTable() {
  const { activeTrade } = useODSS();

  const [filter, setFilter] = useState<FilterTab>('closed');
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([]);
  const [paperOpen, setPaperOpen] = useState<PaperTrade[]>([]);
  const [paperClosed, setPaperClosed] = useState<PaperTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ---- Data fetch ---- */
  const fetchAll = useCallback(async () => {
    try {
      const [jRes, pRes] = await Promise.all([
        fetch('/api/odss/journal', { cache: 'no-store' }),
        fetch('/api/odss/paper-trading/trades', { cache: 'no-store' }),
      ]);
      const j = await jRes.json().catch(() => ({ trades: [] }));
      const p = await pRes.json().catch(() => ({ open: [], closed: [] }));
      setJournalTrades(Array.isArray(j.trades) ? j.trades : []);
      setPaperOpen(Array.isArray(p.open) ? p.open : []);
      setPaperClosed(Array.isArray(p.closed) ? p.closed : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal');
    } finally {
      setLoading(false);
      setLastRefresh(Date.now());
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 10_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  /* ---- Merge closed trades from both sources ---- */
  const closedTrades = useMemo<UnifiedClosedTrade[]>(() => {
    const fromJournal: UnifiedClosedTrade[] = journalTrades.map((t) => ({
      id: `j-${t.id}`,
      source: 'journal',
      symbol: t.symbol,
      direction: t.direction,
      strategy: t.entryType || 'MARKET',
      sector: t.sector,
      entryStrike: t.entryStrike,
      entryPrice: t.entryPrice,
      entryTime: t.entryTime,
      entryType: t.entryType,
      underlyingEntryPrice: t.underlyingEntryPrice,
      exitPrice: t.exitPrice,
      exitTime: t.exitTime,
      underlyingExitPrice: t.underlyingExitPrice,
      exitReason: t.exitReason,
      stopLoss: t.stopLoss || null,
      tp1: t.tp1 || null,
      tp2: t.tp2 || null,
      tp3: t.tp3 || null,
      // Journal only stores net pnl — gross & costs not persisted
      grossPnl: null,
      totalCosts: null,
      netPnl: t.pnl,
      rMultiple: t.rMultiple,
      confidence: t.confidence,
      marketState: t.marketState || null,
      vixAtEntry: null,
      entryReasons: t.entryReasons,
      exitReasons: t.exitReasons,
      holdTimeMinutes: t.holdTimeMinutes,
      tags: t.tags,
      quantity: null,
      lotSize: null,
    }));

    const fromPaper: UnifiedClosedTrade[] = paperClosed.map((t) => ({
      id: `p-${t.id}`,
      source: 'paper',
      symbol: t.symbol,
      direction: t.direction,
      strategy: t.strategy || t.entryType || 'MARKET',
      sector: t.sectorAtEntry ?? null,
      entryStrike: t.entryStrike,
      entryPrice: t.entryPrice,
      entryTime: t.entryTime,
      entryType: t.entryType,
      underlyingEntryPrice: t.entryUnderlying,
      exitPrice: t.exitPrice ?? null,
      exitTime: t.exitTime ?? t.entryTime,
      underlyingExitPrice: t.exitUnderlying ?? null,
      exitReason: t.exitReason ?? null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null,
      grossPnl: t.grossPnl,
      totalCosts: t.totalCosts,
      netPnl: t.netPnl,
      rMultiple: t.rMultiple,
      confidence: null,
      marketState: t.marketState ?? null,
      vixAtEntry: t.vixAtEntry ?? null,
      entryReasons: null,
      exitReasons: null,
      holdTimeMinutes: t.exitTime
        ? Math.max(0, Math.round((new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 60000))
        : null,
      tags: null,
      quantity: t.quantity,
      lotSize: t.lotSize,
    }));

    return [...fromJournal, ...fromPaper].sort((a, b) => {
      const aT = a.exitTime ? new Date(a.exitTime).getTime() : 0;
      const bT = b.exitTime ? new Date(b.exitTime).getTime() : 0;
      return bT - aT;
    });
  }, [journalTrades, paperClosed]);

  /* ---- Counts for the filter badges ---- */
  const counts = {
    active: activeTrade ? 1 : 0,
    positional: paperOpen.length,
    closed: closedTrades.length,
  };

  /* ---- Toggle expansion (close on second click) ---- */
  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  /* ------------------------------------------------------------------------ */
  /*  Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <Card className="border-purple-100 bg-white/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-purple-700">
            <BookOpen className="h-4 w-4 text-purple-600" />
            <span>TRADE JOURNAL</span>
          </span>
          <span className="flex items-center gap-2">
            {lastRefresh > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Updated {new Date(lastRefresh).toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-purple-600 hover:bg-purple-50"
              onClick={fetchAll}
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ---- Filter buttons ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterButton
            active={filter === 'active'}
            label="Active"
            icon={<Activity className="h-3.5 w-3.5" />}
            count={counts.active}
            onClick={() => setFilter('active')}
          />
          <FilterButton
            active={filter === 'positional'}
            label="Positional"
            icon={<Wallet className="h-3.5 w-3.5" />}
            count={counts.positional}
            onClick={() => setFilter('positional')}
          />
          <FilterButton
            active={filter === 'closed'}
            label="Closed"
            icon={<BookOpen className="h-3.5 w-3.5" />}
            count={counts.closed}
            onClick={() => setFilter('closed')}
          />
        </div>

        {/* ---- Loading state ---- */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
            <span className="font-mono text-xs text-muted-foreground">Loading journal…</span>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-center">
            <p className="font-mono text-xs text-rose-600">Failed to load journal data</p>
            <p className="mt-1 text-[11px] text-rose-500">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 border-rose-200 text-rose-600 hover:bg-rose-100"
              onClick={fetchAll}
            >
              <RefreshCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          </div>
        ) : (
          <>
            {/* ---- ACTIVE ---- */}
            {filter === 'active' && <ActiveTab />}

            {/* ---- POSITIONAL ---- */}
            {filter === 'positional' && (
              <PositionalTab
                trades={paperOpen}
                expandedId={expandedId}
                onToggle={toggleExpand}
              />
            )}

            {/* ---- CLOSED ---- */}
            {filter === 'closed' && (
              <ClosedTab
                trades={closedTrades}
                expandedId={expandedId}
                onToggle={toggleExpand}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ========================================================================== */
/*  Filter Button                                                              */
/* ========================================================================== */

function FilterButton({
  active,
  label,
  icon,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  count: number;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      className={cn(
        'h-8 gap-1.5 border px-3 font-mono text-[11px] font-medium tracking-wider transition-all',
        active
          ? 'border-purple-300 bg-purple-100 text-purple-700 shadow-[0_2px_8px_-2px_rgba(124,58,237,0.25)]'
          : 'border-purple-100 bg-white/70 text-muted-foreground hover:bg-purple-50 hover:text-purple-700',
      )}
    >
      {icon}
      {label.toUpperCase()}
      <Badge
        className={cn(
          'ml-1 h-4 min-w-[1rem] px-1 text-[9px] font-bold leading-none',
          active
            ? 'border-purple-200 bg-purple-200 text-purple-800'
            : 'border-purple-100 bg-purple-50 text-purple-600',
        )}
      >
        {count}
      </Badge>
    </Button>
  );
}

/* ========================================================================== */
/*  ACTIVE TAB — live trade from useODSS                                       */
/* ========================================================================== */

function ActiveTab() {
  const { activeTrade } = useODSS();

  if (!activeTrade) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-purple-200 bg-purple-50/40 py-12">
        <div className="rounded-full border border-purple-200 bg-white p-3 shadow-sm">
          <Target className="h-5 w-5 text-purple-400" />
        </div>
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-purple-700">
          No active trade
        </p>
        <p className="text-[11px] text-muted-foreground">
          The decision engine is monitoring the market. A live trade will appear here when entered.
        </p>
      </div>
    );
  }

  const t = activeTrade;
  const pnl = t.pnl ?? 0;
  const rMult = t.rMultiple ?? 0;
  const entryTime = t.entryTime ?? t.createdAt;
  const holdMs = t.exitTime ? t.exitTime - entryTime : Date.now() - entryTime;
  const holdMins = Math.max(0, Math.round(holdMs / 60000));

  // Build a UnifiedClosedTrade-shaped object so we can reuse the detail card
  const trade: UnifiedClosedTrade = {
    id: `live-${t.symbol}-${entryTime}`,
    source: 'journal',
    symbol: t.symbol,
    direction: t.direction,
    strategy: t.entryType || 'MARKET',
    sector: null,
    entryStrike: t.entryStrike ?? null,
    entryPrice: t.entryPrice ?? null,
    entryTime: new Date(entryTime).toISOString(),
    entryType: t.entryType ?? 'MARKET',
    underlyingEntryPrice: t.underlyingEntryPrice ?? null,
    exitPrice: t.exitPrice ?? null,
    exitTime: t.exitTime ? new Date(t.exitTime).toISOString() : null,
    underlyingExitPrice: t.currentUnderlying ?? null,
    exitReason: t.exitReason ?? null,
    stopLoss: t.stopLoss ?? t.initialStopLoss ?? null,
    tp1: t.tp1 ?? null,
    tp2: t.tp2 ?? null,
    tp3: t.tp3 ?? null,
    grossPnl: null,
    totalCosts: null,
    netPnl: pnl,
    rMultiple: rMult,
    confidence: null,
    marketState: null,
    vixAtEntry: null,
    entryReasons: null,
    exitReasons: null,
    holdTimeMinutes: holdMins,
    tags: 'LIVE',
    quantity: null,
    lotSize: null,
    aiExplanation: t.aiExplanation ?? null,
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-purple-200 bg-purple-50/60 px-3 py-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-purple-700">
          Live · streaming from decision engine
        </span>
      </div>
      <TradeDetailCard trade={trade} live />
    </div>
  );
}

/* ========================================================================== */
/*  POSITIONAL TAB — open paper trades                                         */
/* ========================================================================== */

function PositionalTab({
  trades,
  expandedId,
  onToggle,
}: {
  trades: PaperTrade[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<Wallet className="h-5 w-5 text-purple-400" />}
        title="No open paper trades"
        subtitle="Open a paper trade from the Paper Trade tab — it will show up here as a positional trade."
      />
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Header row */}
      <ColumnHeader
        cols={[
          { label: 'Symbol', span: 'md:col-span-2' },
          { label: 'Dir', span: 'md:col-span-1' },
          { label: 'Strategy', span: 'md:col-span-3', hideSm: true },
          { label: 'Strike', span: 'md:col-span-1', hideSm: true },
          { label: 'Undl', span: 'md:col-span-1', hideSm: true },
          { label: 'Opened', span: 'md:col-span-1', hideSm: true },
          { label: 'Premium', span: 'md:col-span-1', align: 'right', hideSm: true },
          { label: 'Est.P&L', span: 'md:col-span-2', align: 'right' },
          { label: '', span: 'md:col-span-1', align: 'right' },
        ]}
      />

      {trades.map((t) => {
        const id = `p-${t.id}`;
        const isExpanded = expandedId === id;
        const estPremium = estimateCurrentPremium(t);
        const totalShares = (t.quantity ?? 1) * (t.lotSize ?? 1);
        const estPnl = (estPremium - t.entryPrice) * totalShares;
        const pnlPositive = estPnl >= 0;

        return (
          <div key={id} className="space-y-1">
            <button
              onClick={() => onToggle(id)}
              className={cn(
                'grid w-full grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 rounded-md border bg-white/80 px-3 py-2 text-left transition-all md:grid-cols-12',
                isExpanded
                  ? 'border-purple-300 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.25)]'
                  : 'border-purple-100 hover:border-purple-200 hover:bg-purple-50/50',
              )}
            >
              {/* Symbol */}
              <span className="col-span-1 font-mono text-xs font-bold text-foreground md:col-span-2">
                {t.symbol}
              </span>
              {/* Dir */}
              <span className="col-span-1 md:col-span-1">
                <DirectionTag direction={t.direction} />
              </span>
              {/* Strategy */}
              <span className="col-span-1 hidden font-mono text-[10px] text-muted-foreground md:col-span-3 md:block">
                {t.strategy}
              </span>
              {/* Strike */}
              <span className="hidden font-mono text-[10px] text-foreground md:col-span-1 md:block">
                {num(t.entryStrike, 0)}
              </span>
              {/* Entry underlying */}
              <span className="hidden font-mono text-[10px] text-muted-foreground md:col-span-1 md:block">
                {num(t.entryUnderlying, 0)}
              </span>
              {/* Opened */}
              <span className="hidden font-mono text-[10px] text-muted-foreground md:col-span-1 md:block">
                {fmtDateShort(t.entryTime)}
              </span>
              {/* Premium */}
              <span className="hidden text-right font-mono text-[10px] text-foreground md:col-span-1 md:block">
                ₹{num(estPremium)}
              </span>
              {/* Est P&L */}
              <span
                className={cn(
                  'col-span-1 text-right font-mono text-xs font-bold md:col-span-2',
                  pnlPositive ? 'text-emerald-600' : 'text-rose-500',
                )}
              >
                {pnlPositive ? '+' : ''}
                {inr(estPnl, 0)}
              </span>
              {/* Expand chevron */}
              <span className="col-span-1 flex justify-end text-purple-500 md:col-span-1">
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            </button>

            {/* Expanded detail */}
            <ExpandWrapper open={isExpanded}>
              <PositionalDetail trade={t} />
            </ExpandWrapper>
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================== */
/*  CLOSED TAB — merged closed trades                                          */
/* ========================================================================== */

function ClosedTab({
  trades,
  expandedId,
  onToggle,
}: {
  trades: UnifiedClosedTrade[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-5 w-5 text-purple-400" />}
        title="No closed trades yet"
        subtitle="Completed trades from the journal and paper-trading history will appear here. Trades flow in automatically once exited."
      />
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Header row */}
      <ColumnHeader
        cols={[
          { label: 'Symbol', span: 'md:col-span-2' },
          { label: 'Dir', span: 'md:col-span-1' },
          { label: 'Strategy', span: 'md:col-span-3', hideSm: true },
          { label: 'Entry', span: 'md:col-span-1', hideSm: true },
          { label: 'Exit', span: 'md:col-span-1', hideSm: true },
          { label: 'Hold', span: 'md:col-span-1', hideSm: true },
          { label: 'Net P&L', span: 'md:col-span-2', align: 'right' },
          { label: 'R', span: 'md:col-span-1', align: 'right' },
          { label: '', span: 'md:col-span-1', align: 'right' },
        ]}
      />

      {trades.map((t) => {
        const isExpanded = expandedId === t.id;
        const pnlPositive = t.netPnl >= 0;
        const rPositive = t.rMultiple >= 0;

        return (
          <div key={t.id} className="space-y-1">
            <button
              onClick={() => onToggle(t.id)}
              className={cn(
                'grid w-full grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 rounded-md border bg-white/80 px-3 py-2 text-left transition-all md:grid-cols-12',
                isExpanded
                  ? 'border-purple-300 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.25)]'
                  : 'border-purple-100 hover:border-purple-200 hover:bg-purple-50/50',
              )}
            >
              {/* Symbol */}
              <span className="col-span-1 flex items-center gap-1.5 font-mono text-xs font-bold text-foreground md:col-span-2">
                <span className="truncate">{t.symbol}</span>
                <SourceTag source={t.source} />
              </span>
              {/* Dir */}
              <span className="col-span-1 md:col-span-1">
                <DirectionTag direction={t.direction} />
              </span>
              {/* Strategy */}
              <span className="hidden font-mono text-[10px] text-muted-foreground md:col-span-3 md:block">
                {t.strategy || '—'}
              </span>
              {/* Entry */}
              <span className="hidden font-mono text-[10px] text-muted-foreground md:col-span-1 md:block">
                {fmtDateShort(t.entryTime)}
              </span>
              {/* Exit */}
              <span className="hidden font-mono text-[10px] text-muted-foreground md:col-span-1 md:block">
                {fmtDateShort(t.exitTime)}
              </span>
              {/* Hold */}
              <span className="hidden font-mono text-[10px] text-foreground md:col-span-1 md:block">
                {fmtHoldTime(t.holdTimeMinutes)}
              </span>
              {/* Net P&L */}
              <span
                className={cn(
                  'col-span-1 text-right font-mono text-xs font-bold md:col-span-2',
                  pnlPositive ? 'text-emerald-600' : 'text-rose-500',
                )}
              >
                {pnlPositive ? '+' : ''}
                {inr(t.netPnl, 0)}
              </span>
              {/* R */}
              <span
                className={cn(
                  'hidden text-right font-mono text-xs font-semibold md:col-span-1 md:block',
                  rPositive ? 'text-emerald-600' : 'text-rose-500',
                )}
              >
                {rStr(t.rMultiple)}
              </span>
              {/* Expand chevron */}
              <span className="col-span-1 flex justify-end text-purple-500 md:col-span-1">
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            </button>

            {/* Expanded detail */}
            <ExpandWrapper open={isExpanded}>
              <TradeDetailCard trade={t} />
            </ExpandWrapper>
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================== */
/*  Column Header (table head)                                                 */
/* ========================================================================== */

function ColumnHeader({
  cols,
}: {
  cols: {
    label: string;
    span: string;
    align?: 'left' | 'right';
    hideSm?: boolean;
  }[];
}) {
  return (
    <div className="hidden grid-cols-12 gap-2 border-b border-purple-100 px-3 py-1.5 md:grid">
      {cols.map((c) => (
        <span
          key={c.label || 'chevron'}
          className={cn(
            'font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground',
            c.span,
            c.hideSm ? 'hidden md:block' : '',
            c.align === 'right' ? 'text-right' : '',
          )}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

/* ========================================================================== */
/*  Expand Wrapper — smooth height animation using CSS grid trick              */
/* ========================================================================== */

function ExpandWrapper({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'grid transition-all duration-300 ease-out',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/* ========================================================================== */
/*  Trade Detail Card (used for closed + active)                               */
/* ========================================================================== */

function TradeDetailCard({
  trade,
  live = false,
}: {
  trade: UnifiedClosedTrade;
  live?: boolean;
}) {
  const pnlPositive = trade.netPnl >= 0;
  const rPositive = trade.rMultiple >= 0;
  const isWin = trade.netPnl > 0;

  return (
    <div className="rounded-lg border border-purple-200 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      {/* ---- Header strip ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-bold text-foreground">{trade.symbol}</span>
          <DirectionTag direction={trade.direction} />
          <span className="font-mono text-[10px] text-muted-foreground">·</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-purple-600">
            {trade.strategy || '—'}
          </span>
          {live && (
            <Badge className="border-emerald-200 bg-emerald-50 text-[9px] font-bold text-emerald-700">
              LIVE
            </Badge>
          )}
          <SourceTag source={trade.source} />
        </div>
        <div className="text-right">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Net P&amp;L</div>
          <div
            className={cn(
              'font-mono text-lg font-bold',
              pnlPositive ? 'text-emerald-600' : 'text-rose-500',
            )}
          >
            {pnlPositive ? '+' : ''}
            {inr(trade.netPnl, 2)}
          </div>
        </div>
      </div>

      {/* ---- Quick stats strip ---- */}
      <div className="flex flex-wrap items-center gap-3 py-3 text-[10px] font-mono">
        <Stat icon={<Calendar className="h-3 w-3" />} label="Entry" value={fmtDateTime(trade.entryTime)} />
        <Stat
          icon={<Clock className="h-3 w-3" />}
          label="Exit"
          value={trade.exitTime ? fmtDateTime(trade.exitTime) : 'OPEN'}
        />
        <Stat
          icon={<Clock className="h-3 w-3" />}
          label="Hold"
          value={fmtHoldTime(trade.holdTimeMinutes)}
        />
        <Stat
          icon={<Gauge className="h-3 w-3" />}
          label="R"
          value={rStr(trade.rMultiple)}
          valueClass={rPositive ? 'text-emerald-600' : 'text-rose-500'}
        />
        <Stat
          icon={isWin ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          label="Outcome"
          value={isWin ? 'WIN ✓' : trade.netPnl === 0 ? 'BREAKEVEN' : 'LOSS ✗'}
          valueClass={isWin ? 'text-emerald-600' : trade.netPnl === 0 ? 'text-muted-foreground' : 'text-rose-500'}
        />
      </div>

      {/* ---- Body grid ---- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ENTRY DETAILS */}
        <Section title="Entry Details" icon={<Crosshair className="h-3 w-3" />}>
          <Row label="Strike" value={num(trade.entryStrike, 0)} />
          <Row label="Premium" value={inr(trade.entryPrice, 2)} />
          <Row label="Underlying" value={num(trade.underlyingEntryPrice, 0)} />
          <Row label="Type" value={trade.entryType || 'MARKET'} />
          {trade.quantity != null && trade.lotSize != null && (
            <Row label="Lots" value={`${trade.quantity} × ${trade.lotSize} (${trade.quantity * trade.lotSize} qty)`} />
          )}
        </Section>

        {/* EXIT DETAILS */}
        <Section title="Exit Details" icon={<X className="h-3 w-3" />}>
          <Row label="Exit Price" value={trade.exitPrice != null ? inr(trade.exitPrice, 2) : '—'} />
          <Row label="Underlying" value={trade.underlyingExitPrice != null ? num(trade.underlyingExitPrice, 0) : '—'} />
          <Row label="Exit Reason" value={trade.exitReason || '—'} />
          <Row label="Exit Time" value={trade.exitTime ? fmtDateTime(trade.exitTime) : 'OPEN'} />
        </Section>

        {/* P&L BREAKDOWN */}
        <Section title="P&L Breakdown" icon={<Wallet className="h-3 w-3" />}>
          <Row
            label="Gross P&L"
            value={trade.grossPnl != null ? inr(trade.grossPnl, 2) : '—'}
            valueClass={trade.grossPnl != null ? pnlColor(trade.grossPnl) : ''}
          />
          <Row
            label="Costs"
            value={
              trade.totalCosts != null
                ? `-${inr(trade.totalCosts, 2).replace('-', '')} (brokerage+STT+GST)`
                : '—'
            }
            valueClass={trade.totalCosts != null && trade.totalCosts > 0 ? 'text-rose-500' : ''}
          />
          <Row
            label="Net P&L"
            value={`${pnlPositive ? '+' : ''}${inr(trade.netPnl, 2)} ${isWin ? '✓' : ''}`}
            valueClass={pnlPositive ? 'text-emerald-600' : 'text-rose-500'}
            bold
          />
        </Section>

        {/* RISK MANAGEMENT */}
        <Section title="Risk Management" icon={<Target className="h-3 w-3" />}>
          <Row label="Stop Loss" value={trade.stopLoss != null ? `${inr(trade.stopLoss, 2)} (-0.25R)` : '—'} />
          <Row
            label="TP1"
            value={trade.tp1 != null && trade.tp1 > 0 ? `${inr(trade.tp1, 2)} (+1.0R)` : '—'}
            valueClass={
              trade.tp1 != null && trade.tp1 > 0 && trade.exitPrice != null && trade.exitPrice >= trade.tp1
                ? 'text-emerald-600 font-bold'
                : ''
            }
          />
          <Row label="TP2" value={trade.tp2 != null && trade.tp2 > 0 ? `${inr(trade.tp2, 2)} (+2.0R)` : '—'} />
          <Row label="TP3" value={trade.tp3 != null && trade.tp3 > 0 ? `${inr(trade.tp3, 2)} (+3.0R)` : '—'} />
        </Section>
      </div>

      {/* ---- R-multiple visual bar ---- */}
      <div className="mt-3 rounded-md border border-purple-100 bg-purple-50/30 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-widest text-purple-700">
            <Gauge className="h-3 w-3" /> R-Multiple
          </span>
          <span
            className={cn(
              'font-mono text-xs font-bold',
              rPositive ? 'text-emerald-600' : 'text-rose-500',
            )}
          >
            {rStr(trade.rMultiple)}
          </span>
        </div>
        <RMultipleBar r={trade.rMultiple} />
      </div>

      {/* ---- Market context ---- */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ContextTile label="Market State" value={trade.marketState || '—'} />
        <ContextTile label="VIX at Entry" value={trade.vixAtEntry != null ? num(trade.vixAtEntry, 2) : '—'} />
        <ContextTile label="Sector" value={trade.sector || 'INDEX'} />
        <ContextTile
          label="Confidence"
          value={trade.confidence != null ? `${trade.confidence.toFixed(0)}%` : '—'}
        />
      </div>

      {/* ---- Entry / Exit Reasons ---- */}
      {(trade.entryReasons || trade.exitReasons) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {trade.entryReasons && (
            <ReasonBlock title="Entry Reasons" text={trade.entryReasons} icon={<Crosshair className="h-3 w-3" />} />
          )}
          {trade.exitReasons && (
            <ReasonBlock title="Exit Reasons" text={trade.exitReasons} icon={<X className="h-3 w-3" />} />
          )}
        </div>
      )}

      {/* ---- AI Explanation (only for live trades) ---- */}
      {trade.aiExplanation && (
        <div className="mt-3 rounded-md border border-purple-200 bg-gradient-to-br from-purple-50 to-violet-50 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <Brain className="h-3 w-3 text-purple-600" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-purple-700">
              AI Explanation
            </span>
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-foreground/85">
            {trade.aiExplanation}
          </p>
        </div>
      )}

      {/* ---- Tags ---- */}
      {trade.tags && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {trade.tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((tag, i) => (
              <Badge
                key={`${tag}-${i}`}
                variant="outline"
                className="border-purple-200 bg-purple-50 px-1.5 py-0 text-[9px] font-mono text-purple-700"
              >
                {tag}
              </Badge>
            ))}
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Positional Detail Card (open trade — uses PaperTrade shape)                */
/* ========================================================================== */

function PositionalDetail({ trade }: { trade: PaperTrade }) {
  const estPremium = estimateCurrentPremium(trade);
  const totalShares = (trade.quantity ?? 1) * (trade.lotSize ?? 1);
  const estPnl = (estPremium - trade.entryPrice) * totalShares;
  const initialRisk = trade.entryPrice * totalShares * 0.25; // 25% SL default
  const estR = initialRisk > 0 ? estPnl / initialRisk : 0;
  const pnlPositive = estPnl >= 0;

  // Wrap into UnifiedClosedTrade so we can reuse the big detail card
  const unified: UnifiedClosedTrade = {
    id: `p-${trade.id}`,
    source: 'paper',
    symbol: trade.symbol,
    direction: trade.direction,
    strategy: trade.strategy,
    sector: trade.sectorAtEntry ?? null,
    entryStrike: trade.entryStrike,
    entryPrice: trade.entryPrice,
    entryTime: trade.entryTime,
    entryType: trade.entryType,
    underlyingEntryPrice: trade.entryUnderlying,
    exitPrice: estPremium,
    exitTime: null,
    underlyingExitPrice: trade.entryUnderlying,
    exitReason: 'OPEN · live estimate',
    stopLoss: null,
    tp1: null,
    tp2: null,
    tp3: null,
    grossPnl: estPnl,
    totalCosts: trade.totalCosts,
    netPnl: estPnl - trade.totalCosts,
    rMultiple: estR,
    confidence: null,
    marketState: trade.marketState ?? null,
    vixAtEntry: trade.vixAtEntry ?? null,
    entryReasons: null,
    exitReasons: null,
    holdTimeMinutes: Math.max(0, Math.round((Date.now() - new Date(trade.entryTime).getTime()) / 60000)),
    tags: 'OPEN',
    quantity: trade.quantity,
    lotSize: trade.lotSize,
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          Position open · estimated P&L {pnlPositive ? '+' : ''}
          {inr(estPnl, 2)} ({rStr(estR)})
        </span>
      </div>
      <TradeDetailCard trade={unified} live />
    </div>
  );
}

/* ========================================================================== */
/*  R-Multiple Visual Bar                                                      */
/* ========================================================================== */

function RMultipleBar({ r }: { r: number }) {
  if (!Number.isFinite(r)) {
    return <div className="font-mono text-[10px] text-muted-foreground">—</div>;
  }
  // Map R to a -3R..+3R range; clamp to [-3, 3]
  const clamped = Math.max(-3, Math.min(3, r));
  // Width as % of half the bar (50% = 0R)
  const widthPct = (Math.abs(clamped) / 3) * 50;
  const positive = clamped >= 0;

  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-purple-50 ring-1 ring-purple-100">
      {/* center marker */}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-purple-300" />
      {/* fill */}
      <div
        className={cn(
          'absolute top-0 h-full transition-all duration-500',
          positive ? 'bg-emerald-400' : 'bg-rose-400',
        )}
        style={{
          left: positive ? '50%' : `${50 - widthPct}%`,
          width: `${widthPct}%`,
        }}
      />
      {/* tick marks */}
      {[-3, -2, -1, 1, 2, 3].map((tick) => (
        <div
          key={tick}
          className="absolute top-0 h-full w-px bg-purple-200/60"
          style={{ left: `${50 + (tick / 3) * 50}%` }}
        />
      ))}
    </div>
  );
}

/* ========================================================================== */
/*  Small building-block components                                            */
/* ========================================================================== */

function Stat({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <span className="flex items-center gap-1 rounded-md border border-purple-100 bg-white/70 px-2 py-1">
      <span className="text-purple-500">{icon}</span>
      <span className="uppercase tracking-widest text-muted-foreground">{label}:</span>
      <span className={cn('font-semibold text-foreground', valueClass)}>{value}</span>
    </span>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-purple-100 bg-purple-50/30 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-purple-600">{icon}</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-purple-700">
          {title}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
  bold,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-right',
          bold ? 'font-bold' : 'font-medium',
          valueClass ?? 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ContextTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-purple-100 bg-white/70 p-2 text-center">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-[11px] font-semibold text-foreground">{value}</div>
    </div>
  );
}

function ReasonBlock({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: React.ReactNode;
}) {
  // Try to parse JSON arrays; otherwise show raw text
  const parsed = safeParseJson(text);
  let items: string[] = [];
  if (Array.isArray(parsed)) {
    items = parsed
      .map((p: any) =>
        typeof p === 'string' ? p : p?.reason ?? p?.message ?? JSON.stringify(p),
      )
      .filter(Boolean);
  } else if (typeof parsed === 'object' && parsed) {
    items = Object.entries(parsed).map(([k, v]) => `${k}: ${String(v as any)}`);
  } else if (text) {
    items = [text];
  }

  return (
    <div className="rounded-md border border-purple-100 bg-white/70 p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-purple-600">{icon}</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-purple-700">
          {title}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-foreground/85"
            >
              <span className="mt-0.5 text-purple-400">▸</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DirectionTag({ direction }: { direction: string }) {
  const cls = dirBadgeClass(direction);
  const label = direction === 'CE' ? 'CE' : direction === 'PE' ? 'PE' : direction;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest',
        cls,
      )}
    >
      {label}
    </span>
  );
}

function SourceTag({ source }: { source: 'journal' | 'paper' }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'ml-0.5 h-3.5 border px-1 py-0 font-mono text-[8px] font-bold uppercase tracking-widest',
        source === 'paper'
          ? 'border-violet-200 bg-violet-50 text-violet-600'
          : 'border-purple-200 bg-purple-50 text-purple-600',
      )}
    >
      {source === 'paper' ? 'PAPER' : 'JOURNAL'}
    </Badge>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-purple-200 bg-purple-50/40 py-12">
      <div className="rounded-full border border-purple-200 bg-white p-3 shadow-sm">{icon}</div>
      <p className="font-mono text-xs font-semibold uppercase tracking-widest text-purple-700">{title}</p>
      <p className="max-w-md px-4 text-center text-[11px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/* ========================================================================== */
/*  Open-trade helpers (replicated from paper-trading-panel for live estimate) */
/* ========================================================================== */

function estimateCurrentPremium(trade: PaperTrade): number {
  const S = trade.entryUnderlying;
  const K = trade.entryStrike;
  const intrinsic = trade.direction === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const elapsedDays = (Date.now() - new Date(trade.entryTime).getTime()) / 86_400_000;
  const decay = Math.max(0, 1 - 0.05 * elapsedDays);
  const entryIntrinsic =
    trade.direction === 'CE'
      ? Math.max(trade.entryUnderlying - K, 0)
      : Math.max(K - trade.entryUnderlying, 0);
  const tv = Math.max(0, trade.entryPrice - entryIntrinsic);
  return Math.max(0.05, intrinsic + tv * decay);
}
