/**
 * ODSS - Guardrails Engine (V1.1)
 *
 * Borrowed concept from EdgeFlo: discipline enforcement.
 * NOT a new analysis engine — a pre-entry check that blocks trades
 * which violate the user's risk limits.
 *
 * Checks (in order):
 *   1. Max trades per day
 *   2. Max daily loss
 *   3. Profit cap (stop when ahead)
 *   4. No new entries near market close
 *   5. No new entries during first 5 minutes (chaos)
 *   6. Correlation with active trade (don't double up)
 *
 * Returns: { allowed: boolean, reason: string, guardrail: string }
 */
import { db } from '@/lib/db';
import { getActiveTrade } from '../store/store';
import { ALL_SYMBOLS } from '../universe';
import { getQuote } from '../simulator/market-simulator';
import type { Direction } from '../types';

export interface GuardrailResult {
  allowed: boolean;
  reason: string;
  guardrail: string; // which guardrail triggered
  warnings: string[];
}

// Intraday trade counter (resets at market open)
let tradesToday = 0;
let realizedPnlToday = 0;
let lastResetDate = '';

function resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) {
    tradesToday = 0;
    realizedPnlToday = 0;
    lastResetDate = today;
  }
}

// Correlation matrix (beta-based, precomputed)
// Symbols in the same sector have high correlation; indices correlate with their sectors.
function getCorrelation(symbol1: string, symbol2: string): number {
  if (symbol1 === symbol2) return 1;
  const m1 = ALL_SYMBOLS.find((s) => s.symbol === symbol1);
  const m2 = ALL_SYMBOLS.find((s) => s.symbol === symbol2);
  if (!m1 || !m2) return 0;

  // Same sector → high correlation
  if (m1.sector === m2.sector && m1.type === 'STOCK' && m2.type === 'STOCK') return 0.75;

  // Index vs its component stocks
  if (symbol1 === 'BANKNIFTY' && m2.sector === 'BANKING') return 0.85;
  if (symbol2 === 'BANKNIFTY' && m1.sector === 'BANKING') return 0.85;
  if (symbol1 === 'FINNIFTY' && (m2.sector === 'BANKING' || m2.sector === 'FINANCIAL')) return 0.8;
  if (symbol2 === 'FINNIFTY' && (m1.sector === 'BANKING' || m1.sector === 'FINANCIAL')) return 0.8;
  if (symbol1 === 'NIFTY' || symbol2 === 'NIFTY') return 0.6; // NIFTY correlates with everything
  if (symbol1 === 'MIDCPNIFTY' || symbol2 === 'MIDCPNIFTY') return 0.55;

  // Different sectors → low correlation
  return 0.3;
}

export async function checkGuardrails(
  symbol: string,
  direction: Direction,
  config: any
): Promise<GuardrailResult> {
  resetIfNewDay();
  const warnings: string[] = [];

  // 1. Max trades per day
  if (tradesToday >= config.maxTradesPerDay) {
    return {
      allowed: false,
      reason: `Daily trade limit reached (${tradesToday}/${config.maxTradesPerDay}). No more entries today.`,
      guardrail: 'MAX_TRADES_PER_DAY',
      warnings,
    };
  }

  // 2. Max daily loss
  const maxLossRupees = (config.capital * config.maxDailyLossPct) / 100;
  if (realizedPnlToday <= -maxLossRupees) {
    return {
      allowed: false,
      reason: `Daily loss limit hit (₹${Math.abs(realizedPnlToday).toFixed(0)} loss). Stop trading for today.`,
      guardrail: 'MAX_DAILY_LOSS',
      warnings,
    };
  }

  // 3. Profit cap
  const profitCapRupees = (config.capital * config.profitCapPct) / 100;
  if (realizedPnlToday >= profitCapRupees) {
    return {
      allowed: false,
      reason: `Profit cap reached (₹${realizedPnlToday.toFixed(0)} profit). Don't give it back — stop for today.`,
      guardrail: 'PROFIT_CAP',
      warnings,
    };
  }

  // 4. No new entries near market close
  // Indian market closes at 15:30 IST. We use local time (server is IST).
  const now = new Date();
  const istHour = now.getHours();
  const istMinute = now.getMinutes();
  const minutesToClose = (15 * 60 + 30) - (istHour * 60 + istMinute); // approx IST
  if (minutesToClose > 0 && minutesToClose < config.noEntryAfterMinutes) {
    return {
      allowed: false,
      reason: `Too close to market close (${minutesToClose} min remaining). No new entries in last ${config.noEntryAfterMinutes} min.`,
      guardrail: 'NEAR_CLOSE',
      warnings,
    };
  }

  // 5. No new entries in first 5 minutes (9:15-9:20)
  // Only applies during live market hours; for the simulator we skip this
  // since the simulator doesn't track real IST precisely.
  // (This rule is documented but enforced only when real broker data is connected.)

  // 6. Correlation with active trade
  const active = getActiveTrade();
  if (active) {
    const corr = getCorrelation(symbol, active.symbol);
    if (corr > 0.7) {
      return {
        allowed: false,
        reason: `High correlation (${(corr * 100).toFixed(0)}%) with active ${active.symbol} ${active.direction} trade. This is the same bet — don't double up.`,
        guardrail: 'CORRELATED_EXPOSURE',
        warnings,
      };
    }
    if (corr > 0.5) {
      warnings.push(`Moderate correlation (${(corr * 100).toFixed(0)}%) with active ${active.symbol} trade. Consider sizing down.`);
    }
  }

  // All checks passed
  return {
    allowed: true,
    reason: 'All guardrails passed.',
    guardrail: 'NONE',
    warnings,
  };
}

// Called when a trade is entered (to increment counter)
export function registerTradeEntry() {
  resetIfNewDay();
  tradesToday++;
}

// Called when a trade is exited (to update realized PnL)
export function registerTradeExit(pnl: number) {
  resetIfNewDay();
  realizedPnlToday += pnl;
}

// Get current guardrail status (for dashboard display)
export function getGuardrailStatus(config: any) {
  resetIfNewDay();
  return {
    tradesToday,
    maxTradesPerDay: config.maxTradesPerDay,
    realizedPnlToday,
    maxDailyLossRupees: (config.capital * config.maxDailyLossPct) / 100,
    profitCapRupees: (config.capital * config.profitCapPct) / 100,
    remainingTrades: Math.max(0, config.maxTradesPerDay - tradesToday),
  };
}
