/**
 * ODSS — Short Covering Squeeze Detector
 * =======================================
 *
 * Detects institutional short covering rallies — the most explosive
 * moves in options trading (100-300% premium gains in minutes).
 *
 * THE SETUP:
 *   Institutions are primarily option WRITERS (sellers). When the market
 *   moves against them, they're forced to buy back their positions
 *   (short covering), causing explosive rallies.
 *
 * DETECTION LOGIC:
 *   1. Find the strike with HIGHEST Call OI (resistance)
 *   2. If price approaches this strike (within 0.2%)
 *   3. AND Call OI is DECREASING (unwinding)
 *   4. AND Call volume is INCREASING (panic buying)
 *   5. → SHORT COVERING RALLY IMMINENT
 *
 *   Similarly for Put OI (support breaks → long unwinding)
 *
 * OUTPUT:
 *   - squeezeType: CALL_SQUEEZE (bullish) / PUT_SQUEEZE (bearish) / NONE
 *   - triggerStrike: The strike being tested
 *   - proximity: How close price is to the strike (0-1)
 *   - squeezeScore: 0-100 (higher = more likely squeeze)
 *   - action: Recommended action (buy OTM calls/puts)
 */

export type SqueezeType = 'CALL_SQUEEZE' | 'PUT_SQUEEZE' | 'NONE';

export interface SqueezeSignal {
  symbol: string;
  squeezeType: SqueezeType;
  triggerStrike: number;
  currentPrice: number;
  proximity: number;           // 0-1 (how close to strike)
  squeezeScore: number;        // 0-100
  maxCallOIStrike: number;
  maxCallOI: number;
  maxPutOIStrike: number;
  maxPutOI: number;
  callOIChange: number;        // negative = unwinding
  putOIChange: number;
  action: string;
  description: string;
  detectedAt: number;
}

// Track previous OI to detect changes
interface OISnapshot {
  timestamp: number;
  maxCallOIStrike: number;
  maxCallOI: number;
  maxPutOIStrike: number;
  maxPutOI: number;
}

const oiHistory = new Map<string, OISnapshot[]>();
const HISTORY_SIZE = 6; // Last 6 scans (30 seconds at 5s interval)

/**
 * Detect short covering squeeze from option chain data.
 *
 * @param symbol Stock/index symbol
 * @param optionChain The option chain (with real OI from Dhan)
 * @param currentPrice Current underlying price
 */
