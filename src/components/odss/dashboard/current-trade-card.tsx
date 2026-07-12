'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge, StateBadge, STATE_ORDER } from '../shared/badges';
import { Target, TrendingUp, LogOut, Activity, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TradeStateName } from '@/lib/odss/types';

export function CurrentTradeCard() {
  const { activeTrade, liveQuotes, enterTrade, exitTrade, topRecommendations } = useODSS();
  const q = activeTrade ? liveQuotes[activeTrade.symbol] : null;

  if (!activeTrade) {
    const topEnter = topRecommendations.find((r) => r.decision.decision === 'ENTER');
    return (
      <Card className="border-dashed border-border/60 bg-card/40 backdrop-blur-sm accent-info">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide text-muted-foreground">
            <Activity className="h-4 w-4 text-info" />
            <span className="text-gradient-bull text-base font-bold">ACTIVE TRADE</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-5 text-center">
            <div className="rounded-full border border-border/60 bg-muted/40 p-3">
              <Target className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-2 font-mono text-xs font-semibold uppercase tracking-widest text-foreground/85">
              No active trade
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/90">
              Engine is monitoring the market for high-probability setups.
            </p>
            {topEnter && (
              <div className="mt-3 w-full rounded-lg border border-bull/40 bg-bull/10 p-3 backdrop-blur-sm">
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-bull">
                  ▸ Top candidate ready
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm font-bold text-foreground">
                      {topEnter.symbol}
                    </span>
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {topEnter.sector}
                    </span>
                  </div>
                  <DirectionBadge direction={topEnter.direction} />
                </div>
                <Button
                  size="sm"
                  className="mt-2 w-full border-bull/40 bg-bull/20 font-mono text-[11px] tracking-widest text-bull hover:bg-bull/30 hover:text-bull"
                  variant="outline"
                  onClick={() => enterTrade(topEnter.symbol, topEnter.direction)}
                >
                  ARM ENTRY @ {topEnter.strike.primaryStrike} · ₹
                  {topEnter.strike.primaryLTP.toFixed(0)}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const t = activeTrade;
  const pnl = t.pnl ?? 0;
  const rMult = t.rMultiple ?? 0;
  const pnlPositive = pnl >= 0;

  return (
    <Card
      className={cn(
        'border bg-card/50 backdrop-blur-sm transition-all',
        pnlPositive ? 'border-bull/50 glow-bull' : 'border-bear/50 glow-bear'
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
            <Activity className="h-4 w-4 text-info" />
            <span className={cn('text-base font-bold', pnlPositive ? 'text-gradient-bull' : 'text-gradient-bear')}>ACTIVE TRADE</span>
          </span>
          <StateBadge state={t.state} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Symbol + direction */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold tracking-wide text-foreground">
                {t.symbol}
              </span>
              <DirectionBadge direction={t.direction} />
            </div>
            {t.entryStrike && (
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                STRIKE {t.entryStrike} · {t.entryType?.replace('_', ' ')}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Underlying
            </div>
            <div className="font-mono text-sm font-bold tnum text-foreground">
              {q?.ltp.toFixed(2) ?? t.currentUnderlying?.toFixed(2)}
            </div>
          </div>
        </div>

        {/* PnL + R */}
        <div className="grid grid-cols-2 gap-2">
          <div
            className={cn(
              'rounded-lg border p-2 transition-all',
              pnlPositive
                ? 'border-bull/40 bg-bull/10 glow-bull'
                : 'border-bear/40 bg-bear/10 glow-bear'
            )}
          >
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Unrealized PnL
            </div>
            <div
              className={cn(
                'font-mono text-lg font-bold tnum',
                pnlPositive ? 'text-bull text-glow-bull' : 'text-bear text-glow-bear'
              )}
            >
              {pnlPositive ? '+' : ''}₹{pnl.toFixed(0)}
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Target className="h-3 w-3" /> R Multiple
            </div>
            <div
              className={cn(
                'font-mono text-lg font-bold tnum transition-all',
                rMult >= 0 ? 'text-bull text-glow-bull' : 'text-bear text-glow-bear'
              )}
            >
              {rMult >= 0 ? '+' : ''}
              {rMult.toFixed(2)}R
            </div>
          </div>
        </div>

        {/* Entry / SL / TPs */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
          <Row label="Entry (opt)" value={`₹${t.entryPrice?.toFixed(2) ?? '—'}`} />
          <Row label="Current (opt)" value={`₹${t.currentPrice?.toFixed(2) ?? '—'}`} />
          <Row label="Entry (und)" value={t.underlyingEntryPrice?.toFixed(2) ?? '—'} />
          <Row label="SL (und)" value={t.stopLoss?.toFixed(2) ?? '—'} valueClass="text-bear" />
          <Row label="TP1" value={t.tp1?.toFixed(2) ?? '—'} valueClass="text-bull" />
          <Row label="TP2" value={t.tp2?.toFixed(2) ?? '—'} valueClass="text-bull" />
        </div>

        {/* Hold time */}
        {t.entryTime && (
          <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <Clock className="h-3 w-3" />
            HELD {Math.round((Date.now() - t.entryTime) / 60000)} MIN · ENTERED{' '}
            {new Date(t.entryTime).toLocaleTimeString('en-IN', { hour12: false })}
          </div>
        )}

        {/* Risk/Reward visual */}
        <RiskRewardBar trade={t} currentUnderlying={q?.ltp ?? t.currentUnderlying ?? 0} />

        {/* State timeline */}
        <StateTimeline history={t.stateHistory} currentState={t.state} />

        {/* AI explanation */}
        {t.aiExplanation && (
          <div className="rounded-lg border border-ai/40 bg-ai/10 p-2 backdrop-blur-sm">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-ai">
              ▸ AI Coach
            </div>
            <p className="mt-0.5 text-xs text-foreground/90">{t.aiExplanation}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="flex-1 border-bear/40 bg-bear/20 font-mono text-[11px] tracking-widest text-bear hover:bg-bear/30 hover:text-bear"
            onClick={() => exitTrade('Manual exit by user')}
          >
            <LogOut className="mr-1 h-3 w-3" /> EXIT TRADE
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn('tnum font-medium text-foreground', valueClass)}>{value}</span>
    </div>
  );
}

function RiskRewardBar({
  trade,
  currentUnderlying,
}: {
  trade: any;
  currentUnderlying: number;
}) {
  if (!trade.underlyingEntryPrice || !trade.stopLoss || !trade.tp1) return null;
  const entry = trade.underlyingEntryPrice;
  const sl = trade.stopLoss;
  const tp1 = trade.tp1;
  const tp2 = trade.tp2 ?? tp1;
  const tp3 = trade.tp3 ?? tp2;
  const min = Math.min(sl, currentUnderlying, entry) * 0.999;
  const max = Math.max(tp3, currentUnderlying, entry) * 1.001;
  const range = max - min || 1;
  const pct = (v: number) => ((v - min) / range) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>Risk / Reward</span>
        <span>SL → TP3</span>
      </div>
      <div className="relative h-6 w-full rounded border border-border/60 bg-muted/40">
        {/* SL zone */}
        <div
          className="absolute top-0 h-full bg-bear/70 shadow-[0_0_6px_rgba(251,113,133,0.6)]"
          style={{ left: `${pct(sl)}%`, width: '2px' }}
        />
        {/* Entry */}
        <div
          className="absolute top-0 h-full bg-info/70"
          style={{ left: `${pct(entry)}%`, width: '2px' }}
        />
        {/* TP1 */}
        <div
          className="absolute top-0 h-full bg-bull/60"
          style={{ left: `${pct(tp1)}%`, width: '2px' }}
        />
        {/* TP2 */}
        <div
          className="absolute top-0 h-full bg-bull/80"
          style={{ left: `${pct(tp2)}%`, width: '2px' }}
        />
        {/* TP3 */}
        <div
          className="absolute top-0 h-full bg-bull shadow-[0_0_6px_rgba(52,211,153,0.7)]"
          style={{ left: `${pct(tp3)}%`, width: '2px' }}
        />
        {/* Current price marker */}
        <div
          className="absolute top-0 h-full w-1 bg-foreground shadow-[0_0_8px_rgba(230,237,243,0.8)]"
          style={{ left: `${pct(currentUnderlying)}%` }}
        />
        {/* Labels */}
        <span
          className="absolute -bottom-4 font-mono text-[9px] text-bear"
          style={{ left: `${pct(sl)}%`, transform: 'translateX(-50%)' }}
        >
          SL
        </span>
        <span
          className="absolute -bottom-4 font-mono text-[9px] text-info"
          style={{ left: `${pct(entry)}%`, transform: 'translateX(-50%)' }}
        >
          E
        </span>
        <span
          className="absolute -bottom-4 font-mono text-[9px] text-bull"
          style={{ left: `${pct(tp1)}%`, transform: 'translateX(-50%)' }}
        >
          1
        </span>
        <span
          className="absolute -bottom-4 font-mono text-[9px] text-bull"
          style={{ left: `${pct(tp2)}%`, transform: 'translateX(-50%)' }}
        >
          2
        </span>
        <span
          className="absolute -bottom-4 font-mono text-[9px] text-bull"
          style={{ left: `${pct(tp3)}%`, transform: 'translateX(-50%)' }}
        >
          3
        </span>
      </div>
    </div>
  );
}

function StateTimeline({
  history,
  currentState,
}: {
  history: { state: TradeStateName; timestamp: number; reason: string }[];
  currentState: TradeStateName;
}) {
  const reached = new Set(history.map((h) => h.state));
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        ▸ Trade Lifecycle
      </div>
      <div className="flex items-center gap-0.5">
        {STATE_ORDER.map((s) => {
          const isReached = reached.has(s);
          const isCurrent = s === currentState;
          return (
            <div key={s} className="flex-1">
              <div
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  isCurrent
                    ? 'bg-bull shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                    : isReached
                      ? 'bg-bull/70'
                      : 'bg-muted'
                )}
              />
              <div
                className={cn(
                  'mt-0.5 text-center font-mono text-[7px] leading-tight tracking-widest',
                  isCurrent ? 'font-bold text-bull' : 'text-muted-foreground'
                )}
              >
                {s === 'WAITING_ENTRY' ? 'WAIT' : s === 'COMPLETE' ? 'DONE' : s.slice(0, 4)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
