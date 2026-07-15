/**
 * ODSS - Black-Scholes Option Pricing for Paper Trades
 * ----------------------------------------------------
 * Provides theoretical option prices + Greeks for paper-trade fill simulation
 * when no live broker feed is available. Used by paper-trade-manager.ts to
 * compute realistic entry/exit premiums.
 *
 * Standard Black-Scholes-Merton model with continuous dividend yield assumed 0
 * (Indian index options do not pay dividends during the option's life in the
 * typical short-dated weekly scenario).
 *
 * Greeks returned:
 *   - price : premium per share (₹)
 *   - delta : dPrice/dSpot
 *   - gamma : d²Price/dSpot²
 *   - theta : dPrice/dTime (per calendar day, in ₹/day)
 *   - vega  : dPrice/dSigma (per 1% IV change, in ₹)
 *   - rho   : dPrice/dRate  (per 1% rate change, in ₹)
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal probability density function */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Standard normal cumulative distribution function (Abramowitz-Stegun 26.2.17) */
function normCdf(x: number): number {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const d = 0.3989423 * Math.exp(-0.5 * x * x);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

export interface BlackScholesParams {
  S: number;       // spot price
  K: number;       // strike price
  T: number;       // time to expiry in years
  r: number;       // risk-free rate (0.07 = 7% for India)
  sigma: number;   // implied volatility (0.15 = 15%)
  type: 'CE' | 'PE';
}

export interface BlackScholesResult {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

/**
 * Compute Black-Scholes option price + Greeks.
 * At expiry (T ≤ 0) or with zero volatility, returns intrinsic value.
 */
export function blackScholes(params: BlackScholesParams): BlackScholesResult {
  const { S, K, T, r, sigma, type } = params;

  // Degenerate cases — return intrinsic value (no time value)
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const intrinsic = type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const itm = type === 'CE' ? S > K : S < K;
    return {
      price: Math.max(intrinsic, 0.05),
      delta: itm ? (type === 'CE' ? 1 : -1) : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const pdfD1 = normPdf(d1);
  const cdfD1 = normCdf(d1);
  const cdfD2 = normCdf(d2);
  const cdfMinusD1 = normCdf(-d1);
  const cdfMinusD2 = normCdf(-d2);

  const discK = K * Math.exp(-r * T);

  // Common Greeks
  const gamma = pdfD1 / (S * sigma * sqrtT);
  const vega = (S * pdfD1 * sqrtT) / 100; // per 1% IV change

  if (type === 'CE') {
    const price = S * cdfD1 - discK * cdfD2;
    const delta = cdfD1;
    // Theta per calendar day (divide annual by 365)
    const theta =
      (-(S * pdfD1 * sigma) / (2 * sqrtT) - r * discK * cdfD2) / 365;
    const rho = (discK * T * cdfD2) / 100; // per 1% rate change
    return {
      price: Math.max(price, 0.05),
      delta,
      gamma,
      theta,
      vega,
      rho,
    };
  } else {
    // PE
    const price = discK * cdfMinusD2 - S * cdfMinusD1;
    const delta = cdfD1 - 1;
    const theta =
      (-(S * pdfD1 * sigma) / (2 * sqrtT) + r * discK * cdfMinusD2) / 365;
    const rho = (-discK * T * cdfMinusD2) / 100; // per 1% rate change
    return {
      price: Math.max(price, 0.05),
      delta,
      gamma,
      theta,
      vega,
      rho,
    };
  }
}

export interface PriceOptionParams {
  spot: number;
  strike: number;
  daysToExpiry: number;
  iv: number;             // implied volatility as percentage (15 = 15%)
  riskFreeRate?: number;  // default 0.07 (India 10Y G-Sec)
  type: 'CE' | 'PE';
}

export interface PriceOptionResult {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/**
 * Convenience wrapper around blackScholes that accepts trader-friendly units:
 *   - daysToExpiry : days remaining to expiry (0 = expiry day, treated as 1h)
 *   - iv           : implied volatility as a percentage (15 = 15%)
 *   - riskFreeRate : decimal (default 0.07 = 7%, India 10Y G-Sec)
 *
 * Returns price + the four Greeks most relevant to short-term option
 * position management (delta, gamma, theta, vega).
 */
export function priceOption(params: PriceOptionParams): PriceOptionResult {
  const r = params.riskFreeRate ?? 0.07;
  const sigma = params.iv / 100;

  // Convert days to years; floor at 1 hour to avoid div-by-zero on expiry day
  const dte = Number.isFinite(params.daysToExpiry) ? Math.max(params.daysToExpiry, 0) : 0;
  const Tyears = Math.max(dte / 365, 1 / (365 * 24));

  const result = blackScholes({
    S: params.spot,
    K: params.strike,
    T: Tyears,
    r,
    sigma,
    type: params.type,
  });

  return {
    price: result.price,
    delta: result.delta,
    gamma: result.gamma,
    theta: result.theta,
    vega: result.vega,
  };
}

/**
 * Quick implied-volatility estimator via bisection. Useful when we have
 * a market premium and need to back out the implied vol for paper-trade
 * fill calibration.
 */
export function impliedVol(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: 'CE' | 'PE',
): number {
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) return 0.15;
  let lo = 0.05;
  let hi = 5.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const { price } = blackScholes({ S, K, T, r, sigma: mid, type });
    if (Math.abs(price - marketPrice) < 0.005) return mid;
    if (price < marketPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
