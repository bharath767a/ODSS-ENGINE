/**
 * ODSS — News Shocks Store
 * ========================
 * Persists detected news-shock events (high-impact negative news that moved a
 * stock) to DATA_DIR with timestamps, deduped by symbol+trigger, so the
 * Opportunities tab can show a live shockers panel AND a timestamped history
 * that survives restarts.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';

export interface NewsShockRecord {
  symbol: string; sector: string; direction: 'PE';
  trigger: string; conviction: number;
  firstSeen: number; lastSeen: number; ageMinutes: number;
  ivCaution?: boolean; price?: number; targetPrice?: number;
}

const FILE = dataPath('news-shocks.json');
const MAX = 200;
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000; // same symbol+trigger within 6h = same event

export function loadNewsShocks(): NewsShockRecord[] {
  try { return JSON.parse(readFileSync(FILE, 'utf-8')); } catch { return []; }
}

/** Merge the current scan's news-shock picks into the persisted history. */
export function recordNewsShocks(picks: any[] | undefined): void {
  if (!picks || picks.length === 0) return;
  const list = loadNewsShocks();
  const now = Date.now();
  let changed = false;
  for (const p of picks) {
    const trigger = p.shockTrigger ?? p.newsHeadlines?.[0] ?? '';
    if (!p.symbol || !trigger) continue;
    const existing = list.find(r => r.symbol === p.symbol && r.trigger === trigger && (now - r.lastSeen) < DEDUP_WINDOW_MS);
    if (existing) {
      existing.lastSeen = now;
      existing.ageMinutes = p.shockAgeMinutes ?? existing.ageMinutes;
      existing.conviction = p.convictionScore ?? existing.conviction;
      existing.price = p.currentPrice ?? existing.price;
      changed = true;
    } else {
      list.unshift({
        symbol: p.symbol, sector: p.sector ?? p.shockSector ?? 'GENERAL', direction: 'PE',
        trigger, conviction: p.convictionScore ?? 65,
        firstSeen: now, lastSeen: now, ageMinutes: p.shockAgeMinutes ?? 0,
        ivCaution: p.ivCaution, price: p.currentPrice, targetPrice: p.shockTargetPrice,
      });
      changed = true;
    }
  }
  if (changed) {
    const trimmed = list.slice(0, MAX);
    try { ensureDataDir(); writeFileSync(FILE, JSON.stringify(trimmed)); } catch { /* best effort */ }
  }
}
