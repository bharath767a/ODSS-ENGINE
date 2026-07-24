/**
 * ODSS Market Service (Mini-service)
 *
 * Real-time market simulation + engine orchestrator.
 * - Ticks the simulator every few seconds
 * - Runs the ODSS scan (all engines) on each tick
 * - Broadcasts live updates via Socket.IO to all connected dashboards
 *
 * Port: 3002
 *
 * Frontend connects via: io("/?XTransformPort=3002")
 */
import { createServer } from 'http';
import { Server } from 'socket.io';
import { writeFileSync, readFileSync } from 'fs';
import { tick, getQuote, getAllQuotes, getIndiaVix, getMarketBreadth, getOptionChain, resetSimulator, injectRealQuote, injectRealVix } from '../../src/lib/odss/simulator/market-simulator';
import { runScan, enterTrade, exitTrade } from '../../src/lib/odss/orchestrator';
import { getStore, loadActiveTradeFromDb } from '../../src/lib/odss/store/store';
import { getConfig } from '../../src/lib/odss/config';
import { startRecording, stopRecording, recordTick, recordScan, isRecording, listSessions, getCurrentSessionId } from '../../src/lib/odss/replay/recorder';
import { generateValidationReport } from '../../src/lib/odss/replay/validator';
import { checkGuardrails, registerTradeEntry, registerTradeExit, getGuardrailStatus } from '../../src/lib/odss/engines/guardrails-engine';
import { ensureSeedUsers } from '../../src/lib/user-manager';
import { getDataRouter } from '../../src/lib/odss/data-providers/router';
import { ALL_SYMBOLS } from '../../src/lib/odss/universe';
import { fetchRealNews } from '../../src/lib/odss/news/news-fetcher';
import { archiveNews } from '../../src/lib/odss/news/archive';
import { archiveLiveQuotes, archiveHistoricalCandles, archiveOptionChain } from '../../src/lib/odss/archive/data-archive';
import { fetchAndInjectOptionChains } from '../../src/lib/odss/data-providers/option-chain-feed';
import { updateOCConfluence, getAllOCConfluence, getOCConfluence } from '../../src/lib/odss/engines/oc-confluence';
import { listTaken, assignStrike, type TakenTrade } from '../../src/lib/odss/taken-trades';
import { runControlEngine } from '../../src/lib/odss/engines/oc-control';
import { mapBridgeChain } from '../../src/lib/odss/data-providers/option-chain-feed';
import { buildEODRecord, buildEODReport, saveEODReport, loadEODReport } from '../../src/lib/odss/engines/eod-positioning';
import { STOCKS } from '../../src/lib/odss/universe';
import { updateSqueeze, getActiveSqueezes, getSqueezeFor, getCompletedSqueezes, resetSqueezeLog } from '../../src/lib/odss/engines/squeeze-detector';
import { recordNewsShocks } from '../../src/lib/odss/news/shocks-store';
import { getMarketSession, shouldEngineBeActive, shouldPollRealData } from '../../src/lib/odss/market-session';
import { getIVSpikePct } from '../../src/lib/odss/engines/oc-confluence';
import { applyPlainGuidance } from '../../src/lib/odss/engines/conviction-engine';
import { recordDisplayedPicks, updateOutcomes, closeOutcomesForDay, getPickStats } from '../../src/lib/odss/engines/pick-outcomes';
import { dataPath, ensureDataDir } from '../../src/lib/odss/data-dir';
import type { Direction } from '../../src/lib/odss/types';

const PORT = 3002;
const TICK_INTERVAL_MS = 3000; // simulator tick
const SCAN_INTERVAL_MS = 5000; // engine scan

