'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, TrendingUp, TrendingDown, Minus, Sparkles, Loader2, ChevronLeft, Building2, DollarSign, BarChart3, Heart, Users, Calendar, Target } from 'lucide-react';
import { useODSS } from '@/hooks/use-odss';
import { cn } from '@/lib/utils';
import { ALL_SYMBOLS } from '@/lib/odss/universe';
import { useToast } from '@/hooks/use-toast';

interface FundamentalResponse {
  data: any;
  score: any;
  recommendation: any;
  currentPrice: number;
}

export function StockAnalysisTab({ initialSymbol }: { initialSymbol?: string | null }) {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fundamental, setFundamental] = useState<FundamentalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [story, setStory] = useState<any>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; changePct: number; source: string }>>({});
  const { toast } = useToast();

  const stocks = ALL_SYMBOLS.filter((s) => s.type === 'STOCK');
  const filtered = stocks.filter((s) =>
    !search || s.symbol.toLowerCase().includes(search.toLowerCase()) || s.name.toLowerCase().includes(search.toLowerCase())
  );

  // Fetch live prices for all stocks in the list (from Yahoo via the quote API)
  useEffect(() => {
    let mounted = true;
    async function fetchLivePrices() {
      const prices: Record<string, { price: number; changePct: number; source: string }> = {};
      // Fetch in batches of 5 to avoid overwhelming the API
      const batchSize = 5;
      for (let i = 0; i < filtered.length; i += batchSize) {
        const batch = filtered.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(async (s) => {
            try {
              const res = await fetch(`/api/odss/quote/${s.symbol}`);
              if (res.ok) {
                const q = await res.json();
                if (q.ltp > 0) {
                  prices[s.symbol] = {
                    price: q.ltp,
                    changePct: q.changePct ?? 0,
                    source: q.source ?? 'UNKNOWN',
                  };
                }
              }
            } catch {
              // individual quote failed — skip
            }
          }),
        );
      }
      if (mounted) setLivePrices(prices);
    }
    fetchLivePrices();
    const id = setInterval(fetchLivePrices, 30000); // refresh every 30s
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [search]); // re-fetch when search changes (filtered list changes)

  useEffect(() => {
    if (!selectedSymbol) {
      setFundamental(null);
      setStory(null);
      return;
    }
    setLoading(true);
    setStory(null);
    fetch(`/api/odss/fundamentals/${selectedSymbol}`)
      .then((r) => r.json())
      .then((d) => { if (d.data) setFundamental(d); })
      .finally(() => setLoading(false));
  }, [selectedSymbol]);

  const fetchStory = async () => {
    if (!selectedSymbol) return;
    setStoryLoading(true);
    try {
      const res = await fetch(`/api/odss/stock-story/${selectedSymbol}`, { method: 'POST' });
      const data = await res.json();
      setStory(data.story);
    } catch (e: any) {
      toast({ title: 'Failed to generate story', description: e.message, variant: 'destructive' });
    } finally {
      setStoryLoading(false);
    }
  };

  if (selectedSymbol && fundamental) {
    return (
      <StockAnalysisView
        data={fundamental}
        onBack={() => { setSelectedSymbol(null); setStory(null); }}
        story={story}
        storyLoading={storyLoading}
        onGenerateStory={fetchStory}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Card className="accent-ai border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-ai" />
            <span className="text-gradient-ai text-base font-bold">STOCK ANALYSIS</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">Fundamental Analysis · P/E · EPS · Debt · Quarterly Results · Buy/Sell/Hold</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search stocks by name or symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-background/60 pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {filtered.map((s) => (
              <button
                key={s.symbol}
                onClick={() => setSelectedSymbol(s.symbol)}
                className={cn(
                  'group relative overflow-hidden rounded-lg border border-border/50 bg-card/40 p-3 text-left transition-all hover:border-ai/40 hover:bg-ai/5',
                  selectedSymbol === s.symbol && 'border-ai/60 bg-ai/10'
                )}
              >
                <div className="font-mono text-sm font-bold text-foreground">{s.symbol}</div>
                <div className="truncate text-[10px] text-muted-foreground">{s.name}</div>
                <div className="mt-1 flex items-center justify-between">
                  <Badge variant="outline" className="text-[9px]">{s.sector}</Badge>
                  {livePrices[s.symbol] ? (
                    <span className={cn(
                      'font-mono text-[10px]',
                      livePrices[s.symbol].changePct >= 0 ? 'text-bull' : 'text-bear',
                    )}>
                      ₹{livePrices[s.symbol].price.toFixed(0)}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-muted-foreground">₹{s.basePrice.toFixed(0)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// FULL STOCK ANALYSIS VIEW
// ============================================================
function StockAnalysisView({ data, onBack, story, storyLoading, onGenerateStory }: {
  data: FundamentalResponse;
  onBack: () => void;
  story: any;
  storyLoading: boolean;
  onGenerateStory: () => void;
}) {
  const { data: fund, score, recommendation: rec, currentPrice } = data;
  const actionColors: Record<string, string> = {
    STRONG_BUY: 'text-bull bg-bull/20 border-bull/50 glow-bull',
    BUY: 'text-bull bg-bull/15 border-bull/40',
    HOLD: 'text-warn bg-warn/15 border-warn/40',
    SELL: 'text-bear bg-bear/15 border-bear/40',
    STRONG_SELL: 'text-bear bg-bear/20 border-bear/50 glow-bear',
  };
  const actionLabels: Record<string, string> = {
    STRONG_BUY: 'STRONG BUY', BUY: 'BUY', HOLD: 'HOLD', SELL: 'SELL', STRONG_SELL: 'STRONG SELL',
  };

  return (
    <div className="space-y-3">
      {/* Back button + header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-bold">
            {fund.profile.name}
            <span className="ml-2 font-mono text-sm text-muted-foreground">({fund.profile.symbol})</span>
          </h2>
          <p className="text-xs text-muted-foreground">{fund.profile.industry} · Market Cap: ₹{(fund.profile.marketCap / 1000).toFixed(1)}K Cr</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold">₹{currentPrice.toFixed(2)}</div>
          <div className={cn('inline-flex items-center rounded border px-2 py-0.5 text-xs font-bold', actionColors[rec.action])}>
            {actionLabels[rec.action]} · {rec.confidence}%
          </div>
        </div>
      </div>

      {/* Score + Buy/Sell/Hold meter */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Fundamental Score */}
        <Card className="accent-ai border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Fundamental Score</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-around">
            <ScoreGauge value={score.total} rating={score.rating} />
            <div className="space-y-1">
              <ScoreBar label="Valuation" value={score.valuation} />
              <ScoreBar label="Growth" value={score.growth} />
              <ScoreBar label="Profitability" value={score.profitability} />
              <ScoreBar label="Health" value={score.financialHealth} />
              <ScoreBar label="Quality" value={score.quality} />
            </div>
          </CardContent>
        </Card>

        {/* Buy/Sell/Hold */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recommendation</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className={cn('rounded-lg border p-3 text-center', actionColors[rec.action])}>
              <div className="text-2xl font-bold">{actionLabels[rec.action]}</div>
              <div className="text-xs opacity-80">{rec.confidence}% confidence · {rec.riskLevel} risk · {rec.timeHorizon} term</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border/40 bg-muted/20 p-2">
                <div className="text-muted-foreground">Fair Value</div>
                <div className="font-mono font-bold text-foreground">₹{rec.fairValue}</div>
              </div>
              <div className={cn('rounded border p-2', rec.upsideDownside >= 0 ? 'border-bull/30 bg-bull/10' : 'border-bear/30 bg-bear/10')}>
                <div className="text-muted-foreground">Upside/Downside</div>
                <div className={cn('font-mono font-bold', rec.upsideDownside >= 0 ? 'text-bull' : 'text-bear')}>
                  {rec.upsideDownside >= 0 ? '+' : ''}{rec.upsideDownside.toFixed(1)}%
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{rec.reasoning}</p>
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Key Signals</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {rec.keyMetrics.map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{m.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-foreground">{m.value}</span>
                  {m.signal === 'BULLISH' && <TrendingUp className="h-3 w-3 text-bull" />}
                  {m.signal === 'BEARISH' && <TrendingDown className="h-3 w-3 text-bear" />}
                  {m.signal === 'NEUTRAL' && <Minus className="h-3 w-3 text-muted-foreground" />}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Valuation + Earnings */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-bull" /> Valuation Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Metric label="P/E Ratio" value={fund.valuation.peRatio.toFixed(1)} sub={`Sector: ${fund.valuation.sectorPE}`} good={fund.valuation.premiumDiscount < 0} bad={fund.valuation.premiumDiscount > 25} />
              <Metric label="Forward P/E" value={fund.valuation.forwardPE.toFixed(1)} sub="Next year" good={fund.valuation.forwardPE < fund.valuation.peRatio} />
              <Metric label="P/B Ratio" value={fund.valuation.pbRatio.toFixed(2)} />
              <Metric label="EV/EBITDA" value={fund.valuation.evEbitda.toFixed(1)} />
              <Metric label="PEG Ratio" value={fund.valuation.pegRatio.toFixed(2)} good={fund.valuation.pegRatio < 1} bad={fund.valuation.pegRatio > 2.5} />
              <Metric label="Div Yield" value={`${fund.valuation.dividendYield.toFixed(2)}%`} good={fund.valuation.dividendYield > 2} />
            </div>
            <div className={cn('mt-2 rounded p-2 text-xs', fund.valuation.premiumDiscount < 0 ? 'bg-bull/10 text-bull' : 'bg-bear/10 text-bear')}>
              Trading at {Math.abs(fund.valuation.premiumDiscount).toFixed(1)}% {fund.valuation.premiumDiscount > 0 ? 'premium to' : 'discount to'} sector P/E
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-info" /> Earnings & Profitability
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Metric label="EPS (TTM)" value={`₹${fund.earnings.eps.toFixed(2)}`} sub={`Fwd: ₹${fund.earnings.forwardEPS.toFixed(2)}`} />
              <Metric label="EPS Growth" value={`${fund.earnings.epsGrowthYoY.toFixed(1)}%`} good={fund.earnings.epsGrowthYoY > 15} bad={fund.earnings.epsGrowthYoY < 5} />
              <Metric label="3Y EPS CAGR" value={`${fund.earnings.epsGrowth3Y.toFixed(1)}%`} good={fund.earnings.epsGrowth3Y > 15} />
              <Metric label="Revenue" value={`₹${(fund.earnings.revenue / 1000).toFixed(1)}K Cr`} sub={`+${fund.earnings.revenueGrowthYoY.toFixed(1)}% YoY`} />
              <Metric label="ROE" value={`${fund.earnings.roe.toFixed(1)}%`} good={fund.earnings.roe > 18} bad={fund.earnings.roe < 10} />
              <Metric label="ROCE" value={`${fund.earnings.roce.toFixed(1)}%`} good={fund.earnings.roce > 18} bad={fund.earnings.roce < 12} />
              <Metric label="Op Margin" value={`${fund.earnings.operatingMargin.toFixed(1)}%`} />
              <Metric label="Net Margin" value={`${fund.earnings.netProfitMargin.toFixed(1)}%`} good={fund.earnings.netProfitMargin > 15} />
              <Metric label="Net Profit" value={`₹${(fund.earnings.netProfit / 1000).toFixed(1)}K Cr`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Financial Health + Ownership */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Heart className="h-4 w-4 text-bear" /> Financial Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Metric label="Debt/Equity" value={fund.health.debtToEquity.toFixed(2)} good={fund.health.debtToEquity < 0.5} bad={fund.health.debtToEquity > 2} />
              <Metric label="Current Ratio" value={fund.health.currentRatio.toFixed(2)} good={fund.health.currentRatio > 1.5} bad={fund.health.currentRatio < 1} />
              <Metric label="Quick Ratio" value={fund.health.quickRatio.toFixed(2)} />
              <Metric label="Int. Coverage" value={`${fund.health.interestCoverage.toFixed(1)}x`} good={fund.health.interestCoverage > 5} bad={fund.health.interestCoverage < 2} />
              <Metric label="Total Debt" value={`₹${(fund.health.totalDebt / 1000).toFixed(1)}K Cr`} />
              <Metric label="Free Cash Flow" value={`₹${(fund.health.freeCashFlow / 1000).toFixed(1)}K Cr`} good={fund.health.freeCashFlow > 0} bad={fund.health.freeCashFlow < 0} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-ai" /> Ownership & Quality
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="Promoter" value={`${fund.ownership.promoterHolding.toFixed(1)}%`} sub={`${fund.ownership.promoterHoldingChange > 0 ? '+' : ''}${fund.ownership.promoterHoldingChange.toFixed(1)}%`} good={fund.ownership.promoterHoldingChange > 0} bad={fund.ownership.promoterHoldingChange < -0.5} />
              <Metric label="FII" value={`${fund.ownership.fiiHolding.toFixed(1)}%`} sub={`${fund.ownership.fiiHoldingChange > 0 ? '+' : ''}${fund.ownership.fiiHoldingChange.toFixed(1)}%`} good={fund.ownership.fiiHoldingChange > 0} bad={fund.ownership.fiiHoldingChange < -1.5} />
              <Metric label="DII" value={`${fund.ownership.diiHolding.toFixed(1)}%`} sub={`${fund.ownership.diiHoldingChange > 0 ? '+' : ''}${fund.ownership.diiHoldingChange.toFixed(1)}%`} />
              <Metric label="Institutional" value={`${fund.ownership.institutionalHolding.toFixed(1)}%`} good={fund.ownership.institutionalHolding > 30} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quarterly Results */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-warn" /> Quarterly Results
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border/40">
                <tr className="text-left font-mono text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-2">Quarter</th>
                  <th className="px-3 py-2 text-right">Revenue (Cr)</th>
                  <th className="px-3 py-2 text-right">Net Profit (Cr)</th>
                  <th className="px-3 py-2 text-right">EPS</th>
                  <th className="px-3 py-2 text-right">Rev QoQ</th>
                  <th className="px-3 py-2 text-right">Profit QoQ</th>
                  <th className="px-3 py-2 text-right">Margin</th>
                  <th className="px-3 py-2 text-center">Surprise</th>
                </tr>
              </thead>
              <tbody className="font-mono tnum">
                {fund.quarterly.map((q: any, i: number) => (
                  <tr key={i} className="border-b border-border/20 hover:bg-info/5">
                    <td className="px-3 py-2 font-bold text-foreground">{q.quarter}</td>
                    <td className="px-3 py-2 text-right">{q.revenue.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{q.netProfit.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₹{q.eps.toFixed(2)}</td>
                    <td className={cn('px-3 py-2 text-right', q.revenueGrowthQoQ >= 0 ? 'text-bull' : 'text-bear')}>{q.revenueGrowthQoQ >= 0 ? '+' : ''}{q.revenueGrowthQoQ.toFixed(1)}%</td>
                    <td className={cn('px-3 py-2 text-right', q.profitGrowthQoQ >= 0 ? 'text-bull' : 'text-bear')}>{q.profitGrowthQoQ >= 0 ? '+' : ''}{q.profitGrowthQoQ.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right">{q.margin.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center">
                      <Badge className={cn('text-[9px]', q.surprise === 'BEAT' ? 'bg-bull/15 text-bull' : q.surprise === 'MISS' ? 'bg-bear/15 text-bear' : 'bg-muted/40 text-muted-foreground')}>
                        {q.surprise} {q.surprisePct > 0 ? '+' : ''}{q.surprisePct.toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Strengths + Weaknesses */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="border-bull/30 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-bull">✓ Strengths</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {score.strengths.map((s: string, i: number) => (
                <li key={i} className="flex gap-2 text-foreground/90"><span className="text-bull">▸</span> {s}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="border-bear/30 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-bear">⚠ Weaknesses</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {score.weaknesses.map((w: string, i: number) => (
                <li key={i} className="flex gap-2 text-foreground/90"><span className="text-bear">▸</span> {w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* AI Stock Story */}
      <Card className="accent-ai border-ai/30 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-ai" />
              <span className="text-gradient-ai font-bold">AI STOCK STORY</span>
            </span>
            <Button size="sm" variant="outline" onClick={onGenerateStory} disabled={storyLoading} className="border-ai/30 text-ai hover:bg-ai/10">
              {storyLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              {story ? 'Regenerate' : 'Generate Story'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!story && !storyLoading && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Click "Generate Story" to get a plain-English explanation of {fund.profile.name} — what it does, how it's performing, and whether it's interesting.
            </div>
          )}
          {storyLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-ai" />
              <span className="ml-2 text-xs text-muted-foreground">Writing the story...</span>
            </div>
          )}
          {story && !storyLoading && (
            <div className="space-y-3">
              {story.oneLiner && (
                <div className="rounded-lg border border-ai/20 bg-ai/5 p-2 text-sm font-medium text-foreground">
                  {story.oneLiner}
                </div>
              )}
              {story.narrative && (
                <div className="text-xs leading-relaxed text-foreground/90">
                  {story.narrative.split('\n').map((p: string, i: number) => <p key={i} className="mb-2">{p}</p>)}
                </div>
              )}
              {story.forBeginners && (
                <div className="rounded-lg border border-info/20 bg-info/5 p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase text-info">For Beginners</div>
                  <p className="text-xs text-foreground/80">{story.forBeginners}</p>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {story.greenFlags?.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase text-bull">🟢 Green Flags</div>
                    <ul className="space-y-0.5 text-[11px] text-foreground/80">
                      {story.greenFlags.map((f: string, i: number) => <li key={i}>✓ {f}</li>)}
                    </ul>
                  </div>
                )}
                {story.redFlags?.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase text-bear">🔴 Red Flags</div>
                    <ul className="space-y-0.5 text-[11px] text-foreground/80">
                      {story.redFlags.map((f: string, i: number) => <li key={i}>⚠ {f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              {story.shouldYouInvest && (
                <div className="rounded-lg border border-warn/20 bg-warn/5 p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase text-warn">Should You Invest?</div>
                  <p className="text-xs text-foreground/80">{story.shouldYouInvest}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// HELPER COMPONENTS
// ============================================================
function ScoreGauge({ value, rating }: { value: number; rating: string }) {
  const color = value > 65 ? '#34d399' : value > 45 ? '#fbbf24' : '#fb7185';
  const radius = 32;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="relative inline-flex flex-col items-center">
      <svg width="80" height="80" className="-rotate-90" style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}>
        <circle cx="40" cy="40" r={radius} stroke="#1c2330" strokeWidth="6" fill="none" />
        <circle cx="40" cy="40" r={radius} stroke={color} strokeWidth="6" fill="none" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <div className="absolute flex flex-col items-center pt-1">
        <span className="text-xl font-bold" style={{ color }}>{value}</span>
        <span className="text-[8px] uppercase text-muted-foreground">{rating}</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value > 65 ? 'bg-bull' : value > 45 ? 'bg-warn' : 'bg-bear';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full transition-all duration-500', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="w-6 text-right font-mono text-foreground">{value}</span>
    </div>
  );
}

function Metric({ label, value, sub, good, bad }: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className={cn('rounded border p-2', good ? 'border-bull/30 bg-bull/5' : bad ? 'border-bear/30 bg-bear/5' : 'border-border/40 bg-muted/20')}>
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-sm font-bold', good ? 'text-bull' : bad ? 'text-bear' : 'text-foreground')}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
