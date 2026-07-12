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
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide text-muted-foreground">
            <Vote className="h-4 w-4 text-ai" />
            <span className="text-gradient-ai text-base font-bold">ENGINE VOTES</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-xs text-muted-foreground">No recommendation yet.</div>
        </CardContent>
      </Card>
    );
  }

  const votes = r.decision.votes;
  const totalWeight = votes.reduce((a, b) => a + b.weight, 0);

  return (
    <Card className="accent-ai border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Vote className="h-4 w-4 text-ai" />
            <span className="text-gradient-ai text-base font-bold">ENGINE VOTES</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-bull">
            {r.symbol}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 p-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Final Decision
            </div>
            <div className="mt-0.5">
              <DecisionBadge decision={r.decision.decision} />
            </div>
          </div>
          <ConfidenceMeter value={r.decision.confidence} />
        </div>

        {/* Weighted bar */}
        <div className="flex h-2 w-full overflow-hidden rounded-full border border-border/40 bg-muted/40">
          {votes.map((v) => {
            const color =
              v.vote === 'ENTER'
                ? 'bg-bull'
                : v.vote === 'WAIT'
                  ? 'bg-warn'
                  : v.vote === 'WATCH'
                    ? 'bg-info'
                    : 'bg-bear';
            return (
              <div
                key={v.engine}
                className={cn(color, 'shadow-[0_0_6px_rgba(255,255,255,0.08)] transition-all')}
                style={{ width: `${(v.weight / totalWeight) * 100}%` }}
                title={`${v.engine}: ${v.vote}`}
              />
            );
          })}
        </div>

        {/* Vote list */}
        <div className="space-y-1">
          {votes.map((v) => {
            const voteColor =
              v.vote === 'ENTER'
                ? 'border-bull/30'
                : v.vote === 'WAIT'
                  ? 'border-warn/30'
                  : v.vote === 'WATCH'
                    ? 'border-info/30'
                    : 'border-bear/30';
            return (
              <div
                key={v.engine}
                className={cn(
                  'flex items-center gap-2 rounded border bg-muted/20 p-1.5 transition-colors hover:bg-muted/40',
                  voteColor
                )}
              >
                <div className="flex w-24 flex-col">
                  <span className="font-mono text-[11px] font-semibold text-foreground">
                    {v.engine}
                  </span>
                  <span className="font-mono text-[9px] tnum text-muted-foreground">
                    {(v.weight * 100).toFixed(0)}% w
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <DecisionBadge decision={v.vote} />
                    <span className="font-mono text-[10px] tnum text-muted-foreground">
                      {v.score.toFixed(0)}/100
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] leading-tight text-muted-foreground">
                    {v.reason}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
