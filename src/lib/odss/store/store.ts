/**
 * ODSS - In-Memory Store
 * Tracks active trades and the latest engine outputs for live UI updates.
 * The orchestrator updates this on each scan; API routes read from here.
 * Also persists to Prisma for journaling.
 */
import type {
  LiveTrade,
  Recommendation,
  MarketEngineOutput,
  SectorEngineOutput,
  RSEngineOutput,
  OpportunityEngineOutput,
} from '../types';
import { db } from '@/lib/db';

interface ODSSStore {
  market: MarketEngineOutput | null;
  sectors: SectorEngineOutput | null;
  rs: RSEngineOutput | null;
  opportunities: OpportunityEngineOutput | null;
  recommendations: Map<string, Recommendation>; // by symbol
  activeTrade: LiveTrade | null;
  completedTrades: LiveTrade[];
  decisionLog: { timestamp: number; level: string; engine: string; symbol?: string; message: string }[];
  lastScanAt: number;
}

const store: ODSSStore = {
  market: null,
  sectors: null,
  rs: null,
  opportunities: null,
  recommendations: new Map(),
  activeTrade: null,
  completedTrades: [],
  decisionLog: [],
  lastScanAt: 0,
};

export function getStore(): ODSSStore {
  return store;
}

export function setActiveTrade(trade: LiveTrade | null) {
  store.activeTrade = trade;
}

export function getActiveTrade(): LiveTrade | null {
  return store.activeTrade;
}

export function logDecision(level: string, engine: string, message: string, symbol?: string) {
  const entry = { timestamp: Date.now(), level, engine, message, symbol };
  store.decisionLog.unshift(entry);
  if (store.decisionLog.length > 500) store.decisionLog.length = 500;
  // Persist to DB (best-effort)
  db.decisionLog
    .create({
      data: {
        level,
        engine,
        symbol: symbol ?? null,
        message,
        payload: null,
      },
    })
    .catch(() => {});
}

export async function loadActiveTradeFromDb() {
  try {
    const rows = await db.tradeState.findMany({
      where: { state: { not: 'COMPLETE' } },
      orderBy: { updatedAt: 'desc' },
    });
    if (rows.length > 0) {
      const r = rows[0];
      const trade: LiveTrade = {
        symbol: r.symbol,
        direction: r.direction as 'CE' | 'PE',
        state: r.state as LiveTrade['state'],
        entryType: (r.entryType as LiveTrade['entryType']) ?? undefined,
        entryStrike: r.entryStrike ?? undefined,
        entryPrice: r.entryPrice ?? undefined,
        underlyingEntryPrice: r.underlyingEntryPrice ?? undefined,
        entryTime: r.entryTime?.getTime() ?? undefined,
        stopLoss: r.stopLoss ?? undefined,
        initialStopLoss: r.initialStopLoss ?? undefined,
        tp1: r.tp1 ?? undefined,
        tp2: r.tp2 ?? undefined,
        tp3: r.tp3 ?? undefined,
        currentPrice: r.currentPrice ?? undefined,
        currentUnderlying: r.currentUnderlying ?? undefined,
        pnl: r.pnl ?? undefined,
        rMultiple: r.rMultiple ?? undefined,
        exitPrice: r.exitPrice ?? undefined,
        exitTime: r.exitTime?.getTime() ?? undefined,
        exitReason: r.exitReason ?? undefined,
        aiExplanation: r.aiExplanation ?? undefined,
        stateHistory: r.stateHistory ? JSON.parse(r.stateHistory) : [],
        notes: r.notes ?? undefined,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
      };
      store.activeTrade = trade;
    }
  } catch (e) {
    // ignore
  }
}

