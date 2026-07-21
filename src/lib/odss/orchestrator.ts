/**
 * ODSS - Orchestrator
 * Runs all engines in deterministic order on each scan:
 *   1. Market Engine
 *   2. Sector Engine
 *   3. Relative Strength Engine
 *   4. Opportunity Engine (uses 1+2+3, runs Technical+OptionChain for each symbol)
 *   5. For top opportunity (or active trade): Strike, Entry, Risk, Decision
 *   6. If active trade exists: Trade Management, Exit, State Machine
 *   7. Persist + log
 *
 * The orchestrator is the ONLY place that calls multiple engines together.
 * Each engine remains independently testable.
 */
import type { Recommendation, LiveTrade, Direction } from '../types';
import { db } from '@/lib/db';
import { runMarketEngine } from './engines/market-engine';
import { runSectorEngine } from './engines/sector-engine';
import { runRSEngine } from './engines/relative-strength-engine';
import { runOpportunityEngine } from './engines/opportunity-engine';
import { runTechnicalEngine } from './engines/technical-engine';
import { runOptionChainEngine } from './engines/option-chain-engine';
import { runStrikeEngine } from './engines/strike-engine';
import { runEntryEngine } from './engines/entry-engine';
import { runRiskEngine } from './engines/risk-engine';
import { runDecisionEngine } from './engines/decision-engine';
import { runTradeManagementEngine } from './engines/trade-management-engine';
import { runExitEngine } from './engines/exit-engine';
import { runConvictionEngine } from './engines/conviction-engine';
import { createInitialTrade, nextTradeState, applyStateTransition } from './state-machine';
import {
  getStore,
  setActiveTrade,
  getActiveTrade,
  persistActiveTrade,
  archiveTradeToJournal,
  logDecision,
} from './store/store';
import { getQuote } from './simulator/market-simulator';
import { explainDecision, explainTradeManagement } from './ai/explainer';
import { getConfig } from './config';

let scanInProgress = false;

