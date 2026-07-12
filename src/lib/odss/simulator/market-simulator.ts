/**
 * ODSS - Market Simulator (Phase 2 Data Layer)
 *
 * Since this sandbox has no real broker feed, this module produces a realistic
 * Indian market simulation that drives every downstream engine. The simulation
 * is deterministic per session (seeded) so results are reproducible.
 *
 * Produces:
 *  - Cash/underlying quotes with OHLCV candles
 *  - India VIX
 *  - Option chains with OI, OI change, volume, bid/ask, IV
 *  - Greeks via Black-Scholes
 *  - Market breadth (advances/declines)
 *
 * The simulator maintains stateful "market regimes" that change over time:
 * trending up, trending down, ranging, choppy, selloff, recovery.
 */
import { ALL_SYMBOLS, getSymbolMeta, roundToStrike, getThursdayExpiry, type SymbolMeta } from '../universe';
import { blackScholes } from './greeks';
import type { Candle, MarketBreadth, OptionChain, OptionRow, Quote } from '../types';

// ---- Seeded PRNG (mulberry32) for reproducibility ----
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Regime =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGING'
  | 'CHOPPY'
  | 'SELLOFF'
  | 'RECOVERY';

interface SymbolState {
  meta: SymbolMeta;
  price: number;
  prevClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  candles: Candle[]; // 1-min candles
  cumulativeVol: number;
  drift: number; // per-tick drift
  vol: number; // per-tick volatility
  sectorBias: number; // -1..1, sector influence
}

interface SimulatorState {
  seed: number;
  rng: () => number;
  tickCount: number;
  regime: Regime;
  regimeBarsLeft: number;
  indiaVix: number;
  vixDrift: number;
  symbols: Map<string, SymbolState>;
  sectorBias: Map<string, number>; // per-sector momentum bias
  startTime: number;
  currentExpiry: string;
}

let state: SimulatorState | null = null;

const SECONDS_PER_TICK = 60; // 1-minute candles
const TICKS_PER_DAY = 375; // 9:15 to 15:30 = 6h15m = 375 min
const RISK_FREE_RATE = 0.07;

function pickRegime(rng: () => number): Regime {
  const r = rng();
  if (r < 0.3) return 'TRENDING_UP';
  if (r < 0.55) return 'TRENDING_DOWN';
  if (r < 0.75) return 'RANGING';
  if (r < 0.85) return 'CHOPPY';
  if (r < 0.93) return 'SELLOFF';
  return 'RECOVERY';
}

function regimeParams(regime: Regime): { drift: number; vol: number; vixDrift: number } {
  switch (regime) {
    case 'TRENDING_UP':
      return { drift: 0.00018, vol: 0.0009, vixDrift: -0.0008 };
    case 'TRENDING_DOWN':
      return { drift: -0.00018, vol: 0.0011, vixDrift: 0.0012 };
    case 'RANGING':
      return { drift: 0, vol: 0.0007, vixDrift: -0.0003 };
    case 'CHOPPY':
      return { drift: 0, vol: 0.0014, vixDrift: 0.0005 };
    case 'SELLOFF':
      return { drift: -0.0004, vol: 0.0022, vixDrift: 0.0035 };
    case 'RECOVERY':
      return { drift: 0.00028, vol: 0.0014, vixDrift: -0.002 };
  }
}

function initSimulator(seed: number): SimulatorState {
  const rng = mulberry32(seed);
  const regime = pickRegime(rng);
  const symbols = new Map<string, SymbolState>();
  const sectorBias = new Map<string, number>();

  // Assign a sector bias (some sectors lead, some lag)
  const sectors = Array.from(new Set(ALL_SYMBOLS.filter((s) => s.type === 'STOCK').map((s) => s.sector)));
  for (const sec of sectors) {
    sectorBias.set(sec, (rng() - 0.5) * 2); // -1..1
  }

  for (const meta of ALL_SYMBOLS) {
    const prevClose = meta.basePrice * (1 + (rng() - 0.5) * 0.01);
    const gapPct = (rng() - 0.5) * 0.006;
    const open = prevClose * (1 + gapPct);
    symbols.set(meta.symbol, {
      meta,
      price: open,
      prevClose,
      open,
      dayHigh: open,
      dayLow: open,
      candles: [],
      cumulativeVol: 0,
      drift: 0,
      vol: 0,
      sectorBias: meta.type === 'STOCK' ? sectorBias.get(meta.sector) ?? 0 : 0,
    });
  }

  return {
    seed,
    rng,
    tickCount: 0,
    regime,
    regimeBarsLeft: 30 + Math.floor(rng() * 60),
    indiaVix: 13 + rng() * 6,
    vixDrift: regimeParams(regime).vixDrift,
    symbols,
    sectorBias,
    startTime: Date.now() - 0,
    currentExpiry: getThursdayExpiry(0),
  };
}

export function getSimulator(): SimulatorState {
  if (!state) {
    state = initSimulator(42);
  }
  return state;
}

export function resetSimulator(seed?: number): void {
  state = initSimulator(seed ?? Math.floor(Math.random() * 100000));
}

