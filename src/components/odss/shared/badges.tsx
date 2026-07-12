'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap } from 'lucide-react';
import type { Trend, Bias, Decision, TradeStateName, Direction, Volatility, Structure } from '@/lib/odss/types';

export function TrendBadge({ trend, className }: { trend: Trend; className?: string }) {
  const map = {
    BULLISH: { icon: TrendingUp, color: 'text-emerald-600 bg-emerald-50 border-emerald-200', label: 'Bullish' },
    BEARISH: { icon: TrendingDown, color: 'text-rose-600 bg-rose-50 border-rose-200', label: 'Bearish' },
    NEUTRAL: { icon: Minus, color: 'text-slate-500 bg-slate-50 border-slate-200', label: 'Neutral' },
  };
  const { icon: Icon, color, label } = map[trend];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium', color, className)}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

export function BiasBadge({ bias }: { bias: Bias }) {
  const map = {
    LONG: { color: 'text-emerald-700 bg-emerald-100 border-emerald-300', label: 'LONG' },
    SHORT: { color: 'text-rose-700 bg-rose-100 border-rose-300', label: 'SHORT' },
    NEUTRAL: { color: 'text-slate-600 bg-slate-100 border-slate-300', label: 'NEUTRAL' },
  };
  const { color, label } = map[bias];
  return <span className={cn('inline-flex items-center rounded border px-2 py-0.5 text-xs font-bold', color)}>{label}</span>;
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  return direction === 'CE' ? (
    <span className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">CE Call</span>
  ) : (
    <span className="inline-flex items-center rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">PE Put</span>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const map = {
    ENTER: { color: 'text-emerald-700 bg-emerald-100 border-emerald-300', icon: TrendingUp },
    WAIT: { color: 'text-amber-700 bg-amber-100 border-amber-300', icon: AlertTriangle },
    WATCH: { color: 'text-sky-700 bg-sky-100 border-sky-300', icon: Minus },
    AVOID: { color: 'text-rose-700 bg-rose-100 border-rose-300', icon: TrendingDown },
  };
  const { color, icon: Icon } = map[decision];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-bold', color)}>
      <Icon className="h-3 w-3" /> {decision}
    </span>
  );
}

export function VolatilityBadge({ vol }: { vol: Volatility }) {
  const map = {
    LOW: 'text-slate-600 bg-slate-100',
    NORMAL: 'text-emerald-600 bg-emerald-100',
    HIGH: 'text-amber-600 bg-amber-100',
    EXTREME: 'text-rose-600 bg-rose-100',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium', map[vol])}>
      {vol === 'EXTREME' && <Zap className="h-3 w-3" />} {vol}
    </span>
  );
}

const STATE_COLORS: Record<TradeStateName, string> = {
  WATCHLIST: 'text-slate-600 bg-slate-100 border-slate-300',
  READY: 'text-sky-700 bg-sky-100 border-sky-300',
  WAITING_ENTRY: 'text-amber-700 bg-amber-100 border-amber-300',
  ENTERED: 'text-emerald-700 bg-emerald-100 border-emerald-300',
  TP1: 'text-emerald-700 bg-emerald-100 border-emerald-300',
  TP2: 'text-emerald-700 bg-emerald-100 border-emerald-300',
  TRAILING: 'text-violet-700 bg-violet-100 border-violet-300',
  WEAKENING: 'text-amber-700 bg-amber-100 border-amber-300',
  EXIT: 'text-rose-700 bg-rose-100 border-rose-300',
  COMPLETE: 'text-slate-500 bg-slate-100 border-slate-300',
};

export function StateBadge({ state }: { state: TradeStateName }) {
  return (
    <span className={cn('inline-flex items-center rounded border px-2 py-0.5 text-xs font-bold', STATE_COLORS[state])}>
      {state.replace('_', ' ')}
    </span>
  );
}

export const STATE_ORDER: TradeStateName[] = [
  'WATCHLIST', 'READY', 'WAITING_ENTRY', 'ENTERED', 'TP1', 'TP2', 'TRAILING', 'WEAKENING', 'EXIT', 'COMPLETE',
];

export function ScoreBar({ value, max = 100, label, color }: { value: number; max?: number; label?: string; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const defaultColor = pct > 65 ? 'bg-emerald-500' : pct > 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="w-full">
      {label && <div className="mb-0.5 flex justify-between text-xs text-slate-500"><span>{label}</span><span>{value.toFixed(0)}</span></div>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={cn('h-full rounded-full transition-all', color ?? defaultColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const color = value > 70 ? 'text-emerald-600' : value > 45 ? 'text-amber-600' : 'text-rose-600';
  const stroke = value > 70 ? '#10b981' : value > 45 ? '#f59e0b' : '#f43f5e';
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="72" height="72" className="-rotate-90">
        <circle cx="36" cy="36" r={radius} stroke="#e2e8f0" strokeWidth="6" fill="none" />
        <circle cx="36" cy="36" r={radius} stroke={stroke} strokeWidth="6" fill="none" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-lg font-bold', color)}>{value.toFixed(0)}</span>
        <span className="text-[9px] uppercase text-slate-400">conf</span>
      </div>
    </div>
  );
}

export function StructureBadge({ structure }: { structure: Structure }) {
  const map: Record<Structure, string> = {
    UPTREND: 'text-emerald-700 bg-emerald-50',
    DOWNTREND: 'text-rose-700 bg-rose-50',
    RANGE: 'text-slate-600 bg-slate-50',
    BREAKOUT: 'text-emerald-700 bg-emerald-100 font-bold',
    BREAKDOWN: 'text-rose-700 bg-rose-100 font-bold',
    REVERSAL: 'text-amber-700 bg-amber-100',
  };
  return <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', map[structure])}>{structure.replace('_', ' ')}</span>;
}

export function ChangePct({ value, className }: { value: number; className?: string }) {
  const positive = value >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs font-medium', positive ? 'text-emerald-600' : 'text-rose-600', className)}>
      {positive ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}
