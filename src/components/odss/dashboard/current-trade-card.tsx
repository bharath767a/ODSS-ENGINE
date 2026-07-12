'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useODSS } from '@/hooks/use-odss';
import { DirectionBadge, StateBadge, STATE_ORDER } from '../shared/badges';
import { Target, Shield, TrendingUp, LogOut, Activity, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TradeStateName } from '@/lib/odss/types';

export function CurrentTradeCard() {
  const { activeTrade, liveQuotes, enterTrade, exitTrade, topRecommendations } = useODSS();
  const q = activeTrade ? liveQuotes[activeTrade.symbol] : null;

  if (!activeTrade) {
    // Show the top candidate ready for entry
    const topEnter = topRecommendations.find((r) => r.decision.decision === 'ENTER');
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-slate-500" /> Active Trade</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="rounded-full bg-slate-100 p-3"><Target className="h-6 w-6 text-slate-400" /></div>
            <p className="mt-2 text-sm font-medium text-slate-600">No active trade</p>
            <p className="text-xs text-slate-400">The engine is monitoring the market for high-probability setups.</p>
            {topEnter && (
              <div className="mt-4 w-full rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="text-xs font-medium text-emerald-700">Top candidate ready</div>
                <div className="mt-1 flex items-center justify-between">
                  <div>
                    <span className="font-bold">{topEnter.symbol}</span>
                    <span className="ml-2 text-xs text-slate-500">{topEnter.sector}</span>
                  </div>
                  <DirectionBadge direction={topEnter.direction} />
                </div>
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => enterTrade(topEnter.symbol, topEnter.direction)}
                >
                  Arm Entry @ {topEnter.strike.primaryStrike} (₹{topEnter.strike.primaryLTP.toFixed(0)})
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const t = activeTrade;
  const isLong = t.direction === 'CE';
  const pnl = t.pnl ?? 0;
  const rMult = t.rMultiple ?? 0;
  const pnlPositive = pnl >= 0;

  return (
    <Card className={cn('border-2', pnlPositive ? 'border-emerald-200' : 'border-rose-200')}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Activity className="h-4 w-4 text-slate-500" /> Active Trade</span>
          <StateBadge state={t.state} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Symbol + direction */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{t.symbol}</span>
              <DirectionBadge direction={t.direction} />
            </div>
            {t.entryStrike && <div className="text-xs text-slate-500">Strike {t.entryStrike} • {t.entryType?.replace('_', ' ')}</div>}
          </div>
          <div className="text-right">
            <div className="font-mono text-xs text-slate-500">Underlying</div>
            <div className="font-mono text-sm font-semibold">{q?.ltp.toFixed(2) ?? t.currentUnderlying?.toFixed(2)}</div>
          </div>
        </div>

        {/* PnL + R */}
        <div className="grid grid-cols-2 gap-2">
          <div className={cn('rounded-lg border p-2', pnlPositive ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50')}>
            <div className="flex items-center gap-1 text-[10px] text-slate-500"><TrendingUp className="h-3 w-3" /> Unrealized PnL</div>
            <div className={cn('font-mono text-base font-bold', pnlPositive ? 'text-emerald-700' : 'text-rose-700')}>
              {pnlPositive ? '+' : ''}₹{pnl.toFixed(0)}
            </div>
          </div>
          <div className="rounded-lg border p-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-500"><Target className="h-3 w-3" /> R Multiple</div>
            <div className={cn('font-mono text-base font-bold', rMult >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
              {rMult >= 0 ? '+' : ''}{rMult.toFixed(2)}R
            </div>
          </div>
        </div>

        {/* Entry / SL / TPs */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <Row label="Entry (opt)" value={`₹${t.entryPrice?.toFixed(2) ?? '-'}`} />
          <Row label="Current (opt)" value={`₹${t.currentPrice?.toFixed(2) ?? '-'}`} />
          <Row label="Entry (und)" value={t.underlyingEntryPrice?.toFixed(2) ?? '-'} />
          <Row label="SL (und)" value={t.stopLoss?.toFixed(2) ?? '-'} valueClass="text-rose-600" />
          <Row label="TP1" value={t.tp1?.toFixed(2) ?? '-'} valueClass="text-emerald-600" />
          <Row label="TP2" value={t.tp2?.toFixed(2) ?? '-'} valueClass="text-emerald-600" />
        </div>

        {/* Hold time */}
        {t.entryTime && (
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <Clock className="h-3 w-3" />
            Held for {Math.round((Date.now() - t.entryTime) / 60000)} min • entered {new Date(t.entryTime).toLocaleTimeString()}
          </div>
        )}

        {/* Risk/Reward visual */}
        <RiskRewardBar trade={t} currentUnderlying={q?.ltp ?? t.currentUnderlying ?? 0} />

        {/* State timeline */}
        <StateTimeline history={t.stateHistory} currentState={t.state} />

        {/* AI explanation */}
        {t.aiExplanation && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2">
            <div className="text-[10px] font-medium uppercase text-violet-600">AI Coach</div>
            <p className="mt-0.5 text-xs text-slate-700">{t.aiExplanation}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="flex-1"
            onClick={() => exitTrade('Manual exit by user')}
          >
            <LogOut className="mr-1 h-3 w-3" /> Exit Trade
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cn('font-mono font-medium', valueClass)}>{value}</span>
    </div>
  );
}

function RiskRewardBar({ trade, currentUnderlying }: { trade: any; currentUnderlying: number }) {
  if (!trade.underlyingEntryPrice || !trade.stopLoss || !trade.tp1) return null;
  const isLong = trade.direction === 'CE';
  const entry = trade.underlyingEntryPrice;
  const sl = trade.stopLoss;
  const tp1 = trade.tp1;
  const tp2 = trade.tp2 ?? tp1;
  const tp3 = trade.tp3 ?? tp2;
  const min = Math.min(sl, currentUnderlying, entry) * 0.999;
  const max = Math.max(tp3, currentUnderlying, entry) * 1.001;
  const range = max - min;
  const pct = (v: number) => ((v - min) / range) * 100;
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] text-slate-400"><span>Risk / Reward</span><span>SL → TP3</span></div>
      <div className="relative h-6 w-full rounded border bg-slate-50">
        {/* SL zone */}
        <div className="absolute top-0 h-full bg-rose-200/60" style={{ left: `${pct(sl)}%`, width: '2px' }} />
        {/* Entry */}
        <div className="absolute top-0 h-full bg-slate-400" style={{ left: `${pct(entry)}%`, width: '2px' }} />
        {/* TP1 */}
        <div className="absolute top-0 h-full bg-emerald-300/60" style={{ left: `${pct(tp1)}%`, width: '2px' }} />
        {/* TP2 */}
        <div className="absolute top-0 h-full bg-emerald-400/70" style={{ left: `${pct(tp2)}%`, width: '2px' }} />
        {/* TP3 */}
        <div className="absolute top-0 h-full bg-emerald-500" style={{ left: `${pct(tp3)}%`, width: '2px' }} />
        {/* Current price marker */}
        <div
          className="absolute top-0 h-full w-1 bg-slate-900"
          style={{ left: `${pct(currentUnderlying)}%` }}
        />
        {/* Labels */}
        <span className="absolute -bottom-4 text-[9px] text-rose-600" style={{ left: `${pct(sl)}%`, transform: 'translateX(-50%)' }}>SL</span>
        <span className="absolute -bottom-4 text-[9px] text-slate-500" style={{ left: `${pct(entry)}%`, transform: 'translateX(-50%)' }}>E</span>
        <span className="absolute -bottom-4 text-[9px] text-emerald-600" style={{ left: `${pct(tp1)}%`, transform: 'translateX(-50%)' }}>1</span>
        <span className="absolute -bottom-4 text-[9px] text-emerald-600" style={{ left: `${pct(tp2)}%`, transform: 'translateX(-50%)' }}>2</span>
        <span className="absolute -bottom-4 text-[9px] text-emerald-600" style={{ left: `${pct(tp3)}%`, transform: 'translateX(-50%)' }}>3</span>
      </div>
    </div>
  );
}

function StateTimeline({ history, currentState }: { history: { state: TradeStateName; timestamp: number; reason: string }[]; currentState: TradeStateName }) {
  const reached = new Set(history.map((h) => h.state));
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase text-slate-400">Trade Lifecycle</div>
      <div className="flex items-center gap-0.5">
        {STATE_ORDER.map((s, i) => {
          const isReached = reached.has(s);
          const isCurrent = s === currentState;
          return (
            <div key={s} className="flex-1">
              <div
                className={cn(
                  'h-1.5 rounded-full',
                  isCurrent ? 'bg-slate-900' : isReached ? 'bg-emerald-500' : 'bg-slate-200'
                )}
              />
              <div className={cn('mt-0.5 text-center text-[7px] leading-tight', isCurrent ? 'font-bold text-slate-800' : 'text-slate-400')}>
                {s === 'WAITING_ENTRY' ? 'WAIT' : s === 'COMPLETE' ? 'DONE' : s.slice(0, 4)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