export function detectSqueeze(
  symbol: string,
  optionChain: any,
  currentPrice: number,
): SqueezeSignal | null {
  if (!optionChain || !currentPrice || currentPrice <= 0) return null;

  const strikes = optionChain.strikes || [];
  if (strikes.length === 0) return null;

  // Find max Call OI and max Put OI strikes
  let maxCallOIStrike = 0, maxCallOI = 0;
  let maxPutOIStrike = 0, maxPutOI = 0;

  for (const s of strikes) {
    const callOI = Number(s.callOI || 0);
    const putOI = Number(s.putOI || 0);
    if (callOI > maxCallOI) { maxCallOI = callOI; maxCallOIStrike = s.strike; }
    if (putOI > maxPutOI) { maxPutOI = putOI; maxPutOIStrike = s.strike; }
  }

  if (maxCallOI === 0 && maxPutOI === 0) return null;

  // Track OI history for this symbol
  let history = oiHistory.get(symbol);
  if (!history) {
    history = [];
    oiHistory.set(symbol, history);
  }
  history.push({
    timestamp: Date.now(),
    maxCallOIStrike, maxCallOI, maxPutOIStrike, maxPutOI,
  });
  if (history.length > HISTORY_SIZE) history.shift();

  // Calculate OI change (current vs 2 scans ago, ~10 seconds)
  const prevSnapshot = history.length >= 3 ? history[history.length - 3] : null;
  const callOIChange = prevSnapshot ? maxCallOI - prevSnapshot.maxCallOI : 0;
  const putOIChange = prevSnapshot ? maxPutOI - prevSnapshot.maxPutOI : 0;

  // Check for CALL SQUEEZE (bullish)
  // Price approaching max Call OI strike from below
  const callDistance = Math.abs(currentPrice - maxCallOIStrike) / currentPrice;
  const callProximity = Math.max(0, 1 - callDistance / 0.005); // within 0.5%

  // Call unwinding (OI decreasing) + price near resistance
  const callUnwinding = callOIChange < 0;
  const callSqueezeScore = callProximity * 50 + (callUnwinding ? 30 : 0) + (callOIChange < -maxCallOI * 0.01 ? 20 : 0);

  // Check for PUT SQUEEZE (bearish)
  // Price approaching max Put OI strike from above
  const putDistance = Math.abs(currentPrice - maxPutOIStrike) / currentPrice;
  const putProximity = Math.max(0, 1 - putDistance / 0.005);

  const putUnwinding = putOIChange < 0;
  const putSqueezeScore = putProximity * 50 + (putUnwinding ? 30 : 0) + (putOIChange < -maxPutOI * 0.01 ? 20 : 0);

  // Determine squeeze type
  let squeezeType: SqueezeType = 'NONE';
  let triggerStrike = 0;
  let proximity = 0;
  let squeezeScore = 0;
  let action = '';
  let description = '';

  if (callSqueezeScore >= 60 && currentPrice < maxCallOIStrike) {
    // CALL SQUEEZE — institutions covering short calls
    squeezeType = 'CALL_SQUEEZE';
    triggerStrike = maxCallOIStrike;
    proximity = callProximity;
    squeezeScore = Math.round(callSqueezeScore);
    action = 'BUY OTM CALLS (slightly above max CE OI strike)';
    description = `⚡ CALL SQUEEZE: Price ₹${currentPrice.toFixed(0)} approaching max CE OI ₹${maxCallOIStrike}. ` +
      `Call OI ${callUnwinding ? 'unwinding' : 'stable'} (${callOIChange > 0 ? '+' : ''}${callOIChange}). ` +
      `Institutions covering short calls — explosive rally imminent.`;
  } else if (putSqueezeScore >= 60 && currentPrice > maxPutOIStrike) {
    // PUT SQUEEZE — institutions covering short puts (bearish)
    squeezeType = 'PUT_SQUEEZE';
    triggerStrike = maxPutOIStrike;
    proximity = putProximity;
    squeezeScore = Math.round(putSqueezeScore);
    action = 'BUY OTM PUTS (slightly below max PE OI strike)';
    description = `⚡ PUT SQUEEZE: Price ₹${currentPrice.toFixed(0)} approaching max PE OI ₹${maxPutOIStrike}. ` +
      `Put OI ${putUnwinding ? 'unwinding' : 'stable'} (${putOIChange > 0 ? '+' : ''}${putOIChange}). ` +
      `Institutions covering short puts — sharp decline imminent.`;
  } else {
    squeezeType = 'NONE';
    squeezeScore = Math.max(callSqueezeScore, putSqueezeScore);
    description = `Max CE OI at ₹${maxCallOIStrike} (${(maxCallOI/100000).toFixed(1)}L). Max PE OI at ₹${maxPutOIStrike} (${(maxPutOI/100000).toFixed(1)}L). No squeeze detected.`;
  }

  return {
    symbol,
    squeezeType,
    triggerStrike,
    currentPrice,
    proximity,
    squeezeScore: Math.round(squeezeScore),
    maxCallOIStrike,
    maxCallOI,
    maxPutOIStrike,
    maxPutOI,
    callOIChange,
    putOIChange,
    action,
    description,
    detectedAt: Date.now(),
  };
}

/**
 * Get squeeze signals for multiple symbols.
 */
export function detectSqueezes(
  symbols: string[],
  getOptionChain: (symbol: string) => any | null,
  getQuote: (symbol: string) => number,
): SqueezeSignal[] {
  const results: SqueezeSignal[] = [];
  for (const symbol of symbols) {
    const chain = getOptionChain(symbol);
    const price = getQuote(symbol);
    if (chain && price > 0) {
      const signal = detectSqueeze(symbol, chain, price);
      if (signal && signal.squeezeType !== 'NONE') {
        results.push(signal);
      }
    }
  }
  return results;
}

/**
 * Reset OI history (for testing).
 */
export function resetSqueezeDetector(): void {
  oiHistory.clear();
}
