'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { TrendBadge, VolatilityBadge, BiasBadge, StructureBadge, ChangePct, ConfidenceMeter } from '../shared/badges';
import { Activity, BarChart3, Gauge, Layers } from 'lucide-react';

export function MarketOverview() {
  const { market, nifty, bankNifty, vix, breadth } = useODSS();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Gauge className="h-4 w-4 text-slate-500" /> Market Engine</span>
          {market && <ConfidenceMeter value={market.marketConfidence} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Index prices */}
        <div className="grid grid-cols-2 gap-2">
          <IndexTile label="NIFTY 50" price={nifty?.ltp} changePct={nifty?.changePct} vwap={nifty?.vwap} />
          <IndexTile label="BANK NIFTY" price={bankNifty?.ltp} changePct={bankNifty?.changePct} vwap={bankNifty?.vwap} />
        </div>

        {/* VIX + Breadth */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border bg-slate-50/50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">India VIX</span>
              {market && <VolatilityBadge vol={market.volatility} />}
            </div>
            <div className="mt-1 font-mono text-lg font-semibold">{vix.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border bg-slate-50/50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Breadth A/D</span>
              <span className="font-mono text-xs">{breadth ? `${breadth.advanceCount}/${breadth.declineCount}` : '-'}</span>
            </div>
            <div className="mt-1 font-mono text-lg font-semibold">
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
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
              {market.marketState.replace(/_/g, ' ')}
            </span>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
              {market.dayType.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* Market score bar */}
        {market && (
          <div>
            <div className="mb-0.5 flex justify-between text-xs text-slate-500">
              <span>Market Score</span>
              <span className="font-mono">{market.marketScore.toFixed(0)}</span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="absolute left-1/2 top-0 h-full w-px bg-slate-400" />
              <div
                className={`absolute top-0 h-full ${market.marketScore >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
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
          <div className="border-t pt-2">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-400">
              <Activity className="h-3 w-3" /> Market Facts
            </div>
            <ul className="space-y-0.5">
              {market.facts.slice(0, 6).map((f, i) => (
                <li key={i} className="text-xs text-slate-600">{f}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IndexTile({ label, price, changePct, vwap }: { label: string; price?: number; changePct?: number; vwap?: number }) {
  return (
    <div className="rounded-lg border bg-gradient-to-br from-white to-slate-50 p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-mono text-base font-semibold">{price?.toFixed(2) ?? '-'}</div>
      <div className="flex items-center justify-between">
        {changePct !== undefined && <ChangePct value={changePct} />}
        {vwap && <span className="text-[10px] text-slate-400">VWAP {vwap.toFixed(0)}</span>}
      </div>
    </div>
  );
}
