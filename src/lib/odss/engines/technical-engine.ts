/**
 * ODSS - Technical Engine (Phase 6)
 * Calculates technical facts only: Trend, VWAP, EMA alignment, ATR,
 * Support/Resistance, Breakout, Pullback, Volume structure, Liquidity sweep,
 * Momentum.
 * Output only technical facts.
 */
import type { TechnicalEngineOutput, Trend, Quote } from '../types';
import { getQuote } from '../simulator/market-simulator';
import { atr, adx, ema, emaSeries, rsi, vwap, findPivots, clusterLevels, volumeTrend, linregSlope, stochastic } from '../indicators';

export function runTechnicalEngine(symbol: string): TechnicalEngineOutput {
  const q = getQuote(symbol);
  if (!q) return emptyOutput(symbol);

  const candles = q.candles;
  const closes = candles.map((c) => c.close);
  if (closes.length < 10) return emptyOutput(symbol, q);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = closes.length >= 50 ? ema(closes, 50) : ema21;
  const atrVal = atr(candles, 14);
  const atrPct = (atrVal / q.ltp) * 100;
  const rsiVal = rsi(closes, 14);
  const adxVal = adx(candles, 14);
  const dayVwap = q.vwap;
  const slope = linregSlope(closes, 20);
  const stoch = stochastic(candles, 14);

  // EMA alignment
  let emaAlignment: TechnicalEngineOutput['emaAlignment'] = 'MIXED';
  if (ema9 > ema21 && ema21 > ema50) emaAlignment = 'BULLISH';
  else if (ema9 < ema21 && ema21 < ema50) emaAlignment = 'BEARISH';

  // Trend
  let trend: Trend = 'NEUTRAL';
  if (emaAlignment === 'BULLISH' && slope > 0 && q.ltp > dayVwap) trend = 'BULLISH';
  else if (emaAlignment === 'BEARISH' && slope < 0 && q.ltp < dayVwap) trend = 'BEARISH';

  // VWAP position
  const vwapDiff = (q.ltp - dayVwap) / dayVwap;
  let vwapPosition: TechnicalEngineOutput['vwapPosition'] = 'AT';
  if (vwapDiff > 0.0005) vwapPosition = 'ABOVE';
  else if (vwapDiff < -0.0005) vwapPosition = 'BELOW';

  // Support/Resistance from pivots + recent highs/lows
  const pivots = findPivots(candles, 3);
  const resistance = clusterLevels(pivots.highs, 0.003).slice(0, 3);
  const support = clusterLevels(pivots.lows, 0.003).slice(-3).reverse();
  // Add day high/low
  if (resistance.length === 0 || q.dayHigh > resistance[0]) resistance.unshift(q.dayHigh);
  if (support.length === 0 || q.dayLow < support[support.length - 1]) support.push(q.dayLow);

  // Breakout
  const lastResistance = resistance[0];
  const lastSupport = support[support.length - 1];
  let breakout: TechnicalEngineOutput['breakout'] = { level: lastResistance, status: 'NONE' };
  if (q.ltp > lastResistance * 0.999 && q.ltp < lastResistance * 1.0015) {
    breakout = { level: lastResistance, status: 'BREAKING_OUT' };
  } else if (q.ltp < lastSupport * 1.001 && q.ltp > lastSupport * 0.9985) {
    breakout = { level: lastSupport, status: 'BREAKING_DOWN' };
  }

  // Pullback
  let pullback: TechnicalEngineOutput['pullback'] = { to: 0, status: 'NONE' };
  if (trend === 'BULLISH') {
    if (Math.abs(q.ltp - ema21) / ema21 < 0.001) pullback = { to: ema21, status: 'AT_SUPPORT' };
    else if (Math.abs(q.ltp - dayVwap) / dayVwap < 0.001) pullback = { to: dayVwap, status: 'AT_VWAP' };
  } else if (trend === 'BEARISH') {
    if (Math.abs(q.ltp - ema21) / ema21 < 0.001) pullback = { to: ema21, status: 'AT_SUPPORT' };
    else if (Math.abs(q.ltp - dayVwap) / dayVwap < 0.001) pullback = { to: dayVwap, status: 'AT_VWAP' };
  }

  // Volume structure
  const volStruct = volumeTrend(candles, 10);

  // Liquidity sweep: did price wick beyond prior high/low then reverse?
  let liquiditySweep: TechnicalEngineOutput['liquiditySweep'] = { direction: 'NONE', swept: 0 };
  if (candles.length >= 3) {
    const last3 = candles.slice(-3);
    const priorHigh = Math.max(...candles.slice(-15, -3).map((c) => c.high));
    const priorLow = Math.min(...candles.slice(-15, -3).map((c) => c.low));
    const sweptHigh = last3.some((c) => c.high > priorHigh) && last3[last3.length - 1].close < priorHigh;
    const sweptLow = last3.some((c) => c.low < priorLow) && last3[last3.length - 1].close > priorLow;
    if (sweptHigh) liquiditySweep = { direction: 'HIGH', swept: priorHigh };
    else if (sweptLow) liquiditySweep = { direction: 'LOW', swept: priorLow };
  }

  // Momentum: -100..100
  const momentum = Math.max(-100, Math.min(100, slope / q.ltp * 10000 + (rsiVal - 50) + (stoch.k - 50) * 0.5));

  // Score: 0..100 — directional technical quality
  // For CE bullish setup -> high score; for PE bearish setup -> high score
  // We compute absolute technical quality (how clear the setup is).
  let score = 0;
  score += trend !== 'NEUTRAL' ? 20 : 0;
  score += emaAlignment !== 'MIXED' ? 15 : 0;
  score += vwapPosition !== 'AT' ? 10 : 5;
  score += Math.min(25, adxVal * 0.5); // trend strength
  score += breakout.status !== 'NONE' ? 15 : 0;
  score += pullback.status !== 'NONE' ? 10 : 0;
  score += liquiditySweep.direction !== 'NONE' ? 10 : 0;
  score += volStruct === 'RISING' ? 5 : 0;
  score = Math.min(100, score);

  const facts: string[] = [
    `Trend ${trend} (${emaAlignment})`,
    `EMA9 ${ema9.toFixed(2)} / EMA21 ${ema21.toFixed(2)} / EMA50 ${ema50.toFixed(2)}`,
    `VWAP ${dayVwap.toFixed(2)} — price ${vwapPosition}`,
    `ATR ${atrVal.toFixed(2)} (${atrPct.toFixed(2)}%)`,
    `RSI ${rsiVal.toFixed(1)} | ADX ${adxVal.toFixed(1)}`,
    `Stoch %K ${stoch.k.toFixed(1)} / %D ${stoch.d.toFixed(1)}`,
    `Resistance: ${resistance.slice(0, 3).map((r) => r.toFixed(2)).join(', ')}`,
    `Support: ${support.slice(0, 3).map((r) => r.toFixed(2)).join(', ')}`,
    breakout.status !== 'NONE' ? `Breakout: ${breakout.status} at ${breakout.level.toFixed(2)}` : 'No active breakout',
    pullback.status !== 'NONE' ? `Pullback ${pullback.status} at ${pullback.to.toFixed(2)}` : 'No pullback setup',
    `Volume ${volStruct}`,
    liquiditySweep.direction !== 'NONE' ? `Liquidity sweep ${liquiditySweep.direction} at ${liquiditySweep.swept.toFixed(2)}` : 'No liquidity sweep',
  ];

  return {
    symbol,
    trend,
    emaAlignment,
    vwap: dayVwap,
    vwapPosition,
    atr: atrVal,
    atrPct,
    rsi: rsiVal,
    adx: adxVal,
    support,
    resistance,
    breakout,
    pullback,
    volumeStructure: volStruct,
    liquiditySweep,
    momentum,
    score,
    facts,
    timestamp: Date.now(),
  };
}

function emptyOutput(symbol: string, q?: Quote): TechnicalEngineOutput {
  return {
    symbol,
    trend: 'NEUTRAL',
    emaAlignment: 'MIXED',
    vwap: q?.vwap ?? 0,
    vwapPosition: 'AT',
    atr: 0,
    atrPct: 0,
    rsi: 50,
    adx: 0,
    support: [],
    resistance: [],
    breakout: { level: 0, status: 'NONE' },
    pullback: { to: 0, status: 'NONE' },
    volumeStructure: 'FLAT',
    liquiditySweep: { direction: 'NONE', swept: 0 },
    momentum: 0,
    score: 0,
    facts: ['Insufficient data'],
    timestamp: Date.now(),
  };
}
