/**
 * ODSS - AI Explanation Engine (Phase 16)
 * AI NEVER decides. AI only explains:
 *   Why selected, Why rejected, Why holding, Why trailing, Why exiting.
 *
 * Uses z-ai-web-dev-sdk (LLM) in the backend only.
 * Falls back to deterministic templated explanations if AI fails.
 */
import ZAI from 'z-ai-web-dev-sdk';
import type {
  Recommendation,
  LiveTrade,
  TradeManagementOutput,
  ExitEngineOutput,
  AIExplanation,
} from '../types';

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function buildContextForDecision(rec: Recommendation, mode: 'SELECTED' | 'REJECTED'): string {
  const m = rec.market;
  const t = rec.technical;
  const o = rec.optionChain;
  const r = rec.risk;
  const d = rec.decision;
  const opp = rec.opportunity;
  const facts = [
    `Symbol: ${rec.symbol} (${rec.sector ?? 'INDEX'})`,
    `Direction: ${rec.direction} (CE=Call/Bullish, PE=Put/Bearish)`,
    `Score: ${opp.totalScore.toFixed(1)}/100 | Confidence: ${opp.confidence.toFixed(0)}%`,
    `Market: ${m.marketState} (score ${m.marketScore.toFixed(0)}, VIX ${m.indiaVix.toFixed(2)})`,
    `Technical: ${t.facts.slice(0, 4).join('; ')}`,
    `Option Chain: PCR ${o.pcr.toFixed(2)}, ${o.callWritingTrend} CE / ${o.putWritingTrend} PE, max pain ${o.maxPain}`,
    `Risk: Entry ${r.entry.toFixed(2)}, SL ${r.stopLoss.toFixed(2)}, TP1/2/3 ${r.tp1.toFixed(2)}/${r.tp2.toFixed(2)}/${r.tp3.toFixed(2)}, RR 1:${r.rr.toFixed(1)}, Max loss ₹${r.maxLoss.toFixed(0)}`,
    `Decision: ${d.decision} (${d.confidence}% confidence)`,
    `Votes: ${d.votes.map((v) => `${v.engine}:${v.vote}(${(v.weight * 100).toFixed(0)}%)`).join(', ')}`,
    `Strike: ${rec.strike.primaryStrike} (${rec.strike.strikeType}, LTP ${rec.strike.primaryLTP}, Δ ${rec.strike.primaryDelta.toFixed(2)})`,
    `Entry: ${rec.entry.entryType} — ${rec.entry.entryTrigger}`,
  ].join('\n');
  return facts;
}

let explainerCooldownUntil = 0;

async function callLLM(system: string, user: string): Promise<string | null> {
  // Respect cooldown to prevent 429 cascades
  if (Date.now() < explainerCooldownUntil) return null;
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    });
    return completion.choices[0]?.message?.content ?? null;
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    if (msg.includes('429') || msg.includes('Too many requests') || msg.includes('500')) {
      explainerCooldownUntil = Date.now() + 5 * 60_000;
    }
    return null;
  }
}

export async function explainDecision(
  rec: Recommendation,
  mode: 'SELECTED' | 'REJECTED',
): Promise<AIExplanation> {
  const context = buildContextForDecision(rec, mode);
  const systemPrompt = `You are ODSS AI Coach — an options trading explainer for the Indian market (NIFTY/BANKNIFTY/stocks).
You NEVER give trade recommendations or decisions. You ONLY explain WHY the deterministic engine arrived at its decision.
Be concise, structured, and trader-friendly. Use bullet points. Reference the engine votes and facts.
Always include a risk note. Always end with a one-line coaching tip.
Respond in plain text with markdown bullets.`;

  const userPrompt = `Context (deterministic engine output):
${context}

Mode: ${mode === 'SELECTED' ? 'WHY SELECTED (this was chosen as a top opportunity)' : 'WHY REJECTED (this was deprioritized)'}

Explain:
- Summary in 1-2 sentences
- Why selected/rejected (3-5 bullets referencing specific votes/facts)
- Risk notes
- One coaching tip

Keep under 250 words.`;

  const content = await callLLM(systemPrompt, userPrompt);
  if (!content) {
    return fallbackExplanation(rec, mode);
  }

  return {
    summary: content.split('\n').slice(0, 2).join(' ').trim(),
    whySelected: mode === 'SELECTED' ? extractBullets(content, ['why selected', 'selected']) : undefined,
    whyRejected: mode === 'REJECTED' ? extractBullets(content, ['why rejected', 'rejected']) : undefined,
    riskNotes: extractSection(content, 'risk'),
    coachingTip: extractLastLine(content),
    timestamp: Date.now(),
  };
}

