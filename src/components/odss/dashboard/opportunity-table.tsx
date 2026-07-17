'use client';

import { memo, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge } from '../shared/badges';
import { Trophy, ChevronRight, Lock, TrendingUp, TrendingDown, Newspaper, Target, Shield, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/lib/odss/types';

function OpportunityTableInner({ onSelect }: { onSelect?: (rec: Recommendation) => void }) {
  const { topRecommendations, liveQuotes, conviction } = useODSS();
  const recs = topRecommendations;
  const convictionPicks = conviction?.convictionPicks ?? [];
  const watchlist = conviction?.watchlist ?? [];
  const newsShockPicks = conviction?.newsShockPicks ?? [];

  // If conviction engine has picks, show conviction view
  if (convictionPicks.length > 0 || watchlist.length > 0) {
    return (
      <Card className="accent-warn border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
              <Trophy className="h-4 w-4 text-warn" />
              <span className="text-gradient-warn text-base font-bold">CONVICTION PICKS</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {convictionPicks.length} LOCKED · {watchlist.length} WATCHING
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-3">
          {convictionPicks.map((pick: any, idx: number) => {
            const q = liveQuotes[pick.symbol];
            const rec = recs.find((r) => r.symbol === pick.symbol);
            const isLocked = pick.locked;
            const signalConfig = getSignalConfig(pick.entrySignal);
            return (
              <div
                key={pick.symbol}
                className={cn(
                  'cursor-pointer rounded-lg border p-2.5 transition-all hover:bg-info/5',
                  isLocked ? 'border-ai/40 bg-gradient-to-br from-ai/10 to-transparent shadow-[0_0_12px_-2px_rgba(124,58,237,0.2)]'
                    : pick.entrySignal === 'ENTER_NOW' ? 'border-bull/30 bg-bull/5' : 'border-border/40 bg-card/30',
                )}
                onClick={() => rec && onSelect?.(rec)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded font-mono text-xs font-bold', idx === 0 ? 'bg-warn/20 text-warn' : 'bg-muted/30 text-muted-foreground')}>{pick.rank}</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-sans text-sm font-bold tracking-wide text-foreground">{pick.symbol}</span>
                        <DirectionBadge direction={pick.direction} />
                        {isLocked && <span className="flex items-center gap-0.5 rounded bg-ai/20 px-1 py-0.5 font-mono text-[9px] font-bold text-ai"><Lock className="h-2.5 w-2.5" />{pick.lockMinutesLeft}m</span>}
                        {pick.hasEarningsNews && <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[9px] font-bold text-amber-700">EQ</span>}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{pick.sector}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold text-foreground">₹{q?.ltp.toFixed(2) ?? pick.currentPrice.toFixed(2) ?? '—'}</div>
                    <div className={cn('font-mono text-[10px] font-bold', q && q.changePct >= 0 ? 'text-bull' : 'text-bear')}>{q ? `${q.changePct >= 0 ? '▲' : '▼'} ${Math.abs(q.changePct).toFixed(2)}%` : ''}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase text-muted-foreground">CONV</span>
                  <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tnum', pick.convictionScore >= 70 ? 'bg-bull/20 text-bull' : pick.convictionScore >= 55 ? 'bg-warn/20 text-warn' : 'bg-bear/20 text-bear')}>{pick.convictionScore}</span>
                  <span className={cn('flex items-center gap-0.5 font-mono text-[9px] font-bold', pick.trendScore > 2 ? 'text-bull' : pick.trendScore < -2 ? 'text-bear' : 'text-muted-foreground')}>
                    {pick.trendScore > 2 ? <TrendingUp className="h-2.5 w-2.5" /> : pick.trendScore < -2 ? <TrendingDown className="h-2.5 w-2.5" /> : null}
                    {pick.trendScore > 0 ? '+' : ''}{pick.trendScore}
                  </span>
                  {pick.newsBoost !== 0 && (
                    <span className={cn('flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9px] font-bold', pick.newsBoost > 0 ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear')}>
                      <Newspaper className="h-2.5 w-2.5" />{pick.newsBoost > 0 ? '+' : ''}{pick.newsBoost}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[9px] text-muted-foreground">{pick.consecutiveTop10}× top10</span>
                </div>
                <div className="mt-2 flex items-center gap-2 border-t border-border/20 pt-2">
                  <span className={cn('flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest', signalConfig.bg)}>
                    {signalConfig.icon}{signalConfig.label}
                  </span>
                  {pick.entrySignal === 'ENTER_NOW' && (
                    <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Target className="h-2.5 w-2.5" />₹{pick.entryZoneLow.toFixed(0)}–₹{pick.entryZoneHigh.toFixed(0)}</span>
                      <span className="flex items-center gap-0.5"><Shield className="h-2.5 w-2.5" />₹{pick.stopLoss.toFixed(0)}</span>
                      <span className="flex items-center gap-0.5 text-ai"><Zap className="h-2.5 w-2.5" />1:{pick.riskRewardRatio}</span>
                    </div>
                  )}
                  <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
                </div>
                {pick.newsHeadlines?.length > 0 && (
                  <div className="mt-1.5 border-t border-border/10 pt-1.5">
                    {pick.newsHeadlines.slice(0, 2).map((h: string, i: number) => (
                      <div key={i} className="flex items-start gap-1 font-mono text-[9px] leading-snug text-muted-foreground">
                        <Newspaper className="mt-0.5 h-2.5 w-2.5 shrink-0 text-purple-400" />
                        <span className="line-clamp-1">{h}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* News Shock Picks */}
          {newsShockPicks.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-bear">
                <Zap className="h-3 w-3 text-bear" /> NEWS SHOCK — PE OPPORTUNITIES
                <span className="h-px flex-1 bg-bear/30" />{newsShockPicks.length} ACTIVE
              </div>
              {newsShockPicks.map((pick: any) => {
                const q = liveQuotes[pick.symbol];
                const rec = recs.find((r) => r.symbol === pick.symbol);
                return (
                  <div key={`shock-${pick.symbol}`} className={cn('cursor-pointer rounded-lg border p-2.5 mb-1.5 transition-all hover:bg-bear/5', pick.ivCaution ? 'border-amber/30 bg-amber/5' : 'border-bear/30 bg-bear/5')} onClick={() => rec && onSelect?.(rec)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-sans text-sm font-bold text-foreground">{pick.symbol}</span>
                        <DirectionBadge direction="PE" />
                        <span className="rounded bg-bear/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bear">{pick.shockAgeMinutes}m ago</span>
                        {pick.ivCaution && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700">⚠ IV CAUTION</span>}
                      </div>
                      <div className="font-mono text-sm font-bold text-foreground">₹{q?.ltp.toFixed(2) ?? pick.currentPrice.toFixed(2)}</div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tnum', pick.convictionScore >= 70 ? 'bg-bull/20 text-bull' : pick.convictionScore >= 55 ? 'bg-warn/20 text-warn' : 'bg-bear/20 text-bear')}>{pick.convictionScore}</span>
                      <span className={cn('flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest', pick.entrySignal === 'ENTER_NOW' ? 'bg-bear/20 text-bear border border-bear/30' : 'bg-warn/20 text-warn border border-warn/30')}>
                        <Zap className="h-3 w-3" />{pick.entrySignal === 'ENTER_NOW' ? 'PE ENTER' : 'WAIT (IV HIGH)'}
                      </span>
                      <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground"><Target className="h-2.5 w-2.5" />₹{pick.shockTargetPrice?.toFixed(0)}</span>
                    </div>
                    <div className="mt-1.5 border-t border-border/10 pt-1.5">
                      <div className="flex items-start gap-1 font-mono text-[9px] leading-snug text-bear">
                        <Zap className="mt-0.5 h-2.5 w-2.5 shrink-0" /><span className="line-clamp-2">{pick.shockTrigger}</span>
                      </div>
                    </div>
                    {pick.ivCaution && pick.ivCautionReason && <div className="mt-1 rounded bg-amber-50 p-1"><p className="font-mono text-[9px] text-amber-700">⚠ {pick.ivCautionReason}</p></div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Watchlist */}
          {watchlist.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                <span className="h-px flex-1 bg-border/40" />WATCHLIST (stabilizing…)<span className="h-px flex-1 bg-border/40" />
              </div>
              <div className="space-y-1">
                {watchlist.map((pick: any) => {
                  const q = liveQuotes[pick.symbol];
                  const rec = recs.find((r) => r.symbol === pick.symbol);
                  return (
                    <div key={pick.symbol} className="flex cursor-pointer items-center justify-between rounded border border-border/20 bg-card/20 px-2 py-1.5 transition-all hover:bg-info/5" onClick={() => rec && onSelect?.(rec)}>
                      <div className="flex items-center gap-2">
                        <DirectionBadge direction={pick.direction} />
                        <span className="font-sans text-xs font-bold text-foreground">{pick.symbol}</span>
                        <span className="font-mono text-[9px] uppercase text-muted-foreground">{pick.sector}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">{pick.consecutiveTop10}/3</span>
                        <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tnum', pick.convictionScore >= 70 ? 'bg-bull/20 text-bull' : pick.convictionScore >= 55 ? 'bg-warn/20 text-warn' : 'bg-bear/20 text-bear')}>{pick.convictionScore}</span>
                        <span className="font-mono text-[10px] text-foreground">₹{q?.ltp.toFixed(0) ?? '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Fallback: show raw top 10 (while conviction engine warms up)
  return (
    <Card className="accent-warn border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Trophy className="h-4 w-4 text-warn" />
            <span className="text-gradient-warn text-base font-bold">TOP OPPORTUNITIES</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{recs.length} RANKED</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[460px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/90">
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Symbol</th>
                <th className="px-2 py-2 text-center">Dir</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-2 py-2 text-right">Chg%</th>
                <th className="px-2 py-2 text-right">Score</th>
                <th className="px-2 py-2 text-right">Conf</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="font-mono tnum">
              {recs.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-10 text-center font-sans text-xs text-muted-foreground">Scanning market for opportunities… Rankings stabilize after 3 consecutive scans.</td></tr>
              )}
              {recs.map((r, idx) => {
                const q = liveQuotes[r.symbol];
                return (
                  <tr key={r.symbol} className={cn('cursor-pointer border-b border-border/30 transition-all hover:bg-info/10', idx % 2 === 0 ? 'bg-card/20' : 'bg-transparent')} onClick={() => onSelect?.(r)}>
                    <td className="px-2 py-1.5 text-muted-foreground">{r.opportunity.rank}</td>
                    <td className="px-2 py-1.5"><div className="font-sans text-xs font-bold tracking-wide text-foreground">{r.symbol}</div>{r.sector && <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{r.sector}</div>}</td>
                    <td className="px-2 py-2 text-center"><DirectionBadge direction={r.direction} /></td>
                    <td className="px-2 py-2 text-right font-semibold text-foreground">{q?.ltp.toFixed(2) ?? '—'}</td>
                    <td className={cn('px-2 py-2 text-right font-bold', q && q.changePct >= 0 ? 'text-bull' : 'text-bear')}>{q ? `${q.changePct >= 0 ? '▲ +' : '▼ '}${Math.abs(q.changePct).toFixed(2)}%` : '—'}</td>
                    <td className="px-2 py-2 text-right"><span className={cn('inline-flex min-w-[32px] justify-center rounded px-2 py-1 text-[10px] font-bold tnum', r.opportunity.totalScore >= 70 ? 'bg-bull/25 text-bull border border-bull/30' : r.opportunity.totalScore >= 55 ? 'bg-warn/25 text-warn border border-warn/30' : 'bg-bear/25 text-bear border border-bear/30')}>{r.opportunity.totalScore.toFixed(0)}</span></td>
                    <td className={cn('px-2 py-2 text-right font-bold tnum', r.opportunity.confidence > 65 ? 'text-bull' : r.opportunity.confidence > 45 ? 'text-warn' : 'text-bear')}>{r.opportunity.confidence.toFixed(0)}%</td>
                    <td className="px-2 py-1.5"><ChevronRight className="h-3 w-3 text-muted-foreground" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function getSignalConfig(signal: string) {
  switch (signal) {
    case 'ENTER_NOW': return { label: 'ENTER NOW', bg: 'bg-bull/20 text-bull border border-bull/30', icon: <Zap className="h-3 w-3" /> };
    case 'AVOID': return { label: 'AVOID', bg: 'bg-bear/20 text-bear border border-bear/30', icon: <Shield className="h-3 w-3" /> };
    default: return { label: 'WAIT', bg: 'bg-warn/20 text-warn border border-warn/30', icon: <Target className="h-3 w-3" /> };
  }
}

// Memoize to prevent re-renders when only liveQuotes change (market:tick)
// but conviction data hasn't changed
export const OpportunityTable = memo(OpportunityTableInner, (prev, next) => {
  // Only re-render if onSelect changed
  return prev.onSelect === next.onSelect;
});