const httpServer = createServer((req, res) => {
  // Simple health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, ts: Date.now() }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

console.log('[odss-market] Starting service on port', PORT);

// Ensure the runtime data directory (and common subfolders) exist before any
// state/quote writes. Portable across Windows / Linux / Replit via DATA_DIR.
ensureDataDir();
ensureDataDir('pm2-logs');
ensureDataDir('archive');
console.log('[odss-market] Data dir ready:', dataPath());

// Initialize: load active trade from DB
loadActiveTradeFromDb().then(() => {
  console.log('[odss-market] Active trade loaded');
}).catch((e) => {
  console.warn('[odss-market] Failed to load active trade:', e.message);
});

// Seed default admin user (admin / admin123) on first run.
ensureSeedUsers().catch((e) => {
  console.warn('[odss-market] Failed to seed default users:', e.message);
});

// Pre-warm the simulator with some ticks so engines have data
for (let i = 0; i < 30; i++) tick();
console.log('[odss-market] Simulator pre-warmed with 30 ticks');

// ============================================================
// REAL DATA INJECTION LOOP
// ============================================================
// Every 10 seconds, fetch REAL quotes from Yahoo Finance (free,
// public, no key) and inject them into the simulator's in-memory
// store. This overwrites the synthetic prices with REAL market
// prices, so all API routes that call getQuote() return real data.
//
// Yahoo is the PRIMARY real data source because:
//   - It works from any IP (no geo-block, unlike NSE)
//   - It returns real quotes for all NSE stocks + indices
//   - It returns real India VIX from ^INDIAVIX
//   - It's completely free with no auth
//
// For option chains, Yahoo doesn't provide them — those remain
// simulated unless NSE_PROXY_URL is configured (Mumbai Cloudflare
// Worker). The optionchain API route tries NSE first, then falls
// back to the simulator.
//
// Key symbols fetched: NIFTY, BANKNIFTY, FINNIFTY (indices) +
// all F&O stocks. India VIX is fetched separately.
const REAL_DATA_INTERVAL_MS = 5_000; // 5s — aligns with the scan loop for lower latency
const REAL_DATA_SYMBOLS = ALL_SYMBOLS.map((s) => s.symbol);
let realDataEnabled = true;
let lastRealDataFetch = 0;
let injectInProgress = false; // prevents overlapping fetch cycles at the tighter interval
let realDataStats = { fetched: 0, failed: 0, lastSuccess: 0 as number | null, source: 'NONE' as string };

// Write quotes to a shared file so the web server can read real prices
function writeQuotesFile() {
  try {
    const allQuotes = getAllQuotes();
    const nifty = getQuote('NIFTY');
    const bankNifty = getQuote('BANKNIFTY');
    const vix = getIndiaVix();
    writeFileSync(dataPath('quotes.json'), JSON.stringify({
      quotes: allQuotes.map((q) => ({ symbol: q.symbol, ltp: q.ltp, prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, volume: q.volume, vwap: q.vwap, changePct: q.changePct, sector: q.sector })),
      nifty: nifty ? { ltp: nifty.ltp, changePct: nifty.changePct, vwap: nifty.vwap, open: nifty.open, high: nifty.high, low: nifty.low } : null,
      bankNifty: bankNifty ? { ltp: bankNifty.ltp, changePct: bankNifty.changePct, vwap: bankNifty.vwap } : null,
      vix, ts: Date.now(), source: realDataStats.source,
    }));
  } catch (e) { console.warn('[odss-market] Failed to write quotes file:', (e as Error).message); }
}

function injectQuote(sym: string, q: { ltp: number; prevClose: number; open: number; high: number; low: number; volume: number; changePct: number; vwap: number }) {
  injectRealQuote(sym, { ltp: q.ltp, prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, volume: q.volume, changePct: q.changePct, vwap: q.vwap });
}

// Yahoo batched fallback (used only when the bridge/Dhan is unavailable).
async function injectViaYahoo(yahoo: any): Promise<number> {
  let fetched = 0;
  const BATCH_SIZE = 5, BATCH_DELAY = 200;
  for (let i = 0; i < REAL_DATA_SYMBOLS.length; i += BATCH_SIZE) {
    const batch = REAL_DATA_SYMBOLS.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async (sym) => {
      const q = await yahoo.getQuote(sym);
      if (q && q.ltp > 0) { injectQuote(sym, q); return sym; }
      return null;
    }));
    for (const r of results) if (r.status === 'fulfilled' && r.value) fetched++;
    if (i + BATCH_SIZE < REAL_DATA_SYMBOLS.length) await new Promise(r => setTimeout(r, BATCH_DELAY));
  }
  return fetched;
}

async function fetchAndInjectRealData() {
  if (!realDataEnabled || injectInProgress) return;

  // ─── MARKET SESSION CHECK ───
  // When market is closed, reduce polling to 5 min (saves API quota)
  if (!shouldPollRealData()) {
    if (Date.now() - lastRealDataFetch < 5 * 60 * 1000) return;
    console.log('[odss-market] Market closed — polling real data at reduced frequency (5 min)');
  }
  injectInProgress = true;
  lastRealDataFetch = Date.now();
  try {
    const router = getDataRouter();
    const angel = router.getProvider('ANGEL_ONE');
    const yahoo = router.getProvider('YAHOO');

    // VIX always from Yahoo — reliable and free.
    try { const vix = await yahoo?.getIndiaVIX(); if (vix && vix > 0 && vix < 200) injectRealVix(vix); }
    catch (e) { console.warn('[odss-market] VIX fetch failed:', (e as Error).message); }

    // QUOTES: AngelOne (when configured) → Yahoo fallback. We deliberately do
    // NOT use the Dhan bridge for quotes — Dhan is reserved exclusively for
    // option chains + greeks so we never hit its per-second rate limit.
    let fetched = 0;
    let source = 'NONE';
    if (angel && angel.isConfigured()) {
      try {
        const quotes = await angel.getAllQuotes(REAL_DATA_SYMBOLS);
        for (const [sym, q] of quotes) {
          if (q && q.ltp > 0) { injectQuote(sym, q); fetched++; }
        }
        if (fetched > 0) source = 'ANGELONE';
      } catch (e) {
        console.warn('[odss-market] AngelOne quotes failed, falling back to Yahoo:', (e as Error).message);
      }
    }
    if (fetched === 0 && yahoo) { fetched = await injectViaYahoo(yahoo); if (fetched > 0) source = 'YAHOO'; }

    realDataStats.fetched = fetched;
    realDataStats.source = source;
    if (fetched > 0) realDataStats.lastSuccess = Date.now();
    lastRealDataFetch = Date.now();
    writeQuotesFile();
    try { archiveLiveQuotes(getAllQuotes()); } catch {}
    console.log(`[odss-market] Real data cycle: ${fetched} quotes from ${source}`);
  } catch (e) {
    realDataStats.failed++;
    console.warn('[odss-market] Real data fetch error:', (e as Error).message);
  } finally {
    injectInProgress = false;
  }
}

