'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge, StateBadge } from '../shared/badges';
import { BookOpen, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function JournalTable() {
  useODSS();
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/odss/journal')
      .then((r) => r.json())
      .then((d) => setTrades(d.trades ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <BookOpen className="h-4 w-4 text-info" />
            <span className="text-foreground">TRADE JOURNAL</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {trades.length} TRADES
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-info" />
          </div>
        ) : trades.length === 0 ? (
          <div className="py-8 text-center font-mono text-xs text-muted-foreground">
            No completed trades yet. Trades appear here after exit.
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                <tr className="border-b border-border/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-2 py-1.5">Symbol</th>
                  <th className="px-2 py-1.5">Dir</th>
                  <th className="px-2 py-1.5">Entry</th>
                  <th className="px-2 py-1.5">Exit</th>
                  <th className="px-2 py-1.5">Hold</th>
                  <th className="px-2 py-1.5 text-right">PnL</th>
                  <th className="px-2 py-1.5 text-right">R</th>
                  <th className="px-2 py-1.5">Exit Reason</th>
                </tr>
              </thead>
              <tbody className="font-mono tnum">
                {trades.map((t) => {
                  const pnlPositive = t.pnl >= 0;
                  const rPositive = t.rMultiple >= 0;
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-border/30 transition-colors hover:bg-bull/5"
                    >
                      <td className="px-2 py-1.5 font-sans font-bold text-foreground">
                        {t.symbol}
                      </td>
                      <td className="px-2 py-1.5">
                        <DirectionBadge direction={t.direction} />
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                        {new Date(t.entryTime).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                        {new Date(t.exitTime).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-foreground/80">
                        {t.holdTimeMinutes}m
                      </td>
                      <td
                        className={cn(
                          'px-2 py-1.5 text-right font-semibold tnum',
                          pnlPositive ? 'text-bull text-glow-bull' : 'text-bear text-glow-bear'
                        )}
                      >
                        {pnlPositive ? '+' : ''}₹{t.pnl.toFixed(0)}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-1.5 text-right font-semibold tnum',
                          rPositive ? 'text-bull' : 'text-bear'
                        )}
                      >
                        {rPositive ? '+' : ''}
                        {t.rMultiple.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                        {t.exitReason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
