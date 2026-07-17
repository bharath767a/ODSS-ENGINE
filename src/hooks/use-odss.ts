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
  connected: false,
  lastUpdate: 0,
  recording: false,
  guardrails: null,
};

let socket: Socket | null = null;
let listeners = new Set<(s: ODSSState) => void>();
let currentState: ODSSState = initialState;

function connect() {
  if (socket) return socket;
  socket = io('/', {
    path: '/',
    query: { XTransformPort: '3002' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
  });

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
      decisionLog: data.decisionLog ?? currentState.decisionLog,
      lastUpdate: Date.now(),
    };
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
} {
  const [state, setState] = useState<ODSSState>(currentState);

  useEffect(() => {
    connect();
    listeners.add(setState);
    // Use a microtask to avoid synchronous setState in effect
    Promise.resolve().then(() => setState(currentState));
    return () => {
      listeners.delete(setState);
    };
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

  return { ...state, enterTrade, exitTrade, focusSymbol, resetSimulator, manualScan, startRecording, stopRecording, listSessions, validateSession };
}
