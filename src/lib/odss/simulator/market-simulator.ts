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
  /**
   * When true, this symbol's price is driven by REAL market data (Yahoo/NSE).
   * The tick() function will NOT apply synthetic noise to this symbol —
   * its price stays at the last injected real value until the next
   * injection updates it. This prevents the dashboard from showing
   * a mix of real + synthetic prices.
   */
  realDataActive: boolean;
  /** Timestamp of the last real data injection (epoch ms). */
  lastRealUpdate: number;
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
      realDataActive: false,
      lastRealUpdate: 0,
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
  const now = Date.now();

  // REAL DATA ONLY POLICY: No synthetic VIX drift, no synthetic price movement,
  // no regime rotation, no gaussian noise. The simulator simply holds the last
  // known real price and adds flat candles for indicator continuity.
  // All prices come from Yahoo Finance (injected every 10-20 seconds).
  // All VIX comes from Yahoo Finance (^INDIAVIX).
  // If real data hasn't been injected yet, the price stays at basePrice
  // until the first real quote arrives.

  for (const sym of s.symbols.values()) {
    // Hold the last known real price — add a flat candle for indicator continuity
    sym.candles.push({
      timestamp: now,
      open: sym.price,
      high: sym.price,
      low: sym.price,
      close: sym.price,
      volume: sym.cumulativeVol,
    });
    if (sym.candles.length > 300) sym.candles.shift();
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

/**
 * Inject a REAL quote into the simulator, overwriting the synthetic price.
 *
 * This is the key function that makes the engine run on REAL data:
 * the mini-service's tick loop calls this after fetching real quotes
 * from NSE/Yahoo. The simulator's candle history is preserved (for
 * technical indicators), but the current price, OHLC, volume, and
 * changePct are overwritten with real values.
 *
 * If `realVix` is provided, it also overwrites the simulator's VIX.
 */
export function injectRealQuote(
  symbol: string,
  realQuote: { ltp: number; prevClose: number; open: number; high: number; low: number; volume: number; changePct: number; vwap?: number },
  realVix?: number,
): void {
  const s = getSimulator();
  const sym = s.symbols.get(symbol);
  if (!sym) return;

  // Mark this symbol as having real data — tick() will NOT apply
  // synthetic noise to it as long as the data is fresh (< 30s old).
  sym.realDataActive = true;
  sym.lastRealUpdate = Date.now();

  // Overwrite the current price with the real price
  sym.price = realQuote.ltp;
  sym.prevClose = realQuote.prevClose;
  sym.open = realQuote.open;
  sym.dayHigh = realQuote.high;
  sym.dayLow = realQuote.low;
  sym.cumulativeVol = realQuote.volume;

  // Add a candle with the real price so technical indicators work
  // (but mark it with the real timestamp so it doesn't conflict with
  // the simulator's synthetic candle history)
  sym.candles.push({
    timestamp: Date.now(),
    open: realQuote.open,
    high: realQuote.high,
    low: realQuote.low,
    close: realQuote.ltp,
    volume: realQuote.volume,
  });
  if (sym.candles.length > 300) sym.candles.shift();

  // Overwrite VIX if provided
  if (realVix !== undefined && realVix > 0 && realVix < 200) {
    s.indiaVix = realVix;
    (s as any)._lastRealVixUpdate = Date.now();
  }
}

// ---- REAL option chains (injected from the Dhan bridge) ----
// When a fresh real chain exists for a symbol, getOptionChain() returns it
// instead of the synthetic one, so every downstream engine analyses REAL
// OI / greeks / IV. Falls back to synthetic when stale/absent.
const realOptionChains = new Map<string, { chain: OptionChain; ts: number }>();
const REAL_OC_TTL_MS = 120_000; // real chain considered fresh for 2 min

/**
 * Inject a REAL option chain (already mapped to the engine's OptionChain shape,
 * with per-strike OI change computed by the feed) so the option-chain engine,
 * conviction engine and confluence engine all run on real Dhan data.
 */
export function injectRealOptionChain(symbol: string, chain: OptionChain): void {
  if (!chain || !Array.isArray(chain.strikes) || chain.strikes.length === 0) return;
  realOptionChains.set(symbol, { chain, ts: Date.now() });
}

/** Is a fresh real option chain available for this symbol? */
export function hasRealOptionChain(symbol: string): boolean {
  const e = realOptionChains.get(symbol);
  return !!e && Date.now() - e.ts < REAL_OC_TTL_MS;
}

/**
 * Inject real India VIX into the simulator.
 */
export function injectRealVix(realVix: number): void {
  const s = getSimulator();
  if (realVix > 0 && realVix < 200) {
    s.indiaVix = realVix;
    (s as any)._lastRealVixUpdate = Date.now();
  }
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
  // Prefer a fresh REAL chain from the Dhan bridge when available.
  const real = realOptionChains.get(symbol);
  if (real && Date.now() - real.ts < REAL_OC_TTL_MS) return real.chain;

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
