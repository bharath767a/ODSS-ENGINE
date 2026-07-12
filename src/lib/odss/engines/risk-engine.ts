/**
 * ODSS - Risk Engine (Phase 11)
 * Calculates: Entry, SL, TP1, TP2, TP3, RR, Position Size, Maximum Loss.
 * Uses underlying price only.
 */
import type { RiskPlan, Direction, EntryPlan, TechnicalEngineOutput } from '../types';
import { getConfigSync } from '../config';
import { getSymbolMeta } from '../universe';
import { getOptionChain } from '../simulator/market-simulator';

export function runRiskEngine(
  symbol: string,
  direction: Direction,
  entry: EntryPlan,
  technical: TechnicalEngineOutput,
): RiskPlan {
  const config = getConfigSync();
  const meta = getSymbolMeta(symbol);
  const chain = getOptionChain(symbol);

  const isLong = direction === 'CE';
  const atr = technical.atr || meta ? technical.atr : 0;
  const entryPrice = entry.entryPrice;

  // SL distance based on ATR
  const slDistance = Math.max(Math.abs(entryPrice - entry.stopLoss), atr);
  const stopLoss = isLong ? entryPrice - slDistance : entryPrice + slDistance;

  // Targets at 1R, 2R, 3R
  const tp1 = isLong ? entryPrice + slDistance : entryPrice - slDistance;
  const tp2 = isLong ? entryPrice + slDistance * 2 : entryPrice - slDistance * 2;
  const tp3 = isLong ? entryPrice + slDistance * 3 : entryPrice - slDistance * 3;

  // RR (to TP2)
  const rr = 2;

  // Option premium at entry strike (approx from chain)
  // We need the primary strike from strike engine; recompute by nearest ATM
  let optionPremium = 0;
  if (chain && meta) {
    const atmStrike = chain.atmStrike;
    const row = chain.strikes.find((r) => r.strike === atmStrike && r.type === direction);
    optionPremium = row?.ltp ?? meta.basePrice * 0.01;
  }
  // Approx option price movement per unit of underlying = delta (we use ~0.5 for ATM)
  const deltaApprox = 0.5;
  const riskPerShare = Math.max(slDistance * deltaApprox, optionPremium * 0.3);

  // Position sizing: risk = capital * riskPerTradePct / 100
  const riskBudget = (config.capital * config.riskPerTradePct) / 100;
  const lotSize = meta?.lotSize ?? 75;
  const lotsByRisk = Math.max(1, Math.floor(riskBudget / (riskPerShare * lotSize)));
  const positionSize = lotsByRisk;
  const maxLoss = positionSize * lotSize * riskPerShare;

  // Max profit (to TP2)
  const profitPerShare = slDistance * 2 * deltaApprox;
  const maxProfit = positionSize * lotSize * profitPerShare;

  const facts: string[] = [
    `Entry (underlying) ${entryPrice.toFixed(2)}`,
    `SL (underlying) ${stopLoss.toFixed(2)} (${slDistance.toFixed(2)} = ${atr.toFixed(2)} ATR)`,
    `TP1 ${tp1.toFixed(2)} (1R) | TP2 ${tp2.toFixed(2)} (2R) | TP3 ${tp3.toFixed(2)} (3R)`,
    `RR 1:${rr}`,
    `Capital ₹${config.capital.toLocaleString('en-IN')} | Risk ${config.riskPerTradePct}% = ₹${riskBudget.toFixed(0)}`,
    `Lot size ${lotSize} | Lots ${positionSize}`,
    `Max loss ₹${maxLoss.toFixed(0)} | Max profit ₹${maxProfit.toFixed(0)}`,
    `Risk per share ₹${riskPerShare.toFixed(2)} (Δ ≈ ${deltaApprox})`,
  ];

  return {
    entry: entryPrice,
    stopLoss,
    tp1,
    tp2,
    tp3,
    rr,
    positionSize,
    maxLoss,
    maxProfit,
    riskPerShare,
    facts,
  };
}
