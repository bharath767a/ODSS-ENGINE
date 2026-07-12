'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, TrendingUp, Target, DollarSign, Clock, Percent } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function AnalyticsDashboard() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/odss/analytics').then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="flex items-center justify-center py-8 text-sm text-slate-400">Loading analytics…</div>;

  const metrics = [
    { label: 'Total Trades', value: data.totalTrades, icon: BarChart, color: 'text-slate-700' },
    { label: 'Win Rate', value: `${data.winRate.toFixed(1)}%`, icon: Percent, color: data.winRate >= 50 ? 'text-emerald-600' : 'text-rose-600' },
    { label: 'Profit Factor', value: data.profitFactor.toFixed(2), icon: DollarSign, color: data.profitFactor >= 1.5 ? 'text-emerald-600' : 'text-amber-600' },
    { label: 'Avg R', value: `${data.avgR >= 0 ? '+' : ''}${data.avgR.toFixed(2)}`, icon: Target, color: data.avgR >= 0 ? 'text-emerald-600' : 'text-rose-600' },
    { label: 'Max Drawdown', value: `₹${data.maxDrawdown.toFixed(0)}`, icon: TrendingUp, color: 'text-rose-600' },
    { label: 'Avg Hold', value: `${data.avgHoldMinutes.toFixed(0)}m`, icon: Clock, color: 'text-slate-700' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-slate-400">{m.label}</span>
                <m.icon className={cn('h-3 w-3', m.color)} />
              </div>
              <div className={cn('mt-1 font-mono text-lg font-bold', m.color)}>{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Equity curve */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Equity Curve</CardTitle></CardHeader>
          <CardContent>
            {data.equityCurve.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">No trades yet.</div>
            ) : (
              <EquityCurve points={data.equityCurve} />
            )}
          </CardContent>
        </Card>

        {/* Exit stats */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Exit Reason Distribution</CardTitle></CardHeader>
          <CardContent>
            {Object.keys(data.exitStats).length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">No exit data.</div>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(data.exitStats).map(([reason, count]) => {
                  const pct = ((count as number) / data.totalTrades) * 100;
                  return (
                    <div key={reason}>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600">{reason}</span>
                        <span className="font-mono text-slate-400">{count as number} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-slate-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EquityCurve({ points }: { points: { i: number; cum: number }[] }) {
  const w = 500;
  const h = 160;
  const max = Math.max(...points.map((p) => p.cum), 0);
  const min = Math.min(...points.map((p) => p.cum), 0);
  const range = max - min || 1;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / Math.max(points.length - 1, 1)) * w} ${h - ((p.cum - min) / range) * h}`).join(' ');
  const isPositive = points[points.length - 1]?.cum >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <line x1="0" y1={h - ((0 - min) / range) * h} x2={w} y2={h - ((0 - min) / range) * h} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={isPositive ? '#10b981' : '#f43f5e'} strokeWidth="2" />
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={isPositive ? '#10b98120' : '#f43f5e20'} />
    </svg>
  );
}
