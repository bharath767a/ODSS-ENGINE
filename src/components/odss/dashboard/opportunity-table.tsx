'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge, DecisionBadge, ConfidenceMeter, ScoreBar } from '../shared/badges';
import { Trophy, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/lib/odss/types';

export function OpportunityTable({ onSelect }: { onSelect?: (rec: Recommendation) => void }) {
  const { topRecommendations, liveQuotes } = useODSS();
  const recs = topRecommendations;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /> Top Opportunities</span>
          <span className="text-xs font-normal text-slate-400">{recs.length} ranked</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Symbol</th>
                <th className="px-2 py-1.5">Dir</th>
                <th className="px-2 py-1.5">Price</th>
                <th className="px-2 py-1.5 hidden sm:table-cell">Chg%</th>
                <th className="px-2 py-1.5">Score</th>
                <th className="px-2 py-1.5 hidden md:table-cell">Tech/OC</th>
                <th className="px-2 py-1.5">Conf</th>
                <th className="px-2 py-1.5">Decision</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {recs.length === 0 && (
                <tr><td colSpan={10} className="px-2 py-8 text-center text-slate-400">Scanning market for opportunities…</td></tr>
              )}
              {recs.map((r) => {
                const q = liveQuotes[r.symbol];
                return (
                  <tr
                    key={r.symbol}
                    className="border-t border-slate-100 transition-colors hover:bg-slate-50 cursor-pointer"
                    onClick={() => onSelect?.(r)}
                  >
                    <td className="px-2 py-1.5 font-mono text-slate-400">{r.opportunity.rank}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-semibold text-slate-800">{r.symbol}</div>
                      {r.sector && <div className="text-[9px] text-slate-400">{r.sector}</div>}
                    </td>
                    <td className="px-2 py-1.5"><DirectionBadge direction={r.direction} /></td>
                    <td className="px-2 py-1.5 font-mono">{q?.ltp.toFixed(2) ?? '-'}</td>
                    <td className="px-2 py-1.5 hidden sm:table-cell">
                      {q && <span className={q.changePct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                        {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                      </span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-semibold">{r.opportunity.totalScore.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 hidden md:table-cell">
                      <div className="flex gap-0.5">
                        <span className="rounded bg-slate-100 px-1 text-[10px]">{r.opportunity.technicalScore.toFixed(0)}T</span>
                        <span className="rounded bg-slate-100 px-1 text-[10px]">{r.opportunity.optionChainScore.toFixed(0)}O</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={cn('font-mono font-bold', r.opportunity.confidence > 65 ? 'text-emerald-600' : r.opportunity.confidence > 45 ? 'text-amber-600' : 'text-rose-600')}>
                        {r.opportunity.confidence.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-2 py-1.5"><DecisionBadge decision={r.decision.decision} /></td>
                    <td className="px-2 py-1.5"><ChevronRight className="h-3 w-3 text-slate-400" /></td>
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
