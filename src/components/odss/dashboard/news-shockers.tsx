'use client';

import { memo, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge } from '../shared/badges';
import { cn } from '@/lib/utils';
import { Zap, Clock, History } from 'lucide-react';

function fmtTime(ts: number) {
  try { return new Date(ts).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }); }
  catch { return ''; }
}

function NewsShockersInner() {
  const { conviction } = useODSS();
  const current: any[] = conviction?.newsShockPicks ?? [];
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/odss/news-shocks').then(r => r.json()).then(d => { if (alive) setHistory(d.items ?? []); }).catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <Card className="border-bear/40 bg-gradient-to-br from-bear/10 to-transparent backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide">
            <Zap className={cn('h-4 w-4 text-bear', current.length > 0 && 'animate-pulse')} />
            <span className="text-bear text-base font-bold">NEWS SHOCKERS</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-bear/80">
            {current.length} LIVE · {history.length} LOGGED
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        {/* LIVE shockers */}
        {current.length === 0 && history.length === 0 && (
          <div className="py-4 text-center font-mono text-xs text-muted-foreground">No news shocks detected. High-impact negative news will appear here (PE opportunities).</div>
        )}
        {current.map((pick: any) => (
          <div key={`live-${pick.symbol}`} className={cn('rounded-lg border p-2.5', pick.ivCaution ? 'border-amber-400/40 bg-amber-400/5' : 'border-bear/30 bg-bear/5')}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-sans text-sm font-bold text-foreground">{pick.symbol}</span>
                <DirectionBadge direction="PE" />
                <span className="rounded bg-bear/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bear">{pick.shockAgeMinutes}m ago</span>
                {pick.ivCaution && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700">⚠ IV HIGH</span>}
              </div>
              <span className="font-mono text-sm font-bold text-foreground">₹{pick.currentPrice?.toFixed(2)}</span>
            </div>
            <div className="mt-1.5 flex items-start gap-1 font-mono text-[9px] leading-snug text-bear">
              <Zap className="mt-0.5 h-2.5 w-2.5 shrink-0" /><span className="line-clamp-2">{pick.shockTrigger}</span>
            </div>
          </div>
        ))}

        {/* Timestamped HISTORY */}
        {history.length > 0 && (
          <div className="mt-1 border-t border-border/20 pt-2">
            <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              <History className="h-3 w-3" /> Logged history
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {history.map((h: any, i: number) => (
                <div key={`hist-${h.symbol}-${h.firstSeen}-${i}`} className="rounded border border-border/20 bg-card/20 p-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className="font-sans text-xs font-bold text-foreground">{h.symbol}</span>
                      <span className="rounded bg-muted/20 px-1 py-0.5 font-mono text-[8px] uppercase text-muted-foreground">{h.sector}</span>
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[8px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />{fmtTime(h.firstSeen)}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] leading-snug text-muted-foreground line-clamp-2">{h.trigger}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const NewsShockers = memo(NewsShockersInner);
