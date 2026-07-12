/**
 * ODSS - Decision Stability & Uncertainty Tracker (V1.1)
 *
 * Two simple, non-structural additions:
 *
 * 1. UNCERTAINTY LABEL
 *    When the Decision Engine outputs AVOID due to CONFLICTING signals
 *    (not due to strong bearish/bullish bias), we label it NO_TRADE_UNCERTAIN
 *    instead of AVOID. This tells the user: "the engine doesn't know"
 *    rather than "the engine thinks you should avoid."
 *
 * 2. DECISION STABILITY
 *    Track the last N decisions per symbol. If the decision is flip-flopping
 *    (BUY → WAIT → BUY → AVOID), add a stability penalty to confidence
 *    and display a warning badge. Stable decisions = trustworthy.
 *
 * Both are pure logic — no new engines, no new interfaces.
 */

const HISTORY_SIZE = 5;
const FLIP_THRESHOLD = 3; // if >= 3 changes in last 5 decisions, unstable

interface SymbolDecisionHistory {
  decisions: { decision: string; confidence: number; timestamp: number }[];
}

const decisionHistories = new Map<string, SymbolDecisionHistory>();

export function recordDecision(
  symbol: string,
  decision: string,
  confidence: number
): { stability: number; isStable: boolean; flipCount: number } {
  let hist = decisionHistories.get(symbol);
  if (!hist) {
    hist = { decisions: [] };
    decisionHistories.set(symbol, hist);
  }

  hist.decisions.push({ decision, confidence, timestamp: Date.now() });
  if (hist.decisions.length > HISTORY_SIZE) {
    hist.decisions.shift();
  }

  const { stability, isStable, flipCount } = computeStability(hist);
  return { stability, isStable, flipCount };
}

function computeStability(hist: SymbolDecisionHistory): {
  stability: number;
  isStable: boolean;
  flipCount: number;
} {
  if (hist.decisions.length < 2) {
    return { stability: 1, isStable: true, flipCount: 0 };
  }

  let flips = 0;
  for (let i = 1; i < hist.decisions.length; i++) {
    if (hist.decisions[i].decision !== hist.decisions[i - 1].decision) {
      flips++;
    }
  }

  // Stability = 1 - (flips / max possible flips)
  const maxFlips = hist.decisions.length - 1;
  const stability = maxFlips > 0 ? 1 - flips / maxFlips : 1;
  const isStable = flips < FLIP_THRESHOLD;

  return { stability, isStable, flipCount: flips };
}

/**
 * Classify an AVOID decision as either:
 * - AVOID (strong opposing bias — engine actively says no)
 * - NO_TRADE_UNCERTAIN (signals are conflicting — engine doesn't know)
 *
 * Rule: If any engine votes ENTER but the aggregate is AVOID,
 *       it's uncertainty, not active avoidance.
 */
export function classifyAvoid(
  votes: { engine: string; vote: string; score: number; confidence: number }[]
): 'AVOID' | 'NO_TRADE_UNCERTAIN' {
  const hasEnterVote = votes.some((v) => v.vote === 'ENTER');
  const hasAvoidVote = votes.some((v) => v.vote === 'AVOID');

  // If some engines say ENTER and others say AVOID → uncertain
  if (hasEnterVote && hasAvoidVote) {
    return 'NO_TRADE_UNCERTAIN';
  }

  return 'AVOID';
}

export function getDecisionHistory(symbol: string) {
  return decisionHistories.get(symbol)?.decisions ?? [];
}

export function clearAllHistories() {
  decisionHistories.clear();
}
