'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Loader2,
  RefreshCw,
  Newspaper,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Sparkles,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
  Banknote,
  Building2,
  Gauge,
  Sun,
  Moon,
  Clock,
  Zap,
  ShieldAlert,
} from 'lucide-react';

// ============================================================
// Market Brief Panel
// ------------------------------------------------------------
// Fetches /api/odss/market-brief?type=pre|intraday|post and renders
// a complete pre/intraday/post market briefing:
//   - NIFTY / BANKNIFTY / VIX / SENSEX tiles with change %
//   - Market breadth (advances/declines)
//   - AI Summary + AI Prediction (gradient text)
//   - Key Risks list + Key Opportunities list
//   - FII / DII summary
//   - Top gainers / Top losers
//   - Latest news items (with sentiment badges + links)
//   - Sector performance bars
//
// Defaults to "pre" on mount. Includes a refresh button.
// ============================================================

type BriefType = 'pre' | 'intraday' | 'post';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  link?: string;
  timestamp: number;
  category?: string;
}

interface GainerLoserItem {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  changePct: number;
}

interface SectorPerfItem {
  sector: string;
  changePct: number;
  leader: string;
  laggard: string;
  advanceCount: number;
  declineCount: number;
}

interface FiiDiiSummary {
  fiiBuyCrore: number;
  fiiSellCrore: number;
  fiiNetCrore: number;
  diiBuyCrore: number;
  diiSellCrore: number;
  diiNetCrore: number;
  netFlowCrore: number;
  interpretation: string;
}

interface MarketBrief {
  type: BriefType;
  niftyClose: number;
  niftyChange: number;
  niftyChangePct: number;
  bankNiftyClose: number;
  bankNiftyChange: number;
  bankNiftyChangePct: number;
  vix: number;
  vixChange: number;
  sensexClose: number | null;
  sensexChange: number | null;
  sensexChangePct: number | null;
  breadth: { advances: number; declines: number; ratio: number };
  aiSummary: string;
  aiPrediction: string;
  keyRisks: string[];
  keyOpportunities: string[];
  fiiDiiSummary: FiiDiiSummary | null;
  topGainers: GainerLoserItem[];
  topLosers: GainerLoserItem[];
  news: NewsItem[];
  sectorPerformance: SectorPerfItem[];
  source: string;
  updatedAt: number;
}

const BRIEF_TABS: { id: BriefType; label: string; icon: typeof Sun; description: string }[] = [
  { id: 'pre', label: 'Pre-Market', icon: Sun, description: 'Opening setup & overnight cues' },
  { id: 'intraday', label: 'Intraday', icon: Activity, description: 'Live breadth & momentum' },
  { id: 'post', label: 'Post-Market', icon: Moon, description: 'Closing summary & next-day setup' },
];

