'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Award, Shield, PiggyBank, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<string, string> = {
  LARGE_CAP: 'Large Cap',
  MID_CAP: 'Mid Cap',
  SMALL_CAP: 'Small Cap',
  FLEXI_CAP: 'Flexi Cap',
  ELSS: 'Tax Saver (ELSS)',
  INDEX: 'Index Fund',
  DEBT: 'Debt Fund',
  HYBRID: 'Hybrid Fund',
};

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-bull bg-bull/15 border-bull/30',
  MODERATE: 'text-info bg-info/15 border-info/30',
  HIGH: 'text-warn bg-warn/15 border-warn/30',
  VERY_HIGH: 'text-bear bg-bear/15 border-bear/30',
};

export function MutualFundsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/odss/mutual-funds')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* Top picks summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TopPickCard icon={Award} label="Best Overall" value={data.bestOverall} color="text-bull" />
        <TopPickCard icon={TrendingUp} label="Best Returns" value={data.bestReturns} color="text-warn" />
        <TopPickCard icon={Shield} label="Lowest Risk" value={data.lowestRisk} color="text-info" />
        <TopPickCard icon={PiggyBank} label="Best SIP" value={data.bestSIP} color="text-ai" />
      </div>

      {/* Funds list */}
      <Card className="accent-info border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-info" />
            <span className="text-gradient-bull text-base font-bold">TOP 10 MUTUAL FUNDS</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">Ranked by 3-year returns</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-border/40 bg-card/95 backdrop-blur">
                <tr className="text-left font-mono text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Fund Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">AUM (Cr)</th>
                  <th className="px-3 py-2 text-right">Expense</th>
                  <th className="px-3 py-2 text-right">1Y</th>
                  <th className="px-3 py-2 text-right">3Y</th>
                  <th className="px-3 py-2 text-right">5Y</th>
                  <th className="px-3 py-2 text-center">Risk</th>
                  <th className="px-3 py-2 text-center">Rating</th>
                  <th className="px-3 py-2 text-right">SIP</th>
                </tr>
              </thead>
              <tbody className="font-mono tnum">
                {data.funds.map((f: any, i: number) => (
                  <>
                    <tr
                      key={f.name}
                      className="cursor-pointer border-b border-border/20 transition-colors hover:bg-info/5"
                      onClick={() => setExpanded(expanded === f.name ? null : f.name)}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-sans font-bold text-foreground">{f.name}</div>
                        <div className="text-[9px] text-muted-foreground">{f.amc}</div>
                      </td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{CATEGORY_LABELS[f.category] ?? f.category}</Badge></td>
                      <td className="px-3 py-2 text-right text-foreground">{f.aum.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{f.expenseRatio.toFixed(2)}%</td>
                      <td className={cn('px-3 py-2 text-right font-bold', f.returns1Y > 15 ? 'text-bull' : f.returns1Y < 0 ? 'text-bear' : 'text-foreground')}>{f.returns1Y > 0 ? '+' : ''}{f.returns1Y.toFixed(1)}%</td>
                      <td className={cn('px-3 py-2 text-right font-bold', f.returns3Y > 15 ? 'text-bull' : 'text-bear')}>{f.returns3Y.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right text-foreground">{f.returns5Y.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-center"><span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-bold', RISK_COLORS[f.riskLevel])}>{f.riskLevel.replace('_', ' ')}</span></td>
                      <td className="px-3 py-2 text-center">
                        <span className="flex justify-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, j) => (
                            <Star key={j} className={cn('h-3 w-3', j < f.rating ? 'fill-warn text-warn' : 'fill-muted text-muted')} />
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">₹{f.minInvestment}</td>
                    </tr>
                    {expanded === f.name && (
                      <tr className="border-b border-border/20 bg-muted/10">
                        <td colSpan={11} className="px-3 py-3">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <DetailMetric label="Alpha" value={f.alpha.toFixed(2)} good={f.alpha > 0} />
                            <DetailMetric label="Beta" value={f.beta.toFixed(2)} />
                            <DetailMetric label="Sharpe Ratio" value={f.sharpeRatio.toFixed(2)} good={f.sharpeRatio > 1} />
                            <DetailMetric label="Sortino Ratio" value={f.sortinoRatio.toFixed(2)} good={f.sortinoRatio > 1.5} />
                            <DetailMetric label="Since Inception" value={`${f.returnsSinceInception.toFixed(1)}%`} />
                            <DetailMetric label="Benchmark" value={f.benchmark} />
                            <DetailMetric label="Fund Manager" value={f.fundManager} />
                            <DetailMetric label="Exit Load" value={f.exitLoad} />
                          </div>
                          <div className="mt-2 grid gap-2 lg:grid-cols-2">
                            <div>
                              <div className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">Top Holdings</div>
                              <div className="flex flex-wrap gap-1">
                                {f.topHoldings.map((h: any, j: number) => (
                                  <Badge key={j} variant="outline" className="text-[9px]">
                                    {h.symbol} <span className="ml-1 text-bull">{h.weight.toFixed(1)}%</span>
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">Analysis</div>
                              <p className="text-[11px] text-foreground/80">{f.analysis}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Category Summary */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Category Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {Object.entries(data.categorySummary).map(([cat, s]: any) => (
              <div key={cat} className="rounded-lg border border-border/40 bg-muted/20 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">{CATEGORY_LABELS[cat] ?? cat}</div>
                <div className="font-mono text-sm font-bold text-bull">{s.avgReturns.toFixed(1)}%</div>
                <div className="text-[9px] text-muted-foreground">{s.count} funds · {s.avgExpense.toFixed(2)}% exp</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TopPickCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <Card className={cn('border-border/50 bg-card/50 backdrop-blur-sm')}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', color)} />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        </div>
        <div className="mt-1 truncate text-sm font-bold text-foreground" title={value}>{value}</div>
      </CardContent>
    </Card>
  );
}

function DetailMetric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded border border-border/40 bg-muted/20 p-2">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-sm font-bold', good ? 'text-bull' : 'text-foreground')}>{value}</div>
    </div>
  );
}
