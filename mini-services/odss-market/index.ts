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
import { archiveLiveQuotes, archiveHistoricalCandles } from '../../src/lib/odss/archive/data-archive';
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
const REAL_DATA_INTERVAL_MS = 10_000; // 10 seconds
const REAL_DATA_SYMBOLS = ALL_SYMBOLS.map((s) => s.symbol);
let realDataEnabled = true;
let lastRealDataFetch = 0;
let realDataStats = { fetched: 0, failed: 0, lastSuccess: 0 as number | null, source: 'NONE' as string };

// Write quotes to a shared file so the web server can read real prices
function writeQuotesFile() {
  try {
    const allQuotes = getAllQuotes();
    const nifty = getQuote('NIFTY');
    const bankNifty = getQuote('BANKNIFTY');
    const vix = getIndiaVix();
    writeFileSync('/home/z/odss-data/quotes.json', JSON.stringify({
      quotes: allQuotes.map((q) => ({ symbol: q.symbol, ltp: q.ltp, prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, volume: q.volume, vwap: q.vwap, changePct: q.changePct, sector: q.sector })),
      nifty: nifty ? { ltp: nifty.ltp, changePct: nifty.changePct, vwap: nifty.vwap, open: nifty.open, high: nifty.high, low: nifty.low } : null,
      bankNifty: bankNifty ? { ltp: bankNifty.ltp, changePct: bankNifty.changePct, vwap: bankNifty.vwap } : null,
      vix, ts: Date.now(), source: realDataStats.source,
    }));
  } catch (e) { console.warn('[odss-market] Failed to write quotes file:', (e as Error).message); }
}

async function fetchAndInjectRealData() {
  if (!realDataEnabled) return;
  console.log('[odss-market] fetchAndInjectRealData: starting...');
  try {
    const router = getDataRouter();
    const yahooProvider = router.getProvider('YAHOO');
    if (!yahooProvider) {
      console.warn('[odss-market] Yahoo provider not available in router');
      return;
    }
    console.log('[odss-market] Yahoo provider found, fetching VIX...');

    // Fetch India VIX first (most important)
    try {
      const vix = await yahooProvider.getIndiaVIX();
      console.log('[odss-market] Yahoo VIX result:', vix);
      if (vix > 0 && vix < 200) {
        injectRealVix(vix);
        realDataStats.source = 'YAHOO';
      }
    } catch (e) {
      console.warn('[odss-market] VIX fetch failed:', (e as Error).message);
    }

    // Fetch quotes for all symbols in batches (Yahoo rate-limits)
    // Prioritize indices first, then stocks
    const indices = REAL_DATA_SYMBOLS.filter((s) => {
      const meta = ALL_SYMBOLS.find((a) => a.symbol === s);
      return meta?.type === 'INDEX';
    });
    const stocks = REAL_DATA_SYMBOLS.filter((s) => {
      const meta = ALL_SYMBOLS.find((a) => a.symbol === s);
      return meta?.type === 'STOCK';
    });

    // Fetch indices (small list, fetch all at once)
    let fetched = 0;
    for (const sym of indices) {
      try {
        const q = await yahooProvider.getQuote(sym);
        if (q && q.ltp > 0) {
          injectRealQuote(sym, {
            ltp: q.ltp,
            prevClose: q.prevClose,
            open: q.open,
            high: q.high,
            low: q.low,
            volume: q.volume,
            changePct: q.changePct,
            vwap: q.vwap,
          });
          fetched++;
          console.log(`[odss-market] Injected ${sym}: ${q.ltp} (change ${q.changePct.toFixed(2)}%)`);
        }
      } catch {
        // individual quote failed — continue
      }
    }

    // Fetch stocks in smaller batches to respect rate limits
    const stockBatch = stocks.slice(0, 10); // fetch 10 stocks per cycle (rotates)
    const offset = Math.floor(Date.now() / REAL_DATA_INTERVAL_MS) % Math.ceil(stocks.length / 10);
    const startIdx = offset * 10;
    const stockSlice = stocks.slice(startIdx, startIdx + 10);
    for (const sym of stockSlice) {
      try {
        const q = await yahooProvider.getQuote(sym);
        if (q && q.ltp > 0) {
          injectRealQuote(sym, {
            ltp: q.ltp,
            prevClose: q.prevClose,
            open: q.open,
            high: q.high,
            low: q.low,
            volume: q.volume,
            changePct: q.changePct,
            vwap: q.vwap,
          });
          fetched++;
        }
      } catch {
        // individual quote failed — continue
      }
    }

    realDataStats.fetched = fetched;
    realDataStats.lastSuccess = Date.now();
    if (fetched > 0) {
      realDataStats.source = 'YAHOO';
    }
    lastRealDataFetch = Date.now();
    // Write quotes file so the web server can read real prices
    writeQuotesFile();
    // Archive live quotes for permanent storage (never deleted)
    try { archiveLiveQuotes(getAllQuotes()); } catch {}
  } catch (e) {
    realDataStats.failed++;
    console.warn('[odss-market] Real data fetch error:', (e as Error).message);
  }
}

// Start the real data injection loop
setInterval(fetchAndInjectRealData, REAL_DATA_INTERVAL_MS);
// Fetch immediately on startup (after a 2s delay to let the simulator warm up)
setTimeout(fetchAndInjectRealData, 2000);
console.log('[odss-market] Real data injection loop started (Yahoo Finance, 10s interval)');

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
        const candles = await yahooProvider.fetchHistoricalCandles(meta.symbol, '1y', '1d');
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
  try {
    await runScan();
    if (isRecording()) {
      await recordScan();
    }
    const store = getStore();

    // Write full state to shared file so the web server's API routes can read it
    try {
      const stateData = {
        timestamp: Date.now(),
        market: store.market,
        sectors: store.sectors,
        rs: store.rs,
        opportunities: store.opportunities,
        conviction: store.conviction,
        activeTrade: store.activeTrade,
        topRecommendations: Array.from(store.recommendations.values()).slice(0, 10),
        decisionLog: store.decisionLog.slice(0, 50),
        completedTrades: store.completedTrades.slice(0, 20),
        lastScanAt: store.lastScanAt,
      };
      writeFileSync('/home/z/odss-data/engine-state.json', JSON.stringify(stateData));
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
    decisionLog: store.decisionLog.slice(0, 30),
  });

  socket.on('focus', (symbol: string) => {
    focusedSymbol = symbol;
    socket.emit('focused', { symbol });
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