function maybeRotateRegime(s: SimulatorState) {
  s.regimeBarsLeft--;
  if (s.regimeBarsLeft <= 0) {
    s.regime = pickRegime(s.rng);
    s.regimeBarsLeft = 40 + Math.floor(s.rng() * 80);
    const p = regimeParams(s.regime);
    s.vixDrift = p.vixDrift;
  }
}

function gaussian(rng: () => number): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Advance the simulator by one tick (1 minute). Returns the new tick number. */
export function tick(): number {
  const s = getSimulator();
  maybeRotateRegime(s);
  const p = regimeParams(s.regime);
  const now = Date.now();
  s.indiaVix = Math.max(8, Math.min(40, s.indiaVix + s.vixDrift + gaussian(s.rng) * 0.05));

  for (const sym of s.symbols.values()) {
    const beta = sym.meta.beta;
    // Combine regime drift + sector bias + idiosyncratic noise
    const drift = (p.drift + sym.sectorBias * 0.0001) * beta;
    const vol = p.vol * beta;
    const shock = gaussian(s.rng) * vol;
    const newPrice = Math.max(0.5, sym.price * (1 + drift + shock));

    // Update OHLC
    const minuteHigh = Math.max(sym.price, newPrice);
    const minuteLow = Math.min(sym.price, newPrice);
    const candle: Candle = {
      timestamp: now,
      open: sym.price,
      high: minuteHigh,
      low: minuteLow,
      close: newPrice,
      volume: Math.floor(50000 + s.rng() * 200000) * beta,
    };
    sym.candles.push(candle);
    if (sym.candles.length > 300) sym.candles.shift(); // keep last 5h

    sym.cumulativeVol += candle.volume;
    sym.price = newPrice;
    sym.dayHigh = Math.max(sym.dayHigh, minuteHigh);
    sym.dayLow = Math.min(sym.dayLow, minuteLow);
  }

  s.tickCount++;
  return s.tickCount;
}

export function getQuote(symbol: string): Quote | null {
  const s = getSimulator();
  const sym = s.symbols.get(symbol);
  if (!sym) return null;
  const closes = sym.candles.map((c) => c.close);
  // VWAP across the day
  let pv = 0;
  let vol = 0;
  for (const c of sym.candles) {
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    vol += c.volume;
  }
  const vwapVal = vol === 0 ? sym.price : pv / vol;
  const changePct = ((sym.price - sym.prevClose) / sym.prevClose) * 100;
  return {
    symbol,
    sector: sym.meta.sector,
    ltp: sym.price,
    prevClose: sym.prevClose,
    open: sym.open,
    high: sym.dayHigh,
    low: sym.dayLow,
    dayHigh: sym.dayHigh,
    dayLow: sym.dayLow,
    volume: sym.cumulativeVol,
    vwap: vwapVal,
    changePct,
    candles: sym.candles.slice(),
    timestamp: Date.now(),
  };
}

export function getAllQuotes(): Quote[] {
  const s = getSimulator();
  return Array.from(s.symbols.keys()).map((sym) => getQuote(sym)!).filter(Boolean);
}

export function getIndiaVix(): number {
  return getSimulator().indiaVix;
}

export function getRegime(): Regime {
  return getSimulator().regime;
}

export function getMarketBreadth(): MarketBreadth {
  const s = getSimulator();
  let adv = 0;
  let dec = 0;
  for (const sym of s.symbols.values()) {
    if (sym.price > sym.prevClose) adv++;
    else if (sym.price < sym.prevClose) dec++;
  }
  return {
    advanceCount: adv,
    declineCount: dec,
    advanceDeclineRatio: dec === 0 ? adv : adv / dec,
    timestamp: Date.now(),
  };
}

export function getCurrentExpiry(): string {
  return getSimulator().currentExpiry;
}

