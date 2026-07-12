'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useODSS } from '@/hooks/use-odss';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Recommendation } from '@/lib/odss/types';
import { cn } from '@/lib/utils';

export function AIExplainer({ rec }: { rec?: Recommendation }) {
  const { topRecommendations } = useODSS();
  const r = rec ?? topRecommendations[0];
  const [explanation, setExplanation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'SELECTED' | 'REJECTED'>('SELECTED');

  const fetchExplanation = async (m: 'SELECTED' | 'REJECTED') => {
    if (!r) return;
    setLoading(true);
    setMode(m);
    try {
      const res = await fetch(`/api/odss/explain/${r.symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: m, recommendation: r }),
      });
      const data = await res.json();
      setExplanation(data.explanation);
    } catch (e: any) {
      setExplanation({ summary: 'Failed to fetch AI explanation.', coachingTip: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-ai/30 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Sparkles className="h-4 w-4 text-ai" />
            <span className="text-foreground">AI COACH</span>
          </span>
          {r && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-ai">
              {r.symbol}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!r && (
          <div className="font-mono text-xs text-muted-foreground">
            No recommendation to explain.
          </div>
        )}
        {r && (
          <>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant={mode === 'SELECTED' ? 'default' : 'outline'}
                className={cn(
                  'h-7 font-mono text-[11px] tracking-widest',
                  mode === 'SELECTED'
                    ? 'border-ai/50 bg-ai/20 text-ai hover:bg-ai/30 hover:text-ai'
                    : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground'
                )}
                onClick={() => fetchExplanation('SELECTED')}
                disabled={loading}
              >
                WHY SELECTED
              </Button>
              <Button
                size="sm"
                variant={mode === 'REJECTED' ? 'default' : 'outline'}
                className={cn(
                  'h-7 font-mono text-[11px] tracking-widest',
                  mode === 'REJECTED'
                    ? 'border-ai/50 bg-ai/20 text-ai hover:bg-ai/30 hover:text-ai'
                    : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground'
                )}
                onClick={() => fetchExplanation('REJECTED')}
                disabled={loading}
              >
                WHY REJECTED
              </Button>
              {loading && <Loader2 className="h-3 w-3 animate-spin self-center text-ai" />}
            </div>

            {explanation ? (
              <div className="space-y-2 rounded-lg border border-ai/30 bg-ai/5 p-2 text-xs backdrop-blur-sm">
                {explanation.summary && (
                  <p className="font-medium text-foreground">{explanation.summary}</p>
                )}
                {explanation.whySelected && explanation.whySelected.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-bull">
                      ▸ Why Selected
                    </div>
                    <ul className="ml-3 list-disc space-y-0.5 text-foreground/80">
                      {explanation.whySelected.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {explanation.whyRejected && explanation.whyRejected.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-bear">
                      ▸ Why Rejected
                    </div>
                    <ul className="ml-3 list-disc space-y-0.5 text-foreground/80">
                      {explanation.whyRejected.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {explanation.riskNotes && (
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warn">
                      ▸ Risk Notes
                    </div>
                    <p className="text-foreground/80">{explanation.riskNotes}</p>
                  </div>
                )}
                {explanation.coachingTip && (
                  <div className="rounded border border-ai/40 bg-ai/15 p-1.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-ai">
                      ▸ Coach Tip
                    </span>
                    <p className="mt-0.5 text-foreground/80">{explanation.coachingTip}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-center font-mono text-[11px] text-muted-foreground">
                Click a button above to get an AI explanation of the engine&apos;s decision.
              </div>
            )}
            {r.ai && !loading && (
              <div className="font-mono text-[10px] text-muted-foreground">
                Last AI update: {new Date(r.ai.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
              </div>
            )}
            {!loading && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-ai"
                onClick={() => fetchExplanation(mode)}
              >
                <RefreshCw className="h-3 w-3" /> REFRESH
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
