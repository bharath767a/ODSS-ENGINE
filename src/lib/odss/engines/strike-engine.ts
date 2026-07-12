/**
 * ODSS - Strike Selection Engine (Phase 9)
 * Selects ATM / ITM / OTM based on Liquidity, Expected move, Risk, Conviction.
 * Returns: Primary Strike, Alternative Strike, Aggressive Strike.
 */
import type { StrikeSelection, Direction, OptionChainEngineOutput, TechnicalEngineOutput } from '../types';
import { getOptionChain } from '../simulator/market-simulator';
import { getSymbolMeta, roundToStrike } from '../universe';

export function runStrikeEngine(
  symbol: string,
  direction: Direction,
  technical: TechnicalEngineOutput,
  oc: OptionChainEngineOutput,
  conviction: number // 0..100
): StrikeSelection {
  const meta = getSymbolMeta(symbol);
  const chain = getOptionChain(symbol);
  if (!meta || !chain) {
    return {
      primaryStrike: 0,
      altStrike: 0,
      aggressiveStrike: 0,
      strikeType: 'ATM',
      expiry: '',
      primaryLTP: 0,
      primaryDelta: 0,
      primaryIV: 0,
      liquidityNote: 'No data',
      facts: [],
    };
  }

  const spot = chain.spot;
  const step = meta.strikeStep;
  const atm = chain.atmStrike;

  // Strike selection logic
  // - Low conviction -> ITM (safer delta)
  // - Medium conviction -> ATM (balanced)
  // - High conviction -> OTM (cheaper, more leverage)
  let primaryOffset: number;
  let strikeType: StrikeSelection['strikeType'];
  if (conviction < 45) {
    primaryOffset = direction === 'CE' ? -step : step; // ITM
    strikeType = 'ITM';
  } else if (conviction < 70) {
    primaryOffset = 0;
    strikeType = 'ATM';
  } else {
    primaryOffset = direction === 'CE' ? step : -step; // OTM
    strikeType = 'OTM';
  }

  const primaryStrike = atm + primaryOffset;
  const altStrike = atm; // ATM as alternative
  const aggressiveStrike = atm + (direction === 'CE' ? 2 * step : -2 * step);

  // Find row in chain for primary strike
  const row = chain.strikes.find((r) => r.strike === primaryStrike && r.type === direction);
  const primaryLTP = row?.ltp ?? 0;
  const primaryDelta = Math.abs(row?.delta ?? 0.5);
  const primaryIV = row?.iv ?? oc.atmIV;

  const liquidityNote =
    row && row.oi > 1_000_000
      ? 'High liquidity'
      : row && row.oi > 250_000
      ? 'Adequate liquidity'
      : 'Low liquidity — widen spread';

  const facts: string[] = [
    `Spot ${spot.toFixed(2)} | ATM ${atm}`,
    `Conviction ${conviction.toFixed(0)} -> ${strikeType}`,
    `Primary ${primaryStrike} (LTP ${primaryLTP}, Δ ${primaryDelta.toFixed(2)}, IV ${primaryIV.toFixed(1)}%)`,
    `Alternative ${altStrike} (ATM)`,
    `Aggressive ${aggressiveStrike} (OTM)`,
    liquidityNote,
    `Expected move ±${oc.expectedMove.toFixed(2)}`,
  ];

  return {
    primaryStrike,
    altStrike,
    aggressiveStrike,
    strikeType,
    expiry: chain.expiry,
    primaryLTP,
    primaryDelta,
    primaryIV,
    liquidityNote,
    facts,
  };
}
