'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  DirectionBadge,
  DecisionBadge,
  ConfidenceMeter,
  ScoreBar,
  TrendBadge,
} from '../shared/badges';
import { useODSS } from '@/hooks/use-odss';
import { useEffect, useState } from 'react';
import type { Recommendation } from '@/lib/odss/types';
import { Target, Shield, Crosshair, Activity, Layers3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RecommendationDrawer({
  rec,
  open,
  onOpenChange,
}: {
  rec: Recommendation | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
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
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-border/60 bg-[#0a0e14]/95 backdrop-blur-xl sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono text-xl tracking-wide text-foreground">{rec.symbol}</span>
            <DirectionBadge direction={rec.direction} />
            <DecisionBadge decision={rec.decision.decision} />
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {rec.sector ?? 'INDEX'} · EXP {rec.strike.expiry} · UPDATED{' '}
            {new Date(rec.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-5 border border-border/60 bg-card/40">
              {['overview', 'technical', 'optionchain', 'risk', 'votes'].map((v) => (
                <TabsTrigger
                  key={v}
                  value={v}
                  className="rounded-none font-mono text-[10px] uppercase tracking-widest text-muted-foreground data-[state=active]:bg-bull/10 data-[state=active]:text-bull"
                >
                  {v === 'optionchain' ? 'CHAIN' : v}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 p-3 backdrop-blur-sm">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Total Score
                  </div>
                  <div className="font-mono text-2xl font-bold tnum text-foreground">
                    {rec.opportunity.totalScore.toFixed(0)}
                    <span className="text-sm text-muted-foreground">/100</span>
                  </div>
                </div>
                <ConfidenceMeter value={rec.opportunity.confidence} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ScoreCard label="Market" value={rec.opportunity.marketScore} />
                <ScoreCard label="Sector" value={rec.opportunity.sectorScore} />
                <ScoreCard label="Rel Strength" value={rec.opportunity.rsScore} />
                <ScoreCard label="Technical" value={rec.opportunity.technicalScore} />
                <ScoreCard label="Option Chain" value={rec.opportunity.optionChainScore} />
                <ScoreCard label="Total" value={rec.opportunity.totalScore} highlight />
              </div>

              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Rationale
                </div>
                <p className="rounded-lg border border-border/60 bg-muted/30 p-2 text-xs text-foreground/80">
                  {rec.opportunity.rationale}
                </p>
              </div>

              <Button
                className="w-full border-bull/40 bg-bull/20 font-mono text-[12px] tracking-widest text-bull hover:bg-bull/30 hover:text-bull"
                variant="outline"
                onClick={handleEnter}
                disabled={entering}
                size="lg"
              >
                <Crosshair className="mr-2 h-4 w-4" />
                {entering ? 'ENTERING…' : `ARM ${rec.direction} ENTRY @ ${rec.strike.primaryStrike}`}
              </Button>
            </TabsContent>

            {/* Technical */}
            <TabsContent value="technical" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <TrendBadge trend={rec.technical.trend} />
                <Tag>EMA {rec.technical.emaAlignment}</Tag>
                <Tag>VWAP {rec.technical.vwapPosition}</Tag>
                <Tag>ADX {rec.technical.adx.toFixed(0)}</Tag>
                <Tag>RSI {rec.technical.rsi.toFixed(0)}</Tag>
                <Tag>ATR {rec.technical.atrPct.toFixed(2)}%</Tag>
              </div>
              <FactList facts={rec.technical.facts} icon={Activity} />
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Resistance
                  </div>
                  {rec.technical.resistance.slice(0, 3).map((r, i) => (
                    <div key={i} className="font-mono text-xs tnum text-bear">
                      {r.toFixed(2)}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Support
                  </div>
                  {rec.technical.support.slice(0, 3).map((r, i) => (
                    <div key={i} className="font-mono text-xs tnum text-bull">
                      {r.toFixed(2)}
                    </div>
                  ))}
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
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Live Option Chain (ATM ± 5)
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded border border-border/60 bg-muted/20">
                    <table className="w-full font-mono text-[10px] tnum">
                      <thead className="sticky top-0 bg-card/95 backdrop-blur">
                        <tr className="text-muted-foreground">
                          <th colSpan={4} className="border-r border-border/60 px-1 py-1 text-center">
                            CALLS
                          </th>
                          <th className="px-1 py-1">STRIKE</th>
                          <th colSpan={4} className="border-l border-border/60 px-1 py-1 text-center">
                            PUTS
                          </th>
                        </tr>
                        <tr className="text-muted-foreground">
                          <th className="px-1">OI</th>
                          <th className="px-1">Chg</th>
                          <th className="px-1">IV</th>
                          <th className="border-r border-border/60 px-1">LTP</th>
                          <th className="px-1"></th>
                          <th className="border-l border-border/60 px-1">LTP</th>
                          <th className="px-1">IV</th>
                          <th className="px-1">Chg</th>
                          <th className="px-1">OI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionChain.strikes
                          .filter((_: any, i: number, arr: any[]) => {
                            return (
                              arr.findIndex((x: any) => x.strike === _.strike) ===
                              Math.floor(arr.findIndex((x: any) => x.strike === _.strike) / 2) * 2
                            );
                          })
                          .slice(0, 11)
                          .map((callRow: any) => {
                            const putRow = optionChain.strikes.find(
                              (r: any) => r.strike === callRow.strike && r.type === 'PE'
                            );
                            const isATM = callRow.strike === optionChain.atmStrike;
                            return (
                              <tr
                                key={callRow.strike}
                                className={cn(
                                  'border-b border-border/30 text-center',
                                  isATM && 'bg-bull/10 font-bold text-bull'
                                )}
                              >
                                <td className="px-1 text-muted-foreground">
                                  {(callRow.oi / 100000).toFixed(1)}L
                                </td>
                                <td
                                  className={cn(
                                    'px-1',
                                    callRow.oiChange >= 0 ? 'text-bull' : 'text-bear'
                                  )}
                                >
                                  {(callRow.oiChange / 1000).toFixed(0)}K
                                </td>
                                <td className="px-1 text-foreground/80">{callRow.iv.toFixed(0)}</td>
                                <td className="border-r border-border/60 px-1 text-foreground">
                                  {callRow.ltp.toFixed(0)}
                                </td>
                                <td className="px-1 font-bold text-foreground">{callRow.strike}</td>
                                <td className="border-l border-border/60 px-1 text-foreground">
                                  {putRow?.ltp.toFixed(0)}
                                </td>
                                <td className="px-1 text-foreground/80">{putRow?.iv.toFixed(0)}</td>
                                <td
                                  className={cn(
                                    'px-1',
                                    (putRow?.oiChange ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                                  )}
                                >
                                  {((putRow?.oiChange ?? 0) / 1000).toFixed(0)}K
                                </td>
                                <td className="px-1 text-muted-foreground">
                                  {((putRow?.oi ?? 0) / 100000).toFixed(1)}L
                                </td>
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
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
                <Shield className="mr-1 inline h-3 w-3" /> Entries use underlying price only. Never
                chase — wait for the trigger.
              </div>
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Target className="mr-1 inline h-3 w-3" />
                  Strike Selection
                </div>
                <FactList facts={rec.strike.facts} icon={Crosshair} />
              </div>
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Activity className="mr-1 inline h-3 w-3" />
                  Entry Plan
                </div>
                <FactList facts={rec.entry.facts} icon={Crosshair} />
              </div>
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Shield className="mr-1 inline h-3 w-3" />
                  Risk Plan
                </div>
                <FactList facts={rec.risk.facts} icon={Shield} />
              </div>
            </TabsContent>

            {/* Votes */}
            <TabsContent value="votes" className="space-y-2">
              <div className="rounded-lg border border-border/60 bg-card/40 p-2">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Final Decision
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <DecisionBadge decision={rec.decision.decision} />
                  <ConfidenceMeter value={rec.decision.confidence} />
                </div>
                <p className="mt-2 text-xs text-foreground/80">{rec.decision.reasoning}</p>
              </div>
              {rec.decision.votes.map((v) => (
                <div key={v.engine} className="rounded border border-border/60 bg-muted/20 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {v.engine}
                    </span>
                    <DecisionBadge decision={v.vote as any} />
                  </div>
                  <ScoreBar value={v.score} label="Score" className="mt-1" />
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">{v.reason}</div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground">
      {children}
    </span>
  );
}

function FactList({ facts, icon: Icon }: { facts: string[]; icon: any }) {
  return (
    <ul className="space-y-0.5 rounded-lg border border-border/60 bg-muted/20 p-2">
      {facts.map((f, i) => (
        <li key={i} className="flex gap-1.5 text-xs text-foreground/80">
          <Icon className="mt-0.5 h-3 w-3 shrink-0 text-info" /> {f}
        </li>
      ))}
    </ul>
  );
}

function ScoreCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2',
        highlight
          ? 'border-bull/40 bg-bull/15 text-bull glow-bull'
          : 'border-border/60 bg-muted/30'
      )}
    >
      <div
        className={cn(
          'font-mono text-[10px] uppercase tracking-widest',
          highlight ? 'text-bull/80' : 'text-muted-foreground'
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          'font-mono text-lg font-bold tnum',
          highlight ? 'text-bull' : 'text-foreground'
        )}
      >
        {value.toFixed(0)}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm font-semibold tnum text-foreground">{value}</div>
    </div>
  );
}