// Start the real data injection loop
setInterval(fetchAndInjectRealData, REAL_DATA_INTERVAL_MS);
// Fetch immediately on startup (after a 2s delay to let the simulator warm up)
setTimeout(fetchAndInjectRealData, 2000);
console.log('[odss-market] Real data injection loop started (bridge/Dhan → Yahoo, 5s interval)');

// ============================================================
// REAL OPTION-CHAIN FEED + DELTA/OI CONFLUENCE
// ============================================================
// Fetches REAL Dhan option chains (via the bridge) for the current CE/PE picks,
// indices and any active trade, injects them into the simulator (so the option
// chain engine analyses real OI/greeks), then runs the multi-timeframe
// (5m/15m/4h) delta+OI confluence engine for entry/exit timing.
const OC_INTERVAL_MS = 8_000;
const OC_INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY'];
let ocInProgress = false;

async function fetchOptionChainsAndConfluence() {
  if (ocInProgress) return;
  // Option chains are only meaningful during market hours.
  if (!shouldPollRealData()) return;
  ocInProgress = true;
  try {
    const router = getDataRouter();
    const bridge: any = router.getProvider('BRIDGE' as any);
    if (!bridge || !bridge.isConfigured() || typeof bridge.getRawOptionChain !== 'function') return;

    const store = getStore();
    const conv: any = store.conviction;
    const dirBySym = new Map<string, Direction>();
    for (const p of (conv?.cePicks ?? [])) dirBySym.set(p.symbol, 'CE');
    for (const p of (conv?.pePicks ?? [])) dirBySym.set(p.symbol, 'PE');
    const active: any = store.activeTrade;
    if (active?.symbol) dirBySym.set(active.symbol, active.direction);
    // Always fetch chains for the user's OPEN taken positions so they are
    // tracked with real greeks + confluence even if they drop out of the picks.
    for (const t of listTaken('ACTIVE')) dirBySym.set(t.symbol, t.direction);
    for (const idx of OC_INDEX_SYMBOLS) if (!dirBySym.has(idx)) dirBySym.set(idx, 'CE');

    // Indices FIRST so the benchmark cards are never starved by the rate limit,
    // then the picks. Cap the set for Dhan's option-chain limit.
    const pickSyms = Array.from(dirBySym.keys()).filter(s => !OC_INDEX_SYMBOLS.includes(s));
    const symbols = [...OC_INDEX_SYMBOLS.filter(i => dirBySym.has(i)), ...pickSyms].slice(0, 12);
    const chains = await fetchAndInjectOptionChains(bridge, symbols);
    for (const [sym, chain] of chains) {
      try { updateOCConfluence(sym, chain, dirBySym.get(sym) ?? 'CE'); } catch {}
      try { updateSqueeze(sym, chain, OC_INDEX_SYMBOLS.includes(sym)); } catch {}
      try { archiveOptionChain(sym, chain); } catch {}
    }
    (store as any).ocConfluence = getAllOCConfluence();
    (store as any).squeezes = getActiveSqueezes();
    (store as any).completedSqueezes = getCompletedSqueezes().slice(0, 20);
    // Index control read (direction-agnostic) for the NIFTY/BANKNIFTY benchmark
    // cards. PERSIST across cycles — a one-off 429 on an index must not blank the
    // card; we keep the last good read until a fresh chain replaces it.
    const idxControl: Record<string, any> = (store as any).indexControl || {};
    for (const idx of OC_INDEX_SYMBOLS) {
      const chain = chains.get(idx);
      if (chain) { try { idxControl[idx] = runControlEngine(chain, getQuote(idx)?.changePct ?? 0); } catch {} }
    }
    (store as any).indexControl = idxControl;
    if (chains.size > 0) console.log(`[odss-market] Option chains: ${chains.size} real Dhan chains injected + confluence updated`);
  } catch (e) {
    console.warn('[odss-market] Option-chain feed error:', (e as Error).message);
  } finally {
    ocInProgress = false;
  }
}
setInterval(fetchOptionChainsAndConfluence, OC_INTERVAL_MS);
setTimeout(fetchOptionChainsAndConfluence, 6000);
console.log('[odss-market] Option-chain + delta/OI confluence loop started (8s interval)');

// ============================================================
// END-OF-DAY POSITIONING SCAN — tomorrow's bullish/bearish watchlist
// ============================================================
// After close, read the whole F&O universe's option chains once and rank by the
// day's OI positioning (who's in control) → a plan for tomorrow. Runs once/day
// automatically post-close, or on demand via the 'eod:run' socket event.
let eodRunning = false;
let eodDoneDate = '';
function istDayKey(): string { const ist = new Date(Date.now() + 5.5 * 3600 * 1000); return `${ist.getUTCFullYear()}-${ist.getUTCMonth() + 1}-${ist.getUTCDate()}`; }