export async function explainTradeManagement(
  trade: LiveTrade,
  mgmt: TradeManagementOutput,
  exit: ExitEngineOutput,
): Promise<AIExplanation> {
  const context = [
    `Trade: ${trade.symbol} ${trade.direction}`,
    `State: ${trade.state}`,
    `Entry: option ₹${trade.entryPrice?.toFixed(2)} at underlying ₹${trade.underlyingEntryPrice?.toFixed(2)}`,
    `Current: option ₹${trade.currentPrice?.toFixed(2)} at underlying ₹${trade.currentUnderlying?.toFixed(2)}`,
    `R multiple: ${trade.rMultiple?.toFixed(2)}`,
    `SL: ₹${trade.stopLoss?.toFixed(2)} (initial ${trade.initialStopLoss?.toFixed(2)})`,
    `TP1/2/3: ${trade.tp1?.toFixed(2)}/${trade.tp2?.toFixed(2)}/${trade.tp3?.toFixed(2)}`,
    `Management action: ${mgmt.action} — ${mgmt.reason}`,
    `Exit score: ${exit.exitScore.toFixed(0)} (${exit.action})`,
    `Exit reasons: ${exit.facts.join('; ')}`,
  ].join('\n');

  const systemPrompt = `You are ODSS AI Coach — an options trade management explainer for the Indian market.
You NEVER decide. You ONLY explain WHY the engine recommends HOLDING, TRAILING, or EXITING.
Be concise, structured, trader-friendly. Use bullet points. Reference R-multiple, SL distance, and exit score.
End with a one-line coaching tip.`;

  const userPrompt = `Context:
${context}

Explain:
- Summary (1 sentence)
- Why holding/trailing/exiting (3-5 bullets)
- Risk notes
- One coaching tip
Keep under 200 words.`;

  const content = await callLLM(systemPrompt, userPrompt);
  if (!content) {
    return fallbackMgmtExplanation(trade, mgmt, exit);
  }

  return {
    summary: content.split('\n').slice(0, 2).join(' ').trim(),
    whyHolding: mgmt.action === 'HOLD' || mgmt.action === 'WATCH' ? extractBullets(content, ['why hold', 'holding']) : undefined,
    whyExiting: mgmt.action === 'FULL_EXIT' || exit.action === 'EXIT' ? extractBullets(content, ['why exit', 'exiting']) : undefined,
    riskNotes: extractSection(content, 'risk'),
    coachingTip: extractLastLine(content),
    timestamp: Date.now(),
  };
}

// Helpers
function extractBullets(text: string, _keywords: string[]): string[] {
  const lines = text.split('\n');
  const bullets: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || /^\d+\./.test(trimmed)) {
      inSection = true;
      bullets.push(trimmed.replace(/^[-•\d.]+\s*/, ''));
    } else if (inSection && trimmed.length > 0 && !trimmed.startsWith('-') && !trimmed.startsWith('•')) {
      inSection = false;
    }
  }
  return bullets.slice(0, 6);
}

function extractSection(text: string, keyword: string): string | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(keyword)) {
      const next = lines.slice(i + 1).find((l) => l.trim().length > 0);
      if (next) return next.trim();
      return lines[i].trim();
    }
  }
  return undefined;
}

function extractLastLine(text: string): string | undefined {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines[lines.length - 1]?.trim();
}

// Fallback deterministic explanations if LLM unavailable
function fallbackExplanation(rec: Recommendation, mode: 'SELECTED' | 'REJECTED'): AIExplanation {
  const d = rec.decision;
  const aligned = d.votes.filter((v) => v.vote === (mode === 'SELECTED' ? 'ENTER' : 'AVOID'));
  return {
    summary: `${rec.symbol} ${rec.direction} — ${mode === 'SELECTED' ? 'selected' : 'rejected'} with ${d.confidence}% confidence.`,
    whySelected: mode === 'SELECTED'
      ? aligned.map((v) => `${v.engine} voted ENTER (${(v.weight * 100).toFixed(0)}% weight): ${v.reason}`)
      : undefined,
    whyRejected: mode === 'REJECTED'
      ? d.votes.filter((v) => v.vote === 'AVOID').map((v) => `${v.engine}: ${v.reason}`)
      : undefined,
    riskNotes: `Max loss ₹${rec.risk.maxLoss.toFixed(0)} on ${rec.risk.positionSize} lot(s). RR 1:${rec.risk.rr.toFixed(1)}.`,
    coachingTip: 'Wait for the entry trigger before executing — never chase price.',
    timestamp: Date.now(),
  };
}

function fallbackMgmtExplanation(
  trade: LiveTrade,
  mgmt: TradeManagementOutput,
  exit: ExitEngineOutput,
): AIExplanation {
  return {
    summary: `${trade.symbol} ${trade.direction} — ${mgmt.action}. R=${trade.rMultiple?.toFixed(2)}. Exit score ${exit.exitScore.toFixed(0)}/100.`,
    whyHolding: mgmt.action === 'HOLD' ? ['Trade progressing normally', `R multiple ${trade.rMultiple?.toFixed(2)}`] : undefined,
    whyExiting: mgmt.action === 'FULL_EXIT' || exit.action === 'EXIT'
      ? [exit.reason, `Exit score ${exit.exitScore.toFixed(0)}/100`]
      : undefined,
    riskNotes: `Current SL ₹${trade.stopLoss?.toFixed(2)} (initial ₹${trade.initialStopLoss?.toFixed(2)}).`,
    coachingTip: 'Stick to the plan — do not exit on a single indicator change.',
    timestamp: Date.now(),
  };
}
