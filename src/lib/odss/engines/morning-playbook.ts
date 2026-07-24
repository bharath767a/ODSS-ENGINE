/**
 * ODSS — MORNING PLAYBOOK (P3: pre-open synthesis)
 * ================================================
 *
 * Retail reads headlines at 9:25. This engine has the plan ready by ~9:05:
 *
 *   yesterday's EOD option positioning  ×  overnight news (direct + causal)
 *
 * For every stock in yesterday's EOD bullish/bearish watchlist we check what
 * the overnight tape did to the thesis:
 *
 *   ALIGNED  — news pushes the SAME way the chain was positioned → prime watch
 *   QUIET    — no meaningful overnight news → positioning thesis stands alone
 *   CAUTION  — news pushes AGAINST yesterday's positioning → stand aside until
 *              the market picks a side (these sink to the bottom, flagged)
 *
 * DATA HONESTY: built only from the real saved EOD report + really archived
 * news. No EOD report (e.g. scan failed yesterday) → no playbook, and the UI
 * says so. Nothing is invented.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dataPath, ensureDataDir } from '../data-dir';
import { causalNewsImpact } from '../news/causal-map';

export interface PlaybookItem {
  symbol: string; sector: string;
  side: 'CE' | 'PE';
  eodScore: number;            // yesterday's positioning score (signed)
  eodReason: string;           // why the chain was bullish/bearish
  newsBoost: number;           // direction-aligned overnight news effect
  newsNotes: string[];         // auditable reasons (headlines + causal)
  verdict: 'ALIGNED' | 'QUIET' | 'CAUTION';
  rank: number;
  plain: string;               // one layman sentence
}

export interface MorningPlaybook {
  date: string;                // IST YYYY-MM-DD (today)
  eodDate: string;             // the EOD report's date it was built from
  generatedAt: number;
  items: PlaybookItem[];
}

const STATE_FILE = dataPath('morning-playbook.json');

function istDate(now = Date.now()): string { return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10); }

/**
 * Build the playbook. `eodReport` = saved EOD positioning report
 * ({ date, bullish:[{symbol,sector,score,reason}], bearish:[...] }).
 * `recentNews` = archived news items (title/description/sentiment/entities).
 */
export function buildMorningPlaybook(eodReport: any, recentNews: any[]): MorningPlaybook | null {
  if (!eodReport || (!Array.isArray(eodReport.bullish) && !Array.isArray(eodReport.bearish))) return null;
  const now = Date.now();
  const items: PlaybookItem[] = [];

  const consider = (rec: any, side: 'CE' | 'PE') => {
    if (!rec?.symbol) return;
    const sector = rec.sector ?? '';
    // Direct overnight stock news (strictly entity-matched — no loose keywords).
    const direct = recentNews.filter((n: any) => n.entities?.stocks?.includes(rec.symbol));
    const pos = direct.filter((n: any) => n.sentiment === 'POSITIVE').length;
    const neg = direct.filter((n: any) => n.sentiment === 'NEGATIVE').length;
    const directBoost = Math.max(-8, Math.min(8, (pos - neg) * 4));
    // Second-order causal effects (crude/rupee/RBI/…).
    const causal = causalNewsImpact(rec.symbol, sector, recentNews);
    const stockBoost = directBoost + causal.boost;               // for the STOCK
    const newsBoost = side === 'CE' ? stockBoost : -stockBoost;  // for the SIDE
    const notes = [
      ...direct.slice(0, 1).map((n: any) => n.title),
      ...causal.notes,
    ].slice(0, 2);

    const verdict: PlaybookItem['verdict'] = newsBoost >= 4 ? 'ALIGNED' : newsBoost <= -4 ? 'CAUTION' : 'QUIET';
    const rank = Math.abs(rec.score ?? 0) + (verdict === 'ALIGNED' ? 15 : verdict === 'CAUTION' ? -25 : 0);

    const dirWord = side === 'CE' ? 'UP' : 'DOWN';
    const plain = verdict === 'ALIGNED'
      ? `Yesterday's option positioning says ${dirWord}, and overnight news agrees. Watch for a ${side} entry once the engine confirms after 9:30.`
      : verdict === 'CAUTION'
        ? `Yesterday's positioning said ${dirWord}, but overnight news points the OTHER way. Stand aside until the market picks a side.`
        : `Yesterday's option positioning says ${dirWord}. No overnight news either way — let the open confirm it.`;

    items.push({
      symbol: rec.symbol, sector, side,
      eodScore: rec.score ?? 0,
      eodReason: rec.reason ?? rec.note ?? '',
      newsBoost, newsNotes: notes, verdict, rank, plain,
    });
  };

  for (const r of eodReport.bullish ?? []) consider(r, 'CE');
  for (const r of eodReport.bearish ?? []) consider(r, 'PE');

  items.sort((a, b) => b.rank - a.rank);
  const playbook: MorningPlaybook = {
    date: istDate(now),
    eodDate: String(eodReport.date ?? ''),
    generatedAt: now,
    items: items.slice(0, 10),
  };
  try { ensureDataDir(); writeFileSync(STATE_FILE, JSON.stringify(playbook)); } catch { /* best effort */ }
  return playbook;
}

export function loadMorningPlaybook(): MorningPlaybook | null {
  try {
    const p = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    return p?.date === istDate() ? p : null;   // only today's playbook is valid
  } catch { return null; }
}
