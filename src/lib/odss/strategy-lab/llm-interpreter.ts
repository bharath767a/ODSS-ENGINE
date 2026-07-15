/**
 * ODSS Strategy Lab — LLM Interpreter
 * ====================================================================
 *
 * Uses the z-ai-web-dev-sdk (LLM) to translate a strategy genome into
 * a plain-English description, and to suggest concrete parameter
 * tweaks that could improve a variant's performance.
 *
 * The AI NEVER decides anything — it only explains and suggests. The
 * deterministic evolution engine (evolution-engine.ts) and the
 * strategy-performance-tracker remain the source of truth for all
 * fitness calculations and lifecycle transitions.
 *
 * Both functions are defensive: any LLM failure (network, malformed
 * response, missing SDK, parse error) is caught and a deterministic
 * fallback is returned, so callers can render a useful result even
 * when the LLM is unavailable.
 * ====================================================================
 */

import {
  parseGenome,
  genomeToString,
  type StrategyGenome,
} from './strategy-genome';

// ----------------------------------------------------------------------------
// LLM helper
// ----------------------------------------------------------------------------

async function callLLM(
  system: string,
  user: string,
  maxTokens?: number,
): Promise<string | null> {
  try {
    // Dynamic import keeps z-ai-web-dev-sdk out of the client bundle.
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    });
    return completion.choices[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Public: interpretStrategy
// ----------------------------------------------------------------------------

/**
 * Generate a plain-English description of the strategy described by
 * the given genome JSON string. Returns 2-3 sentences.
 *
 * On any failure (invalid genome, LLM unavailable, etc.) returns a
 * deterministic template-based description.
 */
export async function interpretStrategy(genome: string): Promise<string> {
  // Parse defensively.
  let parsed: StrategyGenome | null = null;
  try {
    parsed = parseGenome(genome);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return (
      'This strategy genome could not be parsed. The variant may have ' +
      'been created with an older schema; review the raw JSON to inspect ' +
      'its parameters.'
    );
  }

  const system = `You are ODSS Strategy Lab — an expert Indian options trader who explains trading strategies in plain English.
You are given a strategy genome (a JSON object describing a strategy's entry, strike-selection, exit, risk and position-sizing rules).
Your job: produce a clear, 2-3 sentence summary that a trader can read in 5 seconds.
Mention the strategy type, the core entry filter, and the most distinctive exit/risk rule.
Never invent numbers that are not in the genome. Use INR / ₹ terminology only if relevant. No bullet points — write prose.`;

  const user = `Genome (JSON):
${JSON.stringify(parsed, null, 2)}

Compact summary: ${genomeToString(parsed)}

Write a 2-3 sentence plain-English description of this strategy.`;

  const content = await callLLM(system, user, 200);
  if (content && content.trim().length > 10) {
    return content.trim();
  }
  return fallbackInterpretation(parsed);
}

function fallbackInterpretation(g: StrategyGenome): string {
  const stratName = g.strategy.replace(/_/g, ' ').toLowerCase();
  const entry = `enters ${g.entryRules.entryType.toLowerCase()} when market score ≥ ${Math.round(g.entryRules.minMarketScore)} and RR ≥ ${g.entryRules.minRR.toFixed(1)}`;
  const strike = `${g.strikeSelection.strikeType.replace('_', ' ')} strikes near Δ ${g.strikeSelection.deltaTarget.toFixed(2)}`;
  const exit = `exits at ${Math.round(g.exitRules.stopLossPct * 100)}% stop-loss or ${g.exitRules.takeProfit1R.toFixed(1)}R profit${g.exitRules.exitOnEOD ? ', flat by end-of-day' : ''}`;
  return (
    `A ${stratName} strategy that ${entry}. ` +
    `It targets ${strike} and ${exit}. ` +
    `Sized with ${g.positionSizing.method.toLowerCase().replace('_', ' ')} (${g.positionSizing.fixedLots} lot(s)).`
  );
}

// ----------------------------------------------------------------------------
// Public: suggestImprovements
// ----------------------------------------------------------------------------

/**
 * Ask the LLM for 2-3 concrete, parameter-level improvements to the
 * given variant based on its performance stats.
 *
 * `stats` is intentionally `any` so callers can pass either a raw
 * StrategyVariant row or a slimmed-down summary. We extract the most
 * relevant fields defensively.
 *
 * Returns an array of 2-3 suggestion strings. On any failure returns
 * a deterministic 2-item fallback array.
 */
export async function suggestImprovements(
  variantName: string,
  stats: any,
): Promise<string[]> {
  // Build a compact, LLM-friendly stats summary. Be defensive about
  // every field — `stats` can come from many places.
  const s = stats ?? {};
  const summary = {
    name: variantName,
    strategy: s.strategy ?? s.genome?.strategy ?? 'unknown',
    status: s.status ?? 'unknown',
    tier: s.tier ?? 'unknown',
    rawN: safeNum(s.rawN),
    effectiveN: safeNum(s.effectiveN),
    wins: safeNum(s.wins),
    losses: safeNum(s.losses),
    winRatePct: safeNum(s.winRatePct),
    profitFactor: safeNum(s.profitFactor),
    avgR: safeNum(s.avgR),
    totalPnl: safeNum(s.totalPnl),
    fitness: safeNum(s.fitness),
    genome: s.genome
      ? (() => {
          try {
            const parsed =
              typeof s.genome === 'string'
                ? parseGenome(s.genome)
                : (s.genome as StrategyGenome);
            return parsed ? genomeToString(parsed) : null;
          } catch {
            return null;
          }
        })()
      : null,
  };

  const system = `You are ODSS Strategy Lab — an expert Indian options quant coach.
You are given the performance stats of a single strategy variant that was evolved by a genetic algorithm.
Your job: suggest 2-3 CONCRETE, parameter-level improvements the evolution engine could try next.
Each suggestion must reference a specific genome parameter (e.g. "lower stopLossPct from 30% to 20%", "raise minRR to 2.5", "disable exitOnEOD").
Tie each suggestion to the observed stat (e.g. low win rate, negative avgR, small sample size, poor profit factor).
Be terse: one short sentence per suggestion. No preamble, no closing remarks.
Output exactly 2 or 3 suggestions, one per line, prefixed with "- ".`;

  const user = `Variant stats:
${JSON.stringify(summary, null, 2)}

Suggest 2-3 concrete parameter-level improvements.`;

  const content = await callLLM(system, user, 300);
  const parsed = parseSuggestions(content);
  if (parsed.length >= 2) {
    return parsed.slice(0, 3);
  }
  return fallbackSuggestions(summary);
}

function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseSuggestions(content: string | null): string[] {
  if (!content) return [];
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const suggestions: string[] = [];
  for (const line of lines) {
    // Accept lines starting with "-", "•", "*", or "1."/"1)"
    const match = line.match(/^(?:[-•*]\s+|\d+[.)]\s+)?(.+)$/);
    if (match && match[1].length > 8) {
      suggestions.push(match[1].trim());
    }
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

function fallbackSuggestions(s: {
  name: string;
  winRatePct: number | null;
  profitFactor: number | null;
  avgR: number | null;
  effectiveN: number | null;
}): string[] {
  const out: string[] = [];

  // Win rate signal
  const wr = s.winRatePct;
  if (wr !== null && wr < 50) {
    out.push(
      `Tighten entry filters — raise minTechnicalScore by 5 and require confluence to lift the ${wr.toFixed(1)}% win rate.`,
    );
  } else if (wr !== null && wr >= 60) {
    out.push(
      `Loosen strike selection toward OTM_1 to capture more premium at the strong ${wr.toFixed(1)}% win rate.`,
    );
  } else {
    out.push(
      'Tune minMarketScore ±10 to find a sharper entry edge.',
    );
  }

  // Expectancy signal
  const r = s.avgR;
  if (r !== null && r < 0) {
    out.push(
      `Cut stopLossPct by 5pp (currently negative avgR ${r.toFixed(2)}) to reduce per-trade drawdown.`,
    );
  } else if (r !== null && r > 1) {
    out.push(
      `Extend takeProfit2R by +0.5R — strong avgR ${r.toFixed(2)} suggests winners are being cut too early.`,
    );
  } else {
    out.push(
      'Rebalance the TP1/TP2 ladder by 0.25R increments to test expectancy.',
    );
  }

  // Sample-size signal
  const n = s.effectiveN;
  if (n !== null && n < 10) {
    out.push(
      `Keep the variant in CANDIDATE until effectiveN ≥ 10 (currently ${n.toFixed(1)}) — stats are not yet reliable.`,
    );
  } else {
    out.push(
      'Try a mutated child with kellyFraction ±0.05 to diversify position-sizing behavior.',
    );
  }

  return out.slice(0, 3);
}
