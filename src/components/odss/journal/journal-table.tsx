'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge, StateBadge } from '../shared/badges';
import { BookOpen, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export function JournalTable() {
  const { } = useODSS();
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/odss/journal')
      .then((r) => r.json())
      .then((d) => setTrades(d.trades ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-slate-500" /> Trade Journal</span>
          <span className="text-xs font-normal text-slate-400">{trades.length} trades</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
        ) : trades.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">No completed trades yet. Trades appear here after exit.</div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left text-[10px] uppercase text-slate-400">
                  <th className="px-2 py-1.5">Symbol</th>
                  <th className="px-2 py-1.5">Dir</th>
                  <th className="px-2 py-1.5">Entry</th>
                  <th className="px-2 py-1.5">Exit</th>
                  <th className="px-2 py-1.5">Hold</th>
                  <th className="px-2 py-1.5">PnL</th>
                  <th className="px-2 py-1.5">R</th>
                  <th className="px-2 py-1.5">Exit Reason</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const pnlPositive = t.pnl >= 0;
                  const rPositive = t.rMultiple >= 0;
                  return (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-semibold">{t.symbol}</td>
                      <td className="px-2 py-1.5"><DirectionBadge direction={t.direction} /></td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-slate-500">{new Date(t.entryTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-slate-500">{new Date(t.exitTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px]">{t.holdTimeMinutes}m</td>
                      <td className={`px-2 py-1.5 font-mono font-semibold ${pnlPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {pnlPositive ? '+' : ''}₹{t.pnl.toFixed(0)}
                      </td>
                      <td className={`px-2 py-1.5 font-mono font-semibold ${rPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {rPositive ? '+' : ''}{t.rMultiple.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-slate-500">{t.exitReason}</td>
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
