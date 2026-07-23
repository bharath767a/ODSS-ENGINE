'use client';

import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  MarketEngineOutput,
  SectorEngineOutput,
  RSEngineOutput,
  OpportunityEngineOutput,
  LiveTrade,
  Recommendation,
} from '@/lib/odss/types';

export interface ODSSState {
  market: MarketEngineOutput | null;
  sectors: SectorEngineOutput | null;
  rs: RSEngineOutput | null;
  opportunities: OpportunityEngineOutput | null;
  conviction: any | null;
  activeTrade: LiveTrade | null;
  topRecommendations: Recommendation[];
  decisionLog: { timestamp: number; level: string; engine: string; symbol?: string; message: string }[];
  // Live market ticks
  liveQuotes: Record<string, { ltp: number; changePct: number; vwap: number; volume: number; sector?: string }>;
  nifty: { ltp: number; changePct: number; vwap: number; open: number; high: number; low: number } | null;
  bankNifty: { ltp: number; changePct: number; vwap: number } | null;
  vix: number;
  breadth: { advanceCount: number; declineCount: number; advanceDeclineRatio: number } | null;
  // Focused symbol option chain
  optionChain: any | null;
  // Taken positions (tracked with real greeks) + option-chain confluence
  takenTrades: any[];
  ocConfluence: Record<string, any>;
  indexControl: Record<string, any>;
  confluence: any[] | null;
  connected: boolean;
  lastUpdate: number;
  // Recording status
  recording: boolean;
  // Guardrails
  guardrails: {
    tradesToday: number;
    maxTradesPerDay: number;
    realizedPnlToday: number;
    maxDailyLossRupees: number;
    profitCapRupees: number;
    remainingTrades: number;
  } | null;
}

const initialState: ODSSState = {
  market: null,
  sectors: null,
  rs: null,
  opportunities: null,
  conviction: null,
  activeTrade: null,
  topRecommendations: [],
  decisionLog: [],
  liveQuotes: {},
  nifty: null,
  bankNifty: null,
  vix: 0,
  breadth: null,
  optionChain: null,
  takenTrades: [],
  ocConfluence: {},
  indexControl: {},
  confluence: null,
  connected: false,
  lastUpdate: 0,
  recording: false,
  guardrails: null,
};

let socket: Socket | null = null;
let listeners = new Set<(s: ODSSState) => void>();
let currentState: ODSSState = initialState;

