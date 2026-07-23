'use client';

import { memo, useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge } from '../shared/badges';
import { ConfluenceCard } from './confluence-card';
import { Trophy, ChevronRight, Lock, TrendingUp, TrendingDown, Newspaper, Target, Shield, Zap, Plus, Check, X, Loader2, Activity, Users, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/lib/odss/types';
import { VIEW_ONLY } from '@/lib/view-only';

function OpportunityTableInner({ onSelect }: { onSelect?: (rec: Recommendation) => void }) {
  const { topRecommendations, liveQuotes, conviction, takenTrades, confluence, indexControl, nifty } = useODSS();
  const niftyControl = indexControl?.['NIFTY'] ?? null;
  const recs = topRecommendations;
  const convictionPicks = conviction?.convictionPicks ?? [];
  const watchlist = conviction?.watchlist ?? [];
  const newsShockPicks = conviction?.newsShockPicks ?? [];
  // v3: stable per-side books emitted directly by the conviction engine.
  const stableCE = conviction?.cePicks ?? null;
  const stablePE = conviction?.pePicks ?? null;

  // NIFTY permanent confluence
  const niftyConfluence = useMemo(() => {
    if (!confluence || confluence.length === 0) return null;
    return confluence.find((c: any) => c.symbol === 'NIFTY') ?? null;
  }, [confluence]);
  const niftyQuote = nifty;

  // Set of symbols currently taken (active trades)
  const takenSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const t of takenTrades ?? []) {
      if (t.status === 'ACTIVE') s.add(t.symbol);
    }
    return s;
  }, [takenTrades]);

  // Build CE and PE lists. v3: if the engine emits stable per-side books, use
  // them verbatim (already stable + best-2 flagged). Otherwise fall back to the
  // legacy derivation from convictionPicks + watchlist + topRecommendations.
  const cePicks = useMemo(() => {
    if (stableCE && stableCE.length > 0) return stableCE.slice(0, 5);
    const ce = convictionPicks.filter((p: any) => p.direction === 'CE');
    const ceWatch = watchlist.filter((p: any) => p.direction === 'CE');
    const ceRecs = recs.filter((r) => r.direction === 'CE').map(r => ({
      symbol: r.symbol, sector: r.sector, direction: 'CE' as const,
      convictionScore: r.opportunity?.totalScore ?? 0,
      currentPrice: liveQuotes[r.symbol]?.ltp ?? 0,
      entrySignal: 'WAIT' as const, entryZoneLow: 0, entryZoneHigh: 0,
      stopLoss: 0, riskRewardRatio: 0, locked: false, lockMinutesLeft: 0,
      technicalHealth: 50, trendScore: 0, newsBoost: 0, newsHeadlines: [],
      consecutiveTop10: 0, stability: 'MODERATE' as const, stabilityScore: 50,
      hasEarningsNews: false, newsMomentum: 'NEUTRAL' as const,
      optionChainSignal: 'NEUTRAL', optionChainArrow: '◆' as const,
      pcr: undefined, callWritingTrend: undefined, putWritingTrend: undefined,
      delta: undefined, deltaArrow: '◆' as const, deltaChangePct: 0,
      decision: 'HOLD', decisionReason: 'Awaiting conviction engine',
      rank: 0, technicalScore: 0, optionChainScore: 0, originalScore: 0,
      confidence: 50,
    }));
    // Combine: conviction picks first, then watchlist, then recs (deduped)
    const seen = new Set<string>();
    const result: any[] = [];
    for (const p of [...ce, ...ceWatch, ...ceRecs]) {
      if (!seen.has(p.symbol)) { seen.add(p.symbol); result.push(p); }
    }
    return result.slice(0, 5);
  }, [stableCE, convictionPicks, watchlist, recs, liveQuotes]);

  const pePicks = useMemo(() => {
    if (stablePE && stablePE.length > 0) return stablePE.slice(0, 5);
    const pe = convictionPicks.filter((p: any) => p.direction === 'PE');
    const peWatch = watchlist.filter((p: any) => p.direction === 'PE');
    const peRecs = recs.filter((r) => r.direction === 'PE').map(r => ({
      symbol: r.symbol, sector: r.sector, direction: 'PE' as const,
      convictionScore: r.opportunity?.totalScore ?? 0,
      currentPrice: liveQuotes[r.symbol]?.ltp ?? 0,
      entrySignal: 'WAIT' as const, entryZoneLow: 0, entryZoneHigh: 0,
      stopLoss: 0, riskRewardRatio: 0, locked: false, lockMinutesLeft: 0,
      technicalHealth: 50, trendScore: 0, newsBoost: 0, newsHeadlines: [],
      consecutiveTop10: 0, stability: 'MODERATE' as const, stabilityScore: 50,
      hasEarningsNews: false, newsMomentum: 'NEUTRAL' as const,
      optionChainSignal: 'NEUTRAL', optionChainArrow: '◆' as const,
      pcr: undefined, callWritingTrend: undefined, putWritingTrend: undefined,
      delta: undefined, deltaArrow: '◆' as const, deltaChangePct: 0,
      decision: 'HOLD', decisionReason: 'Awaiting conviction engine',
      rank: 0, technicalScore: 0, optionChainScore: 0, originalScore: 0,
      confidence: 50,
    }));
    const seen = new Set<string>();
    const result: any[] = [];
    for (const p of [...pe, ...peWatch, ...peRecs]) {
      if (!seen.has(p.symbol)) { seen.add(p.symbol); result.push(p); }
    }
    return result.slice(0, 5);
  }, [stablePE, convictionPicks, watchlist, recs, liveQuotes]);

  // ALWAYS show organized view
  return (
    <div className="space-y-3">
      {/* NIFTY 50 — Permanent Benchmark Tracker (ALWAYS shows, even without confluence) */}
      <Card className="border-info/30 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
              <Activity className="h-4 w-4 text-info" />
              <span className="text-info text-base font-bold">NIFTY 50 — BENCHMARK</span>
              <span className="rounded bg-info/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-info">PERMANENT</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {niftyQuote ? `₹${niftyQuote.ltp.toFixed(2)} ${niftyQuote.changePct >= 0 ? '▲' : '▼'} ${Math.abs(niftyQuote.changePct).toFixed(2)}%` : '—'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {(() => {
            const biasDir = niftyControl ? (niftyControl.bias === 'SHORT' ? 'PE' : 'CE') : (niftyQuote && niftyQuote.changePct < -0.5 ? 'PE' : 'CE');
            return (
              <div className="mb-2 flex items-center gap-2">
                <DirectionBadge direction={biasDir} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {biasDir === 'CE' ? 'Bullish bias (buy calls on dips)' : 'Bearish bias (buy puts on rallies)'}
                </span>
              </div>
            );
          })()}
          {niftyControl ? (
            <div className="space-y-1.5 rounded-md border border-border/40 bg-card/30 p-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground"><Users className="h-3 w-3" /> Who's in control</span>
                <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
                  niftyControl.controller === 'BUYERS' ? 'bg-bull/20 text-bull' : niftyControl.controller === 'SELLERS' ? 'bg-bear/20 text-bear' : 'bg-muted/30 text-muted-foreground')}>
                  {niftyControl.controller} {niftyControl.strength}%
                </span>
              </div>
              {niftyControl.evidence?.[0] && <div className="font-mono text-[9px] leading-snug text-foreground/80">{niftyControl.evidence[0]}</div>}
              <div className="flex flex-wrap gap-1 font-mono text-[9px] text-muted-foreground">
                <span className="rounded bg-bull/10 px-1 py-0.5 text-bull">Sup {niftyControl.supportStrike}</span>
                <span className="rounded bg-bear/10 px-1 py-0.5 text-bear">Res {niftyControl.resistanceStrike}</span>
                <span className="rounded bg-muted/20 px-1 py-0.5">Max pain {niftyControl.maxPain}</span>
                <span className="rounded bg-muted/20 px-1 py-0.5">PCR {Number(niftyControl.pcr).toFixed(2)}</span>
                <span className="rounded bg-muted/20 px-1 py-0.5">{String(niftyControl.gammaRegime).toLowerCase()}</span>
              </div>
              {niftyControl.trap && (
                <div className="flex items-start gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-1 font-mono text-[9px] text-amber-600">
                  <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />{niftyControl.trapNote}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-muted/30 bg-muted/5 p-2 text-center font-mono text-[9px] text-muted-foreground">
              NIFTY order-flow read loading — fetching option chain from Dhan…
            </div>
          )}
        </CardContent>
      </Card>

      {/* NEWS SHOCKERS — Separate prominent section */}
      {newsShockPicks.length > 0 && (
        <Card className="border-bear/40 bg-gradient-to-br from-bear/10 to-transparent backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-mono tracking-wide">
                <Zap className="h-4 w-4 text-bear animate-pulse" />
                <span className="text-bear text-base font-bold">NEWS SHOCKERS</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-bear/80">
                {newsShockPicks.length} ACTIVE · PE OPPORTUNITIES
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {newsShockPicks.map((pick: any) => {
              const q = liveQuotes[pick.symbol];
              const rec = recs.find((r) => r.symbol === pick.symbol);
              return (
                <div key={`shock-${pick.symbol}`} className={cn('cursor-pointer rounded-lg border p-2.5 transition-all hover:bg-bear/5', pick.ivCaution ? 'border-amber/30 bg-amber/5' : 'border-bear/30 bg-bear/5')} onClick={() => rec && onSelect?.(rec)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-sans text-sm font-bold text-foreground">{pick.symbol}</span>
                      <DirectionBadge direction="PE" />
                      <span className="rounded bg-bear/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bear">{pick.shockAgeMinutes}m ago</span>
                      {pick.ivCaution && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700">⚠ IV HIGH</span>}
                    </div>
                    <div className="font-mono text-sm font-bold text-foreground">₹{q?.ltp.toFixed(2) ?? pick.currentPrice.toFixed(2)}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tnum', pick.convictionScore >= 70 ? 'bg-bear/20 text-bear' : 'bg-warn/20 text-warn')}>{pick.convictionScore}</span>
                    <span className={cn('flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest', pick.entrySignal === 'ENTER_NOW' ? 'bg-bear/20 text-bear border border-bear/30' : 'bg-warn/20 text-warn border border-warn/30')}>
                      <Zap className="h-3 w-3" />{pick.entrySignal === 'ENTER_NOW' ? 'PE ENTER' : 'WAIT (IV HIGH)'}
                    </span>
                  </div>
                  <div className="mt-1.5 border-t border-border/10 pt-1.5">
                    <div className="flex items-start gap-1 font-mono text-[9px] leading-snug text-bear">
                      <Zap className="mt-0.5 h-2.5 w-2.5 shrink-0" /><span className="line-clamp-2">{pick.shockTrigger}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* CE & PE PICKS — Side by side (no scrolling needed) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* CE — BULLISH PICKS (Top 5) */}
        <Card className="border-bull/30 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-bull" />
                <span className="text-bull text-base font-bold">CE — BULLISH</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-bull/80">
                {cePicks.length} CALLS
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {cePicks.length === 0 && (
              <div className="py-6 text-center font-mono text-xs text-muted-foreground">
                No bullish (CE) setups yet. Engine scanning...
              </div>
            )}
            {cePicks.map((pick: any, idx: number) => {
              const q = liveQuotes[pick.symbol];
              const rec = recs.find((r) => r.symbol === pick.symbol);
              const pickConfluence = confluence?.find((c: any) => c.symbol === pick.symbol);
              const isTaken = takenSymbols.has(pick.symbol);
              return (
                <SimplePickCard
                  key={`ce-${pick.symbol}`}
                  pick={pick}
                  idx={idx}
                  q={q}
                  rec={rec}
                  isTaken={isTaken}
                  onSelect={onSelect}
                  pickConfluence={pickConfluence}
                />
              );
            })}
          </CardContent>
        </Card>

        {/* PE — BEARISH PICKS (Top 5) */}
        <Card className="border-bear/30 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
                <TrendingDown className="h-4 w-4 text-bear" />
                <span className="text-bear text-base font-bold">PE — BEARISH</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-bear/80">
                {pePicks.length} PUTS
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {pePicks.length === 0 && (
              <div className="py-6 text-center font-mono text-xs text-muted-foreground">
                No bearish (PE) setups yet. Engine scanning...
              </div>
            )}
            {pePicks.map((pick: any, idx: number) => {
              const q = liveQuotes[pick.symbol];
              const rec = recs.find((r) => r.symbol === pick.symbol);
              const pickConfluence = confluence?.find((c: any) => c.symbol === pick.symbol);
              const isTaken = takenSymbols.has(pick.symbol);
              return (
                <SimplePickCard
                  key={`pe-${pick.symbol}`}
                  pick={pick}
                  idx={idx}
                  q={q}
                  rec={rec}
                  isTaken={isTaken}
                  onSelect={onSelect}
                  pickConfluence={pickConfluence}
                />
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Simple Pick Card — shows pick info + confluence + take trade
// ============================================================

function SimplePickCard({ pick, idx, q, rec, isTaken, onSelect, pickConfluence }: {
  pick: any;
  idx: number;
  q: { ltp: number; changePct: number } | undefined;
  rec: Recommendation | undefined;
  isTaken: boolean;
  onSelect?: (rec: Recommendation) => void;
  pickConfluence?: any;
}) {
  const [showTakeForm, setShowTakeForm] = useState(false);
  const [entryPriceInput, setEntryPriceInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTakeTrade = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const ltp = q?.ltp ?? pick.currentPrice ?? 0;
      const defaultEntry = ltp > 0 ? (ltp * 0.02).toFixed(2) : '';
      const entryPrice = parseFloat(entryPriceInput || defaultEntry);
      if (entryPrice <= 0) {
        setError('Invalid entry price');
        setSubmitting(false);
        return;
      }
      const res = await fetch('/api/odss/taken-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: pick.symbol, direction: pick.direction, entryPrice, entryUnderlying: q?.ltp, sector: pick.sector }),
      });
      if (!res.ok) throw new Error('Failed to take trade');
      setShowTakeForm(false);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  }, [q, pick, entryPriceInput]);

  const signalConfig = getSignalConfig(pick.entrySignal);

  return (
    <div
      className={cn(
        'cursor-pointer rounded-lg border p-2.5 transition-all hover:bg-info/5',
        pick.locked ? 'border-ai/40 bg-gradient-to-br from-ai/10 to-transparent'
          : pick.entrySignal === 'ENTER_NOW' ? 'border-bull/30 bg-bull/5' : 'border-border/40 bg-card/30',
      )}
      onClick={() => rec && onSelect?.(rec)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-6 w-6 items-center justify-center rounded font-mono text-xs font-bold', idx === 0 ? 'bg-warn/20 text-warn' : 'bg-muted/30 text-muted-foreground')}>{idx + 1}</span>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-sans text-sm font-bold tracking-wide text-foreground">{pick.symbol}</span>
              <DirectionBadge direction={pick.direction} />
              {pick.isPrime && <span className="flex items-center gap-0.5 rounded bg-warn/25 px-1 py-0.5 font-mono text-[9px] font-bold text-warn" title={pick.whyBest}><Trophy className="h-2.5 w-2.5" />PRIME</span>}
              {pick.locked && <span className="flex items-center gap-0.5 rounded bg-ai/20 px-1 py-0.5 font-mono text-[9px] font-bold text-ai"><Lock className="h-2.5 w-2.5" />{pick.lockMinutesLeft}m</span>}
              {isTaken && <span className="rounded bg-bull/20 px-1 py-0.5 font-mono text-[9px] font-bold text-bull"><Check className="inline h-2 w-2" /> TAKEN</span>}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{pick.sector}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm font-bold text-foreground">₹{q?.ltp.toFixed(2) ?? pick.currentPrice?.toFixed(2) ?? '—'}</div>
          <div className={cn('font-mono text-[10px] font-bold', q && q.changePct >= 0 ? 'text-bull' : 'text-bear')}>{q ? `${q.changePct >= 0 ? '▲' : '▼'} ${Math.abs(q.changePct).toFixed(2)}%` : ''}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase text-muted-foreground">CONV</span>
        <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tnum', pick.convictionScore >= 70 ? 'bg-bull/20 text-bull' : pick.convictionScore >= 55 ? 'bg-warn/20 text-warn' : 'bg-bear/20 text-bear')}>{pick.convictionScore?.toFixed(0) ?? '?'}</span>
        {pick.technicalHealth !== undefined && (
          <span className={cn('rounded px-1 py-0.5 font-mono text-[8px] font-bold', pick.technicalHealth >= 60 ? 'bg-bull/15 text-bull' : pick.technicalHealth >= 50 ? 'bg-warn/15 text-warn' : 'bg-bear/15 text-bear')}>TH {pick.technicalHealth}</span>
        )}
        {pick.roomScore !== undefined && (
          <span className={cn('rounded px-1 py-0.5 font-mono text-[8px] font-bold', pick.roomScore >= 60 ? 'bg-bull/15 text-bull' : pick.roomScore >= 45 ? 'bg-warn/15 text-warn' : 'bg-bear/15 text-bear')} title={pick.roomNotes?.join(' · ')}>ROOM {pick.roomScore}</span>
        )}
        {pick.ocScore !== undefined && (
          <span className={cn('rounded px-1 py-0.5 font-mono text-[8px] font-bold', pick.ocScore >= 60 ? 'bg-bull/15 text-bull' : pick.ocScore >= 45 ? 'bg-warn/15 text-warn' : 'bg-bear/15 text-bear')} title={[`OI: ${pick.oiAction}`, `entry: ${pick.ocEntrySignal}`, `exit: ${pick.ocExitSignal}`, ...(pick.ocNotes ?? [])].join(' · ')}>OC {pick.ocScore}</span>
        )}
        <span className={cn('flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold tracking-widest', signalConfig.bg)}>
          {signalConfig.icon}{signalConfig.label}
        </span>
        {/* Take Trade button */}
        {!VIEW_ONLY && !isTaken && !showTakeForm && (
          <Button size="sm" variant="ghost" className="ml-auto h-6 gap-0.5 font-mono text-[9px] tracking-widest text-bull hover:bg-bull/10" onClick={(e) => { e.stopPropagation(); setShowTakeForm(true); }}>
            <Plus className="h-3 w-3" /> TAKE
          </Button>
        )}
        {isTaken && (
          <span className="ml-auto font-mono text-[9px] text-bull"><Check className="inline h-2 w-2" /> TAKEN</span>
        )}
      </div>
      {/* Inline take-trade form */}
      {showTakeForm && (
        <div className="mt-2 flex items-center gap-2 rounded border border-bull/30 bg-bull/5 p-2" onClick={(e) => e.stopPropagation()}>
          <span className="font-mono text-[10px] text-muted-foreground">Entry ₹:</span>
          <Input
            type="number"
            value={entryPriceInput}
            onChange={(e) => setEntryPriceInput(e.target.value)}
            placeholder={(q?.ltp ? (q.ltp * 0.02).toFixed(2) : '100')}
            className="h-7 w-20 font-mono text-xs"
          />
          <Button size="sm" className="h-7 gap-1 font-mono text-[10px]" onClick={handleTakeTrade} disabled={submitting}>
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} CONFIRM
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowTakeForm(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      {/* Intraday Confluence Card */}
      {pickConfluence && (
        <ConfluenceCard confluence={pickConfluence} />
      )}
      {/* Entry-timing reason (why ENTER / WAIT / AVOID) */}
      {pick.entrySignalReason && (
        <div className="mt-1 font-mono text-[9px] italic leading-snug text-muted-foreground">
          {pick.entrySignal === 'ENTER_NOW' ? '✓' : pick.entrySignal === 'AVOID' ? '✕' : '⏳'} {pick.entrySignalReason}
        </div>
      )}
      {/* WHO'S IN CONTROL — real order-flow read */}
      {pick.controller && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/10 pt-1.5">
          <span
            className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold',
              pick.controller === 'BUYERS' ? 'bg-bull/20 text-bull' : pick.controller === 'SELLERS' ? 'bg-bear/20 text-bear' : 'bg-muted/30 text-muted-foreground')}
            title={pick.controlEvidence?.join(' · ')}
          >
            <Users className="h-2.5 w-2.5" />{pick.controller} {pick.controlStrength ?? 0}%
          </span>
          {pick.controlEvidence?.[0] && (
            <span className="line-clamp-1 font-mono text-[9px] text-muted-foreground">{pick.controlEvidence[0]}</span>
          )}
        </div>
      )}
      {pick.trap && (
        <div className="mt-1 flex items-start gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[9px] text-amber-600">
          <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" /><span>{pick.trapNote ?? 'Order flow contradicts price — trap risk'}</span>
        </div>
      )}
      {/* News headlines */}
      {pick.newsHeadlines?.length > 0 && (
        <div className="mt-1.5 border-t border-border/10 pt-1.5">
          {pick.newsHeadlines.slice(0, 2).map((h: string, i: number) => (
            <div key={i} className="flex items-start gap-1 font-mono text-[9px] leading-snug text-muted-foreground">
              <Newspaper className="mt-0.5 h-2.5 w-2.5 shrink-0 text-purple-400" />
              <span className="line-clamp-1">{h}</span>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div className="mt-1.5 rounded bg-bear/10 px-2 py-1 font-mono text-[9px] text-bear">⚠ {error}</div>
      )}
    </div>
  );
}

function getSignalConfig(signal: string) {
  switch (signal) {
    case 'ENTER_NOW': return { label: 'ENTER NOW', bg: 'bg-bull/20 text-bull border border-bull/30', icon: <Zap className="h-3 w-3" /> };
    case 'AVOID': return { label: 'AVOID', bg: 'bg-bear/20 text-bear border border-bear/30', icon: <Shield className="h-3 w-3" /> };
    default: return { label: 'WAIT', bg: 'bg-warn/20 text-warn border border-warn/30', icon: <Target className="h-3 w-3" /> };
  }
}

export const OpportunityTable = memo(OpportunityTableInner, (prev, next) => {
  return prev.onSelect === next.onSelect;
});
