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
import { tick, getQuote, getAllQuotes, getIndiaVix, getMarketBreadth, getOptionChain, resetSimulator } from '../../src/lib/odss/simulator/market-simulator';
import { runScan, enterTrade, exitTrade } from '../../src/lib/odss/orchestrator';
import { getStore, loadActiveTradeFromDb } from '../../src/lib/odss/store/store';
import { getConfig } from '../../src/lib/odss/config';
import { startRecording, stopRecording, recordTick, recordScan, isRecording, listSessions, getCurrentSessionId } from '../../src/lib/odss/replay/recorder';
import { generateValidationReport } from '../../src/lib/odss/replay/validator';
import { checkGuardrails, registerTradeEntry, registerTradeExit, getGuardrailStatus } from '../../src/lib/odss/engines/guardrails-engine';
import { ensureSeedUsers } from '../../src/lib/user-manager';
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
    // Record scan if session is active
    if (isRecording()) {
      await recordScan();
    }
    const store = getStore();
    io.emit('odss:update', {
      timestamp: Date.now(),
      market: store.market,
      sectors: store.sectors,
      rs: store.rs,
      opportunities: store.opportunities,
      activeTrade: store.activeTrade,
      topRecommendations: Array.from(store.recommendations.values()).slice(0, 10),
      decisionLog: store.decisionLog.slice(0, 20),
      recording: isRecording(),
    });
  } catch (e) {
    console.error('[odss-market] Scan error:', e.message);
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
