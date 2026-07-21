/**
 * ODSS — FII/DII Smart Money Bias Engine
 * =======================================
 *
 * Tracks institutional positioning using NSE's daily Participant-wise
 * Open Interest report (released every evening at ~6:30 PM IST).
 *
 * CONCEPT:
 *   - FIIs (Foreign Institutional Investors) = "Smart Money"
 *   - Pro/Proprietary desks = "Smart Money"
 *   - Clients (Retail) = "Dumb Money" (retail consistently loses)
 *
 * If Smart Money is heavily SHORT on calls (writing calls), they expect
 * the market to fall. We should bias toward PE (put buying).
 *
 * If Smart Money is heavily LONG on puts (writing puts), they expect
 * the market to rise. We should bias toward CE (call buying).
 *
 * INTEGRATION:
 *   SmartMoneyMultiplier (0.8x to 1.2x) adjusts conviction scores.
 *   - Smart Money aligned with direction → 1.2x boost
 *   - Smart Money against direction → 0.8x penalty
 *   - Neutral → 1.0x
 *
 * DATA SOURCE:
 *   NSE publishes daily participant OI as CSV.
 *   URL: https://www1.nseindia.com/api/reports?archives=%5B%7B%22name%22%3A%22F%26O%20-%20Participant%20wise%20Open%20Interest%22%2C%22type%22%3A%22archives%22%2C%22category%22%3A%22derivatives%22%2C%22section%22%3A%22equity%22%7D%5D
 *   We fetch this via the bridge (to avoid NSE geo-blocking).
 *
 * Since the bridge fetches this daily, we store the result and use it
 * for the entire trading day.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const STATE_FILE = '/home/z/odss-data/smart-money-bias.json';

export interface SmartMoneyBias {
  // Net positioning (positive = long, negative = short)
  fiiNetCallOI: number;      // FII net call OI (long-short)
  fiiNetPutOI: number;       // FII net put OI (long-short)
  proNetCallOI: number;      // Pro desk net call OI
  proNetPutOI: number;       // Pro desk net put OI
  clientNetCallOI: number;   // Retail net call OI (contra-indicator)
  clientNetPutOI: number;    // Retail net put OI

  // Smart money combined (FII + Pro)
  smartMoneyNetCalls: number;  // positive = smart money long calls (bullish)
  smartMoneyNetPuts: number;   // positive = smart money long puts (bearish)

  // Bias (computed)
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  convictionMultiplier: number;  // 0.8 to 1.2
  description: string;

  // Metadata
  reportDate: string;  // YYYY-MM-DD
  fetchedAt: number;   // epoch ms
}

let cachedBias: SmartMoneyBias | null = null;
let lastFetch = 0;
const FETCH_INTERVAL = 60 * 60 * 1000; // 1 hour (report is daily, no need to fetch often)

/**
 * Compute smart money bias from participant OI data.
 * Called after fetching the NSE participant-wise OI report.
 */
export function computeSmartMoneyBias(participantData: {
  fiis?: { callLong: number; callShort: number; putLong: number; putShort: number };
  pro?: { callLong: number; callShort: number; putLong: number; putShort: number };
  clients?: { callLong: number; callShort: number; putLong: number; putShort: number };
}): SmartMoneyBias {
  const fiis = participantData.fiis || { callLong: 0, callShort: 0, putLong: 0, putShort: 0 };
  const pro = participantData.pro || { callLong: 0, callShort: 0, putLong: 0, putShort: 0 };
  const clients = participantData.clients || { callLong: 0, callShort: 0, putLong: 0, putShort: 0 };

  // Net = Long - Short (positive = net long, negative = net short)
  const fiiNetCallOI = fiis.callLong - fiis.callShort;
  const fiiNetPutOI = fiis.putLong - fiis.putShort;
  const proNetCallOI = pro.callLong - pro.callShort;
  const proNetPutOI = pro.putLong - pro.putShort;
  const clientNetCallOI = clients.callLong - clients.callShort;
  const clientNetPutOI = clients.putLong - clients.putShort;

  // Smart Money = FII + Pro
  const smartMoneyNetCalls = fiiNetCallOI + proNetCallOI;
  const smartMoneyNetPuts = fiiNetPutOI + proNetPutOI;

  // Determine bias
  // If smart money is net LONG calls (buying calls) → bullish
  // If smart money is net SHORT calls (writing calls) → bearish
  // If smart money is net LONG puts (buying puts) → bearish
  // If smart money is net SHORT puts (writing puts) → bullish

  const bullishSignal = smartMoneyNetCalls > 0 && smartMoneyNetPuts < 0;  // buying calls, writing puts
  const bearishSignal = smartMoneyNetCalls < 0 && smartMoneyNetPuts > 0;  // writing calls, buying puts

  let bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  let convictionMultiplier: number;
  let description: string;

  // Magnitude check (only signal if significant positioning)
  const totalSmartOI = Math.abs(smartMoneyNetCalls) + Math.abs(smartMoneyNetPuts);
  const significanceThreshold = totalSmartOI * 0.15; // 15% of total = significant

  if (bullishSignal && Math.abs(smartMoneyNetCalls) > significanceThreshold) {
    bias = 'BULLISH';
    convictionMultiplier = 1.2;
    description = `Smart money BULLISH: net long ${(smartMoneyNetCalls / 1000).toFixed(0)}k calls, net short ${(Math.abs(smartMoneyNetPuts) / 1000).toFixed(0)}k puts. CE conviction boosted.`;
  } else if (bearishSignal && Math.abs(smartMoneyNetCalls) > significanceThreshold) {
    bias = 'BEARISH';
    convictionMultiplier = 1.2; // applies to PE direction
    description = `Smart money BEARISH: net short ${(Math.abs(smartMoneyNetCalls) / 1000).toFixed(0)}k calls, net long ${(smartMoneyNetPuts / 1000).toFixed(0)}k puts. PE conviction boosted.`;
  } else {
    bias = 'NEUTRAL';
    convictionMultiplier = 1.0;
    description = `Smart money NEUTRAL: no significant directional bias detected.`;
  }

  return {
    fiiNetCallOI,
    fiiNetPutOI,
    proNetCallOI,
    proNetPutOI,
    clientNetCallOI,
    clientNetPutOI,
    smartMoneyNetCalls,
    smartMoneyNetPuts,
    bias,
    convictionMultiplier,
    description,
    reportDate: new Date().toISOString().slice(0, 10),
    fetchedAt: Date.now(),
  };
}

