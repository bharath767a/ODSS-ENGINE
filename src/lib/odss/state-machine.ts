/**
 * ODSS - Trade State Machine (Phase 15)
 *
 * States:
 *   WATCHLIST -> READY -> WAITING_ENTRY -> ENTERED -> TP1 -> TP2 -> TRAILING -> WEAKENING -> EXIT -> COMPLETE
 *
 * No shortcuts: each transition requires explicit conditions.
 * Every transition is logged to stateHistory.
 */
import type { LiveTrade, TradeStateName, TradeAction } from '../types';
import type { Decision } from '../types';

export function createInitialTrade(symbol: string, direction: 'CE' | 'PE'): LiveTrade {
  const now = Date.now();
  return {
    symbol,
    direction,
    state: 'WATCHLIST',
    stateHistory: [{ state: 'WATCHLIST', timestamp: now, reason: 'Added to watchlist' }],
    createdAt: now,
    updatedAt: now,
  };
}

interface TransitionInput {
  decision: Decision;
  managementAction: TradeAction;
  rMultiple?: number;
  hitTP1?: boolean;
  hitTP2?: boolean;
  hitSL?: boolean;
  exitAction?: 'CONTINUE' | 'TRAIL' | 'REDUCE_POSITION' | 'EXIT';
  reason?: string;
}

/**
 * Compute next state given current state + signals.
 * Pure function: returns new state + reason. Caller persists.
 */
export function nextTradeState(current: TradeStateName, input: TransitionInput): {
  state: TradeStateName;
  reason: string;
} {
  // Universal: hit SL -> EXIT
  if (input.hitSL) {
    return { state: 'EXIT', reason: 'Stop loss hit' };
  }

  switch (current) {
    case 'WATCHLIST':
      if (input.decision === 'ENTER' || input.decision === 'WAIT') {
        return { state: 'READY', reason: `Decision ${input.decision} — setup ready` };
      }
      return { state: 'WATCHLIST', reason: 'Decision not yet actionable' };

    case 'READY':
      if (input.decision === 'AVOID') {
        return { state: 'WATCHLIST', reason: 'Decision flipped to AVOID' };
      }
      if (input.decision === 'ENTER') {
        return { state: 'WAITING_ENTRY', reason: 'Entry trigger armed' };
      }
      return { state: 'READY', reason: 'Waiting for ENTER decision' };

    case 'WAITING_ENTRY':
      if (input.decision === 'AVOID') {
        return { state: 'WATCHLIST', reason: 'Setup invalidated before entry' };
      }
      // Entry triggered when management action indicates entry (we treat HOLD with positive R as entered)
      // Actual entry is handled by orchestrator when entry conditions met.
      return { state: 'WAITING_ENTRY', reason: 'Awaiting entry trigger' };

    case 'ENTERED':
      if (input.exitAction === 'EXIT') return { state: 'EXIT', reason: 'Exit engine signals EXIT' };
      if (input.hitTP1) return { state: 'TP1', reason: 'TP1 hit — move SL to breakeven' };
      if (input.managementAction === 'FULL_EXIT') return { state: 'EXIT', reason: 'Mgmt: full exit' };
      if (input.managementAction === 'MOVE_TO_BREAKEVEN') return { state: 'TP1', reason: 'Breakeven move' };
      if (input.managementAction === 'WATCH') return { state: 'WEAKENING', reason: 'Mgmt: watch' };
      return { state: 'ENTERED', reason: 'Hold' };

    case 'TP1':
      if (input.exitAction === 'EXIT') return { state: 'EXIT', reason: 'Exit engine signals EXIT' };
      if (input.hitTP2) return { state: 'TP2', reason: 'TP2 hit' };
      if (input.managementAction === 'FULL_EXIT') return { state: 'EXIT', reason: 'Mgmt: full exit' };
      if (input.managementAction === 'TRAIL_SL') return { state: 'TRAILING', reason: 'Trailing SL' };
      if (input.managementAction === 'WATCH') return { state: 'WEAKENING', reason: 'Mgmt: watch' };
      return { state: 'TP1', reason: 'Hold after TP1' };

    case 'TP2':
      if (input.exitAction === 'EXIT') return { state: 'EXIT', reason: 'Exit engine signals EXIT' };
      if (input.managementAction === 'FULL_EXIT') return { state: 'EXIT', reason: 'Mgmt: full exit' };
      if (input.managementAction === 'TRAIL_SL') return { state: 'TRAILING', reason: 'Trailing SL after TP2' };
      if (input.managementAction === 'WATCH') return { state: 'WEAKENING', reason: 'Mgmt: watch' };
      return { state: 'TP2', reason: 'Hold after TP2' };

    case 'TRAILING':
      if (input.exitAction === 'EXIT') return { state: 'EXIT', reason: 'Exit engine signals EXIT' };
      if (input.managementAction === 'FULL_EXIT') return { state: 'EXIT', reason: 'Trailing SL hit' };
      if (input.managementAction === 'WATCH') return { state: 'WEAKENING', reason: 'Mgmt: watch' };
      return { state: 'TRAILING', reason: 'Trail' };

    case 'WEAKENING':
      if (input.exitAction === 'EXIT') return { state: 'EXIT', reason: 'Exit engine signals EXIT' };
      if (input.managementAction === 'FULL_EXIT') return { state: 'EXIT', reason: 'Mgmt: full exit' };
      if (input.managementAction === 'TRAIL_SL') return { state: 'TRAILING', reason: 'Resume trailing' };
      return { state: 'WEAKENING', reason: 'Watching for recovery' };

    case 'EXIT':
      return { state: 'COMPLETE', reason: 'Trade closed' };

    case 'COMPLETE':
      return { state: 'COMPLETE', reason: 'Already complete' };
  }
}

export function applyStateTransition(
  trade: LiveTrade,
  next: { state: TradeStateName; reason: string },
): LiveTrade {
  if (next.state === trade.state) return trade;
  const now = Date.now();
  return {
    ...trade,
    state: next.state,
    stateHistory: [...trade.stateHistory, { state: next.state, timestamp: now, reason: next.reason }],
    updatedAt: now,
  };
}

export const STATE_ORDER: TradeStateName[] = [
  'WATCHLIST',
  'READY',
  'WAITING_ENTRY',
  'ENTERED',
  'TP1',
  'TP2',
  'TRAILING',
  'WEAKENING',
  'EXIT',
  'COMPLETE',
];

export function stateProgress(state: TradeStateName): number {
  return STATE_ORDER.indexOf(state) / (STATE_ORDER.length - 1);
}
