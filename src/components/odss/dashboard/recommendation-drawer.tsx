'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { DirectionBadge, DecisionBadge, ConfidenceMeter, ScoreBar, TrendBadge } from '../shared/badges';
import { useODSS } from '@/hooks/use-odss';
import { useEffect, useState } from 'react';
import type { Recommendation } from '@/lib/odss/types';
import { Target, Shield, Crosshair, Activity, ListChecks, Layers3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RecommendationDrawer({ rec, open, onOpenChange }: { rec: Recommendation | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { enterTrade, focusSymbol, optionChain } = useODSS();
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (rec && open) focusSymbol(rec.symbol);
  }, [rec, open, focusSymbol]);

  if (!rec) return null;

  const handleEnter = async () => {
    if (!rec) return;
    setEntering(true);
    await enterTrade(rec.symbol, rec.direction);
    setEntering(false);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="text-xl">{rec.symbol}</span>
            <DirectionBadge direction={rec.direction} />
            <DecisionBadge decision={rec.decision.decision} />
          </SheetTitle>
          <SheetDescription>
            {rec.sector ?? 'INDEX'} • Expiry {rec.strike.expiry} • Updated {new Date(rec.timestamp).toLocaleTimeString()}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="technical">Technical</TabsTrigger>
              <TabsTrigger value="optionchain">Option Chain</TabsTrigger>
              <TabsTrigger value="risk">Risk/Entry</TabsTrigger>
              <TabsTrigger value="votes">Votes</TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-xs text-slate-500">Total Score</div>
                  <div className="text-2xl font-bold">{rec.opportunity.totalScore.toFixed(0)}<span className="text-sm text-slate-400">/100</span></div>
                </div>
                <ConfidenceMeter value={rec.opportunity.confidence} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ScoreCard label="Market" value={rec.opportunity.marketScore} />
                <ScoreCard label="Sector" value={rec.opportunity.sectorScore} />
                <ScoreCard label="Relative Strength" value={rec.opportunity.rsScore} />
                <ScoreCard label="Technical" value={rec.opportunity.technicalScore} />
                <ScoreCard label="Option Chain" value={rec.opportunity.optionChainScore} />
                <ScoreCard label="Total" value={rec.opportunity.totalScore} highlight />
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">Rationale</div>
                <p className="rounded-lg border bg-slate-50 p-2 text-xs text-slate-700">{rec.opportunity.rationale}</p>
              </div>

              <Button className="w-full" onClick={handleEnter} disabled={entering} size="lg">
                <Crosshair className="mr-2 h-4 w-4" />
                {entering ? 'Entering…' : `Arm ${rec.direction} Entry @ ${rec.strike.primaryStrike}`}
              </Button>
            </TabsContent>

            {/* Technical */}
            <TabsContent value="technical" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <TrendBadge trend={rec.technical.trend} />
                <span className="rounded border bg-slate-50 px-2 py-0.5 text-xs">EMA {rec.technical.emaAlignment}</span>
                <span className="rounded border bg-slate-50 px-2 py-0.5 text-xs">VWAP {rec.technical.vwapPosition}</span>
                <span className="rounded border bg-slate-50 px-2 py-0.5 text-xs">ADX {rec.technical.adx.toFixed(0)}</span>
                <span className="rounded border bg-slate-50 px-2 py-0.5 text-xs">RSI {rec.technical.rsi.toFixed(0)}</span>
                <span className="rounded border bg-slate-50 px-2 py-0.5 text-xs">ATR {rec.technical.atrPct.toFixed(2)}%</span>
              </div>
              <FactList facts={rec.technical.facts} icon={Activity} />
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border p-2">
                  <div className="text-[10px] uppercase text-slate-400">Resistance</div>
                  {rec.technical.resistance.slice(0, 3).map((r, i) => <div key={i} className="font-mono text-xs text-rose-600">{r.toFixed(2)}</div>)}
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-[10px] uppercase text-slate-400">Support</div>
                  {rec.technical.support.slice(0, 3).map((r, i) => <div key={i} className="font-mono text-xs text-emerald-600">{r.toFixed(2)}</div>)}
                </div>
              </div>
            </TabsContent>

            {/* Option Chain */}
            <TabsContent value="optionchain" className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="PCR" value={rec.optionChain.pcr.toFixed(2)} />
                <Metric label="ATM IV" value={`${rec.optionChain.atmIV.toFixed(1)}%`} />
                <Metric label="IV Rank" value={rec.optionChain.ivRank.toFixed(0)} />
                <Metric label="Max Pain" value={rec.optionChain.maxPain.toFixed(0)} />
                <Metric label="Support" value={rec.optionChain.supportStrike.toFixed(0)} />
                <Metric label="Resistance" value={rec.optionChain.resistanceStrike.toFixed(0)} />
              </div>
              <FactList facts={rec.optionChain.facts} icon={Layers3} />

              {/* Live option chain table */}
              {optionChain && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-500">Live Option Chain (ATM ± 5)</div>
                  <div className="max-h-72 overflow-y-auto rounded border">
                    <table className="w-full text-[10px]">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr className="text-slate-400">
                          <th colSpan={4} className="border-r px-1 py-1 text-center">CALLS</th>
                          <th className="px-1 py-1">STRIKE</th>
                          <th colSpan={4} className="border-l px-1 py-1 text-center">PUTS</th>
                        </tr>
                        <tr className="text-slate-400">
                          <th className="px-1">OI</th><th className="px-1">Chg</th><th className="px-1">IV</th><th className="px-1 border-r">LTP</th>
                          <th className="px-1"></th>
                          <th className="px-1 border-l">LTP</th><th className="px-1">IV</th><th className="px-1">Chg</th><th className="px-1">OI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionChain.strikes
                          .filter((_: any, i: number, arr: any[]) => {
                            // group by strike
                            return arr.findIndex((x: any) => x.strike === _.strike) === Math.floor(arr.findIndex((x: any) => x.strike === _.strike) / 2) * 2;
                          })
                          .slice(0, 11)
                          .map((callRow: any) => {
                            const putRow = optionChain.strikes.find((r: any) => r.strike === callRow.strike && r.type === 'PE');
                            const isATM = callRow.strike === optionChain.atmStrike;
                            return (
                              <tr key={callRow.strike} className={cn('border-t text-center', isATM && 'bg-slate-100 font-bold')}>
                                <td className="px-1 text-slate-500">{(callRow.oi / 100000).toFixed(1)}L</td>
                                <td className={cn('px-1', callRow.oiChange >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{(callRow.oiChange / 1000).toFixed(0)}K</td>
                                <td className="px-1">{callRow.iv.toFixed(0)}</td>
                                <td className="px-1 border-r font-mono">{callRow.ltp.toFixed(0)}</td>
                                <td className="px-1 font-mono font-bold">{callRow.strike}</td>
                                <td className="px-1 border-l font-mono">{putRow?.ltp.toFixed(0)}</td>
                                <td className="px-1">{putRow?.iv.toFixed(0)}</td>
                                <td className={cn('px-1', (putRow?.oiChange ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{((putRow?.oiChange ?? 0) / 1000).toFixed(0)}K</td>
                                <td className="px-1 text-slate-500">{((putRow?.oi ?? 0) / 100000).toFixed(1)}L</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Risk/Entry */}
            <TabsContent value="risk" className="space-y-2">
              <div className="rounded-lg border bg-amber-50/30 p-2 text-xs text-amber-700">
                <Shield className="mr-1 inline h-3 w-3" /> Entries use underlying price only. Never chase — wait for the trigger.
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500"><Target className="mr-1 inline h-3 w-3" />Strike Selection</div>
                <FactList facts={rec.strike.facts} icon={Crosshair} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500"><Activity className="mr-1 inline h-3 w-3" />Entry Plan</div>
                <FactList facts={rec.entry.facts} icon={Crosshair} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500"><Shield className="mr-1 inline h-3 w-3" />Risk Plan</div>
                <FactList facts={rec.risk.facts} icon={Shield} />
              </div>
            </TabsContent>

            {/* Votes */}
            <TabsContent value="votes" className="space-y-2">
              <div className="rounded-lg border p-2">
                <div className="text-xs text-slate-500">Final Decision</div>
                <div className="mt-1 flex items-center justify-between">
                  <DecisionBadge decision={rec.decision.decision} />
                  <ConfidenceMeter value={rec.decision.confidence} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{rec.decision.reasoning}</p>
              </div>
              {rec.decision.votes.map((v) => (
                <div key={v.engine} className="rounded border p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{v.engine}</span>
                    <DecisionBadge decision={v.vote as any} />
                  </div>
                  <ScoreBar value={v.score} label="Score" className="mt-1" />
                  <div className="mt-1 text-[10px] text-slate-500">{v.reason}</div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FactList({ facts, icon: Icon }: { facts: string[]; icon: any }) {
  return (
    <ul className="space-y-0.5 rounded-lg border bg-white p-2">
      {facts.map((f, i) => (
        <li key={i} className="flex gap-1.5 text-xs text-slate-600">
          <Icon className="h-3 w-3 mt-0.5 shrink-0 text-slate-400" /> {f}
        </li>
      ))}
    </ul>
  );
}

function ScoreCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-2', highlight ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white')}>
      <div className={cn('text-[10px] uppercase', highlight ? 'text-slate-300' : 'text-slate-400')}>{label}</div>
      <div className={cn('font-mono text-lg font-bold', highlight ? 'text-white' : 'text-slate-800')}>{value.toFixed(0)}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-2">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
