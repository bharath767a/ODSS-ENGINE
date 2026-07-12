/**
 * ODSS - Replay Recorder (Milestone 2 — Validation)
 *
 * Records every tick + every scan to the database for deterministic replay.
 * The recorder hooks into the mini-service's tick + scan loops.
 *
 * Recording is opt-in (started via API or dashboard button).
 * When stopped, the session is marked COMPLETE and ready for replay.
 */
import { db } from '@/lib/db';
import { getAllQuotes, getIndiaVix, getMarketBreadth, getQuote } from '../simulator/market-simulator';
import { getStore } from '../store/store';

let currentSessionId: string | null = null;
let tickCount = 0;
let scanCount = 0;
let regimeHistory: { regime: string; startTick: number; endTick: number | null }[] = [];
let lastRegime: string | null = null;
let lastRegimeStart = 0;

export async function startRecording(name?: string): Promise<string> {
  if (currentSessionId) {
    throw new Error('Recording already in progress. Stop it first.');
  }

  const session = await db.replaySession.create({
    data: {
      name: name || `Session ${new Date().toLocaleString('en-IN')}`,
      status: 'RECORDING',
      startTime: new Date(),
    },
  });

  currentSessionId = session.id;
  tickCount = 0;
  scanCount = 0;
  regimeHistory = [];
  lastRegime = null;
  lastRegimeStart = 0;

  return session.id;
}

export async function recordTick(): Promise<void> {
  if (!currentSessionId) return;

  try {
    const vix = getIndiaVix();
    const quotes = getAllQuotes();
    const breadth = getMarketBreadth();

    const quotesJson = JSON.stringify(
      quotes.reduce((acc, q) => {
        acc[q.symbol] = {
          ltp: q.ltp,
          changePct: q.changePct,
          vwap: q.vwap,
          volume: q.volume,
          sector: q.sector,
        };
        return acc;
      }, {} as Record<string, any>)
    );

    const breadthJson = JSON.stringify(breadth);

    await db.replayTick.create({
      data: {
        sessionId: currentSessionId,
        tickNumber: tickCount,
        vix,
        quotes: quotesJson,
        breadth: breadthJson,
      },
    });

    // Track regime changes
    const { getRegime } = await import('../simulator/market-simulator');
    const currentRegime = getRegime();
    if (currentRegime !== lastRegime) {
      if (lastRegime) {
        regimeHistory.push({
          regime: lastRegime,
          startTick: lastRegimeStart,
          endTick: tickCount - 1,
        });
      }
      lastRegime = currentRegime;
      lastRegimeStart = tickCount;
    }

    tickCount++;
  } catch (e) {
    console.error('[recorder] recordTick error:', (e as Error).message);
  }
}

export async function recordScan(): Promise<void> {
  if (!currentSessionId) return;

  try {
    const store = getStore();
    const market = store.market;
    const sectors = store.sectors;
    const opportunities = store.opportunities;
    const recs = Array.from(store.recommendations.values()).slice(0, 10);

    const top = recs[0];

    await db.replayScan.create({
      data: {
        sessionId: currentSessionId,
        scanNumber: scanCount,
        tickNumber: Math.max(0, tickCount - 1),
        timestamp: new Date(),
        market: market ? JSON.stringify(market) : null,
        sectors: sectors ? JSON.stringify(sectors) : null,
        opportunities: opportunities ? JSON.stringify(opportunities) : null,
        topSymbol: top?.symbol ?? null,
        topDirection: top?.direction ?? null,
        topScore: top?.opportunity.totalScore ?? null,
        topDecision: top?.decision.decision ?? null,
        topConfidence: top?.decision.confidence ?? null,
        recommendations: JSON.stringify(recs),
      },
    });

    scanCount++;
  } catch (e) {
    console.error('[recorder] recordScan error:', (e as Error).message);
  }
}

export async function stopRecording(): Promise<{ sessionId: string; tickCount: number; scanCount: number }> {
  if (!currentSessionId) {
    throw new Error('No recording in progress.');
  }

  if (lastRegime) {
    regimeHistory.push({
      regime: lastRegime,
      startTick: lastRegimeStart,
      endTick: tickCount - 1,
    });
  }

  const nifty = getQuote('NIFTY');
  const vix = getIndiaVix();

  await db.replaySession.update({
    where: { id: currentSessionId },
    data: {
      status: 'COMPLETE',
      endTime: new Date(),
      tickCount,
      scanCount,
      finalNifty: nifty?.ltp ?? null,
      finalVix: vix,
      regimeHistory: JSON.stringify(regimeHistory),
    },
  });

  const result = { sessionId: currentSessionId, tickCount, scanCount };
  currentSessionId = null;
  return result;
}

export function isRecording(): boolean {
  return currentSessionId !== null;
}

export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export async function listSessions(): Promise<any[]> {
  return db.replaySession.findMany({
    orderBy: { startTime: 'desc' },
    take: 50,
  });
}

export async function getSession(sessionId: string) {
  const session = await db.replaySession.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  return { session, tickCount: session.tickCount, scanCount: session.scanCount };
}
