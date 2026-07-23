'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge } from '../shared/badges';
import { cn } from '@/lib/utils';
import { CalendarClock, TrendingUp, TrendingDown, Loader2, RefreshCw } from 'lucide-react';
import { VIEW_ONLY } from '@/lib/view-only';

function fmtTime(ts: number) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }); } catch { return '—'; }
}

function Row({ r, bull }: { r: any; bull: boolean }) {
  return (
    <div className={cn('rounded-lg border p-2', bull ? 'border-bull/25 bg-bull/5' : 'border-bear/25 bg-bear/5')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-xs font-bold text-foreground">{r.symbol}</span>
          <DirectionBadge direction={bull ? 'CE' : 'PE'} />
          <span className={cn('rounded px-1 py-0.5 font-mono text-[9px] font-bold', bull ? 'bg-bull/20 text-bull' : 'bg-bear/20 text-bear')}>{r.controller} {r.strength}%</span>
        </div>
        <span className="font-mono text-[9px] text-muted-foreground">₹{r.spot}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 font-mono text-[8px] text-muted-foreground">
        <span className="rounded bg-bull/10 px-1 py-0.5 text-bull">Sup {r.support}</span>
        <span className="rounded bg-bear/10 px-1 py-0.5 text-bear">Res {r.resistance}</span>
        <span className="rounded bg-muted/20 px-1 py-0.5">Max pain {r.maxPain}</span>
        <span className="rounded bg-muted/20 px-1 py-0.5">PCR {r.pcr}</span>
        {r.flowIntensity >= 55 && <span className="rounded bg-orange-500/15 px-1 py-0.5 text-orange-600">🔥 {r.flowIntensity}</span>}
      </div>
      {r.note && <div className="mt-0.5 font-mono text-[8px] leading-snug text-muted-foreground line-clamp-1">{r.note}</div>}
    </div>
  );
}

function EODPositioningInner() {
  const { runEOD } = useODSS();
  const [report, setReport] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    fetch('/api/odss/eod-positioning').then(r => r.json()).then(setReport).catch(() => {});
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    const res = await runEOD();
    if (res?.report) setReport(res.report);
    else load();
    setRunning(false);
  }, [runEOD, load]);

  const bullish = report?.bullish ?? [];
  const bearish = report?.bearish ?? [];
  const hasData = (bullish.length + bearish.length) > 0;

  return (
    <Card className="border-info/30 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <CalendarClock className="h-4 w-4 text-info" />
            <span className="text-info text-base font-bold">TOMORROW'S SETUP</span>
            <span className="rounded bg-info/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-info">EOD OI</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-muted-foreground">{report?.count ? `${report.count} stocks · ${fmtTime(report.generatedAt)}` : ''}</span>
            {!VIEW_ONLY && (
              <Button size="sm" variant="ghost" className="h-6 gap-1 font-mono text-[9px] tracking-widest text-info hover:bg-info/10" onClick={handleRun} disabled={running}>
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} SCAN
              </Button>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {!hasData ? (
          <div className="py-4 text-center font-mono text-[10px] text-muted-foreground">
            No positioning report yet. It runs automatically after market close (or hit SCAN) — reads the day's option-chain OI to rank tomorrow's bullish / bearish setups.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-widest text-bull"><TrendingUp className="h-3 w-3" /> Bullish — buy CE ({bullish.length})</div>
              {bullish.length === 0 && <div className="font-mono text-[9px] text-muted-foreground">None</div>}
              {bullish.map((r: any) => <Row key={`b-${r.symbol}`} r={r} bull />)}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-widest text-bear"><TrendingDown className="h-3 w-3" /> Bearish — buy PE ({bearish.length})</div>
              {bearish.length === 0 && <div className="font-mono text-[9px] text-muted-foreground">None</div>}
              {bearish.map((r: any) => <Row key={`s-${r.symbol}`} r={r} bull={false} />)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const EODPositioning = memo(EODPositioningInner);
