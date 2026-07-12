/**
 * ODSS - Decision Engine (Phase 14)
 * Every module votes.
 * Suggested weighting (configurable): Market, Sector, Relative Strength,
 * Technical, Option Chain, Risk.
 * Produces: Decision, Confidence, Reasoning.
 */
import type {
  DecisionEngineOutput,
  EngineVote,
  Decision,
  MarketEngineOutput,
  SectorScore,
  RSRow,
  TechnicalEngineOutput,
  OptionChainEngineOutput,
  RiskPlan,
  Direction,
} from '../types';
import { getConfigSync } from '../config';

export function runDecisionEngine(args: {
  direction: Direction;
  market: MarketEngineOutput;
  sector?: SectorScore;
  rs?: RSRow;
  technical: TechnicalEngineOutput;
  optionChain: OptionChainEngineOutput;
  risk: RiskPlan;
}): DecisionEngineOutput {
  const config = getConfigSync();
  const { direction, market, sector, rs, technical, optionChain, risk } = args;
  const isLong = direction === 'CE';

  // Each engine produces a vote: ENTER / WAIT / WATCH / AVOID
  // with weight from config, score 0..100 and confidence 0..100

  const votes: EngineVote[] = [];

  // Market vote
  {
    const aligned = (isLong && market.marketScore > 0) || (!isLong && market.marketScore < 0);
    const strength = Math.abs(market.marketScore);
    let vote: EngineVote['vote'];
    if (aligned && strength > 30 && market.marketConfidence > 60) vote = 'ENTER';
    else if (aligned && strength > 15) vote = 'WAIT';
    else if (!aligned && strength > 30) vote = 'AVOID';
    else vote = 'WATCH';
    votes.push({
      engine: 'Market',
      vote,
      weight: config.weightMarket,
      score: Math.min(100, 50 + market.marketScore * 0.5 * (isLong ? 1 : -1)),
      confidence: market.marketConfidence,
      reason: `${market.marketState} | score ${market.marketScore.toFixed(0)}`,
    });
  }

  // Sector vote
  if (sector) {
    const aligned = (isLong && sector.strength > 0) || (!isLong && sector.strength < 0);
    const strength = Math.abs(sector.strength);
    let vote: EngineVote['vote'];
    if (aligned && strength > 30) vote = 'ENTER';
    else if (aligned) vote = 'WAIT';
    else if (!aligned && strength > 30) vote = 'AVOID';
    else vote = 'WATCH';
    votes.push({
      engine: 'Sector',
      vote,
      weight: config.weightSector,
      score: sector.score,
      confidence: Math.min(100, strength * 2),
      reason: `${sector.sector} rank ${sector.rank} (${sector.leadership})`,
    });
  }

  // RS vote
  if (rs) {
    const aligned = (isLong && rs.rsScore > 0) || (!isLong && rs.rsScore < 0);
    const strength = Math.abs(rs.rsScore);
    let vote: EngineVote['vote'];
    if (aligned && strength > 30) vote = 'ENTER';
    else if (aligned) vote = 'WAIT';
    else if (!aligned && strength > 30) vote = 'AVOID';
    else vote = 'WATCH';
    votes.push({
      engine: 'RelativeStrength',
      vote,
      weight: config.weightRS,
      score: rs.score,
      confidence: Math.min(100, strength * 2),
      reason: `${rs.symbol} RS ${rs.leadership} (rank ${rs.rank} in ${rs.sector})`,
    });
  }

  // Technical vote
  {
    const aligned = (isLong && technical.trend === 'BULLISH') || (!isLong && technical.trend === 'BEARISH');
    let vote: EngineVote['vote'];
    if (aligned && technical.score > 60) vote = 'ENTER';
    else if (aligned && technical.score > 40) vote = 'WAIT';
    else if (!aligned && technical.score > 60) vote = 'AVOID';
    else vote = 'WATCH';
    votes.push({
      engine: 'Technical',
      vote,
      weight: config.weightTechnical,
      score: technical.score,
      confidence: Math.min(100, technical.adx),
      reason: `${technical.trend} | EMA ${technical.emaAlignment} | ADX ${technical.adx.toFixed(0)}`,
    });
  }

  // Option Chain vote
  {
    const aligned = (isLong && optionChain.bias === 'LONG') || (!isLong && optionChain.bias === 'SHORT');
    let vote: EngineVote['vote'];
    if (aligned && optionChain.score > 60) vote = 'ENTER';
    else if (aligned) vote = 'WAIT';
    else if (!aligned && optionChain.score > 60) vote = 'AVOID';
    else vote = 'WATCH';
    votes.push({
      engine: 'OptionChain',
      vote,
      weight: config.weightOptionChain,
      score: optionChain.score,
      confidence: Math.min(100, Math.abs(optionChain.pcr - 1) * 100),
      reason: `PCR ${optionChain.pcr.toFixed(2)} | ${optionChain.callWritingTrend} CE / ${optionChain.putWritingTrend} PE`,
    });
  }

  // Risk vote
  {
    let vote: EngineVote['vote'];
    let score = 100;
    if (risk.rr < config.minRR) {
      vote = 'AVOID';
      score = 30;
    } else if (risk.rr < config.minRR + 0.5) {
      vote = 'WAIT';
      score = 60;
    } else if (risk.maxLoss > config.capital * 0.02) {
      vote = 'AVOID';
      score = 40;
    } else {
      vote = 'ENTER';
      score = 90;
    }
    votes.push({
      engine: 'Risk',
      vote,
      weight: config.weightRisk,
      score,
      confidence: Math.min(100, risk.rr * 30),
      reason: `RR 1:${risk.rr.toFixed(1)} | max loss ₹${risk.maxLoss.toFixed(0)} | lots ${risk.positionSize}`,
    });
  }

  // Aggregate decision
  // Weighted: ENTER += weight, AVOID -= weight * 2, WAIT += weight * 0.3, WATCH += weight * 0.1
  let agg = 0;
  for (const v of votes) {
    if (v.vote === 'ENTER') agg += v.weight * 1.0;
    else if (v.vote === 'WAIT') agg += v.weight * 0.4;
    else if (v.vote === 'WATCH') agg += v.weight * 0.1;
    else if (v.vote === 'AVOID') agg -= v.weight * 1.5;
  }

  let decision: Decision;
  if (agg >= 0.7) decision = 'ENTER';
  else if (agg >= 0.4) decision = 'WAIT';
  else if (agg >= 0.1) decision = 'WATCH';
  else decision = 'AVOID';

  // Confidence: weighted average of vote confidences for engines aligned with decision
  let confNum = 0;
  let confDen = 0;
  for (const v of votes) {
    if (
      (decision === 'ENTER' && v.vote === 'ENTER') ||
      (decision === 'WAIT' && (v.vote === 'ENTER' || v.vote === 'WAIT')) ||
      (decision === 'WATCH' && v.vote !== 'AVOID') ||
      (decision === 'AVOID' && v.vote === 'AVOID')
    ) {
      confNum += v.confidence * v.weight;
      confDen += v.weight;
    }
  }
  const confidence = confDen > 0 ? Math.round(confNum / confDen) : 0;

  const reasoning =
    `Decision ${decision} (agg ${agg.toFixed(2)}, confidence ${confidence}%). ` +
    votes.map((v) => `${v.engine}:${v.vote}(${(v.weight * 100).toFixed(0)}%)`).join(' | ');

  return { decision, confidence, reasoning, votes, timestamp: Date.now() };
}
