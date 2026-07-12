'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { DecisionBadge, ConfidenceMeter } from '../shared/badges';
import { Vote } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/lib/odss/types';

export function EngineVotesPanel({ rec }: { rec?: Recommendation }) {
  const { topRecommendations } = useODSS();
  const r = rec ?? topRecommendations[0];

  if (!r) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Vote className="h-4 w-4 text-slate-500" /> Engine Votes</CardTitle></CardHeader>
        <CardContent><div className="text-xs text-slate-400">No recommendation yet.</div></CardContent>
      </Card>
    );
  }

  const votes = r.decision.votes;
  const totalWeight = votes.reduce((a, b) => a + b.weight, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Vote className="h-4 w-4 text-slate-500" /> Engine Votes</span>
          <span className="text-xs font-normal text-slate-400">{r.symbol}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border bg-slate-50/50 p-2">
          <div>
            <div className="text-xs text-slate-500">Final Decision</div>
            <div className="mt-0.5"><DecisionBadge decision={r.decision.decision} /></div>
          </div>
          <ConfidenceMeter value={r.decision.confidence} />
        </div>

        {/* Weighted bar */}
        <div className="flex h-2 w-full overflow-hidden rounded-full">
          {votes.map((v) => {
            const color = v.vote === 'ENTER' ? 'bg-emerald-500' : v.vote === 'WAIT' ? 'bg-amber-500' : v.vote === 'WATCH' ? 'bg-sky-400' : 'bg-rose-500';
            return <div key={v.engine} className={color} style={{ width: `${(v.weight / totalWeight) * 100}%` }} title={`${v.engine}: ${v.vote}`} />;
          })}
        </div>

        {/* Vote list */}
        <div className="space-y-1">
          {votes.map((v) => (
            <div key={v.engine} className="flex items-center gap-2 rounded border bg-white p-1.5">
              <div className="flex w-24 flex-col">
                <span className="text-xs font-medium text-slate-700">{v.engine}</span>
                <span className="text-[9px] text-slate-400">{(v.weight * 100).toFixed(0)}% weight</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <DecisionBadge decision={v.vote} />
                  <span className="font-mono text-[10px] text-slate-500">{v.score.toFixed(0)}/100</span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">{v.reason}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
