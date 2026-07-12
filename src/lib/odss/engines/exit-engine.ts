/**
 * ODSS - Exit Engine (Phase 13)
 * Never exits because one indicator changes.
 * Creates Exit Score using: Trend, VWAP, OI, Volume, Sector, Market, Structure.
 * Output: Continue, Trail, Reduce Position, Exit.
 */
import type {
  ExitEngineOutput,
  ExitAction,
  LiveTrade,
  TechnicalEngineOutput,
  OptionChainEngineOutput,
  MarketEngineOutput,
  SectorScore,
} from '../types';
import { getQuote } from '../simulator/market-simulator';

export function runExitEngine(
  trade: LiveTrade,
  technical: TechnicalEngineOutput,
  oc: OptionChainEngineOutput,
  market: MarketEngineOutput,
  sector?: SectorScore,
): ExitEngineOutput {
  const q = getQuote(trade.symbol);
  if (!q || !trade.underlyingEntryPrice || !trade.initialStopLoss) {
    return { action: 'CONTINUE', exitScore: 0, reason: 'Insufficient data', facts: [] };
  }
  const isLong = trade.direction === 'CE';
  const entry = trade.underlyingEntryPrice;
  const current = q.ltp;
  const slDist = Math.abs(entry - trade.initialStopLoss);
  const rMultiple = isLong ? (current - entry) / slDist : (entry - current) / slDist;

  // Each component contributes to exit score (0..100, higher = exit)
  let exitScore = 0;
  const reasons: string[] = [];

  // Trend
  const trendAgainst = isLong ? technical.trend === 'BEARISH' : technical.trend === 'BULLISH';
  if (trendAgainst) {
    exitScore += 25;
    reasons.push('Trend reversed against position');
  } else {
    reasons.push('Trend aligned with position');
  }

  // VWAP
  const vwapAgainst = isLong ? technical.vwapPosition === 'BELOW' : technical.vwapPosition === 'ABOVE';
  if (vwapAgainst && rMultiple < 0) {
    exitScore += 15;
    reasons.push('Price below VWAP while in loss');
  } else {
    reasons.push('VWAP structure OK');
  }

  // OI / Option chain
  const ocAgainst = isLong ? oc.bias === 'SHORT' : oc.bias === 'LONG';
  if (ocAgainst) {
    exitScore += 15;
    reasons.push('Option chain bias flipping against position');
  }
  if (oc.unwinding === (isLong ? 'CALL_UNWINDING' : 'PUT_UNWINDING')) {
    exitScore += 10;
    reasons.push(`${oc.unwinding.replace('_', ' ')} detected`);
  }

  // Volume
  if (technical.volumeStructure === 'FALLING' && rMultiple > 0) {
    exitScore += 5;
    reasons.push('Volume fading on rally');
  }

  // Sector
  if (sector) {
    const sectorAgainst = isLong ? sector.strength < -20 : sector.strength > 20;
    if (sectorAgainst) {
      exitScore += 10;
      reasons.push(`Sector ${sector.sector} weakening (${sector.changePct.toFixed(2)}%)`);
    } else {
      reasons.push(`Sector ${sector.sector} supportive (${sector.changePct.toFixed(2)}%)`);
    }
  }

  // Market
  const marketAgainst = isLong ? market.marketScore < -25 : market.marketScore > 25;
  if (marketAgainst) {
    exitScore += 15;
    reasons.push(`Market turning against (score ${market.marketScore.toFixed(0)})`);
  }

  // Structure: liquidity sweep against
  if (technical.liquiditySweep.direction !== 'NONE') {
    const sweepAgainst =
      (isLong && technical.liquiditySweep.direction === 'HIGH') ||
      (!isLong && technical.liquiditySweep.direction === 'LOW');
    if (sweepAgainst) {
      exitScore += 10;
      reasons.push(`Liquidity sweep ${technical.liquiditySweep.direction} against position`);
    }
  }

  exitScore = Math.min(100, exitScore);

  let action: ExitAction = 'CONTINUE';
  if (exitScore >= 60) action = 'EXIT';
  else if (exitScore >= 40) action = 'REDUCE_POSITION';
  else if (exitScore >= 20 && rMultiple > 0.5) action = 'TRAIL';
  else action = 'CONTINUE';

  const reason =
    action === 'EXIT'
      ? `Exit score ${exitScore.toFixed(0)} >= 60 — multiple confirmations to exit`
      : action === 'REDUCE_POSITION'
      ? `Exit score ${exitScore.toFixed(0)} — reduce position size`
      : action === 'TRAIL'
      ? `Exit score ${exitScore.toFixed(0)} — trail stop loss`
      : `Exit score ${exitScore.toFixed(0)} — continue holding`;

  return {
    action,
    exitScore,
    reason,
    facts: [...reasons, reason],
  };
}
