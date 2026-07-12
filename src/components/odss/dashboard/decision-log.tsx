'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Info, AlertTriangle, AlertCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bloomberg-style streaming decision tape.
 * - Pure monospace, dark background, subtle scanline glow
 * - Each log line: timestamp · engine · symbol · message
 * - Color-coded by level (DECISION=violet, INFO=cyan, WARN=amber, ERROR=rose)
 */
export function DecisionLog() {
  const { decisionLog } = useODSS();

  return (
    <Card className="accent-info border-border/50 bg-[#080b11]/70 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Terminal className="h-4 w-4 text-info" />
            <span className="text-gradient-bull text-base font-bold">DECISION TAPE</span>
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-bull">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-bull" />
            LIVE
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="space-y-0.5 p-2 font-mono text-[11px] tnum">
            {decisionLog.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                Awaiting engine activity…
              </div>
            )}
            {decisionLog.map((log, i) => {
              const Icon =
                log.level === 'ERROR'
                  ? AlertCircle
                  : log.level === 'WARN'
                    ? AlertTriangle
                    : log.level === 'DECISION'
                      ? Sparkles
                      : Info;
              const color =
                log.level === 'ERROR'
                  ? 'text-bear'
                  : log.level === 'WARN'
                    ? 'text-warn'
                    : log.level === 'DECISION'
                      ? 'text-ai'
                      : 'text-info';
              return (
                <div
                  key={i}
                  className="flex gap-2 border-b border-border/15 py-1.5 leading-relaxed hover:bg-bull/5"
                >
                  <span className="shrink-0 font-bold text-muted-foreground">
                    {new Date(log.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
                  </span>
                  <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', color)} />
                  <span className={cn('shrink-0 font-bold', color)}>[{log.engine}]</span>
                  {log.symbol && (
                    <span className="shrink-0 rounded border border-border/60 bg-muted/40 px-1 font-bold text-foreground">
                      {log.symbol}
                    </span>
                  )}
                  <span className="text-foreground/95">{log.message}</span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
