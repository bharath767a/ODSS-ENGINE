/**
 * ODSS — "Who Is In Control?" Order-Flow Engine
 * =============================================
 *
 * Reads a REAL Dhan option chain and answers the one question that matters:
 * are BUYERS or SELLERS in control right now — and how strongly.
 *
 * METHOD (the way desk traders actually read a chain)
 * ---------------------------------------------------
 * For every strike we look at the INTRADAY change in OI (Dhan `previous_oi`)
 * together with the option's PRICE change (Dhan `previous_close_price`) and put
 * it in one of four buckets — separately for calls and puts:
 *
 *     ΔOI ↑ & Price ↑  = LONG BUILDUP   (fresh BUYING)
 *     ΔOI ↑ & Price ↓  = SHORT BUILDUP  (fresh WRITING / selling)
 *     ΔOI ↓ & Price ↑  = SHORT COVERING (writers buying back)
 *     ΔOI ↓ & Price ↓  = LONG UNWINDING (buyers giving up)
 *
 * Then we map each bucket to who it favours:
 *   Calls  — buying → bulls · writing → bears · covering → bulls · unwinding → bears
 *   Puts   — buying → bears · writing → bulls · covering → bears · unwinding → bulls
 *
 * Each strike's vote is weighted by |ΔOI| (size of the money), by |delta| (real
 * directional exposure) and by proximity to spot (near-the-money is where the
 * fight happens). We normalise to a net −100..+100 control score, extract the OI
 * walls (support/resistance), the max-pain / gamma pin, IV skew, and flag TRAPS
 * where price and positioning disagree.
 *
 * Pure function — same chain in, same read out. Runs only on REAL chains
 * (strict real-data mode returns null chains off-hours, so this never fabricates).
 */
import type { OptionChain, OptionRow, ControlResult, Controller, Bias, StrikeFlow } from '../types';
import { OI_PACK } from '../oi-knowledge-pack';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const W = OI_PACK.flowWeights;

function classifyFlow(oiChange: number, priceChange: number | undefined, oi: number): StrikeFlow {
  const oiUp = oiChange > oi * 0.002;      // >0.2% of standing OI = meaningful
  const oiDown = oiChange < -oi * 0.002;
  if (!oiUp && !oiDown) return 'FLAT';
  // If we have the option price change, use the true 4-quadrant read.
  if (priceChange !== undefined && Math.abs(priceChange) > 0.01) {
    const up = priceChange > 0;
    if (oiUp) return up ? 'LONG_BUILDUP' : 'SHORT_BUILDUP';
    return up ? 'SHORT_COVERING' : 'LONG_UNWINDING';
  }
  // No price change available → conventional assumption (OI build = writing).
  return oiUp ? 'SHORT_BUILDUP' : 'LONG_UNWINDING';
}

// Bullishness of a flow bucket for calls / puts, magnitudes from the knowledge
// pack (WRITING is the strongest signal, then covering, buying, unwinding).
function callSign(f: StrikeFlow): number {
  return f === 'LONG_BUILDUP' ? W.buying : f === 'SHORT_COVERING' ? W.covering : f === 'SHORT_BUILDUP' ? -W.writing : f === 'LONG_UNWINDING' ? -W.unwinding : 0;
}
function putSign(f: StrikeFlow): number {
  return f === 'SHORT_BUILDUP' ? W.writing : f === 'LONG_UNWINDING' ? W.unwinding : f === 'LONG_BUILDUP' ? -W.buying : f === 'SHORT_COVERING' ? -W.covering : 0;
}

function medianStep(strikes: number[]): number {
  const uniq = Array.from(new Set(strikes)).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < uniq.length; i++) { const d = uniq[i] - uniq[i - 1]; if (d > 0) diffs.push(d); }
  if (!diffs.length) return 50;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

const flowLabel = (f: StrikeFlow) => f.replace('_', ' ').toLowerCase();