async function runEODScan(reason: string, limit = 999): Promise<any> {
  if (eodRunning) return (getStore() as any).eodReport ?? loadEODReport();
  const router = getDataRouter();
  const bridge: any = router.getProvider('BRIDGE' as any);
  if (!bridge || !bridge.isConfigured() || typeof bridge.getRawOptionChain !== 'function') {
    console.warn('[odss-market] EOD scan skipped — bridge/Dhan not available');
    return null;
  }
  eodRunning = true;
  console.log(`[odss-market] EOD positioning scan starting (${reason})...`);
  try {
    const records: any[] = [];
    const targets = STOCKS.slice(0, limit);
    for (const meta of targets) {
      try {
        const raw = await bridge.getRawOptionChain(meta.symbol);
        if (!raw) continue;
        const chain = mapBridgeChain(meta.symbol, raw);
        if (!chain) continue;
        const rec = buildEODRecord(meta.symbol, meta.sector, chain);
        if (rec) records.push(rec);
      } catch { /* skip symbol */ }
    }
    const report = buildEODReport(records, istDayKey());
    saveEODReport(report);
    (getStore() as any).eodReport = report;
    io.emit('eod:report', report);
    eodDoneDate = istDayKey();
    console.log(`[odss-market] EOD scan done: ${records.length} stocks — ${report.bullish.length} bullish / ${report.bearish.length} bearish`);
    return report;
  } catch (e) {
    console.warn('[odss-market] EOD scan error:', (e as Error).message);
    return null;
  } finally { eodRunning = false; }
}

// Auto-run once per day, ~5 min after close.
setInterval(() => {
  try {
    const session = getMarketSession();
    if (session.isOpen || session.isPreOpen) return;   // only after close
    if (eodDoneDate === istDayKey()) return;            // already done today
    if (!session.isPostClose) return;                    // wait until actually post-close
    try { closeOutcomesForDay(); } catch {}
    runEODScan('auto post-close');
  } catch { /* ignore */ }
}, 60_000);
console.log('[odss-market] EOD positioning scanner armed (auto after close)');

// Reset the completed-squeeze log once at the start of each trading day.
let squeezeLogDay = '';
setInterval(() => {
  try {
    const s = getMarketSession();
    if ((s.isPreOpen || s.isOpen) && squeezeLogDay !== istDayKey()) {
      resetSqueezeLog(); squeezeLogDay = istDayKey();
      console.log('[odss-market] Squeeze completed-log reset for the new session');
    }
  } catch { /* ignore */ }
}, 60_000);

// Blend option-chain/delta confluence into picks + active trade for entry/exit timing.
function enrichWithOCConfluence(store: any): void {
  try {
    const conv = store.conviction;
    const enrich = (picks: any[]) => {
      if (!Array.isArray(picks)) return;
      for (const p of picks) {
        // Attach any live short-covering squeeze on this symbol to the pick.
        try { const sq = getSqueezeFor(p.symbol); if (sq) p.squeeze = sq; } catch {}
        const oc = getOCConfluence(p.symbol);
        if (!oc) continue;
        p.ocScore = oc.ocScore; p.ocEntrySignal = oc.entrySignal; p.ocExitSignal = oc.exitSignal;
        p.oiAction = oc.oiAction; p.ocNotes = oc.notes; p.atmDelta = oc.atmDelta;
        // OC can veto a technical ENTER, or promote a WAIT when it strongly
        // confirms — but a promote must clear the SAME hard gates as a native
        // ENTER (grade, readable flow, room, news), or the sufficiency /
        // theta / pin gates upstream would be bypassed through this side door.
        let mutated = false;
        if (p.entrySignal === 'ENTER_NOW' && oc.entrySignal === 'AVOID') {
          p.entrySignal = 'WAIT';
          p.entrySignalReason = 'the option chain turned against this in the last few minutes — wait';
          mutated = true;
        } else if (
          p.entrySignal === 'WAIT' && oc.entrySignal === 'ENTER'
          && (p.grade === 'A+' || p.grade === 'A')
          && p.controlReadable !== false
          && (p.roomScore ?? 0) >= 50 && p.newsMomentum !== 'NEGATIVE'
        ) { p.entrySignal = 'ENTER_NOW'; p.entrySignalReason = 'chain + delta just confirmed the move'; mutated = true; }
        // IV-spike honesty: premiums that just repriced up are a bad buy even
        // when the direction is right. ≥25% in an hour → warn; ≥45% → stand down.
        try {
          const spike = getIVSpikePct(p.symbol);
          if (spike !== null && spike >= 25 && (p.entrySignal === 'ENTER_NOW' || p.plainAction === 'BUY NOW')) {
            p.ivCaution = true;
            p.ivCautionReason = `ATM IV +${spike}% in the last hour — premiums expensive`;
            if (spike >= 45) { p.entrySignal = 'WAIT'; p.entrySignalReason = `option premiums spiked +${spike}% — you would overpay; wait for IV to settle`; }
            mutated = true;
          }
        } catch { /* no IV history yet */ }
        // The layman banner must NEVER contradict the signal it stands on.
        if (mutated) { try { applyPlainGuidance(p); } catch {} }
        // Which strike to actually buy: the 0.35–0.55 |delta| sweet spot
        // (real directional exposure without deep-OTM lottery pricing),
        // liquidity-checked. Only on actionable picks.
        if (p.plainAction === 'BUY NOW' || p.plainAction === 'CONSIDER') {
          try {
            const chain = getOptionChain(p.symbol);
            if (chain) {
              const rows = chain.strikes
                .filter((r: any) => r.type === p.direction && Math.abs(r.delta ?? 0) >= 0.32 && Math.abs(r.delta ?? 0) <= 0.58 && (r.oi ?? 0) > 0 && (r.ltp ?? 0) > 0)
                .sort((a: any, b: any) => Math.abs(Math.abs(a.delta) - 0.45) - Math.abs(Math.abs(b.delta) - 0.45) || (b.volume ?? 0) - (a.volume ?? 0));
              const best = rows[0];
              if (best) {
                p.recommendedStrike = best.strike;
                p.recommendedDelta = +Math.abs(best.delta).toFixed(2);
                p.recommendedPremium = +best.ltp.toFixed(2);
              }
            }
          } catch { /* no chain right now */ }
        }
      }
    };
    if (conv) { enrich(conv.cePicks); enrich(conv.pePicks); enrich(conv.primePicks); enrich(conv.convictionPicks); enrich(conv.watchlist); }
    const active = store.activeTrade;
    if (active?.symbol) {
      const oc = getOCConfluence(active.symbol);
      if (oc) { active.ocExitSignal = oc.exitSignal; active.ocScore = oc.ocScore; active.oiAction = oc.oiAction; active.ocNotes = oc.notes; }
    }
  } catch { /* non-critical */ }
}

