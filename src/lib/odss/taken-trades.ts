/**
 * ODSS — Taken Trades (user positions the engine tracks with real greeks)
 * ======================================================================
 *
 * When the user hits TAKE on a pick, the position is recorded here (persisted
 * to DATA_DIR, timestamped, survives restarts). The market service then tracks
 * each open position every few seconds using the REAL option chain — pulling the
 * traded strike's delta/theta/IV and premium, computing live P&L, and layering
 * the 5m/15m/1h option-chain confluence to tell the user when to CLOSE / TRIM.
 *
 * File is the source of truth for POSITIONS (add/close). Live analysis (greeks,
 * P&L, recommendation) is computed by the market service and pushed over the
 * socket — it is NOT written back here (avoids cross-process write races); only
 * a one-time strike assignment is persisted.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from './data-dir';
import type { Direction } from './types';

export interface TakenTrade {
  id: string;
  symbol: string; sector?: string; direction: Direction;
  strike: number;            // 0 = auto-assign nearest-ATM at first analysis
  entryPremium: number;      // option premium at entry (user input)
  entryUnderlying: number;   // underlying LTP at entry
  entryTime: number;         // epoch ms
  status: 'ACTIVE' | 'CLOSED';
  // ── live analysis (filled by the market service, broadcast over socket) ──
  currentPremium?: number; currentUnderlying?: number;
  pnl?: number; pnlPct?: number;
  delta?: number; theta?: number; iv?: number; gamma?: number;
  ocScore?: number; ocExitSignal?: string; oiAction?: string; ocHeadline?: string;
  recommendation?: 'HOLD' | 'TRAIL' | 'REDUCE' | 'CLOSE';
  recReason?: string; updatedAt?: number;
  // ── exit ──
  exitPremium?: number; exitTime?: number; exitReason?: string; realizedPnl?: number;
}

const FILE = dataPath('taken-trades.json');

/** Always read from disk — the web and market processes share this file. */
export function loadTakenTrades(): TakenTrade[] {
  try { return JSON.parse(readFileSync(FILE, 'utf-8')); } catch { return []; }
}

function persist(list: TakenTrade[]): void {
  try { ensureDataDir(); writeFileSync(FILE, JSON.stringify(list)); } catch { /* best effort */ }
}

export function listTaken(status?: 'ACTIVE' | 'CLOSED'): TakenTrade[] {
  const list = loadTakenTrades();
  return status ? list.filter(t => t.status === status) : list;
}

export function addTakenTrade(input: {
  symbol: string; direction: Direction; entryPremium: number; entryUnderlying: number; sector?: string; strike?: number;
}): TakenTrade {
  const list = loadTakenTrades();
  const existing = list.find(x => x.symbol === input.symbol && x.direction === input.direction && x.status === 'ACTIVE');
  if (existing) return existing; // one active position per symbol+side
  const entryTime = Date.now();
  const trade: TakenTrade = {
    id: `${input.symbol}-${input.direction}-${entryTime}`,
    symbol: input.symbol, sector: input.sector, direction: input.direction,
    strike: input.strike && input.strike > 0 ? input.strike : 0,
    entryPremium: input.entryPremium, entryUnderlying: input.entryUnderlying,
    entryTime, status: 'ACTIVE',
  };
  list.push(trade); persist(list);
  return trade;
}

export function closeTakenTrade(id: string, exitPremium?: number, reason?: string): TakenTrade | null {
  const list = loadTakenTrades();
  const t = list.find(x => x.id === id && x.status === 'ACTIVE');
  if (!t) return null;
  t.status = 'CLOSED'; t.exitTime = Date.now();
  t.exitPremium = exitPremium ?? t.currentPremium ?? t.entryPremium;
  t.realizedPnl = +(((t.exitPremium ?? t.entryPremium) - t.entryPremium)).toFixed(2);
  t.exitReason = reason ?? 'Manual close';
  persist(list);
  return t;
}

/** One-time: lock in the traded strike once the chain is known. */
export function assignStrike(id: string, strike: number): void {
  const list = loadTakenTrades();
  const t = list.find(x => x.id === id);
  if (t && (!t.strike || t.strike <= 0)) { t.strike = strike; persist(list); }
}
