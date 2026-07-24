/**
 * ODSS - Shared Data Models
 * Phase 1: Every module communicates only through these shared types.
 * No module should depend on another module's internal logic.
 */

// ============================================================
// CORE DIRECTION / SIDE
// ============================================================
export type Direction = 'CE' | 'PE'; // Call or Put buying
export type Bias = 'LONG' | 'SHORT' | 'NEUTRAL';
export type Trend = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type Structure =
  | 'UPTREND'
  | 'DOWNTREND'
  | 'RANGE'
  | 'BREAKOUT'
  | 'BREAKDOWN'
  | 'REVERSAL';
export type Volatility = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
export type DayType = 'TREND' | 'REVERSAL' | 'RANGE' | 'GAP_UP' | 'GAP_DOWN';
export type MarketState =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGING'
  | 'SELLING_OFF'
  | 'RECOVERING'
  | 'CHOPPY'
  | 'FLAT';

export type Moneyness = 'ITM' | 'ATM' | 'OTM';
export type OptionType = 'CE' | 'PE';
export type EntryType =
  | 'MARKET'
  | 'BREAKOUT'
  | 'RETEST'
  | 'VWAP'
  | 'LIQUIDITY_SWEEP';
export type Decision = 'ENTER' | 'WAIT' | 'WATCH' | 'AVOID';

// ============================================================
// PHASE 15 - STATE MACHINE
// ============================================================
export type TradeStateName =
  | 'WATCHLIST'
  | 'READY'
  | 'WAITING_ENTRY'
  | 'ENTERED'
  | 'TP1'
  | 'TP2'
  | 'TRAILING'
  | 'WEAKENING'
  | 'EXIT'
  | 'COMPLETE';

// ============================================================
// PHASE 2 - DATA LAYER
// ============================================================
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  sector?: string;
  ltp: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  vwap: number;
  changePct: number;
  candles: Candle[];
  iv?: number;
  pcr?: number;
  timestamp: number;
}

export interface OptionRow {
  strike: number;
  type: OptionType;
  ltp: number;
  bid: number;
  ask: number;
  iv: number;
  volume: number;
  oi: number;
  oiChange: number;      // intraday change in OI (vs previous day close)
  ltpChange?: number;    // intraday option price change (vs previous day close)
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  moneyness: Moneyness;
}

// ============================================================
// OPTIONS "WHO IS IN CONTROL" — order-flow analysis
// ============================================================
export type Controller = 'BUYERS' | 'SELLERS' | 'BALANCED';
export type StrikeFlow = 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'SHORT_COVERING' | 'LONG_UNWINDING' | 'FLAT';

export interface ControlResult {
  controller: Controller;      // who is in control right now
  controlScore: number;        // -100 (sellers/bearish) .. +100 (buyers/bullish)
  strength: number;            // 0-100 conviction of the read (|controlScore|-ish)
  bias: Bias;                  // LONG / SHORT / NEUTRAL (directional read)
  evidence: string[];          // plain-English reasons, strongest first
  trap: boolean;               // option chain contradicts the price move (trap risk)
  trapNote?: string;
  supportStrike: number;       // highest put-OI wall below spot
  resistanceStrike: number;    // highest call-OI wall above spot
  maxPain: number;
  pcr: number;
  ivSkew: number;              // put IV - call IV (fear gauge)
  pinStrike: number;           // gamma/OI pin (magnet) strike
  gammaRegime: 'PINNED' | 'TRENDING' | 'NEUTRAL';
  flowIntensity: number;       // 0-100 how FRESH/aggressive near-money positioning is
  earlyFlow: boolean;          // strong + fresh directional flow → early-mover ignition
  dataQuality: number;         // 0-100 how much real flow the read is standing on
  readable: boolean;           // false = too little fresh OI to call a controller yet
  timestamp: number;
}

export interface OptionChain {
  symbol: string;
  expiry: string;
  spot: number;
  atmStrike: number;
  strikes: OptionRow[];
  pcr: number;
  maxPainStrike: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallOIChange: number;
  totalPutOIChange: number;
  timestamp: number;
}

