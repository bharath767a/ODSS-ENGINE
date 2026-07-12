/**
 * ODSS - Black-Scholes Option Pricing & Greeks
 * Used to compute theoretical option prices and greeks for the simulator
 * (since no real broker feed is available in this sandbox).
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function normCdf(x: number): number {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-0.5 * x * x);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

export interface BlackScholesInput {
  S: number; // spot
  K: number; // strike
  T: number; // time to expiry in years
  r: number; // risk-free rate (e.g. 0.07)
  sigma: number; // IV
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

export function blackScholes(inp: BlackScholesInput): BlackScholesResult {
  const { S, K, T, r, sigma, type } = inp;
  if (T <= 0 || sigma <= 0) {
    // At expiry: intrinsic value
    const intrinsic = type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const d1 =
    (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const delta = type === 'CE' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (S * sigma * Math.sqrt(T));
  const vega = S * normPdf(d1) * Math.sqrt(T) / 100; // per 1% IV change
  let theta: number;
  let rho: number;
  if (type === 'CE') {
    theta =
      (-(S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) -
        r * K * Math.exp(-r * T) * normCdf(d2)) /
      365; // per day
    rho = K * T * Math.exp(-r * T) * normCdf(d2) / 100; // per 1% rate change
    const price = S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
    return { price: Math.max(price, 0.05), delta, gamma, theta, vega, rho };
  } else {
    theta =
      (-(S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) +
        r * K * Math.exp(-r * T) * normCdf(-d2)) /
      365;
    rho = -K * T * Math.exp(-r * T) * normCdf(-d2) / 100;
    const price = K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
    return { price: Math.max(price, 0.05), delta, gamma, theta, vega, rho };
  }
}

// Implied vol via bisection (used when we have market price and want IV)
export function impliedVol(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: 'CE' | 'PE'
): number {
  let lo = 0.05;
  let hi = 5.0;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const { price } = blackScholes({ S, K, T, r, sigma: mid, type });
    if (Math.abs(price - marketPrice) < 0.01) return mid;
    if (price < marketPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