export async function runScan(): Promise<void> {
  if (scanInProgress) return;
  scanInProgress = true;
  try {
    const config = await getConfig();
    const store = getStore();

    // 1. Market
    const market = runMarketEngine();
    store.market = market;
    logDecision('INFO', 'Market', `State ${market.marketState}, score ${market.marketScore.toFixed(0)}, VIX ${market.indiaVix.toFixed(2)}`);

    // 2. Sector
    const sectors = runSectorEngine();
    store.sectors = sectors;
    logDecision('INFO', 'Sector', `Top sector: ${sectors.sectors[0]?.sector} (${sectors.sectors[0]?.score.toFixed(0)})`);

    // 3. RS
    const rs = runRSEngine();
    store.rs = rs;
    logDecision('INFO', 'RS', `Strongest: ${rs.rows[0]?.symbol} (${rs.rows[0]?.rsScore.toFixed(0)})`);

    // 4. Opportunity
    const opportunities = runOpportunityEngine({ market, sector: sectors, rs });
    store.opportunities = opportunities;
    store.recommendations.clear();

    // 5. Build full recommendation for top N opportunities
    const topN = opportunities.rows.slice(0, 10);
    const sectorMap = new Map(sectors.sectors.map((s) => [s.sector, s]));
    const rsMap = new Map(rs.rows.map((r) => [r.symbol, r]));
    for (const opp of topN) {
      const technical = runTechnicalEngine(opp.symbol);
      const optionChain = runOptionChainEngine(opp.symbol);
      const sector = sectorMap.get(opp.sector ?? '');
      const rsRow = rsMap.get(opp.symbol);
      const strike = runStrikeEngine(opp.symbol, opp.direction, technical, optionChain, opp.confidence);
      const entry = runEntryEngine(opp.symbol, opp.direction, technical);
      const risk = runRiskEngine(opp.symbol, opp.direction, entry, technical);
      const decision = runDecisionEngine({
        direction: opp.direction,
        market,
        sector,
        rs: rsRow,
        technical,
        optionChain,
        risk,
      });

      const rec: Recommendation = {
        symbol: opp.symbol,
        sector: opp.sector,
        direction: opp.direction,
        market,
        sectorScore: sector,
        rs: rsRow,
        technical,
        optionChain,
        opportunity: opp,
        strike,
        entry,
        risk,
        decision,
        timestamp: Date.now(),
      };
      store.recommendations.set(opp.symbol, rec);
    }

    // 5b. Conviction Engine — stabilizes rankings, adds news momentum
    const liveQuotes: Record<string, { ltp: number; changePct: number }> = {};
    for (const opp of opportunities.rows.slice(0, 15)) {
      const q = getQuote(opp.symbol);
      if (q) liveQuotes[opp.symbol] = { ltp: q.ltp, changePct: q.changePct };
    }
    try { store.conviction = runConvictionEngine(opportunities.rows, store.recommendations, liveQuotes); } catch {}

    // 5b. Smart Money Bias (FII/DII positioning) + Squeeze Detection
    try {
      const { fetchSmartMoneyData, getSmartMoneyMultiplier } = await import('./engines/smart-money-bias');
      const { detectSqueezes } = await import('./engines/squeeze-detector');

      // Fetch smart money data (cached, updates daily)
      const smartMoney = await fetchSmartMoneyData();
      (store as any).smartMoney = smartMoney;

      // Detect squeezes for top symbols
      const topSymbols = opportunities.rows.slice(0, 10).map(o => o.symbol);
      const squeezes = detectSqueezes(
        topSymbols,
        (sym) => {
          try { return runOptionChainEngine(sym); } catch { return null; }
        },
        (sym) => {
          const q = getQuote(sym);
          return q?.ltp ?? 0;
        }
      );
      (store as any).squeezes = squeezes;
    } catch (e) {
      // Non-critical — don't fail the scan
    }

    // 6. Active trade management (if any)
    const active = getActiveTrade();
    if (active && active.state !== 'COMPLETE') {
      const q = getQuote(active.symbol);
      if (q) {
        const technical = runTechnicalEngine(active.symbol);
        const optionChain = runOptionChainEngine(active.symbol);
        const sector = sectorMap.get(active.sector ?? '');
        const sectorScore = sector ? { ...sector } : undefined;

        // Update live values
        active.currentUnderlying = q.ltp;
        active.currentPrice = estimateOptionPrice(active, q.ltp);
        if (active.entryPrice && active.initialStopLoss && active.underlyingEntryPrice) {
          const isLong = active.direction === 'CE';
          const slDist = Math.abs(active.underlyingEntryPrice - active.initialStopLoss);
          active.rMultiple = isLong
            ? (q.ltp - active.underlyingEntryPrice) / slDist
            : (active.underlyingEntryPrice - q.ltp) / slDist;
          active.pnl = (active.currentPrice - active.entryPrice) * (active.direction === 'CE' ? 1 : -1);
        }

        // Run management + exit
        const mgmt = runTradeManagementEngine(active, technical, optionChain, market);
        const exit = runExitEngine(active, technical, optionChain, market, sectorScore);

        logDecision('DECISION', 'TradeManagement', `${active.symbol}: ${mgmt.action} — ${mgmt.reason}`, active.symbol);
        logDecision('DECISION', 'ExitEngine', `${active.symbol}: ${exit.action} (score ${exit.exitScore.toFixed(0)})`, active.symbol);

        // Apply management actions to trade
        if (mgmt.action === 'MOVE_TO_BREAKEVEN' && mgmt.newStopLoss !== undefined) {
          active.stopLoss = mgmt.newStopLoss;
        } else if (mgmt.action === 'TRAIL_SL' && mgmt.newStopLoss !== undefined) {
          // Only move SL in favorable direction
          const isLong = active.direction === 'CE';
          if (
            (isLong && mgmt.newStopLoss > (active.stopLoss ?? 0)) ||
            (!isLong && mgmt.newStopLoss < (active.stopLoss ?? 0))
          ) {
            active.stopLoss = mgmt.newStopLoss;
          }
        }

        // State transitions
        const isLong = active.direction === 'CE';
        const hitTP1 = active.tp1 !== undefined && (isLong ? q.ltp >= active.tp1 : q.ltp <= active.tp1);
        const hitTP2 = active.tp2 !== undefined && (isLong ? q.ltp >= active.tp2 : q.ltp <= active.tp2);
        const hitSL = active.stopLoss !== undefined && (isLong ? q.ltp <= active.stopLoss : q.ltp >= active.stopLoss);

        const transition = nextTradeState(active.state, {
          decision: 'ENTER',
          managementAction: mgmt.action,
          rMultiple: active.rMultiple,
          hitTP1,
          hitTP2,
          hitSL,
          exitAction: exit.action,
          reason: mgmt.reason,
        });

        const updated = applyStateTransition(active, transition);
        Object.assign(active, updated);

        // Handle exit
        if (active.state === 'EXIT' && !active.exitPrice) {
          active.exitPrice = active.currentPrice;
          active.exitTime = Date.now();
          active.exitReason = hitSL ? 'Stop loss hit' : exit.action === 'EXIT' ? `Exit score ${exit.exitScore.toFixed(0)}` : mgmt.reason;
          logDecision('WARN', 'StateMachine', `${active.symbol} EXIT: ${active.exitReason}`, active.symbol);

          // AI explanation for exit — DISABLED to prevent 429 rate limiting
          // The AI explainer calls the LLM on every scan, causing rate limit cascades
          // Re-enable only when API credits are purchased
          // if (config.enableAIExplanation) {
          //   try {
          //     const ai = await explainTradeManagement(active, mgmt, exit);
          //     active.aiExplanation = ai.summary;
          //   } catch (e) {}
          // }

          // Archive to journal
          await archiveTradeToJournal(active);
          // Move to completed
          getStore().completedTrades.unshift(active);
          setActiveTrade(null);
          // Delete from DB
          try {
            await db.tradeState.delete({ where: { symbol: active.symbol } });
          } catch {}
        } else {
          // AI explanation for hold/trail — DISABLED to prevent 429 rate limiting
          // if (config.enableAIExplanation && Math.random() < 0.2) {
          //   try {
          //     const ai = await explainTradeManagement(active, mgmt, exit);
          //     active.aiExplanation = ai.summary;
          //   } catch {}
          // }
          await persistActiveTrade();
        }
      }
    } else {
      // No active trade — auto-enter on the top opportunity if decision is ENTER
      // (Only after the user has explicitly armed auto-entry; default OFF per spec)
      // We just keep the top recommendation ready.
      const top = topN[0];
      if (top && store.recommendations.has(top.symbol)) {
        const rec = store.recommendations.get(top.symbol)!;
        if (rec.decision.decision === 'ENTER') {
          logDecision('INFO', 'Orchestrator', `Top candidate ready: ${top.symbol} ${top.direction} (conf ${rec.decision.confidence}%) — awaiting user arm`, top.symbol);
        }
      }
    }

    store.lastScanAt = Date.now();
  } finally {
    scanInProgress = false;
  }
}