export interface MarketBreadth {
  advanceCount: number;
  declineCount: number;
  advanceDeclineRatio: number;
  timestamp: number;
}

// ============================================================
// PHASE 3 - MARKET ENGINE OUTPUT
// ============================================================
export interface MarketEngineOutput {
  trend: Trend;
  structure: Structure;
  momentum: number;
  volatility: Volatility;
  indiaVix: number;
  marketScore: number;
  marketConfidence: number;
  marketState: MarketState;
  dayType: DayType;
  bias: Bias;
  openingRange: { high: number; low: number; status: 'FORMING' | 'SET' };
  vwap: number;
  breadth: MarketBreadth;
  facts: string[];
  timestamp: number;
}

// ============================================================
// PHASE 4 - SECTOR ENGINE OUTPUT
// ============================================================
export interface SectorScore {
  sector: string;
  rank: number;
  strength: number;
  momentum: number;
  leadership: 'LEADING' | 'LAGGING' | 'MIXED';
  changePct: number;
  score: number;
  facts: string[];
}

export interface SectorEngineOutput {
  sectors: SectorScore[];
  timestamp: number;
}

// ============================================================
// PHASE 5 - RELATIVE STRENGTH OUTPUT
// ============================================================
export interface RSRow {
  symbol: string;
  sector: string;
  rsScore: number;
  rank: number;
  leadership: 'STRONG' | 'WEAK' | 'NEUTRAL';
  changePct: number;
  vsSector: number;
  score: number;
  facts: string[];
}

export interface RSEngineOutput {
  rows: RSRow[];
  timestamp: number;
}

// ============================================================
// PHASE 6 - TECHNICAL ENGINE OUTPUT
// ============================================================
export interface TechnicalEngineOutput {
  symbol: string;
  trend: Trend;
  emaAlignment: 'BULLISH' | 'BEARISH' | 'MIXED';
  vwap: number;
  vwapPosition: 'ABOVE' | 'BELOW' | 'AT';
  atr: number;
  atrPct: number;
  rsi: number;
  adx: number;
  support: number[];
  resistance: number[];
  breakout: { level: number; status: 'BREAKING_OUT' | 'BREAKING_DOWN' | 'NONE' };
  pullback: { to: number; status: 'AT_SUPPORT' | 'AT_VWAP' | 'NONE' };
  volumeStructure: 'RISING' | 'FALLING' | 'FLAT';
  liquiditySweep: { direction: 'HIGH' | 'LOW' | 'NONE'; swept: number };
  momentum: number;
  score: number;
  facts: string[];
  timestamp: number;
}

// ============================================================
// PHASE 7 - OPTION CHAIN ENGINE OUTPUT
// ============================================================
export interface OptionChainEngineOutput {
  symbol: string;
  pcr: number;
  pcrSignal: Bias;
  ivSkew: number;
  ivRank: number;
  atmIV: number;
  callWritingTrend: 'INCREASING' | 'DECREASING' | 'FLAT';
  putWritingTrend: 'INCREASING' | 'DECREASING' | 'FLAT';
  unwinding: 'CALL_UNWINDING' | 'PUT_UNWINDING' | 'NONE';
  liquidityStrike: number;
  maxPain: number;
  spread: number;
  supportStrike: number;
  resistanceStrike: number;
  expectedMove: number;
  score: number;
  bias: Bias;
  facts: string[];
  timestamp: number;
}

// ============================================================
// PHASE 8 - OPPORTUNITY ENGINE OUTPUT
// ============================================================
export interface OpportunityRow {
  symbol: string;
  sector?: string;
  direction: Direction;
  marketScore: number;
  sectorScore: number;
  rsScore: number;
  technicalScore: number;
  optionChainScore: number;
  totalScore: number;
  confidence: number;
  rank: number;
  rationale: string;
  facts: string[];
}

export interface OpportunityEngineOutput {
  rows: OpportunityRow[];
  timestamp: number;
}

