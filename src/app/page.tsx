'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { JournalTable } from '@/components/odss/journal/journal-table';
import { AnalyticsDashboard } from '@/components/odss/analytics/analytics-dashboard';
import { ConfigPanel } from '@/components/odss/config/config-panel';
import { ReplayValidationPanel } from '@/components/odss/replay/replay-panel';
import { Activity, LayoutDashboard, Trophy, BookOpen, BarChart3, Settings, RefreshCw, Radio, Zap, FlaskConical } from 'lucide-react';
import type { Recommendation } from '@/lib/odss/types';

export default function ODSSPage() {
  const { connected, lastUpdate, resetSimulator, manualScan, topRecommendations } = useODSS();
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-slate-900 to-slate-700 text-white shadow-sm">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900">ODSS <span className="text-slate-400 font-normal">— Options Decision Support System</span></h1>
              <p className="text-[10px] text-slate-500">Indian Market • NSE Equity & Index Options • Decision Engine v1.0</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connected ? 'default' : 'secondary'} className="gap-1">
              <Radio className={`h-3 w-3 ${connected ? 'animate-pulse text-emerald-500' : ''}`} />
              {connected ? 'LIVE' : 'CONNECTING…'}
            </Badge>
            {lastUpdate > 0 && (
              <span className="hidden text-[10px] text-slate-400 sm:inline">
                Updated {new Date(lastUpdate).toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={manualScan} title="Trigger manual scan">
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="outline" onClick={handleReset} title="Reset simulator">
              <Zap className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4">
        <Tabs defaultValue="dashboard">
          <TabsList className="mb-4 grid w-full grid-cols-2 sm:grid-cols-6">
            <TabsTrigger value="dashboard" className="gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" /> Dashboard</TabsTrigger>
            <TabsTrigger value="opportunities" className="gap-1.5"><Trophy className="h-3.5 w-3.5" /> Opportunities</TabsTrigger>
            <TabsTrigger value="journal" className="gap-1.5"><BookOpen className="h-3.5 w-3.5" /> Journal</TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Analytics</TabsTrigger>
            <TabsTrigger value="validation" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" /> Validation</TabsTrigger>
            <TabsTrigger value="config" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> Config</TabsTrigger>
          </TabsList>

          {/* Guardrail status bar (always visible) */}
          <div className="mb-4"><GuardrailBar /></div>

          {/* DASHBOARD TAB */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Left column: Market + Sector */}
              <div className="space-y-4">
                <MarketOverview />
                <SectorGrid />
              </div>
              {/* Center column: Opportunities + Current Trade */}
              <div className="space-y-4">
                <CurrentTradeCard />
                <OpportunityTable onSelect={handleSelect} />
              </div>
              {/* Right column: AI + Votes + Log */}
              <div className="space-y-4">
                <AIExplainer rec={selectedRec ?? topRecommendations[0]} />
                <EngineVotesPanel rec={selectedRec ?? topRecommendations[0]} />
                <DecisionLog />
              </div>
            </div>
          </TabsContent>

          {/* OPPORTUNITIES TAB */}
          <TabsContent value="opportunities" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <OpportunityTable onSelect={handleSelect} />
              </div>
              <div className="space-y-4">
                <AIExplainer rec={selectedRec ?? topRecommendations[0]} />
                <EngineVotesPanel rec={selectedRec ?? topRecommendations[0]} />
              </div>
            </div>
          </TabsContent>

          {/* JOURNAL TAB */}
          <TabsContent value="journal" className="space-y-4">
            <JournalTable />
          </TabsContent>

          {/* ANALYTICS TAB */}
          <TabsContent value="analytics" className="space-y-4">
            <AnalyticsDashboard />
          </TabsContent>

          {/* VALIDATION TAB */}
          <TabsContent value="validation" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ReplayValidationPanel />
              </div>
              <div>
                <DecisionLog />
              </div>
            </div>
          </TabsContent>

          {/* CONFIG TAB */}
          <TabsContent value="config" className="space-y-4">
            <ConfigPanel />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t bg-white">
        <div className="mx-auto max-w-[1600px] px-4 py-3">
          <div className="flex flex-col items-center justify-between gap-1 text-[10px] text-slate-400 sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-500">ODSS Decision Engine</span>
              <span>•</span>
              <span>Not an auto-trading bot. Human remains final decision maker.</span>
            </div>
            <div className="flex items-center gap-2">
              <span>22 phases • 12 engines • Phase 1-21 implemented</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Recommendation drawer */}
      <RecommendationDrawer rec={selectedRec} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
