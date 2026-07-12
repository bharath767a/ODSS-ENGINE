'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge, DecisionBadge } from '../shared/badges';
import { Sparkline } from './sparkline';
import { Trophy, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/lib/odss/types';

export function OpportunityTable({ onSelect }: { onSelect?: (rec: Recommendation) => void }) {
  const { topRecommendations, liveQuotes } = useODSS();
  const recs = topRecommendations;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Trophy className="h-4 w-4 text-warn" />
            <span className="text-foreground">TOP OPPORTUNITIES</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {recs.length} RANKED
          </span>
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
                <th className="px-2 py-2 text-center">Trend</th>
                <th className="px-2 py-2 text-right">Chg%</th>
                <th className="px-2 py-2 text-right">Score</th>
                <th className="hidden px-2 py-2 text-center md:table-cell">T / O</th>
                <th className="px-2 py-2 text-right">Conf</th>
                <th className="px-2 py-2 text-center">Decision</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="font-mono tnum">
              {recs.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-2 py-10 text-center font-sans text-xs text-muted-foreground"
                  >
                    Scanning market for opportunities…
                  </td>
                </tr>
              )}
              {recs.map((r) => {
                const q = liveQuotes[r.symbol];
                const conf = r.opportunity.confidence;
                const score = r.opportunity.totalScore;
                const confColor =
                  conf > 65 ? 'text-bull text-glow-bull' : conf > 45 ? 'text-warn' : 'text-bear';
                const scoreBg =
                  score >= 70
                    ? 'bg-bull/15 text-bull'
                    : score >= 55
                      ? 'bg-warn/15 text-warn'
                      : 'bg-bear/15 text-bear';
                return (
                  <tr
                    key={r.symbol}
                    className="cursor-pointer border-b border-border/30 transition-colors hover:bg-bull/5"
                    onClick={() => onSelect?.(r)}
                  >
                    <td className="px-2 py-1.5 text-muted-foreground">{r.opportunity.rank}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-sans text-xs font-bold tracking-wide text-foreground">
                        {r.symbol}
                      </div>
                      {r.sector && (
                        <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                          {r.sector}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <DirectionBadge direction={r.direction} />
                    </td>
                    <td className="px-2 py-2 text-right font-semibold text-foreground">
                      {q?.ltp.toFixed(2) ?? '—'}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-center">
                        {q && <Sparkline price={q.ltp} width={60} height={20} />}
                      </div>
                    </td>
                    <td
                      className={cn(
                        'px-2 py-2 text-right font-bold',
                        q && q.changePct >= 0 ? 'text-bull' : 'text-bear'
                      )}
                    >
                      {q
                        ? `${q.changePct >= 0 ? '▲ +' : '▼ '}${Math.abs(q.changePct).toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span
                        className={cn(
                          'inline-flex min-w-[32px] justify-center rounded px-2 py-1 text-[10px] font-bold tnum',
                          scoreBg
                        )}
                      >
                        {r.opportunity.totalScore.toFixed(0)}
                      </span>
                    </td>
                    <td className="hidden px-2 py-2 text-center text-[10px] md:table-cell">
                      <span className="rounded bg-info/10 px-1.5 py-0.5 font-bold text-info">
                        {r.opportunity.technicalScore.toFixed(0)}T
                      </span>{' '}
                      <span className="rounded bg-ai/10 px-1.5 py-0.5 font-bold text-ai">
                        {r.opportunity.optionChainScore.toFixed(0)}O
                      </span>
                    </td>
                    <td className={cn('px-2 py-2 text-right font-bold tnum', confColor)}>
                      {r.opportunity.confidence.toFixed(0)}%
                    </td>
                    <td className="px-2 py-2 text-center">
                      <DecisionBadge decision={r.decision.decision} />
                    </td>
                    <td className="px-2 py-1.5">
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </td>
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
