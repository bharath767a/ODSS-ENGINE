'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useODSS } from '@/hooks/use-odss';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Recommendation } from '@/lib/odss/types';

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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" /> AI Coach</span>
          {r && <span className="text-xs font-normal text-slate-400">{r.symbol}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!r && <div className="text-xs text-slate-400">No recommendation to explain.</div>}
        {r && (
          <>
            <div className="flex gap-1.5">
              <Button size="sm" variant={mode === 'SELECTED' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => fetchExplanation('SELECTED')} disabled={loading}>
                Why Selected
              </Button>
              <Button size="sm" variant={mode === 'REJECTED' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => fetchExplanation('REJECTED')} disabled={loading}>
                Why Rejected
              </Button>
              {loading && <Loader2 className="h-3 w-3 animate-spin self-center" />}
            </div>

            {explanation ? (
              <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/30 p-2 text-xs">
                {explanation.summary && <p className="font-medium text-slate-800">{explanation.summary}</p>}
                {explanation.whySelected && explanation.whySelected.length > 0 && (
                  <div>
                    <div className="text-[10px] font-medium uppercase text-emerald-600">Why Selected</div>
                    <ul className="ml-3 list-disc space-y-0.5 text-slate-700">
                      {explanation.whySelected.map((x: string, i: number) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>
                )}
                {explanation.whyRejected && explanation.whyRejected.length > 0 && (
                  <div>
                    <div className="text-[10px] font-medium uppercase text-rose-600">Why Rejected</div>
                    <ul className="ml-3 list-disc space-y-0.5 text-slate-700">
                      {explanation.whyRejected.map((x: string, i: number) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>
                )}
                {explanation.riskNotes && (
                  <div>
                    <div className="text-[10px] font-medium uppercase text-amber-600">Risk Notes</div>
                    <p className="text-slate-700">{explanation.riskNotes}</p>
                  </div>
                )}
                {explanation.coachingTip && (
                  <div className="rounded bg-violet-100 p-1.5">
                    <span className="text-[10px] font-medium uppercase text-violet-700">Coach Tip</span>
                    <p className="text-slate-700">{explanation.coachingTip}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-slate-50 p-3 text-center text-xs text-slate-400">
                Click a button above to get an AI explanation of the engine's decision.
              </div>
            )}
            {r.ai && !loading && (
              <div className="text-[10px] text-slate-400">Last AI update: {new Date(r.ai.timestamp).toLocaleTimeString()}</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