// Estimate option price from underlying move using delta approximation
function estimateOptionPrice(trade: LiveTrade, underlying: number): number {
  if (!trade.entryPrice || !trade.underlyingEntryPrice || !trade.entryStrike) return trade.entryPrice ?? 0;
  const isLong = trade.direction === 'CE';
  // Approximate delta at entry ~0.5 (ATM)
  const delta = 0.5;
  const move = underlying - trade.underlyingEntryPrice;
  const priceMove = move * delta * (isLong ? 1 : -1);
  // Time decay: ~5% per hour (rough)
  const hoursSinceEntry = trade.entryTime ? (Date.now() - trade.entryTime) / (60 * 60 * 1000) : 0;
  const thetaDecay = trade.entryPrice * 0.02 * hoursSinceEntry;
  return Math.max(0.5, trade.entryPrice + priceMove - thetaDecay);
}

// Manual entry by user (or auto-arm)
export async function enterTrade(symbol: string, direction: Direction): Promise<LiveTrade> {
  const store = getStore();
  const rec = store.recommendations.get(symbol);
  if (!rec) throw new Error('No recommendation for symbol');
  const q = getQuote(symbol);
  if (!q) throw new Error('No quote');

  const trade: LiveTrade = {
    ...createInitialTrade(symbol, direction),
    state: 'ENTERED',
    entryType: rec.entry.entryType,
    entryStrike: rec.strike.primaryStrike,
    entryPrice: rec.strike.primaryLTP,
    underlyingEntryPrice: q.ltp,
    entryTime: Date.now(),
    stopLoss: rec.risk.stopLoss,
    initialStopLoss: rec.risk.stopLoss,
    tp1: rec.risk.tp1,
    tp2: rec.risk.tp2,
    tp3: rec.risk.tp3,
    currentPrice: rec.strike.primaryLTP,
    currentUnderlying: q.ltp,
    pnl: 0,
    rMultiple: 0,
    stateHistory: [
      { state: 'WATCHLIST', timestamp: Date.now(), reason: 'Added' },
      { state: 'READY', timestamp: Date.now(), reason: 'Decision ENTER' },
      { state: 'WAITING_ENTRY', timestamp: Date.now(), reason: 'User armed entry' },
      { state: 'ENTERED', timestamp: Date.now(), reason: `Entry at ${q.ltp.toFixed(2)} (${rec.entry.entryType})` },
    ],
  };
  setActiveTrade(trade);
  await persistActiveTrade();
  logDecision('DECISION', 'Orchestrator', `ENTERED ${symbol} ${direction} at ${q.ltp.toFixed(2)}`, symbol);

  // AI explanation for entry — DISABLED to prevent 429 rate limiting
  // const config = await getConfig();
  // if (config.enableAIExplanation) {
  //   try {
  //     const ai = await explainDecision(rec, 'SELECTED');
  //     trade.aiExplanation = ai.summary;
  //     await persistActiveTrade();
  //   } catch {}
  // }
  return trade;
}

// Manual exit by user
export async function exitTrade(reason: string): Promise<void> {
  const trade = getActiveTrade();
  if (!trade) return;
  trade.exitPrice = trade.currentPrice;
  trade.exitTime = Date.now();
  trade.exitReason = reason;
  trade.state = 'EXIT';
  logDecision('DECISION', 'Orchestrator', `USER EXIT ${trade.symbol}: ${reason}`, trade.symbol);
  await archiveTradeToJournal(trade);
  getStore().completedTrades.unshift(trade);
  setActiveTrade(null);
  try {
    await db.tradeState.delete({ where: { symbol: trade.symbol } });
  } catch {}
}
