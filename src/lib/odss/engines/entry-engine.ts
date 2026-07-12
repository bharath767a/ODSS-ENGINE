/**
 * ODSS - Entry Engine (Phase 10)
 * Never recommends immediate buying.
 * Chooses one: Market / Breakout / Retest / VWAP / Liquidity Sweep entry.
 * Entry must be based on UNDERLYING price.
 */
import type { EntryPlan, EntryType, Direction, TechnicalEngineOutput, Quote } from '../types';
import { getQuote } from '../simulator/market-simulator';

export function runEntryEngine(
  symbol: string,
  direction: Direction,
  technical: TechnicalEngineOutput,
): EntryPlan {
  const q = getQuote(symbol);
  if (!q) return empty();

  // Never recommend immediate buying — pick a setup that requires a trigger.
  let entryType: EntryType = 'WAITING' as any;
  let entryPrice = q.ltp;
  let entryTrigger = '';
  let stopLoss = q.ltp;
  let reason = '';

  const isLong = direction === 'CE';

  // Priority: Liquidity Sweep > Breakout > Retest > VWAP > Market (last resort)
  if (technical.liquiditySweep.direction !== 'NONE') {
    entryType = 'LIQUIDITY_SWEEP';
    const swept = technical.liquiditySweep.swept;
    // Wait for price to reclaim the swept level
    entryPrice = swept;
    entryTrigger = isLong
      ? `Wait for price to reclaim ${swept.toFixed(2)} after sweep low`
      : `Wait for price to break below ${swept.toFixed(2)} after sweep high`;
    stopLoss = isLong ? swept - technical.atr : swept + technical.atr;
    reason = `Liquidity sweep ${technical.liquiditySweep.direction} at ${swept.toFixed(2)} — high-probability reversal entry`;
  } else if (technical.breakout.status !== 'NONE') {
    entryType = 'BREAKOUT';
    const level = technical.breakout.level;
    entryPrice = level;
    entryTrigger =
      technical.breakout.status === 'BREAKING_OUT'
        ? `Enter on close above ${level.toFixed(2)} with volume`
        : `Enter on close below ${level.toFixed(2)} with volume`;
    stopLoss = isLong ? level - technical.atr : level + technical.atr;
    reason = `Breakout ${technical.breakout.status} at ${level.toFixed(2)}`;
  } else if (technical.pullback.status !== 'NONE') {
    entryType = 'RETEST';
    const to = technical.pullback.to;
    entryPrice = to;
    entryTrigger = `Enter on bounce/rejection from ${technical.pullback.status.replace('AT_', '').toLowerCase()} ${to.toFixed(2)}`;
    stopLoss = isLong ? to - technical.atr * 0.8 : to + technical.atr * 0.8;
    reason = `Pullback to ${technical.pullback.status.replace('AT_', '')} at ${to.toFixed(2)}`;
  } else if (technical.vwapPosition !== 'AT' && Math.abs(q.ltp - q.vwap) / q.vwap < 0.003) {
    entryType = 'VWAP';
    entryPrice = q.vwap;
    entryTrigger = `Enter on VWAP test at ${q.vwap.toFixed(2)}`;
    stopLoss = isLong ? q.vwap - technical.atr * 0.8 : q.vwap + technical.atr * 0.8;
    reason = `VWAP retest entry at ${q.vwap.toFixed(2)}`;
  } else {
    // If no clear setup, do NOT recommend immediate entry. Wait for retest of VWAP.
    entryType = 'VWAP';
    entryPrice = q.vwap;
    entryTrigger = `Wait for pullback to VWAP ${q.vwap.toFixed(2)} (no immediate chase)`;
    stopLoss = isLong ? q.vwap - technical.atr : q.vwap + technical.atr;
    reason = 'No high-probability trigger — wait for VWAP retest rather than chasing';
  }

  const facts: string[] = [
    `Entry type ${entryType}`,
    `Trigger: ${entryTrigger}`,
    `Entry price (underlying) ${entryPrice.toFixed(2)}`,
    `Initial SL (underlying) ${stopLoss.toFixed(2)}`,
    `ATR ${technical.atr.toFixed(2)} used for SL distance`,
    reason,
  ];

  return { entryType, entryPrice, entryTrigger, stopLoss, reason, facts };
}

function empty(): EntryPlan {
  return {
    entryType: 'MARKET',
    entryPrice: 0,
    entryTrigger: 'No quote',
    stopLoss: 0,
    reason: 'No data',
    facts: [],
  };
}