// ============================================================
// TAKEN-TRADE TRACKING (real greeks + P&L + close recommendation)
// ============================================================
// For each open position the user took, pull the traded strike's greeks and
// premium from the REAL option chain, compute live P&L, and combine with the
// 5m/15m/1h option-chain confluence to say clearly: HOLD / TRAIL / TRIM / CLOSE.
function analyzeTakenTrade(t: TakenTrade): TakenTrade {
  const chain = getOptionChain(t.symbol);
  const quote = getQuote(t.symbol);
  const underlying = quote?.ltp ?? t.entryUnderlying;

  let strike = t.strike;
  if ((!strike || strike <= 0) && chain) { strike = chain.atmStrike; try { assignStrike(t.id, strike); } catch {} }

  let delta: number | undefined, theta: number | undefined, iv: number | undefined, gamma: number | undefined, currentPremium: number | undefined;
  if (chain && strike) {
    const sameSide = chain.strikes.filter(r => r.type === t.direction);
    const row = sameSide.find(r => r.strike === strike)
      ?? sameSide.sort((a, b) => Math.abs(a.strike - strike) - Math.abs(b.strike - strike))[0];
    if (row) { delta = row.delta; theta = row.theta; iv = row.iv; gamma = row.gamma; currentPremium = row.ltp; }
  }
  if (currentPremium == null || currentPremium <= 0) {
    // Fallback: estimate premium from the underlying move via delta.
    const move = underlying - t.entryUnderlying;
    currentPremium = Math.max(0.5, t.entryPremium + move * (delta ?? 0.5) * (t.direction === 'CE' ? 1 : -1));
  }
  const pnl = currentPremium - t.entryPremium;
  const pnlPct = t.entryPremium > 0 ? (pnl / t.entryPremium) * 100 : 0;

  // Who's in control on this position's chain (real order flow).
  let controller: string | undefined, controlStrength: number | undefined, controlEvidence: string[] | undefined;
  if (chain) { try { const c = runControlEngine(chain, quote?.changePct ?? 0); controller = c.controller; controlStrength = c.strength; controlEvidence = c.evidence?.slice(0, 2); } catch {} }

  const oc = getOCConfluence(t.symbol);
  // The clearest exit signal is an ORDER-FLOW FLIP: the other side just took
  // control of the chain. That's your "get out" — stated plainly.
  const controlAgainst = !!controller
    && ((t.direction === 'PE' && controller === 'BUYERS') || (t.direction === 'CE' && controller === 'SELLERS'))
    && (controlStrength ?? 0) >= 45;
  let recommendation: TakenTrade['recommendation'] = 'HOLD';
  let recReason = controller && controller !== 'BALANCED'
    ? `${controller} in control (${controlStrength}%) — with you, hold`
    : 'On track — hold';
  if (controlAgainst) { recommendation = 'CLOSE'; recReason = `${controller} just took control (${controlStrength}%) — flow flipped against your ${t.direction}. EXIT NOW.`; }
  else if (oc?.exitSignal === 'EXIT') { recommendation = 'CLOSE'; recReason = oc.headline; }
  else if (pnlPct <= -50) { recommendation = 'CLOSE'; recReason = `Premium down ${pnlPct.toFixed(0)}% — cut the loss`; }
  else if (pnlPct >= 40) { recommendation = 'REDUCE'; recReason = `Up ${pnlPct.toFixed(0)}% — book partial, trail the rest`; }
  else if (oc?.exitSignal === 'REDUCE') { recommendation = 'REDUCE'; recReason = oc.headline; }
  else if (oc?.exitSignal === 'TRAIL') { recommendation = 'TRAIL'; recReason = 'Strong in favour — trail the stop'; }

  return {
    ...t, strike,
    currentUnderlying: +underlying.toFixed(2), currentPremium: +currentPremium.toFixed(2),
    pnl: +pnl.toFixed(2), pnlPct: +pnlPct.toFixed(1),
    delta, theta, iv, gamma,
    ocScore: oc?.ocScore, ocExitSignal: oc?.exitSignal, oiAction: oc?.oiAction, ocHeadline: oc?.headline,
    controller, controlStrength, controlEvidence,
    recommendation, recReason, updatedAt: Date.now(),
  } as any;
}

function trackTakenTrades() {
  try {
    const enriched = listTaken('ACTIVE').map(analyzeTakenTrade);
    io.emit('taken-trades:update', { trades: enriched, timestamp: Date.now() });
  } catch (e) { /* non-critical */ }
}
setInterval(trackTakenTrades, 5000);
console.log('[odss-market] Taken-trade tracking loop started (real greeks + P&L, 5s)');

