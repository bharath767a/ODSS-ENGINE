'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Activity, AlertTriangle, Zap } from 'lucide-react';

interface VectorResult {
  score: number;
  label: string;
  value: string;
  arrow: '▲' | '▼' | '◆';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  status: 'OK' | 'NO_DATA';
  reason?: string;
}

interface SymbolConfluence {
  symbol: string;
  direction: 'CE' | 'PE';
  vectors: {
    cvd5m: VectorResult;
    options15m: VectorResult;
    vwap1h: VectorResult;
  };
  overallScore: number;
  alignedCount: number;
  confluenceLevel: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE' | 'NO_DATA';
  divergenceWarning: boolean;
  divergenceNote?: string;
  computedAt: number;
  status: 'OK' | 'NO_DATA';
}

function VectorRow({ name, vector }: { name: string; vector: VectorResult }) {
  const isNoData = vector.status === 'NO_DATA';
  const colorClass =
    isNoData ? 'text-muted-foreground/50' :
    vector.direction === 'BULLISH' ? 'text-bull' :
    vector.direction === 'BEARISH' ? 'text-bear' :
    'text-muted-foreground';
  const scoreBg =
    isNoData ? 'bg-muted/20 text-muted-foreground/50' :
    vector.score >= 70 ? 'bg-bull/20 text-bull' :
    vector.score >= 50 ? 'bg-warn/20 text-warn' :
    'bg-bear/20 text-bear';
  return (
    <div className="flex items-center gap-2 py-0.5 text-[10px] font-mono">
      <span className="w-14 shrink-0 text-muted-foreground/80">{name}</span>
      <span className={cn('w-12 shrink-0 font-bold', colorClass)}>
        {isNoData ? '—' : vector.value}
      </span>
      <span className={cn('w-3 shrink-0 font-bold', colorClass)}>
        {isNoData ? '◆' : vector.arrow}
      </span>
      <span className={cn('flex-1 truncate', isNoData ? 'italic' : 'text-foreground/80')}>
        {isNoData ? 'NO DATA' : vector.label}
      </span>
      <span className={cn('w-7 shrink-0 rounded px-1 py-0.5 text-center font-bold tnum', scoreBg)}>
        {isNoData ? '—' : vector.score}
      </span>
    </div>
  );
}

function ConfluenceCardInner({ confluence }: { confluence: SymbolConfluence }) {
  const isNoData = confluence.status === 'NO_DATA';
  const level = confluence.confluenceLevel;
  const scoreBg =
    isNoData ? 'from-muted/30 to-muted/10 text-muted-foreground border-muted/30' :
    level === 'STRONG' ? 'from-bull/30 to-bull/10 text-bull border-bull/40' :
    level === 'MODERATE' ? 'from-warn/30 to-warn/10 text-warn border-warn/40' :
    level === 'WEAK' ? 'from-orange-500/20 to-orange-500/5 text-orange-600 border-orange-500/30' :
    'from-bear/30 to-bear/10 text-bear border-bear/40';
  const levelLabel =
    isNoData ? 'NO DATA' :
    level === 'STRONG' ? `⚡ 3/3 ALIGNED — STRONG` :
    level === 'MODERATE' ? `2/3 ALIGNED — MODERATE` :
    level === 'WEAK' ? `1/3 ALIGNED — WEAK` :
    `0/3 ALIGNED — NONE`;
  const levelColor =
    isNoData ? 'text-muted-foreground/70' :
    level === 'STRONG' ? 'text-bull' :
    level === 'MODERATE' ? 'text-warn' :
    level === 'WEAK' ? 'text-orange-600' :
    'text-bear';
  return (
    <div className={cn(
      'mt-1.5 rounded-md border bg-gradient-to-br p-2',
      isNoData ? 'border-muted/30 bg-muted/5' : 'border-border/40',
    )}>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/80">
          <Activity className="h-2.5 w-2.5" />
          <span className="font-bold">Intraday Confluence</span>
        </div>
        <div className={cn(
          'flex h-6 min-w-[36px] items-center justify-center rounded border bg-gradient-to-br px-1.5 font-mono text-xs font-bold tnum',
          scoreBg,
        )}>
          {isNoData ? '—' : confluence.overallScore}
        </div>
      </div>
      <div className="space-y-0.5">
        <VectorRow name="CVD 5m" vector={confluence.vectors.cvd5m} />
        <VectorRow name="OPTS 15m" vector={confluence.vectors.options15m} />
        <VectorRow name="VWAP 1h" vector={confluence.vectors.vwap1h} />
      </div>
      {confluence.divergenceWarning && confluence.divergenceNote && (
        <div className="mt-1.5 flex items-start gap-1 rounded border border-amber-400/50 bg-amber-100/80 p-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-700" />
          <div className="font-mono text-[9px] leading-tight text-amber-900">
            <span className="font-bold">⚠ DIVERGENCE DETECTED</span>
            <div>{confluence.divergenceNote}</div>
          </div>
        </div>
      )}
      <div className={cn(
        'mt-1.5 flex items-center justify-center gap-1 border-t border-border/20 pt-1 font-mono text-[9px] font-bold tracking-wider',
        levelColor,
      )}>
        {level === 'STRONG' && <Zap className="h-2.5 w-2.5" />}
        {isNoData ? '⚠ NO DATA — AWAITING FEED' : levelLabel}
      </div>
    </div>
  );
}

export const ConfluenceCard = memo(ConfluenceCardInner, (prev, next) => {
  return prev.confluence.computedAt === next.confluence.computedAt;
});
