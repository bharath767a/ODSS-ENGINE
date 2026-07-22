/**
 * ODSS - Permanent Data Archive
 *
 * Archives ALL data that flows through the engine:
 *   1. Live quotes (every 60 seconds → daily JSONL files)
 *   2. Historical daily candles (fetched from Yahoo, stored permanently)
 *   3. Option chain snapshots (every 5 minutes)
 *   4. News items (already archived in news-archive.json)
 *
 * Storage: <DATA_DIR>/archive/
 *   - quotes/YYYY-MM-DD.jsonl      (all quotes for that day, append-only)
 *   - historical/{SYMBOL}.json     (daily candles, append new days only)
 *   - optionchains/YYYY-MM-DD.jsonl(option chain snapshots)
 *
 * This data is NEVER deleted. It survives restarts, crashes, and resets.
 * The engine can pull any historical data for cross-referencing at will.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { dataPath } from '../data-dir';

const ARCHIVE_DIR = dataPath('archive');
const QUOTES_DIR = join(ARCHIVE_DIR, 'quotes');
const HISTORICAL_DIR = join(ARCHIVE_DIR, 'historical');
const OPTIONCHAINS_DIR = join(ARCHIVE_DIR, 'optionchains');

function ensureDirs(): void {
  mkdirSync(QUOTES_DIR, { recursive: true });
  mkdirSync(HISTORICAL_DIR, { recursive: true });
  mkdirSync(OPTIONCHAINS_DIR, { recursive: true });
}

function getDateString(ts: number = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ============================================================
// Live Quotes Archive
// ============================================================

let lastQuoteArchive = 0;
const QUOTE_ARCHIVE_INTERVAL = 60_000;

export function archiveLiveQuotes(quotes: any[]): void {
  if (quotes.length === 0) return;
  const now = Date.now();
  if (now - lastQuoteArchive < QUOTE_ARCHIVE_INTERVAL) return;
  lastQuoteArchive = now;
  ensureDirs();
  const dateStr = getDateString(now);
  const filePath = join(QUOTES_DIR, `${dateStr}.jsonl`);
  const entry = JSON.stringify({ ts: now, quotes }) + '\n';
  appendFileSync(filePath, entry);
}

// ============================================================
// Historical Candles Archive
// ============================================================

export function archiveHistoricalCandles(symbol: string, candles: any[]): void {
  if (candles.length === 0) return;
  ensureDirs();
  const filePath = join(HISTORICAL_DIR, `${symbol}.json`);
  let existing: any[] = [];
  try {
    if (existsSync(filePath)) existing = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch { existing = []; }
  const existingTs = new Set(existing.map(c => c.timestamp));
  const newCandles = candles.filter(c => !existingTs.has(c.timestamp));
  if (newCandles.length === 0) return;
  const merged = [...existing, ...newCandles].sort((a, b) => a.timestamp - b.timestamp);
  writeFileSync(filePath, JSON.stringify(merged));
}

export function getHistoricalCandles(symbol: string): any[] {
  try {
    const filePath = join(HISTORICAL_DIR, `${symbol}.json`);
    if (!existsSync(filePath)) return [];
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch { return []; }
}

export function getHistoricalCandlesRange(symbol: string, days: number): any[] {
  const all = getHistoricalCandles(symbol);
  if (all.length === 0) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return all.filter(c => c.timestamp >= cutoff);
}

// ============================================================
// Option Chain Archive
// ============================================================

let lastChainArchive = 0;
const CHAIN_ARCHIVE_INTERVAL = 5 * 60_000;

export function archiveOptionChain(symbol: string, chain: any): void {
  if (!chain) return;
  const now = Date.now();
  if (now - lastChainArchive < CHAIN_ARCHIVE_INTERVAL) return;
  lastChainArchive = now;
  ensureDirs();
  const dateStr = getDateString(now);
  const filePath = join(OPTIONCHAINS_DIR, `${dateStr}.jsonl`);
  const entry = JSON.stringify({ ts: now, symbol, chain }) + '\n';
  appendFileSync(filePath, entry);
}

// ============================================================
// Archive Stats
// ============================================================

export function getArchiveStats(): {
  quoteFiles: number;
  historicalFiles: number;
  optionChainFiles: number;
  totalSizeMB: number;
  oldestQuoteDate: string | null;
  newestQuoteDate: string | null;
  symbolsWithHistory: number;
} {
  try {
    ensureDirs();
    let quoteFiles: string[] = [];
    try { quoteFiles = readdirSync(QUOTES_DIR).filter(f => f.endsWith('.jsonl')); } catch {}
    let historicalFiles: string[] = [];
    try { historicalFiles = readdirSync(HISTORICAL_DIR).filter(f => f.endsWith('.json')); } catch {}
    let optionChainFiles: string[] = [];
    try { optionChainFiles = readdirSync(OPTIONCHAINS_DIR).filter(f => f.endsWith('.jsonl')); } catch {}
    let totalSize = 0;
    for (const dir of [QUOTES_DIR, HISTORICAL_DIR, OPTIONCHAINS_DIR]) {
      try { for (const f of readdirSync(dir)) { totalSize += statSync(join(dir, f)).size; } } catch {}
    }
    return {
      quoteFiles: quoteFiles.length,
      historicalFiles: historicalFiles.length,
      optionChainFiles: optionChainFiles.length,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 10) / 10,
      oldestQuoteDate: quoteFiles.length > 0 ? quoteFiles.sort()[0].replace('.jsonl','') : null,
      newestQuoteDate: quoteFiles.length > 0 ? quoteFiles.sort().slice(-1)[0].replace('.jsonl','') : null,
      symbolsWithHistory: historicalFiles.length,
    };
  } catch {
    return { quoteFiles: 0, historicalFiles: 0, optionChainFiles: 0, totalSizeMB: 0, oldestQuoteDate: null, newestQuoteDate: null, symbolsWithHistory: 0 };
  }
}
