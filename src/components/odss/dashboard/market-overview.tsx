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
  const breadthBullish = (breadth?.advanceDeclineRatio ?? 1) >= 1;

  return (
    <Card className="accent-info border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Gauge className="h-4 w-4 text-info" />
            <span className="text-gradient-bull text-base font-bold">MARKET ENGINE</span>
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
              'rounded-lg p-2 transition-all',
              vixExtreme
                ? 'tile-bear glow-warn'
                : vixHigh
                  ? 'tile-warn'
                  : 'tile-info'
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
                    : 'text-info'
              )}
            >
              {vix.toFixed(2)}
            </div>
          </div>
          <div className={cn('rounded-lg p-2 transition-all', breadthBullish ? 'tile-bull' : 'tile-bear')}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Breadth A/D
              </span>
              <span className="font-mono text-[10px] tnum text-muted-foreground">
                {breadth ? `${breadth.advanceCount}/${breadth.declineCount}` : '-'}
              </span>
            </div>
            <div className={cn(
              'mt-1 font-mono text-lg font-bold tnum',
              breadthBullish ? 'text-bull' : 'text-bear'
            )}>
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
            <span className="rounded border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest text-info">
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
                  'tnum font-bold',
                  market.marketScore >= 0 ? 'text-bull text-glow-bull' : 'text-bear text-glow-bear'
                )}
              >
                {market.marketScore >= 0 ? '+' : ''}
                {market.marketScore.toFixed(0)}
              </span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div
                className={cn(
                  'absolute top-0 h-full rounded-full transition-all duration-500',
                  market.marketScore >= 0
                    ? 'bg-gradient-to-r from-bull/60 to-bull shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                    : 'bg-gradient-to-l from-bear/60 to-bear shadow-[0_0_10px_rgba(251,113,133,0.6)]'
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
            <ul className="space-y-0.5 font-mono text-[11px] text-foreground/80">
              {market.facts.slice(0, 6).map((f, i) => (
                <li key={i} className="leading-snug">
                  <span className="mr-1.5 text-info">›</span>
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
        'relative overflow-hidden rounded-lg p-2 transition-all',
        positive ? 'tile-bull' : 'tile-bear'
      )}
    >
      {/* Subtle glow accent */}
      <div
        className={cn(
          'absolute -right-4 -top-4 h-12 w-12 rounded-full blur-xl',
          positive ? 'bg-bull/20' : 'bg-bear/20'
        )}
      />
      <div className="relative font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="relative font-mono text-base font-bold tnum text-foreground">
        {price?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ??
          '—'}
      </div>
      <div className="relative flex items-center justify-between">
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
