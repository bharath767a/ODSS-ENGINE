'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Info, AlertTriangle, AlertCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DecisionLog() {
  const { decisionLog } = useODSS();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Terminal className="h-4 w-4 text-slate-500" /> Decision Tape</span>
          <span className="flex items-center gap-1 text-xs font-normal text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> LIVE
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="space-y-0.5 p-2 font-mono text-[11px]">
            {decisionLog.length === 0 && (
              <div className="py-8 text-center text-slate-400">Awaiting engine activity…</div>
            )}
            {decisionLog.map((log, i) => {
              const Icon = log.level === 'ERROR' ? AlertCircle : log.level === 'WARN' ? AlertTriangle : log.level === 'DECISION' ? Sparkles : Info;
              const color = log.level === 'ERROR' ? 'text-rose-600' : log.level === 'WARN' ? 'text-amber-600' : log.level === 'DECISION' ? 'text-violet-600' : 'text-slate-500';
              return (
                <div key={i} className="flex gap-2 border-b border-slate-50 py-1">
                  <span className="text-slate-400">{new Date(log.timestamp).toLocaleTimeString('en-IN', { hour12: false })}</span>
                  <Icon className={cn('h-3 w-3 mt-0.5 shrink-0', color)} />
                  <span className="text-slate-400">[{log.engine}]</span>
                  {log.symbol && <span className="rounded bg-slate-100 px-1 text-slate-600">{log.symbol}</span>}
                  <span className="text-slate-700">{log.message}</span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