function formatNum(n: number, decimals = 2): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatSignedPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatSignedChange(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

function formatINR(crore: number): string {
  const sign = crore < 0 ? '-' : '';
  const abs = Math.abs(crore);
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(2)}k Cr`;
  return `${sign}₹${abs.toFixed(0)} Cr`;
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-IN');
}

export function MarketBriefPanel() {
  const [type, setType] = useState<BriefType>('pre');
  const [brief, setBrief] = useState<MarketBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(0);

  const fetchBrief = useCallback(async (t: BriefType) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/odss/market-brief?type=${t}`, { cache: 'no-store' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message ?? `HTTP ${res.status}`);
      }
      const data: MarketBrief = await res.json();
      setBrief(data);
      setLastFetched(Date.now());
    } catch (e) {
      setError((e as Error).message || 'Failed to load market brief');
      setBrief(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Default to "pre" on mount
  useEffect(() => {
    fetchBrief('pre');
  }, [fetchBrief]);

  const handleTabChange = (t: BriefType) => {
    setType(t);
    fetchBrief(t);
  };

  const handleRefresh = () => {
    fetchBrief(type);
  };

  const activeTab = BRIEF_TABS.find((t) => t.id === type)!;

  return (
    <Card className="border-purple-100 bg-white/70 shadow-card-soft backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-purple-200 bg-gradient-to-br from-purple-100 to-violet-50">
              <Newspaper className="h-3.5 w-3.5 text-purple-600" />
            </div>
            <div className="leading-tight">
              <h2 className="text-sm font-bold tracking-tight">
                <span className="text-gradient-ai">Market Brief</span>
              </h2>
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
                {activeTab.description.toUpperCase()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {brief && (
              <span className="hidden items-center gap-1 font-mono text-[10px] tracking-wider text-muted-foreground sm:inline-flex">
                <Clock className="h-3 w-3" />
                {new Date(brief.updatedAt).toLocaleTimeString('en-IN', { hour12: false })}
                <span className="text-purple-200">·</span>
                <span className="text-purple-600">{brief.source}</span>
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={loading}
              className="h-7 border-purple-200 bg-white/70 px-2 font-mono text-[10px] tracking-wider text-purple-700 hover:bg-purple-50 hover:text-purple-800"
            >
              {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              REFRESH
            </Button>
          </div>
        </CardTitle>

        {/* Brief-type tab buttons */}
        <div className="mt-2 flex gap-1.5">
          {BRIEF_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === type;
            return (
              <Button
                key={tab.id}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => handleTabChange(tab.id)}
                disabled={loading}
                className={cn(
                  'h-8 gap-1.5 font-mono text-[11px] tracking-wider transition-all',
                  active
                    ? 'border-purple-300 bg-gradient-to-br from-purple-600 to-violet-600 text-white shadow-[0_2px_8px_-2px_rgba(124,58,237,0.45)]'
                    : 'border-purple-200 bg-white/70 text-purple-700 hover:bg-purple-50 hover:text-purple-800',
                )}
              >
                <Icon className="h-3 w-3" />
                {tab.label.toUpperCase()}
              </Button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Loading state */}
        {loading && !brief && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-purple-600">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground">
              LOADING {type.toUpperCase()} BRIEF...
            </p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-4 text-center">
            <AlertTriangle className="h-6 w-6 text-rose-500" />
            <p className="text-sm font-bold text-rose-700">Brief unavailable</p>
            <p className="font-mono text-[10px] text-rose-600">{error}</p>
            <Button size="sm" variant="outline" onClick={handleRefresh} className="mt-1 border-rose-200 bg-white text-rose-700 hover:bg-rose-50">
              <RefreshCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          </div>
        )}

        {/* Content */}
        {brief && !error && (
          <>
            {/* Index tiles */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <IndexTile
                label="NIFTY 50"
                value={brief.niftyClose}
                change={brief.niftyChange}
                changePct={brief.niftyChangePct}
                icon={<Building2 className="h-3 w-3" />}
              />
              <IndexTile
                label="BANK NIFTY"
                value={brief.bankNiftyClose}
                change={brief.bankNiftyChange}
                changePct={brief.bankNiftyChangePct}
                icon={<Banknote className="h-3 w-3" />}
              />
              <IndexTile
                label="INDIA VIX"
                value={brief.vix}
                change={brief.vixChange}
                changePct={brief.vixChange / 14.5 * 100}
                icon={<Gauge className="h-3 w-3" />}
                vixMode
              />
              {brief.sensexClose !== null && brief.sensexChange !== null && brief.sensexChangePct !== null ? (
                <IndexTile
                  label="SENSEX"
                  value={brief.sensexClose}
                  change={brief.sensexChange}
                  changePct={brief.sensexChangePct}
                  icon={<Activity className="h-3 w-3" />}
                />
              ) : (
                <div className="flex flex-col justify-center rounded-lg border border-purple-100 bg-white/60 p-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">SENSEX</span>
                  <span className="mt-1 text-[10px] text-muted-foreground">feed unavailable</span>
                </div>
              )}
            </div>

            {/* Breadth + FII/DII summary */}
            <div className="grid gap-2 md:grid-cols-2">
              {/* Breadth */}
              <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <Activity className="h-3 w-3 text-purple-500" /> Market Breadth
                  </span>
                  <Badge variant="outline" className="border-purple-200 bg-purple-50 font-mono text-[10px] text-purple-700">
                    A/D {brief.breadth.ratio.toFixed(2)}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex justify-between font-mono text-[10px] tracking-wider">
                      <span className="text-emerald-600">ADVANCES</span>
                      <span className="font-bold text-emerald-700">{brief.breadth.advances}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-rose-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
                        style={{
                          width: `${(brief.breadth.advances / Math.max(1, brief.breadth.advances + brief.breadth.declines)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between font-mono text-[10px] tracking-wider">
                      <span className="text-rose-600">DECLINES</span>
                      <span className="font-bold text-rose-700">{brief.breadth.declines}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className="ml-auto h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600 transition-all"
                        style={{
                          width: `${(brief.breadth.declines / Math.max(1, brief.breadth.advances + brief.breadth.declines)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* FII / DII — REAL NSE provisional numbers, or an honest "unavailable" */}
              {!brief.fiiDiiSummary ? (
                <div className="flex flex-col justify-center rounded-lg border border-purple-100 bg-white/60 p-3">
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <Banknote className="h-3 w-3 text-purple-500" /> FII / DII Activity
                  </span>
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    NSE feed unavailable right now — numbers are shown only when real (published daily ~after close).
                  </span>
                </div>
              ) : (
              <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <Banknote className="h-3 w-3 text-purple-500" /> FII / DII Activity
                    {(brief.fiiDiiSummary as any).asOf && <span className="ml-1 normal-case tracking-normal">({(brief.fiiDiiSummary as any).asOf} · NSE)</span>}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-mono text-[10px]',
                      brief.fiiDiiSummary.netFlowCrore >= 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700',
                    )}
                  >
                    NET {formatINR(brief.fiiDiiSummary.netFlowCrore)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <div className="rounded border border-purple-100 bg-purple-50/40 px-2 py-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>FII</span>
                      <span className={brief.fiiDiiSummary.fiiNetCrore >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                        {formatINR(brief.fiiDiiSummary.fiiNetCrore)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
                      <span>B: {formatINR(brief.fiiDiiSummary.fiiBuyCrore)}</span>
                      <span>S: {formatINR(brief.fiiDiiSummary.fiiSellCrore)}</span>
                    </div>
                  </div>
                  <div className="rounded border border-purple-100 bg-purple-50/40 px-2 py-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>DII</span>
                      <span className={brief.fiiDiiSummary.diiNetCrore >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                        {formatINR(brief.fiiDiiSummary.diiNetCrore)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
                      <span>B: {formatINR(brief.fiiDiiSummary.diiBuyCrore)}</span>
                      <span>S: {formatINR(brief.fiiDiiSummary.diiSellCrore)}</span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] italic leading-tight text-muted-foreground">
                  {brief.fiiDiiSummary.interpretation}
                </p>
              </div>
              )}
            </div>

            {/* AI Summary + Prediction */}
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-purple-200 bg-gradient-to-br from-violet-50 via-white to-purple-50/40 p-3 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.18)]">
                <div className="mb-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-purple-700">
                  <Sparkles className="h-3 w-3" /> AI Summary
                </div>
                <p className="text-xs leading-relaxed text-foreground/90">{brief.aiSummary}</p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-gradient-to-br from-cyan-50 via-white to-violet-50/40 p-3 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.18)]">
                <div className="mb-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-purple-700">
                  <Eye className="h-3 w-3" /> AI Prediction
                </div>
                <p className="text-xs leading-relaxed text-foreground/90">{brief.aiPrediction}</p>
              </div>
            </div>

            {/* Risks + Opportunities */}
            <div className="grid gap-2 md:grid-cols-2">
              <ListBlock
                title="Key Risks"
                icon={<ShieldAlert className="h-3 w-3" />}
                items={brief.keyRisks}
                tone="bear"
              />
              <ListBlock
                title="Key Opportunities"
                icon={<Zap className="h-3 w-3" />}
                items={brief.keyOpportunities}
                tone="bull"
              />
            </div>

            {/* Gainers / Losers */}
            <div className="grid gap-2 md:grid-cols-2">
              <MoversBlock title="Top Gainers" icon={<ArrowUpRight className="h-3 w-3" />} items={brief.topGainers} tone="bull" />
              <MoversBlock title="Top Losers" icon={<ArrowDownRight className="h-3 w-3" />} items={brief.topLosers} tone="bear" />
            </div>

            {/* Sector performance */}
            <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
              <div className="mb-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <Building2 className="h-3 w-3 text-purple-500" /> Sector Performance
              </div>
              <div className="space-y-1.5">
                {brief.sectorPerformance.map((s) => {
                  const maxAbs = Math.max(...brief.sectorPerformance.map((x) => Math.abs(x.changePct)), 0.5);
                  const pct = (s.changePct / maxAbs) * 50; // ±50% width
                  const positive = s.changePct >= 0;
                  return (
                    <div key={s.sector} className="grid grid-cols-[80px_1fr_60px] items-center gap-2 font-mono text-[10px]">
                      <span className="truncate font-semibold text-foreground/80">{s.sector}</span>
                      <div className="relative h-3 rounded bg-purple-50/60">
                        <div className="absolute left-1/2 top-0 h-full w-px bg-purple-200" />
                        <div
                          className={cn(
                            'absolute top-0 h-full rounded transition-all',
                            positive ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-l from-rose-400 to-rose-600',
                          )}
                          style={{
                            width: `${Math.abs(pct)}%`,
                            left: positive ? '50%' : `${50 - Math.abs(pct)}%`,
                          }}
                        />
                      </div>
                      <span className={cn('text-right font-bold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                        {formatSignedPct(s.changePct)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* News list */}
            <div className="rounded-lg border border-purple-100 bg-white/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Newspaper className="h-3 w-3 text-purple-500" /> Latest News
                </span>
                <Badge variant="outline" className="border-purple-200 bg-purple-50 font-mono text-[10px] text-purple-700">
                  {brief.news.length} ITEMS
                </Badge>
              </div>
              <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                {brief.news.map((n) => (
                  <NewsRow key={n.id} item={n} />
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-purple-100 pt-2 font-mono text-[10px] tracking-wider text-muted-foreground">
              <span>
                Updated {lastFetched > 0 ? new Date(lastFetched).toLocaleTimeString('en-IN', { hour12: false }) : '—'}
              </span>
              <span className="text-purple-600">{brief.source}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Sub-components
// ============================================================

function IndexTile({
  label,
  value,
  change,
  changePct,
  icon,
  vixMode = false,
}: {
  label: string;
  value: number;
  change: number;
  changePct: number;
  icon: React.ReactNode;
  vixMode?: boolean;
}) {
  const positive = change >= 0;
  // VIX is inverted — high VIX is bearish
  const displayPositive = vixMode ? change <= 0 : positive;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border p-2 transition-all',
        vixMode
          ? change > 1
            ? 'border-rose-200 bg-rose-50/50'
            : change < -1
              ? 'border-emerald-200 bg-emerald-50/50'
              : 'border-purple-100 bg-white/60'
          : 'border-purple-100 bg-white/60',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {icon}
          {label}
        </span>
        {positive ? (
          <TrendingUp className={cn('h-3 w-3', displayPositive ? 'text-emerald-500' : 'text-rose-500')} />
        ) : (
          <TrendingDown className={cn('h-3 w-3', displayPositive ? 'text-emerald-500' : 'text-rose-500')} />
        )}
      </div>
      <div className="mt-1 font-mono text-base font-bold tabular-nums text-foreground">
        {formatNum(value, vixMode ? 2 : 2)}
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
        <span className={positive ? 'text-emerald-600' : 'text-rose-600'}>
          {formatSignedChange(change)}
        </span>
        <span className={positive ? 'text-emerald-600' : 'text-rose-600'}>
          {formatSignedPct(changePct)}
        </span>
      </div>
    </div>
  );
}

function ListBlock({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  tone: 'bull' | 'bear';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        tone === 'bull' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40',
      )}
    >
      <div
        className={cn(
          'mb-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest',
          tone === 'bull' ? 'text-emerald-700' : 'text-rose-700',
        )}
      >
        {icon}
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-foreground/85">
            <span className={cn('mt-0.5 text-xs', tone === 'bull' ? 'text-emerald-500' : 'text-rose-500')}>
              {tone === 'bull' ? '▲' : '▼'}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoversBlock({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  items: GainerLoserItem[];
  tone: 'bull' | 'bear';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        tone === 'bull' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40',
      )}
    >
      <div
        className={cn(
          'mb-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest',
          tone === 'bull' ? 'text-emerald-700' : 'text-rose-700',
        )}
      >
        {icon}
        {title}
      </div>
      <div className="space-y-1">
        {items.length === 0 && (
          <p className="font-mono text-[10px] text-muted-foreground">No data available</p>
        )}
        {items.map((m) => (
          <div
            key={m.symbol}
            className="flex items-center justify-between rounded border border-purple-100 bg-white/70 px-2 py-1 font-mono text-[11px]"
          >
            <div className="flex flex-col">
              <span className="font-bold text-foreground/90">{m.symbol}</span>
              <span className="truncate text-[9px] text-muted-foreground">{m.name}</span>
            </div>
            <div className="text-right">
              <div className="font-bold tabular-nums text-foreground">₹{formatNum(m.ltp)}</div>
              <div className={cn('text-[10px] tabular-nums', tone === 'bull' ? 'text-emerald-600' : 'text-rose-600')}>
                {formatSignedPct(m.changePct)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  const sentimentConfig = {
    POSITIVE: { color: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
    NEGATIVE: { color: 'border-rose-200 bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
    NEUTRAL: { color: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  } as const;
  const cfg = sentimentConfig[item.sentiment];

  const content = (
    <div className="group flex gap-2 rounded border border-purple-100 bg-white/70 px-2 py-1.5 transition-all hover:border-purple-300 hover:bg-purple-50/40">
      <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', cfg.dot)} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-snug text-foreground/90 group-hover:text-purple-800">{item.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[9px] tracking-wider text-muted-foreground">
          <span>{item.source}</span>
          {item.category && (
            <>
              <span className="text-purple-200">·</span>
              <span className="text-purple-600">{item.category.toUpperCase()}</span>
            </>
          )}
          <span className="text-purple-200">·</span>
          <span>{formatRelativeTime(item.timestamp)}</span>
        </div>
      </div>
      <Badge variant="outline" className={cn('h-fit shrink-0 font-mono text-[9px]', cfg.color)}>
        {item.sentiment}
      </Badge>
    </div>
  );

  if (item.link) {
    return (
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }
  return content;
}
