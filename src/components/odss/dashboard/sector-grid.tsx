'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { ChangePct } from '../shared/badges';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SectorGrid() {
  const { sectors } = useODSS();

  const list = sectors?.sectors ?? [];
  if (list.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Layers className="h-4 w-4 text-slate-500" /> Sector Engine</CardTitle></CardHeader>
        <CardContent><div className="text-xs text-slate-400">Waiting for sector data…</div></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Layers className="h-4 w-4 text-slate-500" /> Sector Ranking</span>
          <span className="text-xs font-normal text-slate-400">{list.length} sectors</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((s) => {
            const bullish = s.strength > 0;
            return (
              <div
                key={s.sector}
                className={cn(
                  'rounded-lg border p-2 transition-colors',
                  s.rank <= 2 ? 'border-emerald-300 bg-emerald-50/50' : s.rank >= list.length - 1 ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200 bg-white'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-semibold text-slate-700">{s.sector}</span>
                  <span className="font-mono text-[10px] text-slate-400">#{s.rank}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <ChangePct value={s.changePct} />
                  <span className={cn('text-[10px] font-medium', bullish ? 'text-emerald-600' : 'text-rose-600')}>
                    {s.leadership}
                  </span>
                </div>
                {/* Strength bar */}
                <div className="relative mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
                  <div
                    className={cn('absolute top-0 h-full', bullish ? 'bg-emerald-500' : 'bg-rose-500')}
                    style={{
                      width: `${Math.abs(s.strength) / 2}%`,
                      left: bullish ? '50%' : `${50 - Math.abs(s.strength) / 2}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