let pollStarted = false;
function startPolling() {
  if (pollStarted) return; pollStarted = true;
  currentState = { ...currentState, connected: true };
  const poll = async () => {
    try {
      const r = await fetch('/api/odss/state', { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      const liveQuotes: ODSSState['liveQuotes'] = {};
      for (const q of s.liveQuotes ?? []) liveQuotes[q.symbol] = { ltp: q.ltp, changePct: q.changePct, vwap: q.vwap, volume: q.volume, sector: q.sector };
      currentState = {
        ...currentState, connected: true,
        market: s.market ?? currentState.market,
        sectors: s.sectors ?? currentState.sectors,
        rs: s.rs ?? currentState.rs,
        opportunities: s.opportunities ?? currentState.opportunities,
        conviction: s.conviction ?? currentState.conviction,
        activeTrade: s.activeTrade ?? currentState.activeTrade,
        topRecommendations: s.topRecommendations ?? currentState.topRecommendations,
        indexControl: s.indexControl ?? currentState.indexControl,
        ocConfluence: s.ocConfluence ?? currentState.ocConfluence,
        takenTrades: s.takenTrades ?? currentState.takenTrades,
        decisionLog: s.decisionLog ?? currentState.decisionLog,
        vix: s.vix ?? currentState.vix,
        nifty: s.nifty ?? currentState.nifty,
        bankNifty: s.bankNifty ?? currentState.bankNifty,
        liveQuotes: Object.keys(liveQuotes).length ? liveQuotes : currentState.liveQuotes,
        lastUpdate: Date.now(),
      };
      emit();
    } catch { /* keep last state */ }
  };
  poll();
  setInterval(poll, 4000);
}

function connect() {
  if (socket) return socket;
  // Remote spectators (e.g. a shared ngrok link) can't reach the local socket on
  // :3002 — serve them a read-only view by polling the state API over HTTP.
  const rloc = typeof window !== 'undefined' ? window.location : null;
  if (rloc && rloc.hostname !== 'localhost' && rloc.hostname !== '127.0.0.1') {
    startPolling();
    return null as unknown as Socket;
  }
  // How to reach the market-service socket (port 3002):
  //  - Hosted behind the Caddy proxy: connect to the same origin and let Caddy
  //    route ?XTransformPort=3002 to :3002.
  //  - Local dev opened directly on :3000 (plain `next dev`, no proxy): there is
  //    nothing to route the query, so connect straight to localhost:3002.
  const baseOpts = { path: '/', transports: ['websocket', 'polling'] as string[], reconnection: true, reconnectionDelay: 2000 };
  const loc = typeof window !== 'undefined' ? window.location : null;
  const isLocalDirect = !!loc && (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && loc.port === '3000';
  if (isLocalDirect) {
    socket = io(`${loc!.protocol}//${loc!.hostname}:3002`, { ...baseOpts });
  } else {
    socket = io('/', { ...baseOpts, query: { XTransformPort: '3002' } });
  }

  socket.on('connect', () => {
    currentState = { ...currentState, connected: true };
    emit();
  });

  socket.on('disconnect', () => {
    currentState = { ...currentState, connected: false };
    emit();
  });

  socket.on('odss:snapshot', (data: any) => {
    currentState = {
      ...currentState,
      market: data.market,
      sectors: data.sectors,
      rs: data.rs,
      opportunities: data.opportunities,
      conviction: data.conviction ?? null,
      activeTrade: data.activeTrade,
      topRecommendations: data.topRecommendations ?? [],
      decisionLog: data.decisionLog ?? [],
      lastUpdate: Date.now(),
    };
    emit();
  });

  socket.on('odss:update', (data: any) => {
    currentState = {
      ...currentState,
      market: data.market ?? currentState.market,
      sectors: data.sectors ?? currentState.sectors,
      rs: data.rs ?? currentState.rs,
      opportunities: data.opportunities ?? currentState.opportunities,
      conviction: data.conviction ?? currentState.conviction,
      activeTrade: data.activeTrade !== undefined ? data.activeTrade : currentState.activeTrade,
      topRecommendations: data.topRecommendations ?? currentState.topRecommendations,
      ocConfluence: data.ocConfluence ?? currentState.ocConfluence,
      indexControl: data.indexControl ?? currentState.indexControl,
      decisionLog: data.decisionLog ?? currentState.decisionLog,
      lastUpdate: Date.now(),
    };
    emit();
  });

  socket.on('taken-trades:update', (data: any) => {
    currentState = { ...currentState, takenTrades: data.trades ?? [], lastUpdate: Date.now() };
    emit();
  });

  socket.on('market:tick', (data: any) => {
    const liveQuotes: ODSSState['liveQuotes'] = {};
    for (const q of data.quotes ?? []) {
      liveQuotes[q.symbol] = { ltp: q.ltp, changePct: q.changePct, vwap: q.vwap, volume: q.volume, sector: q.sector };
    }
    currentState = {
      ...currentState,
      vix: data.vix ?? currentState.vix,
      breadth: data.breadth ?? currentState.breadth,
      nifty: data.nifty ?? currentState.nifty,
      bankNifty: data.bankNifty ?? currentState.bankNifty,
      liveQuotes,
      lastUpdate: Date.now(),
      recording: data.recording ?? currentState.recording,
      guardrails: data.guardrails ?? currentState.guardrails,
    };
    emit();
  });

  socket.on('optionchain:update', (data: any) => {
    currentState = { ...currentState, optionChain: data.chain };
    emit();
  });

  return socket;
}

function emit() {
  for (const l of listeners) l(currentState);
}

export function useODSS(): ODSSState & {
  enterTrade: (symbol: string, direction: 'CE' | 'PE') => Promise<{ ok: boolean; error?: string; guardrail?: string }>;
  exitTrade: (reason?: string) => Promise<{ ok: boolean; error?: string }>;
  focusSymbol: (symbol: string) => void;
  resetSimulator: () => Promise<void>;
  manualScan: () => void;
  // Replay / validation
  startRecording: (name?: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  stopRecording: () => Promise<{ ok: boolean; tickCount?: number; scanCount?: number; error?: string }>;
  listSessions: () => Promise<{ ok: boolean; sessions?: any[]; error?: string }>;
  validateSession: (sessionId: string) => Promise<{ ok: boolean; report?: any; error?: string }>;
  closeTaken: (idOrSymbol: { id?: string; symbol?: string; direction?: string }, reason?: string) => Promise<any>;
} {
  const [state, setState] = useState<ODSSState>(currentState);

  useEffect(() => {
    connect();
    listeners.add(setState);
    // Use a microtask to avoid synchronous setState in effect
    Promise.resolve().then(() => setState(currentState));
    // Seed taken positions immediately (before the first socket push).
    fetch('/api/odss/taken-trades').then(r => r.json()).then((d) => {
      if (Array.isArray(d?.trades)) { currentState = { ...currentState, takenTrades: d.trades }; emit(); }
    }).catch(() => {});
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const closeTaken = useCallback((idOrSymbol: { id?: string; symbol?: string; direction?: string }, reason?: string) => {
    const qs = idOrSymbol.id ? `id=${encodeURIComponent(idOrSymbol.id)}`
      : `symbol=${encodeURIComponent(idOrSymbol.symbol || '')}${idOrSymbol.direction ? `&direction=${idOrSymbol.direction}` : ''}`;
    return fetch(`/api/odss/taken-trades?${qs}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`, { method: 'DELETE' })
      .then(r => r.json()).catch((e) => ({ error: e.message }));
  }, []);

  const enterTrade = useCallback((symbol: string, direction: 'CE' | 'PE') => {
    return new Promise<{ ok: boolean; error?: string; guardrail?: string }>((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('trade:enter', { symbol, direction }, (res: any) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }, []);

  const exitTrade = useCallback((reason?: string) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('trade:exit', { reason }, (res: any) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }, []);

  const focusSymbol = useCallback((symbol: string) => {
    socket?.emit('focus', symbol);
  }, []);

  const resetSimulator = useCallback(async () => {
    return new Promise<void>((resolve) => {
      if (!socket) return resolve();
      socket.emit('reset:simulator', () => resolve());
    });
  }, []);

  const manualScan = useCallback(() => {
    socket?.emit('manual:scan');
  }, []);

  const startRecording = useCallback((name?: string) => {
    return new Promise<{ ok: boolean; sessionId?: string; error?: string }>((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('replay:start', { name }, (res: any) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }, []);

  const stopRecording = useCallback(() => {
    return new Promise<{ ok: boolean; tickCount?: number; scanCount?: number; error?: string }>((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('replay:stop', {}, (res: any) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }, []);

  const listSessions = useCallback(() => {
    return new Promise<{ ok: boolean; sessions?: any[]; error?: string }>((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('replay:sessions', {}, (res: any) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }, []);

  const validateSession = useCallback((sessionId: string) => {
    return new Promise<{ ok: boolean; report?: any; error?: string }>((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('replay:validate', { sessionId }, (res: any) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }, []);

  return { ...state, enterTrade, exitTrade, focusSymbol, resetSimulator, manualScan, startRecording, stopRecording, listSessions, validateSession, closeTaken };
}