export async function persistActiveTrade() {
  const t = store.activeTrade;
  if (!t) return;
  try {
    await db.tradeState.upsert({
      where: { symbol: t.symbol },
      create: {
        symbol: t.symbol,
        direction: t.direction,
        state: t.state,
        entryType: t.entryType ?? null,
        entryStrike: t.entryStrike ?? null,
        entryPrice: t.entryPrice ?? null,
        underlyingEntryPrice: t.underlyingEntryPrice ?? null,
        entryTime: t.entryTime ? new Date(t.entryTime) : null,
        stopLoss: t.stopLoss ?? null,
        initialStopLoss: t.initialStopLoss ?? null,
        tp1: t.tp1 ?? null,
        tp2: t.tp2 ?? null,
        tp3: t.tp3 ?? null,
        currentPrice: t.currentPrice ?? null,
        currentUnderlying: t.currentUnderlying ?? null,
        pnl: t.pnl ?? null,
        rMultiple: t.rMultiple ?? null,
        exitPrice: t.exitPrice ?? null,
        exitTime: t.exitTime ? new Date(t.exitTime) : null,
        exitReason: t.exitReason ?? null,
        aiExplanation: t.aiExplanation ?? null,
        stateHistory: JSON.stringify(t.stateHistory),
        notes: t.notes ?? null,
      },
      update: {
        state: t.state,
        entryType: t.entryType ?? null,
        entryStrike: t.entryStrike ?? null,
        entryPrice: t.entryPrice ?? null,
        underlyingEntryPrice: t.underlyingEntryPrice ?? null,
        entryTime: t.entryTime ? new Date(t.entryTime) : null,
        stopLoss: t.stopLoss ?? null,
        initialStopLoss: t.initialStopLoss ?? null,
        tp1: t.tp1 ?? null,
        tp2: t.tp2 ?? null,
        tp3: t.tp3 ?? null,
        currentPrice: t.currentPrice ?? null,
        currentUnderlying: t.currentUnderlying ?? null,
        pnl: t.pnl ?? null,
        rMultiple: t.rMultiple ?? null,
        exitPrice: t.exitPrice ?? null,
        exitTime: t.exitTime ? new Date(t.exitTime) : null,
        exitReason: t.exitReason ?? null,
        aiExplanation: t.aiExplanation ?? null,
        stateHistory: JSON.stringify(t.stateHistory),
        notes: t.notes ?? null,
      },
    });
  } catch (e) {
    // ignore
  }
}

export async function archiveTradeToJournal(trade: LiveTrade) {
  if (!trade.entryPrice || !trade.exitPrice || !trade.entryTime) return;
  try {
    const exitTime = trade.exitTime ?? Date.now();
    const pnl = (trade.exitPrice - trade.entryPrice) * (trade.direction === 'CE' ? 1 : -1);
    const slDist = trade.initialStopLoss && trade.underlyingEntryPrice
      ? Math.abs(trade.underlyingEntryPrice - trade.initialStopLoss)
      : 1;
    const rMultiple = trade.rMultiple ?? 0;
    await db.tradeJournal.create({
      data: {
        symbol: trade.symbol,
        direction: trade.direction,
        sector: null,
        entryStrike: trade.entryStrike ?? 0,
        entryPrice: trade.entryPrice,
        entryTime: new Date(trade.entryTime),
        entryType: trade.entryType ?? 'MARKET',
        underlyingEntryPrice: trade.underlyingEntryPrice ?? 0,
        exitPrice: trade.exitPrice,
        exitTime: new Date(exitTime),
        exitReason: trade.exitReason ?? 'UNKNOWN',
        underlyingExitPrice: trade.currentUnderlying ?? 0,
        stopLoss: trade.initialStopLoss ?? 0,
        tp1: trade.tp1 ?? 0,
        tp2: trade.tp2 ?? 0,
        tp3: trade.tp3 ?? 0,
        pnl,
        rMultiple,
        confidence: 0,
        marketState: '',
        entryReasons: JSON.stringify(trade.stateHistory.slice(0, 3)),
        exitReasons: trade.exitReason ?? '',
        holdTimeMinutes: Math.round((exitTime - trade.entryTime) / 60000),
        tags: null,
      },
    });
  } catch (e) {
    // ignore
  }
}
