/**
 * ODSS - Fundamental Analysis Types
 *
 * Defines the data structures for fundamental stock analysis:
 * - Company profile + financial metrics
 * - Quarterly results
 * - Corporate actions
 * - Fundamental score (0-100)
 * - Buy/Sell/Hold recommendation
 * - Mutual fund data
 */

// ============================================================
// COMPANY PROFILE
// ============================================================
export interface CompanyProfile {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCap: number;          // in crores
  description: string;
  website: string;
  founded: number;
  listedOn: 'NSE' | 'BSE' | 'BOTH';
  isin: string;
}

// ============================================================
// VALUATION METRICS
// ============================================================
export interface ValuationMetrics {
  peRatio: number;            // Price-to-Earnings
  forwardPE: number;          // Forward P/E (based on projected EPS)
  pbRatio: number;            // Price-to-Book
  psRatio: number;            // Price-to-Sales
  evEbitda: number;           // Enterprise Value / EBITDA
  dividendYield: number;      // %
  pegRatio: number;           // P/E to Growth ratio
  sectorPE: number;           // Average P/E of the sector
  premiumDiscount: number;    // % premium/discount vs sector P/E
}

// ============================================================
// EARNINGS & PROFITABILITY
// ============================================================
export interface EarningsData {
  eps: number;                // Earnings Per Share (TTM)
  forwardEPS: number;         // Projected EPS (next year)
  epsGrowthYoY: number;       // %
  epsGrowth3Y: number;        // 3-year CAGR %
  revenue: number;            // in crores (TTM)
  revenueGrowthYoY: number;   // %
  netProfit: number;          // in crores (TTM)
  netProfitGrowthYoY: number; // %
  operatingMargin: number;    // %
  netProfitMargin: number;    // %
  roe: number;                // Return on Equity %
  roce: number;               // Return on Capital Employed %
  roa: number;                // Return on Assets %
}

// ============================================================
// FINANCIAL HEALTH
// ============================================================
export interface FinancialHealth {
  debtToEquity: number;       // Total Debt / Equity
  currentRatio: number;       // Current Assets / Current Liabilities
  quickRatio: number;         // (Current Assets - Inventory) / Current Liabilities
  interestCoverage: number;   // EBIT / Interest Expense
  totalDebt: number;          // in crores
  cashAndEquivalents: number; // in crores
  freeCashFlow: number;       // in crores (TTM)
  debtToEbitda: number;       // Total Debt / EBITDA
}

// ============================================================
// QUARTERLY RESULTS (last 4 quarters)
// ============================================================
export interface QuarterlyResult {
  quarter: string;            // e.g., "Q4 FY25"
  revenue: number;            // crores
  netProfit: number;          // crores
  eps: number;
  revenueGrowthQoQ: number;   // %
  profitGrowthQoQ: number;    // %
  margin: number;             // %
  surprise: 'BEAT' | 'MISS' | 'IN_LINE'; // vs analyst estimates
  surprisePct: number;        // % beat/miss
}

// ============================================================
// OWNERSHIP & QUALITY
// ============================================================
export interface OwnershipData {
  promoterHolding: number;    // %
  promoterHoldingChange: number; // change in last quarter (pp)
  fiiHolding: number;         // %
  fiiHoldingChange: number;
  diiHolding: number;         // %
  diiHoldingChange: number;
  publicHolding: number;      // %
  institutionalHolding: number; // %
}

// ============================================================
// CORPORATE ACTIONS
// ============================================================
export interface CorporateAction {
  date: string;
  type: 'DIVIDEND' | 'BONUS' | 'SPLIT' | 'BUYBACK' | 'RIGHTS' | 'AGM' | 'RESULT';
  description: string;
  value?: string;
}

// ============================================================
// FUTURE OUTLOOK
// ============================================================
export interface FutureOutlook {
  businessPlans: string[];    // Key growth initiatives
  capexPlans: string;         // Capital expenditure plans
  risks: string[];            // Key risk factors
  catalysts: string[];        // Potential stock catalysts
  managementGuidance: string; // What management has said
  analystConsensus: 'BUY' | 'HOLD' | 'SELL';
  analystTargetPrice: number;
  analystCount: number;
}

// ============================================================
// COMPLETE FUNDAMENTAL DATA
// ============================================================
export interface FundamentalData {
  profile: CompanyProfile;
  valuation: ValuationMetrics;
  earnings: EarningsData;
  health: FinancialHealth;
  quarterly: QuarterlyResult[];
  ownership: OwnershipData;
  corporateActions: CorporateAction[];
  outlook: FutureOutlook;
  lastUpdated: number;
}

// ============================================================
// FUNDAMENTAL SCORE (0-100)
// ============================================================
export interface FundamentalScore {
  total: number;              // 0-100
  valuation: number;          // 0-100
  growth: number;             // 0-100
  profitability: number;      // 0-100
  financialHealth: number;    // 0-100
  quality: number;            // 0-100 (ownership, consistency)
  rating: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'BELOW_AVERAGE' | 'POOR';
  summary: string;            // plain-English summary
  strengths: string[];
  weaknesses: string[];
}

// ============================================================
// BUY/SELL/HOLD RECOMMENDATION
// ============================================================
export interface BuySellHoldRecommendation {
  action: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;         // 0-100
  reasoning: string;
  fairValue: number;          // estimated fair value
  currentPrice: number;
  upsideDownside: number;     // % upside/downside
  timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  keyMetrics: {
    label: string;
    value: string;
    signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  }[];
}

// ============================================================
// MUTUAL FUND DATA
// ============================================================
export interface MutualFund {
  name: string;
  category: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP' | 'FLEXI_CAP' | 'ELSS' | 'INDEX' | 'DEBT' | 'HYBRID';
  amc: string;                // Asset Management Company
  aum: number;                // Assets Under Management (crores)
  expenseRatio: number;       // %
  returns1Y: number;          // %
  returns3Y: number;          // %
  returns5Y: number;          // %
  returnsSinceInception: number; // %
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  beta: number;
  minInvestment: number;      // SIP minimum (₹)
  rating: number;             // 1-5 stars
  topHoldings: { symbol: string; weight: number }[];
  benchmark: string;
  benchmarkReturns1Y: number;
  fundManager: string;
  inceptionDate: string;
  exitLoad: string;
  analysis: string;           // plain-English analysis
}

export interface MutualFundAnalysis {
  funds: MutualFund[];
  bestOverall: string;
  bestReturns: string;
  lowestRisk: string;
  bestSIP: string;
  categorySummary: Record<string, { count: number; avgReturns: number; avgExpense: number }>;
}

// ============================================================
// AI STOCK STORY
// ============================================================
export interface StockStory {
  symbol: string;
  name: string;
  narrative: string;          // The full story (3-4 paragraphs)
  oneLiner: string;           // 1-sentence summary
  forBeginners: string;       // simplified explanation
  keyTakeaways: string[];
  shouldYouInvest: string;    // plain-English answer
  redFlags: string[];
  greenFlags: string[];
  timestamp: number;
}