// ============================================================
// PHASE 9 - STRIKE SELECTION OUTPUT
// ============================================================
export interface StrikeSelection {
  primaryStrike: number;
  altStrike: number;
  aggressiveStrike: number;
  strikeType: 'ATM' | 'ITM' | 'OTM';
  expiry: string;
  primaryLTP: number;
  primaryDelta: number;
  primaryIV: number;
  liquidityNote: string;
  facts: string[];
}

// ============================================================
// PHASE 10 - ENTRY ENGINE OUTPUT
// ============================================================
export interface EntryPlan {
  entryType: EntryType;
  entryPrice: number;
  entryTrigger: string;
  stopLoss: number;
  reason: string;
  facts: string[];
}

// ============================================================
// PHASE 11 - RISK ENGINE OUTPUT
// ============================================================
export interface RiskPlan {
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rr: number;
  positionSize: number;
  maxLoss: number;
  maxProfit: number;
  riskPerShare: number;
  facts: string[];
}

// ============================================================
// PHASE 12 - TRADE MANAGEMENT OUTPUT
// ============================================================
export type TradeAction =
  | 'HOLD'
  | 'TRAIL_SL'
  | 'MOVE_TO_BREAKEVEN'
  | 'PARTIAL_EXIT_TP1'
  | 'PARTIAL_EXIT_TP2'
  | 'FULL_EXIT'
  | 'REENTRY'
  | 'WATCH';

export interface TradeManagementOutput {
  action: TradeAction;
  newStopLoss?: number;
  newTarget?: number;
  reason: string;
  facts: string[];
}

// ============================================================
// PHASE 13 - EXIT ENGINE OUTPUT
// ============================================================
export type ExitAction = 'CONTINUE' | 'TRAIL' | 'REDUCE_POSITION' | 'EXIT';
export interface ExitEngineOutput {
  action: ExitAction;
  exitScore: number;
  reason: string;
  facts: string[];
}

// ============================================================
// PHASE 14 - DECISION ENGINE OUTPUT
// ============================================================
export interface EngineVote {
  engine: string;
  vote: 'ENTER' | 'WAIT' | 'WATCH' | 'AVOID';
  weight: number;
  score: number;
  confidence: number;
  reason: string;
}

export interface DecisionEngineOutput {
  decision: Decision;
  confidence: number;
  reasoning: string;
  votes: EngineVote[];
  timestamp: number;
}

// ============================================================
// PHASE 16 - AI EXPLANATION OUTPUT
// ============================================================
export interface AIExplanation {
  summary: string;
  whySelected?: string[];
  whyRejected?: string[];
  whyHolding?: string[];
  whyExiting?: string[];
  riskNotes?: string;
  coachingTip?: string;
  timestamp: number;
}

// ============================================================
// COMPOSITE RECOMMENDATION
// ============================================================
export interface Recommendation {
  symbol: string;
  sector?: string;
  direction: Direction;
  market: MarketEngineOutput;
  sectorScore?: SectorScore;
  rs?: RSRow;
  technical: TechnicalEngineOutput;
  optionChain: OptionChainEngineOutput;
  control?: ControlResult;
  opportunity: OpportunityRow;
  strike: StrikeSelection;
  entry: EntryPlan;
  risk: RiskPlan;
  decision: DecisionEngineOutput;
  ai?: AIExplanation;
  timestamp: number;
}

// ============================================================
// LIVE TRADE OBJECT
// ============================================================
export interface LiveTrade {
  symbol: string;
  direction: Direction;
  state: TradeStateName;
  entryType?: EntryType;
  entryStrike?: number;
  entryPrice?: number;
  underlyingEntryPrice?: number;
  entryTime?: number;
  stopLoss?: number;
  initialStopLoss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  currentPrice?: number;
  currentUnderlying?: number;
  pnl?: number;
  rMultiple?: number;
  exitPrice?: number;
  exitTime?: number;
  exitReason?: string;
  aiExplanation?: string;
  stateHistory: { state: TradeStateName; timestamp: number; reason: string }[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
