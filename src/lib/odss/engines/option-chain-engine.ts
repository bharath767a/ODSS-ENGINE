/**
 * ODSS - Option Chain Engine (Phase 7)
 * Analyses: ATM/ITM/OTM, OI, OI Change, Call Writing, Put Writing,
 * Unwinding, Volume, Liquidity, Spread, PCR, IV.
 * Output: Option Chain Score.
 */
import type { OptionChainEngineOutput, Bias } from '../types';
import { getOptionChain } from '../simulator/market-simulator';
import { getConfigSync } from '../config';

export function runOptionChainEngine(symbol: string): OptionChainEngineOutput {
  const config = getConfigSync();
  const chain = getOptionChain(symbol);
  if (!chain) return empty(symbol);

  const { strikes, pcr, spot, atmStrike, maxPainStrike } = chain;

  const atmRows = strikes.filter((r) => r.moneyness === 'ATM');
  const atmIV = atmRows.length > 0 ? atmRows.reduce((a, b) => a + b.iv, 0) / atmRows.length : 0;

  // IV skew: difference between OTM put IV and OTM call IV
  const otmPuts = strikes.filter((r) => r.type === 'PE' && r.moneyness === 'OTM').slice(0, 3);
  const otmCalls = strikes.filter((r) => r.type === 'CE' && r.moneyness === 'OTM').slice(0, 3);
  const avgOtmpuIV = otmPuts.length > 0 ? otmPuts.reduce((a, b) => a + b.iv, 0) / otmPuts.length : atmIV;
  const avgOtmceIV = otmCalls.length > 0 ? otmCalls.reduce((a, b) => a + b.iv, 0) / otmCalls.length : atmIV;
  const ivSkew = avgOtmpuIV - avgOtmceIV;

  // IV rank (approximate vs ATM base) — using ATM IV as a proxy
  const ivRank = Math.max(0, Math.min(100, (atmIV - 8) / (30 - 8) * 100));

  // Call/Put writing trends
  const callOIChangeSum = chain.totalCallOIChange;
  const putOIChangeSum = chain.totalPutOIChange;
  const callWritingTrend: OptionChainEngineOutput['callWritingTrend'] =
    callOIChangeSum > 10000 ? 'INCREASING' : callOIChangeSum < -10000 ? 'DECREASING' : 'FLAT';
  const putWritingTrend: OptionChainEngineOutput['putWritingTrend'] =
    putOIChangeSum > 10000 ? 'INCREASING' : putOIChangeSum < -10000 ? 'DECREASING' : 'FLAT';

  // Unwinding detection
  let unwinding: OptionChainEngineOutput['unwinding'] = 'NONE';
  if (callOIChangeSum < -20000 && putOIChangeSum > 0) unwinding = 'CALL_UNWINDING';
  else if (putOIChangeSum < -20000 && callOIChangeSum > 0) unwinding = 'PUT_UNWINDING';

  // Support/Resistance strikes (highest OI)
  const callsByOI = strikes.filter((r) => r.type === 'CE').sort((a, b) => b.oi - a.oi);
  const putsByOI = strikes.filter((r) => r.type === 'PE').sort((a, b) => b.oi - a.oi);
  const resistanceStrike = callsByOI[0]?.strike ?? atmStrike;
  const supportStrike = putsByOI[0]?.strike ?? atmStrike;
  const liquidityStrike = strikes.slice().sort((a, b) => b.oi - a.oi)[0]?.strike ?? atmStrike;

  // ATM spread
  const atmCall = strikes.find((r) => r.moneyness === 'ATM' && r.type === 'CE');
  const spread = atmCall ? atmCall.ask - atmCall.bid : 0;

  // PCR signal
  let pcrSignal: Bias = 'NEUTRAL';
  if (pcr > config.pcrBullish) pcrSignal = 'LONG';
  else if (pcr < config.pcrBearish) pcrSignal = 'SHORT';

  // Expected move (1 std dev) - simplified
  const expectedMove = spot * (atmIV / 100) * Math.sqrt(1 / 365);

  // Score: 0..100 (directional quality)
  let score = 0;
  // PCR alignment with bias
  score += pcrSignal === 'LONG' ? 15 : pcrSignal === 'SHORT' ? 15 : 5;
  // Put writing increasing (bullish) or call writing increasing (bearish) — directional conviction
  if (putWritingTrend === 'INCREASING' && callWritingTrend !== 'INCREASING') score += 15;
  if (callWritingTrend === 'INCREASING' && putWritingTrend !== 'INCREASING') score += 15;
  // Max pain alignment (price tends to gravitate to max pain)
  score += Math.abs(spot - maxPainStrike) / spot < 0.005 ? 10 : 5;
  // Spread tightness (liquidity)
  score += spread < atmCall!.ltp * 0.02 ? 10 : 5;
  // IV rank (good premium selling vs buying perspective)
  score += ivRank > 30 && ivRank < 70 ? 10 : 5;
  // Unwinding detection
  score += unwinding !== 'NONE' ? 10 : 0;
  score = Math.min(100, score);

  // Bias from option chain
  let bias: Bias = 'NEUTRAL';
  if (pcr > config.pcrBullish && putWritingTrend === 'INCREASING' && callWritingTrend !== 'INCREASING') bias = 'LONG';
  else if (pcr < config.pcrBearish && callWritingTrend === 'INCREASING' && putWritingTrend !== 'INCREASING') bias = 'SHORT';

  const facts: string[] = [
    `PCR ${pcr.toFixed(2)} (signal ${pcrSignal})`,
    `ATM IV ${atmIV.toFixed(2)}% | IV Skew ${ivSkew.toFixed(2)} | IV Rank ${ivRank.toFixed(0)}`,
    `Call writing ${callWritingTrend} (${(callOIChangeSum / 1000).toFixed(0)}K)`,
    `Put writing ${putWritingTrend} (${(putOIChangeSum / 1000).toFixed(0)}K)`,
    unwinding !== 'NONE' ? `Unwinding: ${unwinding}` : 'No unwinding',
    `Max pain ${maxPainStrike}`,
    `Resistance strike ${resistanceStrike} (highest CE OI)`,
    `Support strike ${supportStrike} (highest PE OI)`,
    `ATM spread ${spread.toFixed(2)}`,
    `Expected move ±${expectedMove.toFixed(2)}`,
  ];

  return {
    symbol,
    pcr,
    pcrSignal,
    ivSkew,
    ivRank,
    atmIV,
    callWritingTrend,
    putWritingTrend,
    unwinding,
    liquidityStrike,
    maxPain: maxPainStrike,
    spread,
    supportStrike,
    resistanceStrike,
    expectedMove,
    score,
    bias,
    facts,
    timestamp: Date.now(),
  };
}

function empty(symbol: string): OptionChainEngineOutput {
  return {
    symbol,
    pcr: 1,
    pcrSignal: 'NEUTRAL',
    ivSkew: 0,
    ivRank: 0,
    atmIV: 0,
    callWritingTrend: 'FLAT',
    putWritingTrend: 'FLAT',
    unwinding: 'NONE',
    liquidityStrike: 0,
    maxPain: 0,
    spread: 0,
    supportStrike: 0,
    resistanceStrike: 0,
    expectedMove: 0,
    score: 0,
    bias: 'NEUTRAL',
    facts: ['No option chain'],
    timestamp: Date.now(),
  };
}
