'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import {
  TrendBadge,
  VolatilityBadge,
  BiasBadge,
  StructureBadge,
  ChangePct,
  ConfidenceMeter,
} from '../shared/badges';
import { Activity, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MarketOverview() {
  const { market, nifty, bankNifty, vix, breadth } = useODSS();

  const vixHigh = vix >= 18;
  const vixExtreme = vix >= 22;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Gauge className="h-4 w-4 text-info" />
            <span className="text-foreground">MARKET ENGINE</span>
          </span>
          {market && <ConfidenceMeter value={market.marketConfidence} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Index prices */}
        <div className="grid grid-cols-2 gap-2">
          <IndexTile
            label="NIFTY 50"
            price={nifty?.ltp}
            changePct={nifty?.changePct}
            vwap={nifty?.vwap}
          />
          <IndexTile
            label="BANK NIFTY"
            price={bankNifty?.ltp}
            changePct={bankNifty?.changePct}
            vwap={bankNifty?.vwap}
          />
        </div>

        {/* VIX + Breadth */}
        <div className="grid grid-cols-2 gap-2">
          <div
            className={cn(
              'rounded-lg border border-border/50 bg-muted/30 p-2 transition-all',
              vixExtreme && 'border-bear/40 bg-bear/10 glow-warn',
              vixHigh && !vixExtreme && 'border-warn/40 bg-warn/10'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                India VIX
              </span>
              {market && <VolatilityBadge vol={market.volatility} />}
            </div>
            <div
              className={cn(
                'mt-1 font-mono text-lg font-bold tnum transition-all',
                vixExtreme
                  ? 'text-bear text-glow-bear'
                  : vixHigh
                    ? 'text-warn text-glow-warn'
                    : 'text-foreground'
              )}
            >
              {vix.toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Breadth A/D
              </span>
              <span className="font-mono text-[10px] tnum text-muted-foreground">
                {breadth ? `${breadth.advanceCount}/${breadth.declineCount}` : '-'}
              </span>
            </div>
            <div className="mt-1 font-mono text-lg font-bold tnum text-foreground">
              {breadth ? breadth.advanceDeclineRatio.toFixed(2) : '-'}
            </div>
          </div>
        </div>

        {/* Market state row */}
        {market && (
          <div className="flex flex-wrap items-center gap-1.5">
            <TrendBadge trend={market.trend} />
            <StructureBadge structure={market.structure} />
            <BiasBadge bias={market.bias} />
            <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {market.marketState.replace(/_/g, ' ')}
            </span>
            <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {market.dayType.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* Market score bar */}
        {market && (
          <div>
            <div className="mb-0.5 flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>Market Score</span>
              <span
                className={cn(
                  'tnum font-semibold',
                  market.marketScore >= 0 ? 'text-bull' : 'text-bear'
                )}
              >
                {market.marketScore >= 0 ? '+' : ''}
                {market.marketScore.toFixed(0)}
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div
                className={cn(
                  'absolute top-0 h-full transition-all duration-500',
                  market.marketScore >= 0
                    ? 'bg-bull shadow-[0_0_8px_rgba(52,211,153,0.55)]'
                    : 'bg-bear shadow-[0_0_8px_rgba(251,113,133,0.55)]'
                )}
                style={{
                  width: `${Math.abs(market.marketScore) / 2}%`,
                  left: market.marketScore >= 0 ? '50%' : `${50 - Math.abs(market.marketScore) / 2}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Facts */}
        {market && market.facts.length > 0 && (
          <div className="border-t border-border/40 pt-2">
            <div className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Activity className="h-3 w-3 text-info" /> Market Facts
            </div>
            <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {market.facts.slice(0, 6).map((f, i) => (
                <li key={i} className="leading-snug">
                  <span className="mr-1.5 text-bull/60">›</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IndexTile({
  label,
  price,
  changePct,
  vwap,
}: {
  label: string;
  price?: number;
  changePct?: number;
  vwap?: number;
}) {
  const positive = (changePct ?? 0) >= 0;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border bg-gradient-to-br p-2 transition-all',
        positive
          ? 'border-bull/30 from-bull/10 to-transparent'
          : 'border-bear/30 from-bear/10 to-transparent'
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-base font-bold tnum text-foreground">
        {price?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ??
          '—'}
      </div>
      <div className="flex items-center justify-between">
        {changePct !== undefined && <ChangePct value={changePct} />}
        {vwap && (
          <span className="font-mono text-[10px] tnum text-muted-foreground">
            VWAP {vwap.toFixed(0)}
          </span>
        )}
      </div>
    </div>
  );
}
