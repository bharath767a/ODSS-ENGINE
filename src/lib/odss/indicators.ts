/**
 * ODSS - Technical Indicators Library
 * Pure functions used by the Technical Engine (Phase 6).
 * Deterministic: same input -> same output.
 */
import { Candle } from '../types';

export function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

export function emaSeries(values: number[], period: number): number[] {
  const out: number[] = [];
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let e = values[0];
  out.push(e);
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  return ema(trs, Math.min(period, trs.length));
}

export function adx(candles: Candle[], period = 14): number {
  if (candles.length < period + 2) return 15;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const up = c.high - prev.high;
    const down = prev.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    trs.push(
      Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
    );
  }
  const trEma = ema(trs, period);
  if (trEma === 0) return 15;
  const plusEma = ema(plusDM, period);
  const minusEma = ema(minusDM, period);
  const plusDI = (plusEma / trEma) * 100;
  const minusDI = (minusEma / trEma) * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
  return Math.min(100, dx * 100);
}

export function vwap(candles: Candle[]): number {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  return vol === 0 ? candles[candles.length - 1]?.close ?? 0 : pv / vol;
}

export function bollingerBands(values: number[], period = 20, mult = 2) {
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / Math.max(slice.length, 1);
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(slice.length, 1);
  const sd = Math.sqrt(variance);
  return { upper: mean + mult * sd, middle: mean, lower: mean - mult * sd, sd };
}

// Find swing high / low pivots for S/R
export function findPivots(candles: Candle[], lookback = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
      }
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

// Cluster nearby levels
export function clusterLevels(levels: number[], tolerance = 0.002): number[] {
  if (levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = clusters[clusters.length - 1];
    const avg = last.reduce((a, b) => a + b, 0) / last.length;
    if (Math.abs(sorted[i] - avg) / avg <= tolerance) {
      last.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters
    .map((c) => c.reduce((a, b) => a + b, 0) / c.length)
    .sort((a, b) => b - a); // descending
}

// Volume trend over last N candles
export function volumeTrend(candles: Candle[], period = 10): 'RISING' | 'FALLING' | 'FLAT' {
  if (candles.length < period) return 'FLAT';
  const slice = candles.slice(-period);
  const firstHalf = slice.slice(0, Math.floor(period / 2));
  const secondHalf = slice.slice(Math.floor(period / 2));
  const avg1 = firstHalf.reduce((a, b) => a + b.volume, 0) / Math.max(firstHalf.length, 1);
  const avg2 = secondHalf.reduce((a, b) => a + b.volume, 0) / Math.max(secondHalf.length, 1);
  const diff = (avg2 - avg1) / Math.max(avg1, 1);
  if (diff > 0.1) return 'RISING';
  if (diff < -0.1) return 'FALLING';
  return 'FLAT';
}

// Linear regression slope for momentum
export function linregSlope(values: number[], period = 20): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const n = slice.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xmean = xs.reduce((a, b) => a + b, 0) / n;
  const ymean = slice.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xmean) * (slice[i] - ymean);
    den += (xs[i] - xmean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function highest(values: number[], period: number): number {
  return Math.max(...values.slice(-period));
}
export function lowest(values: number[], period: number): number {
  return Math.min(...values.slice(-period));
}

// Stochastic oscillator
export function stochastic(candles: Candle[], period = 14): { k: number; d: number } {
  if (candles.length < period) return { k: 50, d: 50 };
  const slice = candles.slice(-period);
  const hh = Math.max(...slice.map((c) => c.high));
  const ll = Math.min(...slice.map((c) => c.low));
  const close = slice[slice.length - 1].close;
  const k = hh === ll ? 50 : ((close - ll) / (hh - ll)) * 100;
  // %d = SMA of last 3 %k values (approximate by computing on rolling)
  const ks: number[] = [];
  for (let i = Math.max(period, 3); i <= candles.length; i++) {
    const s = candles.slice(i - period, i);
    const h = Math.max(...s.map((c) => c.high));
    const l = Math.min(...s.map((c) => c.low));
    const c = s[s.length - 1].close;
    ks.push(h === l ? 50 : ((c - l) / (h - l)) * 100);
  }
  const d = ks.length >= 3 ? sma(ks.slice(-3), 3) : k;
  return { k, d };
}
