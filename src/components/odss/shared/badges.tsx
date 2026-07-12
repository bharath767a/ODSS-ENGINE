'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap } from 'lucide-react';
import type { Trend, Bias, Decision, TradeStateName, Direction, Volatility, Structure } from '@/lib/odss/types';

/**
 * Dark-theme trading badges.
 * - Subtle translucent backgrounds tinted by semantic color
 * - Hairline borders (border-{color}/30)
 * - Glow shadows on critical states (ENTER, AVOID, EXTREME vol)
 * - Monospace where numeric
 */

export function TrendBadge({ trend, className }: { trend: Trend; className?: string }) {
  const map = {
    BULLISH: {
      icon: TrendingUp,
      color: 'text-bull bg-bull/10 border-bull/30',
      label: 'Bullish',
    },
    BEARISH: {
      icon: TrendingDown,
      color: 'text-bear bg-bear/10 border-bear/30',
      label: 'Bearish',
    },
    NEUTRAL: {
      icon: Minus,
      color: 'text-muted-foreground bg-muted/40 border-border',
      label: 'Neutral',
    },
  } as const;
  const { icon: Icon, color, label } = map[trend];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium tracking-wide',
        color,
        className
      )}
    >
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

export function BiasBadge({ bias }: { bias: Bias }) {
  const map = {
    LONG: { color: 'text-bull bg-bull/15 border-bull/40', label: 'LONG' },
    SHORT: { color: 'text-bear bg-bear/15 border-bear/40', label: 'SHORT' },
    NEUTRAL: { color: 'text-muted-foreground bg-muted/40 border-border', label: 'NEUTRAL' },
  } as const;
  const { color, label } = map[bias];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold tracking-widest',
        color
      )}
    >
      {label}
    </span>
  );
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  return direction === 'CE' ? (
    <span className="inline-flex items-center rounded border border-bull/40 bg-bull/15 px-2 py-0.5 text-[10px] font-bold tracking-widest text-bull">
      CE · CALL
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-bear/40 bg-bear/15 px-2 py-0.5 text-[10px] font-bold tracking-widest text-bear">
      PE · PUT
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const map = {
    ENTER: {
      color: 'text-bull bg-bull/15 border-bull/50 glow-bull',
      icon: TrendingUp,
    },
    WAIT: {
      color: 'text-warn bg-warn/15 border-warn/40',
      icon: AlertTriangle,
    },
    WATCH: {
      color: 'text-info bg-info/10 border-info/30',
      icon: Minus,
    },
    AVOID: {
      color: 'text-bear bg-bear/15 border-bear/50 glow-bear',
      icon: TrendingDown,
    },
  } as const;
  const { color, icon: Icon } = map[decision];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold tracking-widest transition-all',
        color
      )}
    >
      <Icon className="h-3 w-3" /> {decision}
    </span>
  );
}

export function VolatilityBadge({ vol }: { vol: Volatility }) {
  const map = {
    LOW: 'text-muted-foreground bg-muted/40 border-border',
    NORMAL: 'text-bull bg-bull/10 border-bull/25',
    HIGH: 'text-warn bg-warn/15 border-warn/40',
    EXTREME: 'text-bear bg-bear/15 border-bear/50 glow-warn',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium tracking-widest',
        map[vol]
      )}
    >
      {vol === 'EXTREME' && <Zap className="h-3 w-3" />} {vol}
    </span>
  );
}

const STATE_COLORS: Record<TradeStateName, string> = {
  WATCHLIST: 'text-muted-foreground bg-muted/40 border-border',
  READY: 'text-info bg-info/10 border-info/30',
  WAITING_ENTRY: 'text-warn bg-warn/15 border-warn/40',
  ENTERED: 'text-bull bg-bull/15 border-bull/50 glow-bull',
  TP1: 'text-bull bg-bull/15 border-bull/40',
  TP2: 'text-bull bg-bull/15 border-bull/40',
  TRAILING: 'text-ai bg-ai/15 border-ai/40 glow-ai',
  WEAKENING: 'text-warn bg-warn/15 border-warn/40',
  EXIT: 'text-bear bg-bear/15 border-bear/50 glow-bear',
  COMPLETE: 'text-muted-foreground bg-muted/40 border-border',
};

export function StateBadge({ state }: { state: TradeStateName }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold tracking-widest',
        STATE_COLORS[state]
      )}
    >
      {state.replace('_', ' ')}
    </span>
  );
}

export const STATE_ORDER: TradeStateName[] = [
  'WATCHLIST',
  'READY',
  'WAITING_ENTRY',
  'ENTERED',
  'TP1',
  'TP2',
  'TRAILING',
  'WEAKENING',
  'EXIT',
  'COMPLETE',
];

export function ScoreBar({
  value,
  max = 100,
  label,
  color,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  color?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const defaultColor =
    pct > 65 ? 'bg-bull' : pct > 40 ? 'bg-warn' : 'bg-bear';
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <div className="mb-0.5 flex justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="font-mono tnum">{value.toFixed(0)}</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color ?? defaultColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const color =
    value > 70 ? 'text-bull' : value > 45 ? 'text-warn' : 'text-bear';
  const stroke = value > 70 ? '#34d399' : value > 45 ? '#fbbf24' : '#fb7185';
  const glow =
    value > 70
      ? 'drop-shadow(0 0 4px rgba(52,211,153,0.55))'
      : value > 45
        ? 'drop-shadow(0 0 4px rgba(251,191,36,0.5))'
        : 'drop-shadow(0 0 4px rgba(251,113,133,0.55))';
  const radius = 26;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="60" height="60" className="-rotate-90" style={{ filter: glow }}>
        <circle cx="30" cy="30" r={radius} stroke="#1c2330" strokeWidth="5" fill="none" />
        <circle
          cx="30"
          cy="30"
          r={radius}
          stroke={stroke}
          strokeWidth="5"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-base font-bold font-mono tnum', color)}>{value.toFixed(0)}</span>
        <span className="text-[8px] uppercase tracking-widest text-muted-foreground">conf</span>
      </div>
    </div>
  );
}

export function StructureBadge({ structure }: { structure: Structure }) {
  const map: Record<Structure, string> = {
    UPTREND: 'text-bull bg-bull/10 border-bull/25',
    DOWNTREND: 'text-bear bg-bear/10 border-bear/25',
    RANGE: 'text-muted-foreground bg-muted/40 border-border',
    BREAKOUT: 'text-bull bg-bull/20 border-bull/50 font-bold',
    BREAKDOWN: 'text-bear bg-bear/20 border-bear/50 font-bold',
    REVERSAL: 'text-warn bg-warn/15 border-warn/40',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium tracking-widest',
        map[structure]
      )}
    >
      {structure.replace('_', ' ')}
    </span>
  );
}

export function ChangePct({ value, className }: { value: number; className?: string }) {
  const positive = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-xs font-medium tnum',
        positive ? 'text-bull' : 'text-bear',
        className
      )}
    >
      {positive ? '▲' : '▼'}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}
