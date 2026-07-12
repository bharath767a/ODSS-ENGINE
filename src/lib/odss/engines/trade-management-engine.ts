/**
 * ODSS - Trade Management Engine (Phase 12)
 * After entry, continuously monitors price, VWAP, trend, momentum, volume,
 * OI, sector, market, ATR, structure.
 * Output: Hold, Trail SL, Move to Breakeven, Partial Exit, Exit, Re-entry, Watch.
 */
import type {
  TradeManagementOutput,
  TradeAction,
  LiveTrade,
  TechnicalEngineOutput,
  OptionChainEngineOutput,
  MarketEngineOutput,
} from '../types';
import { getConfigSync } from '../config';
import { getQuote } from '../simulator/market-simulator';

export function runTradeManagementEngine(
  trade: LiveTrade,
  technical: TechnicalEngineOutput,
  oc: OptionChainEngineOutput,
  market: MarketEngineOutput,
): TradeManagementOutput {
  const config = getConfigSync();
  const q = getQuote(trade.symbol);
  if (!q || !trade.entryPrice || !trade.stopLoss || !trade.underlyingEntryPrice) {
    return { action: 'WATCH', reason: 'Trade data incomplete', facts: [] };
  }

  const isLong = trade.direction === 'CE';
  const entry = trade.underlyingEntryPrice;
  const currentPrice = q.ltp;
  const initialSL = trade.initialStopLoss ?? trade.stopLoss;
  const slDistance = Math.abs(entry - initialSL);
  const rMultiple = isLong
    ? (currentPrice - entry) / slDistance
    : (entry - currentPrice) / slDistance;

  const actionFacts: string[] = [
    `State ${trade.state}`,
    `Underlying entry ${entry.toFixed(2)} | Current ${currentPrice.toFixed(2)}`,
    `R multiple ${rMultiple.toFixed(2)}`,
    `Initial SL ${initialSL.toFixed(2)} | Current SL ${trade.stopLoss.toFixed(2)}`,
    `Trend ${technical.trend} | VWAP pos ${technical.vwapPosition}`,
    `Market ${market.marketState} (${market.marketScore.toFixed(0)})`,
  ];

  // Decision rules:
  // 1. If TP1 hit and state ENTERED -> move to breakeven
  // 2. If TP2 hit -> trail SL by ATR
  // 3. If trend reverses against trade -> WEAKENING / exit
  // 4. If momentum strongly against -> exit
  // 5. Otherwise HOLD

  const tp1 = trade.tp1;
  const tp2 = trade.tp2;
  const hitTP1 = tp1 !== undefined && (isLong ? currentPrice >= tp1 : currentPrice <= tp1);
  const hitTP2 = tp2 !== undefined && (isLong ? currentPrice >= tp2 : currentPrice <= tp2);
  const trendAgainst = isLong ? technical.trend === 'BEARISH' : technical.trend === 'BULLISH';
  const marketAgainst = isLong ? market.marketScore < -20 : market.marketScore > 20;
  const vwapAgainst = isLong
    ? technical.vwapPosition === 'BELOW'
    : technical.vwapPosition === 'ABOVE';

  // Default action
  let action: TradeAction = 'HOLD';
  let newStopLoss: number | undefined;
  let reason = 'Trade progressing normally — hold';

  if (rMultiple <= -1) {
    action = 'FULL_EXIT';
    reason = 'Stop loss hit (R = -1)';
  } else if (trendAgainst && rMultiple > 0.5) {
    // Lock profits
    action = 'TRAIL_SL';
    const trailDist = technical.atr * config.trailATRMultiple;
    newStopLoss = isLong ? currentPrice - trailDist : currentPrice + trailDist;
    if (isLong ? newStopLoss > (trade.stopLoss ?? 0) : newStopLoss < (trade.stopLoss ?? 0)) {
      reason = `Trend reversed against trade — trail SL to ${newStopLoss?.toFixed(2)}`;
    } else {
      action = 'HOLD';
      newStopLoss = undefined;
      reason = 'Trend reversed but SL already better — hold';
    }
  } else if (hitTP2 && trade.state !== 'TP2' && trade.state !== 'TRAILING') {
    action = 'PARTIAL_EXIT_TP2';
    newStopLoss = entry; // breakeven
    reason = `TP2 hit at ${currentPrice.toFixed(2)} — book 50% and trail rest at breakeven`;
  } else if (hitTP1 && trade.state === 'ENTERED') {
    action = 'MOVE_TO_BREAKEVEN';
    newStopLoss = entry;
    reason = `TP1 hit at ${currentPrice.toFixed(2)} — move SL to breakeven`;
  } else if (trendAgainst && marketAgainst && rMultiple < 0.5) {
    action = 'FULL_EXIT';
    reason = `Multiple confirmations against trade (trend+market) at R=${rMultiple.toFixed(2)}`;
  } else if (vwapAgainst && rMultiple < 0) {
    action = 'WATCH';
    reason = 'Price below VWAP and in loss — watch closely for exit trigger';
  } else if (rMultiple > 1.5) {
    action = 'TRAIL_SL';
    const trailDist = technical.atr * config.trailATRMultiple;
    newStopLoss = isLong ? currentPrice - trailDist : currentPrice + trailDist;
    reason = `Profit > 1.5R — trail SL to ${newStopLoss?.toFixed(2)} (ATR × ${config.trailATRMultiple})`;
  }

  return {
    action,
    newStopLoss,
    reason,
    facts: [...actionFacts, `Action ${action}`, reason],
  };
}
