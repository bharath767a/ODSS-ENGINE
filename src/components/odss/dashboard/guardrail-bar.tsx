'use client';

import { Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useODSS } from '@/hooks/use-odss';
import { cn } from '@/lib/utils';

/**
 * Always-visible guardrail status bar.
 * Dark glassmorphic surface with hairline progress bars. Glows red when blocked.
 */
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

  const blocked =
    remainingTrades === 0 ||
    lossUsed >= maxDailyLossRupees ||
    realizedPnlToday >= profitCapRupees;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-1.5 backdrop-blur-sm transition-all',
        blocked
          ? 'border-bear/50 bg-bear/10 glow-danger'
          : 'border-border/60 bg-card/40'
      )}
    >
      <div className="flex items-center gap-1.5">
        <Shield
          className={cn('h-3.5 w-3.5', blocked ? 'text-bear' : 'text-info')}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          GUARDRAIL
        </span>
      </div>

      {/* Trades today */}
      <GuardrailMetric
        label="TRADES"
        value={`${tradesToday}/${maxTradesPerDay}`}
        tone={tradesToday >= maxTradesPerDay ? 'bear' : 'neutral'}
        pct={(tradesToday / Math.max(1, maxTradesPerDay)) * 100}
        barColor={tradesToday >= maxTradesPerDay ? 'bg-bear' : 'bg-info'}
      />

      <div className="h-3 w-px bg-border/60" />

      {/* Daily loss */}
      <GuardrailMetric
        label="LOSS"
        value={`₹${lossUsed.toFixed(0)}/₹${maxDailyLossRupees.toFixed(0)}`}
        tone={
          lossUsed >= maxDailyLossRupees ? 'bear' : lossPct > 50 ? 'warn' : 'neutral'
        }
        pct={Math.min(100, lossPct)}
        barColor={
          lossPct > 80 ? 'bg-bear' : lossPct > 50 ? 'bg-warn' : 'bg-bull'
        }
      />

      <div className="h-3 w-px bg-border/60" />

      {/* Profit cap */}
      <GuardrailMetric
        label="PROFIT"
        value={`₹${Math.max(0, realizedPnlToday).toFixed(0)}/₹${profitCapRupees.toFixed(0)}`}
        tone={realizedPnlToday >= profitCapRupees ? 'bull' : 'neutral'}
        pct={Math.min(100, profitPct)}
        barColor="bg-bull"
      />

      {/* Status */}
      <div className="ml-auto flex items-center gap-1.5">
        {blocked ? (
          <>
            <AlertTriangle className="h-3 w-3 text-bear" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-bear text-glow-bear">
              ENTRIES BLOCKED
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3 w-3 text-bull" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {remainingTrades} ENTRIES REMAINING
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function GuardrailMetric({
  label,
  value,
  tone,
  pct,
  barColor,
}: {
  label: string;
  value: string;
  tone: 'bull' | 'bear' | 'warn' | 'neutral';
  pct: number;
  barColor: string;
}) {
  const toneClass = {
    bull: 'text-bull',
    bear: 'text-bear',
    warn: 'text-warn',
    neutral: 'text-foreground',
  }[tone];
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className={cn('font-mono text-[11px] font-semibold tnum', toneClass)}>{value}</span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