// ---- Option chain generation ----
export function getOptionChain(symbol: string, numStrikes = 11): OptionChain | null {
  const s = getSimulator();
  const sym = s.symbols.get(symbol);
  if (!sym) return null;
  const meta = sym.meta;
  const spot = sym.price;
  const atmStrike = roundToStrike(spot, meta.strikeStep);

  // Per-symbol IV: base = max(indiaVix/100/sqrt(252), 0.08) scaled by beta
  // For index options IV tracks VIX closely; stock IV has premium.
  const baseIV =
    meta.type === 'INDEX'
      ? Math.max(s.indiaVix / 100, 0.08)
      : Math.max((s.indiaVix / 100) * meta.beta * 1.1, 0.1);

  // Time to expiry
  const expiryDate = new Date(s.currentExpiry + 'T15:30:00+05:30');
  const now = new Date();
  const msToExpiry = Math.max(expiryDate.getTime() - now.getTime(), 60 * 60 * 1000);
  const T = msToExpiry / (365 * 24 * 60 * 60 * 1000);

  const strikes: OptionRow[] = [];
  const half = Math.floor(numStrikes / 2);

  // Synthetic OI base (higher for index)
  const oiBase = meta.type === 'INDEX' ? 5_000_000 : 1_500_000;

  for (let i = -half; i <= half; i++) {
    const strike = atmStrike + i * meta.strikeStep;
    if (strike <= 0) continue;
    // IV smile: ATM lowest, wings higher
    const distanceFromATM = Math.abs(i) / half;
    const iv = baseIV * (1 + distanceFromATM * distanceFromATM * 0.25);

    for (const type of ['CE', 'PE'] as const) {
      const { price, delta, gamma, theta, vega } = blackScholes({
        S: spot,
        K: strike,
        T,
        r: RISK_FREE_RATE,
        sigma: iv,
        type,
      });
      // OI distribution: puts below spot, calls above spot (typical structure)
      let oiFactor: number;
      if (type === 'PE') {
        // Higher OI at OTM puts (below spot)
        oiFactor = strike < spot ? 1.5 - (spot - strike) / (spot * 0.04) * 0.5 : 0.3;
      } else {
        // Higher OI at OTM calls (above spot)
        oiFactor = strike > spot ? 1.5 - (strike - spot) / (spot * 0.04) * 0.5 : 0.3;
      }
      oiFactor = Math.max(0.1, oiFactor);
      // Add randomness and make OI change correlate with price movement
      const rng = s.rng();
      const oi = Math.floor(oiBase * oiFactor * (0.7 + rng * 0.6));
      // OI change: in trending up regime, call writing increases above spot
      const trendBias = s.regime === 'TRENDING_UP' ? (type === 'CE' ? 0.3 : -0.1) :
                        s.regime === 'TRENDING_DOWN' ? (type === 'PE' ? 0.3 : -0.1) :
                        s.regime === 'SELLOFF' ? (type === 'PE' ? 0.5 : 0.1) : 0;
      const oiChange = Math.floor(oi * (trendBias + (rng - 0.5) * 0.4));
      const volume = Math.floor(oi * (0.05 + rng * 0.15));
      const spread = Math.max(price * 0.01, meta.strikeStep * 0.005);

      const moneyness =
        Math.abs(strike - spot) < meta.strikeStep / 2
          ? 'ATM'
          : (type === 'CE' && strike < spot) || (type === 'PE' && strike > spot)
          ? 'ITM'
          : 'OTM';

      strikes.push({
        strike,
        type,
        ltp: Math.round(price * 100) / 100,
        bid: Math.round((price - spread / 2) * 100) / 100,
        ask: Math.round((price + spread / 2) * 100) / 100,
        iv: Math.round(iv * 10000) / 100, // as percentage
        volume,
        oi,
        oiChange,
        delta: Math.round(delta * 1000) / 1000,
        gamma: Math.round(gamma * 1e6) / 1e6,
        theta: Math.round(theta * 100) / 100,
        vega: Math.round(vega * 100) / 100,
        moneyness,
      });
    }
  }

  const totalCallOI = strikes.filter((r) => r.type === 'CE').reduce((a, b) => a + b.oi, 0);
  const totalPutOI = strikes.filter((r) => r.type === 'PE').reduce((a, b) => a + b.oi, 0);
  const totalCallOIChange = strikes.filter((r) => r.type === 'CE').reduce((a, b) => a + b.oiChange, 0);
  const totalPutOIChange = strikes.filter((r) => r.type === 'PE').reduce((a, b) => a + b.oiChange, 0);
  const pcr = totalCallOI === 0 ? 1 : totalPutOI / totalCallOI;

  // Max pain: strike that minimizes total option holder loss
  let maxPainStrike = atmStrike;
  let minPain = Infinity;
  for (let k = -half; k <= half; k++) {
    const testStrike = atmStrike + k * meta.strikeStep;
    if (testStrike <= 0) continue;
    let pain = 0;
    for (const row of strikes) {
      if (row.type === 'CE') {
        pain += Math.max(testStrike - row.strike, 0) * row.oi;
      } else {
        pain += Math.max(row.strike - testStrike, 0) * row.oi;
      }
    }
    if (pain < minPain) {
      minPain = pain;
      maxPainStrike = testStrike;
    }
  }

  return {
    symbol,
    expiry: s.currentExpiry,
    spot,
    atmStrike,
    strikes,
    pcr,
    maxPainStrike,
    totalCallOI,
    totalPutOI,
    totalCallOIChange,
    totalPutOIChange,
    timestamp: Date.now(),
  };
}

// Estimated expected move (1 std dev) over remaining days
export function getExpectedMove(symbol: string): number | null {
  const s = getSimulator();
  const sym = s.symbols.get(symbol);
  if (!sym) return null;
  const meta = sym.meta;
  const spot = sym.price;
  const baseIV =
    meta.type === 'INDEX'
      ? Math.max(s.indiaVix / 100, 0.08)
      : Math.max((s.indiaVix / 100) * meta.beta * 1.1, 0.1);
  const expiryDate = new Date(s.currentExpiry + 'T15:30:00+05:30');
  const now = new Date();
  const days = Math.max((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000), 1);
  return spot * baseIV * Math.sqrt(days / 365);
}
