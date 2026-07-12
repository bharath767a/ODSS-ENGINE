'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { ChangePct } from '../shared/badges';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Heatmap-style sector grid.
 * Tiles tint green→red based on relative strength (top 2 = strong bull,
 * bottom 2 = strong bear, middle = neutral).
 */
export function SectorGrid() {
  const { sectors } = useODSS();

  const list = sectors?.sectors ?? [];
  if (list.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide text-muted-foreground">
            <Layers className="h-4 w-4 text-info" />
            <span className="text-foreground">SECTOR ENGINE</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-xs text-muted-foreground">Awaiting sector data…</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Layers className="h-4 w-4 text-info" />
            <span className="text-foreground">SECTOR HEATMAP</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {list.length} SECTORS
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((s) => {
            // Heat tier 1 (top 2) → strong bull, 2 → bull, 3 → neutral, 4 → bear, 5 (bottom 2) → strong bear
            const tier =
              s.rank <= 2
                ? 'heat-1'
                : s.rank <= Math.ceil(list.length / 2)
                  ? 'heat-2'
                  : s.rank >= list.length - 1
                    ? 'heat-5'
                    : s.rank >= list.length - 2
                      ? 'heat-4'
                      : 'heat-3';
            const bullish = s.strength > 0;
            return (
              <div
                key={s.sector}
                className={cn(
                  'group relative overflow-hidden rounded-md border p-2 transition-all duration-300 hover:scale-[1.02]',
                  tier
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate font-mono text-[11px] font-semibold tracking-wide text-foreground">
                    {s.sector}
                  </span>
                  <span className="font-mono text-[9px] tnum text-muted-foreground">#{s.rank}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <ChangePct value={s.changePct} />
                  <span
                    className={cn(
                      'font-mono text-[9px] uppercase tracking-widest',
                      bullish ? 'text-bull' : 'text-bear'
                    )}
                  >
                    {s.leadership}
                  </span>
                </div>
                {/* Strength bar */}
                <div className="relative mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
                  <div
                    className={cn(
                      'absolute top-0 h-full transition-all duration-500',
                      bullish
                        ? 'bg-bull shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                        : 'bg-bear shadow-[0_0_6px_rgba(251,113,133,0.6)]'
                    )}
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