// ============================================================
// Background News Archiving — fetches real news every 5 minutes
// and archives it with entity extraction for cross-linking.
// This builds the AI's "memory" continuously without depending
// on frontend requests.
// ============================================================
async function fetchAndArchiveNews() {
  try {
    const news = await fetchRealNews(50);
    if (news.length > 0) {
      archiveNews(news);
      console.log(`[odss-market] News archived: ${news.length} items`);
    }
  } catch (e) {
    console.warn('[odss-market] News archive failed:', (e as Error).message);
  }
}
setTimeout(fetchAndArchiveNews, 5000); // start after 5s
setInterval(fetchAndArchiveNews, 5 * 60 * 1000); // every 5 minutes
console.log('[odss-market] News archiving loop started (5-min interval)');

// ============================================================
// Historical Data Archive — fetch 1 year of daily candles for
// all symbols on startup, store permanently. Refresh weekly.
// ============================================================
async function fetchAndArchiveHistorical() {
  try {
    const router = getDataRouter();
    const yahooProvider = router.getProvider('YAHOO');
    if (!yahooProvider) return;
    let count = 0;
    for (const meta of ALL_SYMBOLS) {
      try {
        const candles = await yahooProvider.fetchHistoricalCandles(meta.symbol, '10y', '1d');
        if (candles.length > 0) {
          archiveHistoricalCandles(meta.symbol, candles);
          count++;
        }
        await new Promise(r => setTimeout(r, 200)); // rate-limit friendly
      } catch { /* skip individual failures */ }
    }
    console.log(`[odss-market] Historical data archived: ${count} symbols`);
  } catch (e) {
    console.warn('[odss-market] Historical archive failed:', (e as Error).message);
  }
}
setTimeout(fetchAndArchiveHistorical, 10000); // start after 10s
setInterval(fetchAndArchiveHistorical, 7 * 24 * 60 * 60 * 1000); // weekly refresh
console.log('[odss-market] Historical data archive loop started (weekly refresh)');

let ticking = true;
let scanning = true;

// Tick loop: advance simulator and broadcast market data
setInterval(async () => {
  if (!ticking) return;
  try {
    tick();
    // Record tick if session is active
    if (isRecording()) {
      await recordTick();
    }
    const quotes = getAllQuotes().slice(0, 30); // top 30 for UI
    const nifty = getQuote('NIFTY');
    const bankNifty = getQuote('BANKNIFTY');
    const vix = getIndiaVix();
    const breadth = getMarketBreadth();

    // Broadcast guardrail status
    const config = await getConfig();
    const guardrails = getGuardrailStatus(config);

    io.emit('market:tick', {
      timestamp: Date.now(),
      vix,
      breadth,
      nifty: nifty ? { ltp: nifty.ltp, changePct: nifty.changePct, vwap: nifty.vwap, open: nifty.open, high: nifty.high, low: nifty.low } : null,
      bankNifty: bankNifty ? { ltp: bankNifty.ltp, changePct: bankNifty.changePct, vwap: bankNifty.vwap } : null,
      quotes: quotes.map((q) => ({
        symbol: q.symbol,
        sector: q.sector,
        ltp: q.ltp,
        changePct: q.changePct,
        vwap: q.vwap,
        volume: q.volume,
      })),
      guardrails,
      recording: isRecording(),
      realData: {
        source: realDataStats.source,
        lastSuccess: realDataStats.lastSuccess,
        fetched: realDataStats.fetched,
        ageMs: realDataStats.lastSuccess ? Date.now() - realDataStats.lastSuccess : null,
      },
    });
  } catch (e) {
    console.error('[odss-market] Tick error:', e.message);
  }
}, TICK_INTERVAL_MS);

