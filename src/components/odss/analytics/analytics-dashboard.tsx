'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, TrendingUp, Target, DollarSign, Clock, Percent } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function AnalyticsDashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/odss/analytics')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (!text) throw new Error('Empty response');
        return JSON.parse(text);
      })
      .then((d) => { if (mounted) setData(d); })
      .catch((e) => { if (mounted) setError(e.message || 'Failed to load analytics'); });
    return () => { mounted = false; };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8">
        <p className="font-mono text-sm text-rose-600">Analytics unavailable</p>
        <p className="font-mono text-[10px] text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-8 font-mono text-sm text-muted-foreground">
        Loading analytics…
      </div>
    );
  }

  const metrics = [
    { label: 'Total Trades', value: data.totalTrades, icon: BarChart, color: 'text-foreground' },
    {
      label: 'Win Rate',
      value: `${data.winRate.toFixed(1)}%`,
      icon: Percent,
      color: data.winRate >= 50 ? 'text-bull' : 'text-bear',
    },
    {
      label: 'Profit Factor',
      value: data.profitFactor.toFixed(2),
      icon: DollarSign,
      color: data.profitFactor >= 1.5 ? 'text-bull' : 'text-warn',
    },
    {
      label: 'Avg R',
      value: `${data.avgR >= 0 ? '+' : ''}${data.avgR.toFixed(2)}`,
      icon: Target,
      color: data.avgR >= 0 ? 'text-bull' : 'text-bear',
    },
    {
      label: 'Max Drawdown',
      value: `₹${data.maxDrawdown.toFixed(0)}`,
      icon: TrendingUp,
      color: 'text-bear',
    },
    {
      label: 'Avg Hold',
      value: `${data.avgHoldMinutes.toFixed(0)}m`,
      icon: Clock,
      color: 'text-foreground',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <Card key={m.label} className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {m.label}
                </span>
                <m.icon className={cn('h-3 w-3', m.color)} />
              </div>
              <div className={cn('mt-1 font-mono text-lg font-bold tnum', m.color)}>{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Equity curve */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm tracking-wide text-foreground">
              EQUITY CURVE
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.equityCurve.length === 0 ? (
              <div className="py-8 text-center font-mono text-xs text-muted-foreground">
                No trades yet.
              </div>
            ) : (
              <EquityCurve points={data.equityCurve} />
            )}
          </CardContent>
        </Card>

        {/* Exit stats */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm tracking-wide text-foreground">
              EXIT REASON DISTRIBUTION
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(data.exitStats).length === 0 ? (
              <div className="py-8 text-center font-mono text-xs text-muted-foreground">
                No exit data.
              </div>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(data.exitStats).map(([reason, count]) => {
                  const pct = ((count as number) / data.totalTrades) * 100;
                  return (
                    <div key={reason}>
                      <div className="flex justify-between font-mono text-xs">
                        <span className="text-foreground/80">{reason}</span>
                        <span className="tnum text-muted-foreground">
                          {count as number} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-info shadow-[0_0_6px_rgba(34,211,238,0.4)] transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
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
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${(i / Math.max(points.length - 1, 1)) * w} ${h - ((p.cum - min) / range) * h}`
    )
    .join(' ');
  const isPositive = points[points.length - 1]?.cum >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <line
        x1="0"
        y1={h - ((0 - min) / range) * h}
        x2={w}
        y2={h - ((0 - min) / range) * h}
        stroke="#1c2330"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <path
        d={path}
        fill="none"
        stroke={isPositive ? '#34d399' : '#fb7185'}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        style={{
          filter: isPositive
            ? 'drop-shadow(0 0 4px rgba(52,211,153,0.55))'
            : 'drop-shadow(0 0 4px rgba(251,113,133,0.55))',
        }}
      />
      <path
        d={`${path} L ${w} ${h} L 0 ${h} Z`}
        fill={isPositive ? 'rgba(52,211,153,0.18)' : 'rgba(251,113,133,0.18)'}
      />
    </svg>
  );
}
