'use client';

import { Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useODSS } from '@/hooks/use-odss';
import { cn } from '@/lib/utils';

export function GuardrailBar() {
  const { guardrails } = useODSS();

  if (!guardrails) return null;

  const {
    tradesToday,
    maxTradesPerDay,
    realizedPnlToday,
    maxDailyLossRupees,
    profitCapRupees,
    remainingTrades,
  } = guardrails;

  const lossUsed = Math.max(0, -realizedPnlToday);
  const lossPct = maxDailyLossRupees > 0 ? (lossUsed / maxDailyLossRupees) * 100 : 0;
  const profitPct = profitCapRupees > 0 ? Math.max(0, realizedPnlToday / profitCapRupees) * 100 : 0;

  const blocked = remainingTrades === 0 || lossUsed >= maxDailyLossRupees || realizedPnlToday >= profitCapRupees;

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border px-3 py-1.5 text-xs',
      blocked ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'
    )}>
      <Shield className={cn('h-3.5 w-3.5', blocked ? 'text-rose-500' : 'text-slate-500')} />

      {/* Trades today */}
      <div className="flex items-center gap-1">
        <span className="text-slate-400">Trades:</span>
        <span className={cn('font-mono font-semibold', tradesToday >= maxTradesPerDay ? 'text-rose-600' : 'text-slate-700')}>
          {tradesToday}/{maxTradesPerDay}
        </span>
      </div>

      <div className="h-3 w-px bg-slate-200" />

      {/* Daily loss */}
      <div className="flex items-center gap-1">
        <span className="text-slate-400">Loss:</span>
        <span className={cn('font-mono font-semibold', lossUsed >= maxDailyLossRupees ? 'text-rose-600' : lossPct > 50 ? 'text-amber-600' : 'text-slate-700')}>
          ₹{lossUsed.toFixed(0)}/₹{maxDailyLossRupees.toFixed(0)}
        </span>
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
          <div className={cn('h-full', lossPct > 80 ? 'bg-rose-500' : lossPct > 50 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, lossPct)}%` }} />
        </div>
      </div>

      <div className="h-3 w-px bg-slate-200" />

      {/* Profit cap */}
      <div className="flex items-center gap-1">
        <span className="text-slate-400">Profit:</span>
        <span className={cn('font-mono font-semibold', realizedPnlToday >= profitCapRupees ? 'text-emerald-600' : 'text-slate-700')}>
          ₹{Math.max(0, realizedPnlToday).toFixed(0)}/₹{profitCapRupees.toFixed(0)}
        </span>
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, profitPct)}%` }} />
        </div>
      </div>

      {/* Status */}
      <div className="ml-auto flex items-center gap-1">
        {blocked ? (
          <>
            <AlertTriangle className="h-3 w-3 text-rose-500" />
            <span className="font-medium text-rose-600">Guardrail active — entries blocked</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span className="text-slate-500">{remainingTrades} entries remaining</span>
          </>
        )}
      </div>
    </div>
  );
}