// Scan loop: run all engines and broadcast results
setInterval(async () => {
  if (!scanning) return;

  // ─── MARKET SESSION GUARD ───
  // When market is CLOSED, DON'T run scans — engine state is frozen.
  // This prevents picks from shuffling when no real trading is happening.
  if (!shouldEngineBeActive()) {
    return;
  }

  try {
    await runScan();
    if (isRecording()) {
      await recordScan();
    }
    const store = getStore();

    // ─── OPTION-CHAIN CONFLUENCE ENRICHMENT ───
    // Blend the real delta/OI confluence (entry/exit timing) into the conviction
    // picks so "enter on time / exit on time" reflects the option chain + delta
    // ON TOP OF the technical setup. Only fires when real chains are flowing.
    enrichWithOCConfluence(store);

    // ─── OUTCOME SCOREBOARD (the engine grades its own displayed signals) ───
    try {
      const conv: any = store.conviction;
      if (conv) recordDisplayedPicks([...(conv.cePicks ?? []), ...(conv.pePicks ?? [])]);
      const qmap: Record<string, number> = {};
      for (const q of getAllQuotes()) qmap[q.symbol] = q.ltp;
      updateOutcomes(qmap);
      (store as any).pickStats = getPickStats();
    } catch { /* non-critical */ }

    // Persist news-shock events with timestamps (deduped) for the Opportunities tab.
    try { recordNewsShocks((store.conviction as any)?.newsShockPicks); } catch {}

    const ocConfluence = (store as any).ocConfluence || {};
    const indexControl = (store as any).indexControl || {};

    // Write full state to shared file so the web server's API routes can read it
    try {
      const niftyQ = getQuote('NIFTY'); const bnQ = getQuote('BANKNIFTY');
      const stateData = {
        timestamp: Date.now(),
        market: store.market,
        sectors: store.sectors,
        rs: store.rs,
        opportunities: store.opportunities,
        conviction: store.conviction,
        activeTrade: store.activeTrade,
        topRecommendations: Array.from(store.recommendations.values()).slice(0, 10),
        // Extra fields so REMOTE (HTTP-polling) spectators get live prices + positions.
        nifty: niftyQ ? { ltp: niftyQ.ltp, changePct: niftyQ.changePct, vwap: niftyQ.vwap, open: niftyQ.open, high: niftyQ.high, low: niftyQ.low } : null,
        bankNifty: bnQ ? { ltp: bnQ.ltp, changePct: bnQ.changePct, vwap: bnQ.vwap } : null,
        vix: getIndiaVix(),
        liveQuotes: getAllQuotes().slice(0, 30).map(q => ({ symbol: q.symbol, ltp: q.ltp, changePct: q.changePct, vwap: q.vwap, volume: q.volume, sector: q.sector })),
        takenTrades: listTaken('ACTIVE').map(analyzeTakenTrade),
        smartMoney: (store as any).smartMoney || null,
        squeezes: (store as any).squeezes || [],
        completedSqueezes: (store as any).completedSqueezes || [],
        ocConfluence,
        indexControl,
        pickStats: (store as any).pickStats || null,
        decisionLog: store.decisionLog.slice(0, 50),
        completedTrades: store.completedTrades.slice(0, 20),
        lastScanAt: store.lastScanAt,
      };
      writeFileSync(dataPath('engine-state.json'), JSON.stringify(stateData));
    } catch {}

    io.emit('odss:update', {
      timestamp: Date.now(),
      market: store.market,
      sectors: store.sectors,
      rs: store.rs,
      opportunities: store.opportunities,
      conviction: store.conviction,
      activeTrade: store.activeTrade,
      topRecommendations: Array.from(store.recommendations.values()).slice(0, 10),
        smartMoney: (store as any).smartMoney || null,
        squeezes: (store as any).squeezes || [],
        completedSqueezes: (store as any).completedSqueezes || [],
        ocConfluence,
        indexControl,
      decisionLog: store.decisionLog.slice(0, 20),
      recording: isRecording(),
    });
  } catch (e: any) {
    console.error('[odss-market] Scan error:', e?.message || e);
  }
}, SCAN_INTERVAL_MS);

// Per-symbol option chain streaming for the focused symbol
let focusedSymbol: string | null = null;
setInterval(() => {
  if (!focusedSymbol) return;
  try {
    const chain = getOptionChain(focusedSymbol);
    if (chain) {
      io.emit('optionchain:update', {
        symbol: focusedSymbol,
        chain: {
          spot: chain.spot,
          atmStrike: chain.atmStrike,
          pcr: chain.pcr,
          maxPainStrike: chain.maxPainStrike,
          strikes: chain.strikes.slice(0, 30),
          expiry: chain.expiry,
        },
        timestamp: Date.now(),
      });
    }
  } catch (e) {
    // ignore
  }
}, TICK_INTERVAL_MS);