export function runControlEngine(chain: OptionChain, underlyingChangePct = 0): ControlResult {
  const spot = chain.spot;
  const step = medianStep(chain.strikes.map(r => r.strike));
  const sigma = OI_PACK.proximitySigmaStrikes * step; // near-the-money weighting width

  const calls = chain.strikes.filter(r => r.type === 'CE');
  const puts = chain.strikes.filter(r => r.type === 'PE');

  let bull = 0, bear = 0;           // weighted votes
  let callWriteMag = 0, putWriteMag = 0, callCoverMag = 0, putUnwindMag = 0, callBuyMag = 0, putBuyMag = 0;
  // delta-weighted directional flow (fresh exposure being added)
  let deltaFlow = 0;
  // near-money freshness — how much of the standing OI is brand-new today + turnover
  let nearOI = 0, nearAbsOIChg = 0, nearVol = 0;

  const strikeNotes: { dist: number; mag: number; text: string; sign: number }[] = [];

  const proximity = (strike: number) => Math.exp(-((strike - spot) ** 2) / (2 * sigma * sigma));

  let activeStrikes = 0;            // strikes actually showing a flow (sample size)

  const consider = (r: OptionRow, isCall: boolean) => {
    if (proximity(r.strike) > 0.5) { nearOI += r.oi; nearAbsOIChg += Math.abs(r.oiChange); nearVol += r.volume; }
    const f = classifyFlow(r.oiChange, r.ltpChange, r.oi);
    if (f === 'FLAT') return;
    activeStrikes++;
    const w = proximity(r.strike) * ((1 - OI_PACK.deltaWeight) + OI_PACK.deltaWeight * Math.min(1, Math.abs(r.delta)));
    const mag = Math.abs(r.oiChange) * w;
    const sign = isCall ? callSign(f) : putSign(f);
    if (sign > 0) bull += mag * sign; else bear += mag * -sign;
    // delta-weighted flow: buying calls / covering = +; writing calls = −; puts mirror
    deltaFlow += (isCall ? 1 : -1) * r.oiChange * Math.abs(r.delta) * (isCall ? 1 : 1) * proximity(r.strike) * (f === 'SHORT_BUILDUP' ? -1 : f === 'LONG_UNWINDING' ? -0.6 : 1);
    // track headline magnitudes
    if (isCall && f === 'SHORT_BUILDUP') callWriteMag += mag;
    if (isCall && f === 'SHORT_COVERING') callCoverMag += mag;
    if (isCall && f === 'LONG_BUILDUP') callBuyMag += mag;
    if (!isCall && f === 'SHORT_BUILDUP') putWriteMag += mag;
    if (!isCall && f === 'LONG_UNWINDING') putUnwindMag += mag;
    if (!isCall && f === 'LONG_BUILDUP') putBuyMag += mag;
    strikeNotes.push({
      dist: Math.abs(r.strike - spot), mag, sign,
      text: `${isCall ? 'Call' : 'Put'} ${flowLabel(f)} at ${r.strike} (${r.oiChange > 0 ? '+' : ''}${Math.round(r.oiChange / 1000)}k OI)`,
    });
  };
  for (const r of calls) consider(r, true);
  for (const r of puts) consider(r, false);

  // ── SAMPLE SUFFICIENCY ──
  // (bull−bear)/total is a RATIO, so it saturates to ±100 on almost no data —
  // at 09:15 a couple of contracts on one strike would read "SELLERS 100%".
  // Scale the flow read by how much fresh OI has actually printed and how many
  // strikes are participating, so conviction is EARNED as the session builds.
  const freshRatio = nearOI > 0 ? nearAbsOIChg / nearOI : 0;
  const sufficiency = clamp(
    Math.min(freshRatio / OI_PACK.fullConfFreshOIRatio, activeStrikes / OI_PACK.fullConfActiveStrikes),
    0, 1,
  );
  const dataQuality = Math.round(sufficiency * 100);
  const readable = sufficiency >= OI_PACK.minSufficiency;

  // Net normalised control score in −100..+100, damped by sufficiency.
  const total = bull + bear;
  let controlScore = total > 0 ? ((100 * (bull - bear)) / total) * sufficiency : 0;

  // ── Modifiers (kept modest so raw flow dominates) ──
  const pcr = chain.pcr || 1;
  if (pcr > OI_PACK.pcrBull) controlScore += OI_PACK.pcrMod; else if (pcr < OI_PACK.pcrBear) controlScore -= OI_PACK.pcrMod;
  const maxPain = chain.maxPainStrike || spot;
  if (spot > 0 && maxPain > 0) {
    const pull = ((maxPain - spot) / spot) * 100; // + = pull up toward max pain
    controlScore += clamp(pull * 4, -OI_PACK.maxPainMod, OI_PACK.maxPainMod);
  }
  // IV skew (fear): OTM put IV vs OTM call IV
  const otmPuts = puts.filter(r => r.strike < spot).sort((a, b) => b.strike - a.strike).slice(0, 3);
  const otmCalls = calls.filter(r => r.strike > spot).sort((a, b) => a.strike - b.strike).slice(0, 3);
  const avg = (rs: OptionRow[]) => rs.length ? rs.reduce((s, r) => s + (r.iv || 0), 0) / rs.length : 0;
  const ivSkew = +(avg(otmPuts) - avg(otmCalls)).toFixed(2);
  if (ivSkew > OI_PACK.ivSkewRichPut) controlScore -= OI_PACK.ivSkewMod;       // rich put IV = hedging/fear
  else if (ivSkew < OI_PACK.ivSkewRichCall) controlScore += OI_PACK.ivSkewMod - 1; // rich call IV = upside chase

  controlScore = Math.round(clamp(controlScore, -100, 100));

  // ── Walls, pin, gamma regime ──
  const callsAbove = calls.filter(r => r.strike >= spot);
  const putsBelow = puts.filter(r => r.strike <= spot);
  const resistanceStrike = callsAbove.length ? callsAbove.reduce((a, b) => (b.oi > a.oi ? b : a)).strike : chain.atmStrike;
  const supportStrike = putsBelow.length ? putsBelow.reduce((a, b) => (b.oi > a.oi ? b : a)).strike : chain.atmStrike;
  // Pin = strike with the greatest total OI near spot (magnet).
  const byStrike = new Map<number, number>();
  for (const r of chain.strikes) byStrike.set(r.strike, (byStrike.get(r.strike) ?? 0) + r.oi);
  let pinStrike = chain.atmStrike, pinOI = -1;
  for (const [k, oi] of byStrike) { const w = oi * proximity(k); if (w > pinOI) { pinOI = w; pinStrike = k; } }
  const nearPin = Math.abs(spot - pinStrike) < step * 0.75;
  const wallSpan = Math.abs(resistanceStrike - supportStrike);
  const gammaRegime: ControlResult['gammaRegime'] =
    nearPin && wallSpan <= step * 4 ? 'PINNED'
      : (spot >= resistanceStrike || spot <= supportStrike) ? 'TRENDING' : 'NEUTRAL';

  // ── Controller + bias ──
  // Until enough real flow has printed we refuse to name a controller: an
  // honest "not readable yet" beats a confident number built on noise.
  const controller: Controller = !readable ? 'BALANCED'
    : controlScore > OI_PACK.controlBuyers ? 'BUYERS'
      : controlScore < OI_PACK.controlSellers ? 'SELLERS' : 'BALANCED';
  const strength = Math.min(100, Math.abs(controlScore));
  const bias: Bias = !readable ? 'NEUTRAL'
    : controlScore > OI_PACK.controlBias ? 'LONG'
      : controlScore < -OI_PACK.controlBias ? 'SHORT' : 'NEUTRAL';

  // ── Trap: price and positioning disagree ──
  let trap = false; let trapNote: string | undefined;
  if (!readable) { /* too little flow to call a trap */ }
  else if (underlyingChangePct > 0.4 && controlScore < -25) {
    trap = true; trapNote = `Price up ${underlyingChangePct.toFixed(1)}% but sellers control the chain — possible BULL TRAP`;
  } else if (underlyingChangePct < -0.4 && controlScore > 25) {
    trap = true; trapNote = `Price down ${Math.abs(underlyingChangePct).toFixed(1)}% but buyers control the chain — possible BEAR TRAP / reversal`;
  }

  // ── Evidence (strongest strike moves first + structural notes) ──
  const evidence: string[] = [];
  const headline = callWriteMag + putWriteMag > callCoverMag + putUnwindMag + callBuyMag + putBuyMag
    ? null : null;
  // Top strike-level flows by magnitude:
  strikeNotes.sort((a, b) => b.mag - a.mag);
  for (const n of strikeNotes.slice(0, 3)) evidence.push(n.text);
  // Structural summary:
  if (putWriteMag > callWriteMag * 1.2) evidence.push(`Net put writing — sellers defending support (bullish), strongest near ${supportStrike}`);
  else if (callWriteMag > putWriteMag * 1.2) evidence.push(`Net call writing — sellers capping upside (bearish), strongest near ${resistanceStrike}`);
  if (callCoverMag > callWriteMag && callCoverMag > 0) evidence.push('Call short-covering — resistance weakening (bullish)');
  if (putUnwindMag > putWriteMag && putUnwindMag > 0) evidence.push('Put unwinding — support fading (bearish)');
  evidence.push(`PCR ${pcr.toFixed(2)}${ivSkew > 1 ? `, put-IV rich (skew ${ivSkew})` : ivSkew < -1 ? `, call-IV rich (skew ${ivSkew})` : ''}`);
  evidence.push(`Support ${supportStrike} · Resistance ${resistanceStrike} · Max pain ${maxPain} · ${gammaRegime.toLowerCase()}`);
  void headline;

  // FLOW INTENSITY — how much of the near-money OI is FRESH today + how much it's
  // turning over. A big, fresh, one-sided surge = smart money moving EARLY, before
  // price fully confirms. This is what lets us flag a mover near its start.
  const flowIntensity = nearOI > 0
    ? Math.round(clamp((nearAbsOIChg / nearOI) * 220 + (nearVol / nearOI) * 55, 0, 100))
    : 0;
  const earlyFlow = readable && flowIntensity >= OI_PACK.earlyFlowIntensity && strength >= OI_PACK.earlyFlowStrength && Math.abs(controlScore) >= OI_PACK.earlyFlowScore;
  if (earlyFlow) evidence.unshift(`🔥 Early flow — fresh ${controlScore > 0 ? 'bullish' : 'bearish'} positioning (intensity ${flowIntensity})`);
  if (!readable) evidence.unshift(`Flow not readable yet — only ${activeStrikes} strike(s) active, ${(freshRatio * 100).toFixed(1)}% of near-money OI is fresh (needs ${(OI_PACK.fullConfFreshOIRatio * 100).toFixed(0)}%)`);

  return {
    controller, controlScore: Math.round(controlScore), strength, bias,
    evidence: evidence.slice(0, 6), trap, trapNote,
    supportStrike, resistanceStrike, maxPain, pcr, ivSkew,
    pinStrike, gammaRegime, flowIntensity, earlyFlow,
    dataQuality, readable, timestamp: Date.now(),
  };
}
