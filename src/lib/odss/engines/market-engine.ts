/**
 * ODSS - Market Engine (Phase 3)
 * Determines trend, structure, momentum, volatility, opening range,
 * VWAP, day type, overall market bias.
 * Output: Market Score, Market Confidence, Market State.
 */
import type { MarketEngineOutput, MarketBreadth, Trend, Structure, Volatility, DayType, MarketState, Bias } from '../types';
import { getIndiaVix, getMarketBreadth, getQuote, getRegime } from '../simulator/market-simulator';
import { ema, linregSlope, sma } from '../indicators';
import { getConfigSync } from '../config';

export function runMarketEngine(): MarketEngineOutput {
  const config = getConfigSync();
  const nifty = getQuote('NIFTY');
  const bankNifty = getQuote('BANKNIFTY');
  const breadth = getMarketBreadth();
  const vix = getIndiaVix();

  if (!nifty || !bankNifty) {
    return {
      trend: 'NEUTRAL',
      structure: 'RANGE',
      momentum: 0,
      volatility: 'NORMAL',
      indiaVix: vix,
      marketScore: 0,
      marketConfidence: 0,
      marketState: 'FLAT',
      dayType: 'RANGE',
      bias: 'NEUTRAL',
      openingRange: { high: 0, low: 0, status: 'FORMING' },
      vwap: 0,
      breadth,
      facts: ['NIFTY/BANKNIFTY quotes unavailable'],
      timestamp: Date.now(),
    };
  }

  const closes = nifty.candles.map((c) => c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = closes.length >= 50 ? ema(closes, 50) : ema21;
  const slope = linregSlope(closes, 20);
  const slopePct = (slope / nifty.ltp) * 100;

  // Trend: combo of EMA alignment + slope
  let trend: Trend = 'NEUTRAL';
  if (ema9 > ema21 && ema21 > ema50 && slope > 0) trend = 'BULLISH';
  else if (ema9 < ema21 && ema21 < ema50 && slope < 0) trend = 'BEARISH';

  // Structure
  const recent = nifty.candles.slice(-30);
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  let structure: Structure = 'RANGE';
  if (nifty.ltp > recentHigh * 0.998 && trend === 'BULLISH') structure = 'BREAKOUT';
  else if (nifty.ltp < recentLow * 1.002 && trend === 'BEARISH') structure = 'BREAKDOWN';
  else if (trend === 'BULLISH') structure = 'UPTREND';
  else if (trend === 'BEARISH') structure = 'DOWNTREND';
  if (slopePct !== 0 && Math.sign(slopePct) !== (trend === 'BULLISH' ? 1 : trend === 'BEARISH' ? -1 : 0)) {
    if (structure !== 'RANGE') structure = 'REVERSAL';
  }

  // Momentum: -100..100 from slope + RSI-ish
  const momentum = Math.max(-100, Math.min(100, slopePct * 800 + (nifty.changePct - 0) * 10));

  // Volatility from VIX
  let volatility: Volatility = 'NORMAL';
  if (vix < 12) volatility = 'LOW';
  else if (vix < config.vixHigh) volatility = 'NORMAL';
  else if (vix < config.vixExtreme) volatility = 'HIGH';
  else volatility = 'EXTREME';

  // Opening Range (first 15 min high/low)
  const orCandles = nifty.candles.slice(0, 15);
  const orHigh = Math.max(...orCandles.map((c) => c.high), nifty.open);
  const orLow = Math.min(...orCandles.map((c) => c.low), nifty.open);
  const orStatus = nifty.candles.length >= 15 ? 'SET' : 'FORMING';

  // Day Type
  let dayType: DayType = 'RANGE';
  const changePct = nifty.changePct;
  if (changePct > 0.8) dayType = nifty.ltp > orHigh ? 'TREND' : 'GAP_UP';
  else if (changePct < -0.8) dayType = nifty.ltp < orLow ? 'TREND' : 'GAP_DOWN';
  else if (Math.abs(changePct) < 0.2 && nifty.candles.length > 30) dayType = 'RANGE';
  else dayType = 'TREND';

  // Bias
  let bias: Bias = 'NEUTRAL';
  if (nifty.ltp > nifty.vwap && trend === 'BULLISH' && breadth.advanceDeclineRatio > 1) bias = 'LONG';
  else if (nifty.ltp < nifty.vwap && trend === 'BEARISH' && breadth.advanceDeclineRatio < 1) bias = 'SHORT';

  // Market state
  const regime = getRegime();
  let marketState: MarketState = 'FLAT';
  if (regime === 'TRENDING_UP' || regime === 'RECOVERY') marketState = 'TRENDING_UP';
  else if (regime === 'TRENDING_DOWN' || regime === 'SELLOFF') marketState = regime === 'SELLOFF' ? 'SELLING_OFF' : 'TRENDING_DOWN';
  else if (regime === 'CHOPPY') marketState = 'CHOPPY';
  else if (regime === 'RANGING') marketState = 'RANGING';

  // Market score: -100..100
  let marketScore = 0;
  marketScore += trend === 'BULLISH' ? 25 : trend === 'BEARISH' ? -25 : 0;
  marketScore += structure === 'UPTREND' || structure === 'BREAKOUT' ? 20 : structure === 'DOWNTREND' || structure === 'BREAKDOWN' ? -20 : 0;
  marketScore += bias === 'LONG' ? 15 : bias === 'SHORT' ? -15 : 0;
  marketScore += Math.max(-15, Math.min(15, momentum * 0.15));
  marketScore += breadth.advanceDeclineRatio > 1.5 ? 10 : breadth.advanceDeclineRatio < 0.67 ? -10 : 0;
  marketScore += bankNifty.changePct > 0.3 ? 5 : bankNifty.changePct < -0.3 ? -5 : 0;
  marketScore = Math.max(-100, Math.min(100, marketScore));

  // Confidence: how aligned are the signals
  const signals = [trend === 'BULLISH' ? 1 : trend === 'BEARISH' ? -1 : 0,
    bias === 'LONG' ? 1 : bias === 'SHORT' ? -1 : 0,
    bankNifty.changePct > 0 ? 1 : -1,
    breadth.advanceDeclineRatio > 1 ? 1 : -1,
    momentum > 0 ? 1 : -1];
  const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
  const conf = Math.min(100, Math.abs(avg) * 100 * 0.6 + Math.abs(marketScore) * 0.4);

  const facts: string[] = [
    `NIFTY ${nifty.ltp.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`,
    `BANKNIFTY ${bankNifty.ltp.toFixed(2)} (${bankNifty.changePct >= 0 ? '+' : ''}${bankNifty.changePct.toFixed(2)}%)`,
    `India VIX ${vix.toFixed(2)} (${volatility})`,
    `Trend ${trend} | Structure ${structure}`,
    `EMA9 ${ema9.toFixed(2)} / EMA21 ${ema21.toFixed(2)} / EMA50 ${ema50.toFixed(2)}`,
    `VWAP ${nifty.vwap.toFixed(2)} (price ${nifty.ltp > nifty.vwap ? 'above' : 'below'})`,
    `Breadth A/D ${breadth.advanceCount}/${breadth.declineCount} = ${breadth.advanceDeclineRatio.toFixed(2)}`,
    `Opening Range ${orLow.toFixed(2)}-${orHigh.toFixed(2)} (${orStatus})`,
    `Day type ${dayType} | Bias ${bias}`,
    `Slope ${(slopePct * 100).toFixed(3)}% per min`,
  ];

  return {
    trend,
    structure,
    momentum,
    volatility,
    indiaVix: vix,
    marketScore,
    marketConfidence: Math.round(conf),
    marketState,
    dayType,
    bias,
    openingRange: { high: orHigh, low: orLow, status: orStatus as 'FORMING' | 'SET' },
    vwap: nifty.vwap,
    breadth,
    facts,
    timestamp: Date.now(),
  };
}
