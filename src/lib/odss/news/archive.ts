/**
 * ODSS - News Archive
 * Auto-archives every fetched news item with extracted entities.
 * File-based storage at /home/z/odss-data/news-archive.json, capped at 500 items.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { extractEntities, type NewsEntities } from './entity-extractor';
import type { NewsItem } from './types';

export interface ArchivedNews extends NewsItem { entities: NewsEntities; archivedAt: number; }
interface ArchiveData { items: ArchivedNews[]; lastUpdated: number; }

const ARCHIVE_FILE = '/home/z/odss-data/news-archive.json';
const MAX_ITEMS = 500;
let cache: ArchiveData | null = null;
let lastRead = 0;

function loadArchive(): ArchiveData {
  if (cache && Date.now() - lastRead < 5000) return cache;
  try { cache = JSON.parse(readFileSync(ARCHIVE_FILE, 'utf-8')); } catch { cache = { items: [], lastUpdated: 0 }; }
  lastRead = Date.now(); return cache!;
}

function saveArchive(data: ArchiveData): void {
  try { mkdirSync('/home/z/odss-data', { recursive: true }); data.lastUpdated = Date.now(); writeFileSync(ARCHIVE_FILE, JSON.stringify(data)); cache = data; lastRead = Date.now(); } catch {}
}

export function archiveNews(items: NewsItem[]): void {
  if (!items.length) return;
  const archive = loadArchive();
  const existingIds = new Set(archive.items.map(i => i.id));
  const newItems: ArchivedNews[] = [];
  for (const item of items) {
    if (existingIds.has(item.id)) continue;
    newItems.push({ ...item, entities: extractEntities(item.title, item.description), archivedAt: Date.now() });
  }
  if (!newItems.length) return;
  archive.items = [...newItems, ...archive.items].slice(0, MAX_ITEMS);
  saveArchive(archive);
}

export function getRecentArchived(hours: number = 24): ArchivedNews[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return loadArchive().items.filter(i => i.timestamp >= cutoff);
}

export function findRelatedNews(news: NewsItem, hours: number = 48, maxResults: number = 5): ArchivedNews[] {
  const entities = extractEntities(news.title, news.description);
  return getRecentArchived(hours).filter(a => a.id !== news.id).map(a => {
    let score = 0;
    for (const s of entities.stocks) if (a.entities.stocks.includes(s)) score += 3;
    for (const s of entities.sectors) if (a.entities.sectors.includes(s)) score += 2;
    for (const e of entities.eventTypes) if (a.entities.eventTypes.includes(e)) score += 1;
    return { item: a, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, maxResults).map(s => s.item);
}

export function getTrendingEntities(hours: number = 12) {
  const recent = getRecentArchived(hours);
  const sc = new Map<string,number>(); const sec = new Map<string,number>(); const ec = new Map<string,number>();
  for (const item of recent) {
    for (const s of item.entities.stocks) sc.set(s, (sc.get(s)||0)+1);
    for (const s of item.entities.sectors) sec.set(s, (sec.get(s)||0)+1);
    for (const e of item.entities.eventTypes) ec.set(e, (ec.get(e)||0)+1);
  }
  const toArr = (m: Map<string,number>, k: string) => Array.from(m.entries()).map(([key,val]) => ({ [k]: key, count: val })).sort((a,b)=>(b as any).count-(a as any).count).slice(0,5) as any[];
  return { stocks: toArr(sc,'symbol'), sectors: toArr(sec,'sector'), eventTypes: toArr(ec,'type') };
}

export function getArchiveStats() {
  const a = loadArchive();
  return { totalItems: a.items.length, lastUpdated: a.lastUpdated };
}
