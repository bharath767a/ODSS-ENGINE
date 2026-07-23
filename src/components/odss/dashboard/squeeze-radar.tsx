'use client';

import { memo, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge } from '../shared/badges';
import { cn } from '@/lib/utils';
import { Zap, History, Clock } from 'lucide-react';

function dur(fromTs: number, now: number) {
  if (!fromTs) return '';
  const s = Math.max(0, Math.round((now - fromTs) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function clock(ts: number) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return '—'; }
}

const statusStyle: Record<string, string> = {
  FORMING: 'border-warn/40 bg-warn/5',
  LIVE: 'border-bear/50 bg-bear/5 animate-pulse',
  PEAKING: 'border-orange-500/50 bg-orange-500/5',
};
const badgeStyle: Record<string, string> = {
  FORMING: 'bg-warn/25 text-warn',
  LIVE: 'bg-bear/30 text-bear',
  PEAKING: 'bg-orange-500/25 text-orange-600',
};
const label: Record<string, string> = {
  FORMING: '⚡ SQUEEZE SETUP', LIVE: '⚡ SHORT COVERING LIVE', PEAKING: '⚠ PEAKING — PREPARE EXIT',
};

function SqueezeRadarInner() {
  const { squeezes, completedSqueezes } = useODSS();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const active: any[] = squeezes ?? [];
  const done: any[] = completedSqueezes ?? [];

  return (
    <Card className={cn('backdrop-blur-sm', active.some((s) => s.status === 'LIVE') ? 'border-bear/50' : 'border-warn/30', 'bg-card/50')}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide">
            <Zap className={cn('h-4 w-4 text-bear', active.length > 0 && 'animate-pulse')} />
            <span className="text-bear text-base font-bold">SQUEEZE RADAR</span>
            <span className="rounded bg-bear/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bear">SHORT COVERING</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-bear/80">{active.length} LIVE · {done.length} DONE</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        {active.length === 0 && (
          <div className="py-3 text-center font-mono text-[10px] text-muted-foreground">
            No squeeze setups right now. When price presses a heavy OI wall and writers start covering, it appears here — NIFTY first.
          </div>
        )}
        {active.map((s: any) => (
          <div key={`sq-${s.symbol}`} className={cn('rounded-lg border p-2.5', statusStyle[s.status] ?? 'border-border/40')}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {s.isIndex && <span className="rounded bg-info/20 px-1 py-0.5 font-mono text-[8px] font-bold text-info">INDEX</span>}
                <span className="font-sans text-sm font-bold text-foreground">{s.symbol}</span>
                <DirectionBadge direction={s.direction === 'CALL' ? 'CE' : 'PE'} />
                <span className={cn('rounded px-1.5 py-0.5 font-mono text-[9px] font-black', badgeStyle[s.status])}>{label[s.status] ?? s.status}</span>
              </div>
              <span className="rounded bg-muted/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">{s.confidence}</span>
            </div>
            {/* Action + levels */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[9px]">
              <span className="rounded bg-bull/15 px-1.5 py-0.5 font-bold text-bull">{s.action}</span>
              <span className="rounded bg-muted/20 px-1 py-0.5 text-muted-foreground">wall {s.wallStrike} ({s.proximityPct}%)</span>
              <span className="rounded bg-muted/20 px-1 py-0.5 text-muted-foreground">SL {s.stopLoss}</span>
              <span className="rounded bg-muted/20 px-1 py-0.5 text-muted-foreground">target {s.target}</span>
            </div>
            {/* Confirmation footprint */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[8px] text-muted-foreground">
              <span>OI −{s.oiUnwindPct}%</span>
              <span>· premium {s.premiumChangePct >= 0 ? '+' : ''}{s.premiumChangePct}%</span>
              <span>· vol {s.volumeMult}x</span>
              <span>· IV {s.ivNow}</span>
              <span>· Δ {s.deltaNow}</span>
            </div>
            {/* Timestamps + duration */}
            <div className="mt-1 flex items-center gap-2 border-t border-border/10 pt-1 font-mono text-[8px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {s.detectedAt ? <span>detected {clock(s.detectedAt)}</span> : null}
              {s.triggeredAt ? <span>· triggered {clock(s.triggeredAt)} · {s.status === 'LIVE' || s.status === 'PEAKING' ? `live ${dur(s.triggeredAt, now)}` : ''}</span> : null}
            </div>
            <div className="mt-0.5 font-mono text-[8px] leading-snug text-foreground/70">{s.note}</div>
          </div>
        ))}

        {done.length > 0 && (
          <div className="mt-1 border-t border-border/20 pt-2">
            <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              <History className="h-3 w-3" /> Completed today ({done.length})
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {done.map((c: any, i: number) => (
                <div key={`cd-${c.symbol}-${c.triggeredAt}-${i}`} className="flex items-center justify-between rounded border border-border/20 bg-card/20 px-1.5 py-1 font-mono text-[9px]">
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold text-foreground">{c.symbol}</span>
                    <DirectionBadge direction={c.direction === 'CALL' ? 'CE' : 'PE'} />
                    <span className="text-muted-foreground">{c.wallStrike}</span>
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className={cn('font-bold', c.maxGainPct >= 0 ? 'text-bull' : 'text-bear')}>+{c.maxGainPct}%</span>
                    <span>{Math.round(c.durationSec / 60)}m</span>
                    <span>{clock(c.triggeredAt)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const SqueezeRadar = memo(SqueezeRadarInner);
