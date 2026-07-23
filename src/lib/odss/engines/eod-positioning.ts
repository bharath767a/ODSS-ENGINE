/**
 * ODSS — End-of-Day Positioning Report
 * ====================================
 *
 * After the market closes, the day's option-chain OI change (Dhan `previous_oi`)
 * reflects where smart money POSITIONED for tomorrow — where calls/puts were
 * written (support/resistance defended) and where fresh buying happened. This
 * module reads each F&O stock's real chain, runs the same "who's in control"
 * order-flow read, and ranks the universe into a **next-day watchlist**:
 *
 *   • BULLISH (buy calls tomorrow) — buyers/put-writers in control at close
 *   • BEARISH (buy puts tomorrow)  — sellers/call-writers in control at close
 *
 * It's a plan you walk in with: which stocks are set up, their support/
 * resistance walls, max pain and PCR — before the retail crowd reacts at open.
 * Persisted to DATA_DIR so it survives restarts and is viewable pre-open.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';
import type { OptionChain } from '../types';
import { runControlEngine } from './oc-control';

export interface EODRecord {
  symbol: string; sector?: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;           // -100 (bearish) .. +100 (bullish) — positioning lean
  strength: number;        // 0-100 conviction of the read
  controller: string;      // BUYERS / SELLERS / BALANCED
  spot: number; support: number; resistance: number; maxPain: number; pcr: number;
  flowIntensity: number;
  note: string;            // one-line rationale (strongest evidence)
}

export interface EODReport {
  date: string;            // IST date the positioning is FOR (next session)
  generatedAt: number;
  count: number;
  bullish: EODRecord[];    // ranked strongest-first → CE candidates
  bearish: EODRecord[];    // ranked strongest-first → PE candidates
  all: EODRecord[];
}

const FILE = dataPath('eod-positioning.json');

export function buildEODRecord(symbol: string, sector: string | undefined, chain: OptionChain): EODRecord | null {
  if (!chain || chain.spot <= 0) return null;
  // EOD = pure positioning; no intraday price context, so underlyingChangePct = 0.
  const c = runControlEngine(chain, 0);
  const bias: EODRecord['bias'] = c.controlScore > 15 ? 'BULLISH' : c.controlScore < -15 ? 'BEARISH' : 'NEUTRAL';
  return {
    symbol, sector, bias,
    score: c.controlScore, strength: c.strength, controller: c.controller,
    spot: chain.spot, support: c.supportStrike, resistance: c.resistanceStrike,
    maxPain: c.maxPain, pcr: +Number(c.pcr).toFixed(2), flowIntensity: c.flowIntensity,
    note: c.evidence?.[0] ?? '',
  };
}

export function buildEODReport(records: EODRecord[], forDate: string): EODReport {
  const clean = records.filter(Boolean);
  const bullish = clean.filter(r => r.bias === 'BULLISH').sort((a, b) => b.score - a.score).slice(0, 12);
  const bearish = clean.filter(r => r.bias === 'BEARISH').sort((a, b) => a.score - b.score).slice(0, 12);
  return { date: forDate, generatedAt: Date.now(), count: clean.length, bullish, bearish, all: clean };
}

export function saveEODReport(report: EODReport): void {
  try { ensureDataDir(); writeFileSync(FILE, JSON.stringify(report)); } catch { /* best effort */ }
}

export function loadEODReport(): EODReport | null {
  try { return JSON.parse(readFileSync(FILE, 'utf-8')); } catch { return null; }
}
