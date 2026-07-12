'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/lib/odss/types';

export default function ODSSPage() {
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

  const handleSelect = (rec: Recommendation) => {
    setSelectedRec(rec);
    setDrawerOpen(true);
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
      {/* ============================= HEADER ============================= */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-gradient-to-r from-bull/5 via-transparent to-ai/5 bg-[#0a0e14]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4 px-4 py-2">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-bull/30 bg-gradient-to-br from-bull/25 via-ai/15 to-info/20 shadow-[0_0_20px_-4px_rgba(52,211,153,0.5)]">
              <Activity className="h-4 w-4 text-bull" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight">
                <span className="text-gradient-bull">ODSS</span>
                <span className="ml-1.5 font-normal text-muted-foreground">
                  · Options Decision Support System
                </span>
              </h1>
              <p className="font-mono text-[10px] tracking-wide text-muted-foreground">
                NSE · INDEX &amp; EQUITY OPTIONS · DECISION ENGINE v1.0
              </p>
            </div>
          </div>

          {/* Center status cluster */}
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
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={manualScan}
              title="Trigger manual scan"
              className="h-8 border-border/60 bg-card/40 font-mono text-[11px] text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <RefreshCw className="mr-1 h-3 w-3" /> SCAN
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReset}
              title="Reset simulator"
              className="h-8 border-border/60 bg-card/40 font-mono text-[11px] text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <Zap className="mr-1 h-3 w-3" /> RESET
            </Button>
          </div>
        </div>
      </header>

      {/* Colorful accent bar */}
      <div className="rainbow-bar h-0.5 w-full" />

      {/* ============================= TICKER TAPE ============================= */}
      <TickerTape />

      {/* ============================= MAIN ============================= */}
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-3">
        <Tabs defaultValue="dashboard">
          <TabsList className="mb-3 grid h-9 w-full grid-cols-2 border border-border/60 bg-card/40 backdrop-blur sm:grid-cols-7">
            <TerminalTabsTrigger value="dashboard" icon={<LayoutDashboard className="h-3.5 w-3.5" />} label="Dashboard" />
            <TerminalTabsTrigger value="opportunities" icon={<Trophy className="h-3.5 w-3.5" />} label="Opportunities" />
            <TerminalTabsTrigger value="journal" icon={<BookOpen className="h-3.5 w-3.5" />} label="Journal" />
            <TerminalTabsTrigger value="analytics" icon={<BarChart3 className="h-3.5 w-3.5" />} label="Analytics" />
            <TerminalTabsTrigger value="validation" icon={<FlaskConical className="h-3.5 w-3.5" />} label="Validation" />
            <TerminalTabsTrigger value="credentials" icon={<KeyRound className="h-3.5 w-3.5" />} label="Data Sources" />
            <TerminalTabsTrigger value="config" icon={<Settings className="h-3.5 w-3.5" />} label="Config" />
          </TabsList>

          {/* Guardrail bar — always visible */}
          <div className="mb-3">
            <GuardrailBar />
          </div>

          {/* DASHBOARD TAB */}
          <TabsContent value="dashboard" className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              {/* Left */}
              <div className="space-y-3">
                <MarketOverview />
                <SectorGrid />
              </div>
              {/* Center */}
              <div className="space-y-3">
                <CurrentTradeCard />
                <OpportunityTable onSelect={handleSelect} />
              </div>
              {/* Right */}
              <div className="space-y-3">
                <AIExplainer rec={selectedRec ?? topRecommendations[0]} />
                <EngineVotesPanel rec={selectedRec ?? topRecommendations[0]} />
                <DecisionLog />
              </div>
            </div>
          </TabsContent>

          {/* OPPORTUNITIES TAB */}
          <TabsContent value="opportunities" className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <OpportunityTable onSelect={handleSelect} />
              </div>
              <div className="space-y-3">
                <AIExplainer rec={selectedRec ?? topRecommendations[0]} />
                <EngineVotesPanel rec={selectedRec ?? topRecommendations[0]} />
              </div>
            </div>
          </TabsContent>

          {/* JOURNAL TAB */}
          <TabsContent value="journal" className="space-y-3">
            <JournalTable />
          </TabsContent>

          {/* ANALYTICS TAB */}
          <TabsContent value="analytics" className="space-y-3">
            <AnalyticsDashboard />
          </TabsContent>

          {/* VALIDATION TAB */}
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

          {/* DATA SOURCES / CREDENTIALS TAB */}
          <TabsContent value="credentials" className="space-y-3">
            <div className="mx-auto max-w-2xl">
              <CredentialsPanel />
            </div>
          </TabsContent>

          {/* CONFIG TAB */}
          <TabsContent value="config" className="space-y-3">
            <ConfigPanel />
          </TabsContent>
        </Tabs>
      </main>

      {/* ============================= FOOTER ============================= */}
      <footer className="mt-auto border-t border-border/60 bg-[#0a0e14]/80 backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-4 py-2">
          <div className="flex flex-col items-center justify-between gap-1 font-mono text-[10px] tracking-wide text-muted-foreground sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="text-foreground/80">ODSS DECISION ENGINE</span>
              <span className="text-border">·</span>
              <span>NOT AN AUTO-TRADING BOT · HUMAN IS FINAL DECISION MAKER</span>
            </div>
            <div className="flex items-center gap-2">
              <span>22 PHASES · 12 ENGINES · v1.1</span>
            </div>
          </div>
        </div>
      </footer>

      <RecommendationDrawer rec={selectedRec} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}

/* ---------------- Small header primitives ---------------- */

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
    bull: 'border-bull/40 bg-bull/10 text-bull',
    bear: 'border-bear/40 bg-bear/10 text-bear',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    info: 'border-info/40 bg-info/10 text-info',
    muted: 'border-border bg-card/40 text-muted-foreground',
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
      className="gap-1.5 rounded-none border-transparent bg-transparent font-mono text-[11px] font-medium tracking-wider text-muted-foreground transition-colors data-[state=active]:bg-bull/10 data-[state=active]:text-bull data-[state=active]:shadow-[inset_0_-2px_0_0_rgba(52,211,153,0.6)]"
    >
      {icon}
      {label}
    </TabsTrigger>
  );
}