io.on('connection', (socket) => {
  console.log(`[odss-market] Client connected: ${socket.id}`);

  // Send snapshot immediately
  const store = getStore();
  socket.emit('odss:snapshot', {
    market: store.market,
    sectors: store.sectors,
    rs: store.rs,
    opportunities: store.opportunities,
    activeTrade: store.activeTrade,
    topRecommendations: Array.from(store.recommendations.values()).slice(0, 10),
        smartMoney: (store as any).smartMoney || null,
        squeezes: (store as any).squeezes || [],
        completedSqueezes: (store as any).completedSqueezes || [],
    decisionLog: store.decisionLog.slice(0, 30),
  });

  socket.on('focus', (symbol: string) => {
    focusedSymbol = symbol;
    socket.emit('focused', { symbol });
  });

  // Run the EOD positioning scan on demand (full universe, or a small limit for a quick preview).
  socket.on('eod:run', async (payload: any, ack?: (res: any) => void) => {
    const cb = typeof payload === 'function' ? payload : ack;
    const limit = (payload && typeof payload === 'object' && Number(payload.limit)) || 999;
    try {
      const report = await runEODScan('manual', limit);
      if (cb) cb({ ok: true, report });
    } catch (e: any) {
      if (cb) cb({ ok: false, error: e.message });
    }
  });

  socket.on('manual:scan', async () => {
    try {
      await runScan();
      const s = getStore();
      socket.emit('odss:update', {
        timestamp: Date.now(),
        market: s.market,
        sectors: s.sectors,
        rs: s.rs,
        opportunities: s.opportunities,
        activeTrade: s.activeTrade,
        topRecommendations: Array.from(s.recommendations.values()).slice(0, 10),
        smartMoney: (s as any).smartMoney || null,
        squeezes: (s as any).squeezes || [],
        completedSqueezes: (s as any).completedSqueezes || [],
        decisionLog: s.decisionLog.slice(0, 20),
      });
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('reset:simulator', () => {
    resetSimulator();
    for (let i = 0; i < 30; i++) tick();
    socket.emit('reset:done', { ts: Date.now() });
  });

  // Trade mutations with acknowledgement (frontend uses emit + ack)
  socket.on('trade:enter', async (payload: { symbol: string; direction: Direction }, ack?: (res: any) => void) => {
    try {
      // Guardrail check before entry
      const config = await getConfig();
      const guardrail = await checkGuardrails(payload.symbol.toUpperCase(), payload.direction, config);
      if (!guardrail.allowed) {
        if (ack) ack({ ok: false, error: guardrail.reason, guardrail: guardrail.guardrail });
        return;
      }
      const trade = await enterTrade(payload.symbol.toUpperCase(), payload.direction);
      registerTradeEntry();
      broadcastUpdate();
      if (ack) ack({ ok: true, trade, warnings: guardrail.warnings });
    } catch (e: any) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on('trade:exit', async (payload: { reason?: string }, ack?: (res: any) => void) => {
    try {
      const store = getStore();
      const trade = store.activeTrade;
      const pnl = trade?.pnl ?? 0;
      await exitTrade(payload.reason || 'Manual exit via dashboard');
      registerTradeExit(pnl);
      broadcastUpdate();
      if (ack) ack({ ok: true });
    } catch (e: any) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  // ====== REPLAY / VALIDATION HANDLERS ======

  socket.on('replay:start', async (payload: { name?: string }, ack?: (res: any) => void) => {
    try {
      const sessionId = await startRecording(payload.name);
      console.log(`[odss-market] Recording started: ${sessionId}`);
      if (ack) ack({ ok: true, sessionId });
    } catch (e: any) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on('replay:stop', async (_payload: any, ack?: (res: any) => void) => {
    const cb = typeof _payload === 'function' ? _payload : ack;
    try {
      const result = await stopRecording();
      console.log(`[odss-market] Recording stopped: ${result.sessionId} (${result.tickCount} ticks, ${result.scanCount} scans)`);
      if (cb) cb({ ok: true, ...result });
    } catch (e: any) {
      if (cb) cb({ ok: false, error: e.message });
    }
  });

  socket.on('replay:status', (_payload: any, ack?: (res: any) => void) => {
    // Handle case where ack is the first arg (no payload sent)
    const cb = typeof _payload === 'function' ? _payload : ack;
    if (cb) cb({ recording: isRecording(), sessionId: getCurrentSessionId() });
  });

  socket.on('replay:sessions', async (_payload: any, ack?: (res: any) => void) => {
    const cb = typeof _payload === 'function' ? _payload : ack;
    try {
      const sessions = await listSessions();
      if (cb) cb({ ok: true, sessions });
    } catch (e: any) {
      if (cb) cb({ ok: false, error: e.message });
    }
  });

  socket.on('replay:validate', async (payload: { sessionId: string }, ack?: (res: any) => void) => {
    try {
      console.log(`[odss-market] Generating validation report for session ${payload.sessionId}...`);
      const report = await generateValidationReport(payload.sessionId);
      console.log(`[odss-market] Validation report generated: ${report.decisions.ENTER} ENTERs, ${report.enterOutcomes.winRate} win rate`);
      if (ack) ack({ ok: true, report });
    } catch (e: any) {
      console.error('[odss-market] Validation error:', e.message);
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  // Guardrail status
  socket.on('guardrails:status', async (ack?: (res: any) => void) => {
    try {
      const config = await getConfig();
      const status = getGuardrailStatus(config);
      if (ack) ack(status);
    } catch (e: any) {
      if (ack) ack({ error: e.message });
    }
  });

  // Toggle real data injection on/off
  socket.on('realdata:toggle', (enabled: boolean, ack?: (res: any) => void) => {
    realDataEnabled = enabled;
    console.log(`[odss-market] Real data injection ${enabled ? 'ENABLED' : 'DISABLED'}`);
    if (ack) ack({ enabled: realDataEnabled });
  });

  // Get real data stats
  socket.on('realdata:status', (_payload: any, ack?: (res: any) => void) => {
    if (ack) ack({
      enabled: realDataEnabled,
      ...realDataStats,
      lastFetchAgo: lastRealDataFetch ? Date.now() - lastRealDataFetch : null,
    });
  });

  // Force immediate real data refresh
  socket.on('realdata:refresh', async (_payload: any, ack?: (res: any) => void) => {
    try {
      await fetchAndInjectRealData();
      if (ack) ack({ ok: true, ...realDataStats });
    } catch (e: any) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[odss-market] Client disconnected: ${socket.id}`);
  });
});

function broadcastUpdate() {
  const s = getStore();
  io.emit('odss:update', {
    timestamp: Date.now(),
    market: s.market,
    sectors: s.sectors,
    rs: s.rs,
    opportunities: s.opportunities,
    activeTrade: s.activeTrade,
    topRecommendations: Array.from(s.recommendations.values()).slice(0, 10),
        smartMoney: (s as any).smartMoney || null,
        squeezes: (s as any).squeezes || [],
        completedSqueezes: (s as any).completedSqueezes || [],
    decisionLog: s.decisionLog.slice(0, 20),
  });
}

httpServer.listen(PORT, () => {
  console.log(`[odss-market] WebSocket server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[odss-market] SIGTERM received, shutting down...');
  io.close();
  httpServer.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[odss-market] SIGINT received, shutting down...');
  io.close();
  httpServer.close(() => process.exit(0));
});