/**
 * Get the current smart money bias.
 * Returns cached bias if fresh (< 1 hour old).
 */
export function getSmartMoneyBias(): SmartMoneyBias | null {
  if (cachedBias && Date.now() - lastFetch < FETCH_INTERVAL) {
    return cachedBias;
  }

  // Try loading from disk
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const data: SmartMoneyBias = JSON.parse(raw);
    if (Date.now() - data.fetchedAt < FETCH_INTERVAL) {
      cachedBias = data;
      lastFetch = data.fetchedAt;
      return data;
    }
  } catch {
    // File doesn't exist yet
  }

  return null;
}

/**
 * Save smart money bias to disk (called after fetching participant data).
 */
export function saveSmartMoneyBias(bias: SmartMoneyBias): void {
  cachedBias = bias;
  lastFetch = Date.now();
  try {
    mkdirSync('/home/z/odss-data', { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(bias));
  } catch {}
}

/**
 * Get conviction multiplier for a specific direction.
 * If smart money is bullish and direction is CE → boost (1.2x)
 * If smart money is bearish and direction is PE → boost (1.2x)
 * If smart money is against direction → penalty (0.8x)
 */
export function getDirectionalMultiplier(direction: 'CE' | 'PE'): number {
  const bias = getSmartMoneyBias();
  if (!bias) return 1.0;

  if (bias.bias === 'BULLISH') {
    return direction === 'CE' ? 1.2 : 0.8;
  } else if (bias.bias === 'BEARISH') {
    return direction === 'PE' ? 1.2 : 0.8;
  }
  return 1.0;
}

/**
 * Reset (for testing).
 */
export function resetSmartMoneyBias(): void {
  cachedBias = null;
  lastFetch = 0;
  try {
    writeFileSync(STATE_FILE, '{}');
  } catch {}
}

// ============================================================
// BRIDGE INTEGRATION — Fetch participant OI via bridge
// ============================================================

/**
 * Fetch smart money data from NSE participant-wise OI report.
 * Routes through the bridge (to avoid NSE geo-blocking).
 * Returns cached data if fresh (< 1 hour old).
 */
export async function fetchSmartMoneyData(): Promise<SmartMoneyBias | null> {
  // Return cached if fresh
  if (cachedBias && Date.now() - lastFetch < FETCH_INTERVAL) {
    return cachedBias;
  }

  // Try loading from disk first
  const diskBias = getSmartMoneyBias();
  if (diskBias) {
    cachedBias = diskBias;
    lastFetch = diskBias.fetchedAt;
    return diskBias;
  }

  // Try fetching from bridge
  try {
    const bridgeConfig = JSON.parse(readFileSync('/home/z/odss-data/bridge-config.json', 'utf-8'));
    const bridgeUrl = bridgeConfig.url?.replace(/\/$/, '');
    const bridgeToken = bridgeConfig.token;

    if (!bridgeUrl || !bridgeToken) return null;

    const res = await fetch(`${bridgeUrl}/smart-money`, {
      headers: {
        'X-Bridge-Token': bridgeToken,
        'ngrok-skip-browser-warning': 'true',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data && data.participants) {
      const bias = computeSmartMoneyBias(data.participants);
      saveSmartMoneyBias(bias);
      return bias;
    }
  } catch {
    // Bridge not available or endpoint missing
  }

  return null;
}

/**
 * Get smart money multiplier for conviction adjustment.
 * Returns 0.8 to 1.2 based on smart money alignment.
 */
export function getSmartMoneyMultiplier(direction?: 'CE' | 'PE'): number {
  if (direction) {
    return getDirectionalMultiplier(direction);
  }
  const bias = getSmartMoneyBias();
  return bias?.convictionMultiplier ?? 1.0;
}
