'use client';

import { useState, Component, ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useODSS } from '@/hooks/use-odss';
import { MarketOverview } from '@/components/odss/dashboard/market-overview';
import { SectorGrid } from '@/components/odss/dashboard/sector-grid';
import { OpportunityTable } from '@/components/odss/dashboard/opportunity-table';
import { CurrentTradeCard } from '@/components/odss/dashboard/current-trade-card';
import { EngineVotesPanel } from '@/components/odss/dashboard/engine-votes-panel';
import { DecisionLog } from '@/components/odss/dashboard/decision-log';
import { AIExplainer } from '@/components/odss/dashboard/ai-explainer';
import { RecommendationDrawer } from '@/components/odss/dashboard/recommendation-drawer';
import { GuardrailBar } from '@/components/odss/dashboard/guardrail-bar';
import { TickerTape } from '@/components/odss/dashboard/ticker-tape';
import { JournalTable } from '@/components/odss/journal/journal-table';
import { AnalyticsDashboard } from '@/components/odss/analytics/analytics-dashboard';
import { ConfigPanel } from '@/components/odss/config/config-panel';
import { ReplayValidationPanel } from '@/components/odss/replay/replay-panel';
import { CredentialsPanel } from '@/components/odss/credentials/credentials-panel';
import { StockAnalysisTab } from '@/components/odss/fundamentals/stock-analysis-tab';
import { MutualFundsTab } from '@/components/odss/mutual-funds/mutual-funds-tab';
import { MarketBriefPanel } from '@/components/odss/market-brief/market-brief-panel';
import { HealthMonitorPanel, HealthBadge } from '@/components/odss/health/health-monitor';
import { LearningPanel } from '@/components/odss/learning/learning-panel';
import { StrategyLabPanel } from '@/components/odss/strategy-lab/strategy-lab-panel';
import { PaperTradingPanel } from '@/components/odss/paper-trading/paper-trading-panel';
import { StockSearch } from '@/components/odss/search/stock-search';
import { SeasonalCalendarView } from '@/components/odss/fundamentals/seasonal-components';
import { SwingTab } from '@/components/odss/fundamentals/swing-tab';
import { SectorPerformancePanel } from '@/components/odss/fundamentals/sector-performance-panel';
import { NewsAlerts } from '@/components/odss/alerts/news-alerts';
import { NewsPopup } from '@/components/odss/alerts/news-popup';
import { NewsShockers } from '@/components/odss/dashboard/news-shockers';
import { TakenPositions } from '@/components/odss/dashboard/taken-positions';
import { VIEW_ONLY } from '@/lib/view-only';
import {
  Activity,
  LayoutDashboard,
  Trophy,
  BookOpen,
  BarChart3,
  Settings,
  RefreshCw,
  Radio,
  Zap,
  FlaskConical,
  Circle,
  Cpu,
  KeyRound,
  Building2,
  TrendingUp,
  Calendar,
  Brain,
  Dna,
  Globe2,
  Newspaper,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/lib/odss/types';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#f8f4ff] p-8">
          <Card className="max-w-md p-6 border-purple-200 bg-white">
            <h2 className="mb-2 text-sm font-bold text-purple-700">ODSS Dashboard Error</h2>
            <p className="mb-4 text-xs text-muted-foreground">{this.state.error}</p>
            <Button onClick={() => window.location.reload()} size="sm">
              Reload Dashboard
            </Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ODSSPage() {
  return (
    <ErrorBoundary>
      <ODSSDashboard />
    </ErrorBoundary>
  );
}

function ODSSDashboard() {
  const {
    connected,
    lastUpdate,
    resetSimulator,
    manualScan,
    topRecommendations,
    recording,
    guardrails,
  } = useODSS();
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [swingStock, setSwingStock] = useState<string | null>(null);

  const handleSelect = (rec: Recommendation) => {
    setSelectedRec(rec);
    setDrawerOpen(true);
  };

  const handleSwingSelect = (symbol: string) => {
    setSwingStock(symbol);
    setActiveTab('stocks');
  };

  const handleSearchSelect = (symbol: string) => {
    setSwingStock(symbol);
    setActiveTab('stocks');
  };

  const handleReset = async () => {
    await resetSimulator();
    setTimeout(() => manualScan(), 500);
  };

  const guardrailBlocked =
    guardrails != null &&
    (guardrails.remainingTrades === 0 ||
      Math.max(0, -guardrails.realizedPnlToday) >= guardrails.maxDailyLossRupees ||
      guardrails.realizedPnlToday >= guardrails.profitCapRupees);

  return (
    <div className="flex min-h-screen flex-col">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-purple-100 bg-gradient-to-r from-purple-50 via-white/80 to-violet-50 bg-white/85 backdrop-blur-xl shadow-card-soft">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-purple-200 bg-gradient-to-br from-purple-100 via-violet-100 to-purple-50 shadow-[0_4px_16px_-4px_rgba(124,58,237,0.35)]">
              <Activity className="h-4 w-4 text-purple-600" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/30 to-white/50" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight">
                <span className="text-gradient-ai">ODSS</span>
                <span className="ml-1.5 font-normal text-muted-foreground">
                  · Options Decision Support System
                </span>
              </h1>
              <p className="font-mono text-[10px] tracking-wide text-muted-foreground">
                NSE · INDEX &amp; EQUITY OPTIONS · DECISION ENGINE v1.0
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <StatusChip
              icon={connected ? <Radio className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
              label={connected ? 'LIVE' : 'CONNECTING'}
              tone={connected ? 'bull' : 'warn'}
              pulse={connected}
            />
            <StatusChip
              icon={<Cpu className="h-3 w-3" />}
              label={recording ? 'REC' : 'IDLE'}
              tone={recording ? 'bear' : 'muted'}
              pulse={recording}
            />
            {guardrails && (
              <StatusChip
                label={
                  guardrailBlocked
                    ? `GUARDRAIL · BLOCKED`
                    : `${guardrails.remainingTrades} ENTRIES LEFT`
                }
                tone={guardrailBlocked ? 'bear' : 'info'}
              />
            )}
            {lastUpdate > 0 && (
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground tnum">
                {new Date(lastUpdate).toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            )}
            <HealthBadge />
            <StockSearch onSelect={handleSearchSelect} />
          </div>

          <div className="flex items-center gap-1.5">
            {VIEW_ONLY ? (
              <span className="flex items-center gap-1 rounded border border-info/40 bg-info/10 px-2 py-1 font-mono text-[10px] font-bold tracking-widest text-info">
                👁 VIEW ONLY · LIVE
              </span>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={manualScan}
                  title="Trigger manual scan"
                  className="h-8 border-purple-200 bg-white/70 font-mono text-[11px] text-muted-foreground hover:bg-purple-50 hover:text-foreground"
                >
                  <RefreshCw className="mr-1 h-3 w-3" /> SCAN
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  title="Reset simulator"
                  className="h-8 border-purple-200 bg-white/70 font-mono text-[11px] text-muted-foreground hover:bg-purple-50 hover:text-foreground"
                >
                  <Zap className="mr-1 h-3 w-3" /> RESET
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="rainbow-bar h-0.5 w-full" />

      <TickerTape />

      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-3">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-3 grid h-9 w-full grid-cols-2 border border-purple-100 bg-white/70 backdrop-blur sm:grid-cols-[repeat(14,minmax(0,1fr))]">
            <TerminalTabsTrigger value="dashboard" icon={<LayoutDashboard className="h-3.5 w-3.5" />} label="Dashboard" />
            <TerminalTabsTrigger value="opportunities" icon={<Trophy className="h-3.5 w-3.5" />} label="Opportunities" />
            <TerminalTabsTrigger value="brief" icon={<Newspaper className="h-3.5 w-3.5" />} label="Market Brief" />
            <TerminalTabsTrigger value="stocks" icon={<Building2 className="h-3.5 w-3.5" />} label="Stock Analysis" />
            <TerminalTabsTrigger value="swing" icon={<Zap className="h-3.5 w-3.5" />} label="Swing" />
            <TerminalTabsTrigger value="seasonal" icon={<Calendar className="h-3.5 w-3.5" />} label="Seasonal" />
            <TerminalTabsTrigger value="learning" icon={<Brain className="h-3.5 w-3.5" />} label="Learning" />
            <TerminalTabsTrigger value="strategylab" icon={<Dna className="h-3.5 w-3.5" />} label="Strategy Lab" />
            <TerminalTabsTrigger value="papertrade" icon={<Wallet className="h-3.5 w-3.5" />} label="Paper Trade" />
            <TerminalTabsTrigger value="journal" icon={<BookOpen className="h-3.5 w-3.5" />} label="Journal" />
            <TerminalTabsTrigger value="analytics" icon={<BarChart3 className="h-3.5 w-3.5" />} label="Analytics" />
            <TerminalTabsTrigger value="validation" icon={<FlaskConical className="h-3.5 w-3.5" />} label="Validation" />
            {!VIEW_ONLY && <TerminalTabsTrigger value="credentials" icon={<KeyRound className="h-3.5 w-3.5" />} label="Data Sources" />}
            {!VIEW_ONLY && <TerminalTabsTrigger value="config" icon={<Settings className="h-3.5 w-3.5" />} label="Config" />}
          </TabsList>

          <div className="mb-3">
            <GuardrailBar />
          </div>

          {/* DASHBOARD */}
          <TabsContent value="dashboard" className="space-y-3">
            <MarketBriefPanel />
            <HealthMonitorPanel />
            <LearningPanel />
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-3">
                <MarketOverview />
                <SectorGrid />
                <SectorPerformancePanel />
              </div>
              <div className="space-y-3">
                <CurrentTradeCard />
                <TakenPositions />
                <OpportunityTable onSelect={handleSelect} />
                <NewsAlerts />
              </div>
              <div className="space-y-3">
                <AIExplainer rec={selectedRec ?? topRecommendations[0]} />
                <EngineVotesPanel rec={selectedRec ?? topRecommendations[0]} />
                <DecisionLog />
              </div>
            </div>
          </TabsContent>

          {/* OPPORTUNITIES */}
          <TabsContent value="opportunities" className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                <OpportunityTable onSelect={handleSelect} />
              </div>
              <div className="space-y-3">
                <TakenPositions />
                <NewsShockers />
                <AIExplainer rec={selectedRec ?? topRecommendations[0]} />
                <EngineVotesPanel rec={selectedRec ?? topRecommendations[0]} />
              </div>
            </div>
          </TabsContent>

          {/* MARKET BRIEF */}
          <TabsContent value="brief" className="space-y-3">
            <MarketBriefPanel />
          </TabsContent>

          {/* STOCK ANALYSIS */}
          <TabsContent value="stocks" className="space-y-3">
            <StockAnalysisTab initialSymbol={swingStock} />
          </TabsContent>

          {/* SWING */}
          <TabsContent value="swing" className="space-y-3">
            <SwingTab onSelect={handleSwingSelect} />
          </TabsContent>

          {/* SEASONAL */}
          <TabsContent value="seasonal" className="space-y-3">
            <SeasonalCalendarView />
          </TabsContent>

          {/* LEARNING */}
          <TabsContent value="learning" className="space-y-3">
            <LearningPanel />
          </TabsContent>

          {/* STRATEGY LAB */}
          <TabsContent value="strategylab" className="space-y-3">
            <StrategyLabPanel />
          </TabsContent>

          {/* PAPER TRADING */}
          <TabsContent value="papertrade" className="space-y-3">
            <PaperTradingPanel />
          </TabsContent>

          {/* JOURNAL */}
          <TabsContent value="journal" className="space-y-3">
            <JournalTable />
          </TabsContent>

          {/* ANALYTICS */}
          <TabsContent value="analytics" className="space-y-3">
            <AnalyticsDashboard />
          </TabsContent>

          {/* VALIDATION */}
          <TabsContent value="validation" className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ReplayValidationPanel />
              </div>
              <div>
                <DecisionLog />
              </div>
            </div>
          </TabsContent>

          {/* DATA SOURCES */}
          <TabsContent value="credentials" className="space-y-3">
            <div className="mx-auto max-w-2xl">
              <CredentialsPanel />
            </div>
          </TabsContent>

          {/* CONFIG */}
          <TabsContent value="config" className="space-y-3">
            <ConfigPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-purple-100 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-4 py-2">
          <div className="flex flex-col items-center justify-between gap-1 font-mono text-[10px] tracking-wide text-muted-foreground sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="text-foreground/80">ODSS DECISION ENGINE</span>
              <span className="text-purple-200">·</span>
              <span>NOT AN AUTO-TRADING BOT · HUMAN IS FINAL DECISION MAKER</span>
            </div>
            <div className="flex items-center gap-2">
              <span>22 PHASES · 12 ENGINES · v1.1</span>
            </div>
          </div>
        </div>
      </footer>

      <RecommendationDrawer rec={selectedRec} open={drawerOpen} onOpenChange={setDrawerOpen} />
      <NewsPopup />
    </div>
  );
}

function StatusChip({
  icon,
  label,
  tone,
  pulse,
}: {
  icon?: React.ReactNode;
  label: string;
  tone: 'bull' | 'bear' | 'warn' | 'info' | 'muted';
  pulse?: boolean;
}) {
  const toneMap = {
    bull: 'border-bull/30 bg-bull/10 text-bull',
    bear: 'border-bear/30 bg-bear/10 text-bear',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    info: 'border-info/30 bg-info/10 text-info',
    muted: 'border-purple-200 bg-purple-50 text-muted-foreground',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[10px] font-semibold tracking-widest',
        toneMap[tone]
      )}
    >
      {icon && <span className={cn(pulse && tone === 'bull' && 'live-dot')}>{icon}</span>}
      {label}
    </span>
  );
}

function TerminalTabsTrigger({
  value,
  icon,
  label,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="gap-1.5 rounded-none border-transparent bg-transparent font-mono text-[11px] font-medium tracking-wider text-muted-foreground transition-colors data-[state=active]:bg-purple-50 data-[state=active]:text-purple-700 data-[state=active]:shadow-[inset_0_-2px_0_0_rgba(124,58,237,0.6)]"
    >
      {icon}
      {label}
    </TabsTrigger>
  );
}
