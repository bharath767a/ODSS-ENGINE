'use client';

import { memo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge } from '../shared/badges';
import { cn } from '@/lib/utils';
import { Briefcase, X, Activity } from 'lucide-react';

function recClasses(r?: string) {
  switch (r) {
    case 'CLOSE': return 'bg-bear/20 text-bear border border-bear/30';
    case 'REDUCE': return 'bg-warn/20 text-warn border border-warn/30';
    case 'TRAIL': return 'bg-info/20 text-info border border-info/30';
    default: return 'bg-bull/20 text-bull border border-bull/30';
  }
}

function TakenPositionsInner() {
  const { takenTrades, closeTaken } = useODSS();
  const [closing, setClosing] = useState<string | null>(null);
  const active = (takenTrades ?? []).filter((t: any) => t.status === 'ACTIVE');

  return (
    <Card className="border-info/30 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Briefcase className="h-4 w-4 text-info" />
            <span className="text-info text-base font-bold">MY POSITIONS</span>
            <span className="rounded bg-info/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-info">REAL GREEKS</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-info/80">{active.length} OPEN</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        {active.length === 0 && (
          <div className="py-5 text-center font-mono text-xs text-muted-foreground">
            No open positions. Hit <span className="text-bull font-bold">TAKE</span> on a pick — the engine tracks it with real greeks and tells you when to exit.
          </div>
        )}
        {active.map((t: any) => {
          const pnlPos = (t.pnl ?? 0) >= 0;
          return (
            <div key={t.id} className={cn('rounded-lg border p-2.5', t.recommendation === 'CLOSE' ? 'border-bear/40 bg-bear/5' : 'border-border/40 bg-card/30')}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-sans text-sm font-bold text-foreground">{t.symbol}</span>
                  <DirectionBadge direction={t.direction} />
                  {t.strike > 0 && <span className="rounded bg-muted/30 px-1 py-0.5 font-mono text-[9px] text-muted-foreground">{t.strike} {t.direction}</span>}
                </div>
                <div className="text-right">
                  <div className={cn('font-mono text-sm font-bold', pnlPos ? 'text-bull' : 'text-bear')}>
                    {pnlPos ? '+' : ''}{(t.pnl ?? 0).toFixed(2)} <span className="text-[10px]">({pnlPos ? '+' : ''}{(t.pnlPct ?? 0).toFixed(0)}%)</span>
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground">₹{t.entryPremium?.toFixed(2)} → ₹{t.currentPremium?.toFixed(2)}</div>
                </div>
              </div>
              {/* Greeks */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[9px]">
                {t.delta !== undefined && <span className="rounded bg-muted/20 px-1 py-0.5">Δ {t.delta?.toFixed(2)}</span>}
                {t.theta !== undefined && <span className="rounded bg-muted/20 px-1 py-0.5">θ {t.theta?.toFixed(1)}</span>}
                {t.iv !== undefined && <span className="rounded bg-muted/20 px-1 py-0.5">IV {t.iv?.toFixed(1)}</span>}
                {t.ocScore !== undefined && <span className="rounded bg-info/15 px-1 py-0.5 text-info">OC {t.ocScore}</span>}
                {t.oiAction && <span className="rounded bg-muted/20 px-1 py-0.5">{String(t.oiAction).replace('_', ' ').toLowerCase()}</span>}
              </div>
              {/* Recommendation */}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={cn('flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest', recClasses(t.recommendation))}>
                  <Activity className="h-3 w-3" />{t.recommendation ?? 'HOLD'}
                </span>
                <Button size="sm" variant="ghost" className="h-6 gap-0.5 font-mono text-[9px] tracking-widest text-bear hover:bg-bear/10"
                  disabled={closing === t.id}
                  onClick={async () => { setClosing(t.id); await closeTaken({ id: t.id }, 'Closed from dashboard'); setClosing(null); }}>
                  <X className="h-3 w-3" /> CLOSE
                </Button>
              </div>
              {t.recReason && <div className="mt-1 font-mono text-[9px] leading-snug text-muted-foreground">{t.recReason}</div>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export const TakenPositions = memo(TakenPositionsInner);
