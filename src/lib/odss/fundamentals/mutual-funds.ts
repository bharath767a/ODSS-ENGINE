/**
 * ODSS - Mutual Fund Analysis Provider
 *
 * Generates realistic mutual fund data for the top 10 Indian mutual funds
 * across categories. Like the stock fundamental provider, this is synthetic
 * but realistic — real data can be connected later via AMFI/API.
 */
import type { MutualFund, MutualFundAnalysis } from './types';

const FUNDS_DATA: Omit<MutualFund, 'returns1Y' | 'returns3Y' | 'returns5Y' | 'returnsSinceInception' | 'sharpeRatio' | 'sortinoRatio' | 'alpha' | 'beta' | 'topHoldings' | 'benchmarkReturns1Y' | 'analysis'>[] = [
  {
    name: 'Parag Parikh Flexi Cap Fund',
    category: 'FLEXI_CAP',
    amc: 'PPFAS Mutual Fund',
    aum: 84500,
    expenseRatio: 0.63,
    riskLevel: 'HIGH',
    rating: 5,
    minInvestment: 1000,
    benchmark: 'NIFTY 500 TRI',
    fundManager: 'Rajeev Thakkar',
    inceptionDate: '2013-05-24',
    exitLoad: '1% if redeemed within 365 days',
  },
  {
    name: 'Mirae Asset Large Cap Fund',
    category: 'LARGE_CAP',
    amc: 'Mirae Asset Mutual Fund',
    aum: 41200,
    expenseRatio: 0.51,
    riskLevel: 'MODERATE',
    rating: 5,
    minInvestment: 5000,
    benchmark: 'NIFTY 100 TRI',
    fundManager: 'Neelesh Surana',
    inceptionDate: '2008-04-28',
    exitLoad: '1% if redeemed within 365 days',
  },
  {
    name: 'SBI Small Cap Fund',
    category: 'SMALL_CAP',
    amc: 'SBI Mutual Fund',
    aum: 28900,
    expenseRatio: 0.72,
    riskLevel: 'VERY_HIGH',
    rating: 4,
    minInvestment: 5000,
    benchmark: 'NIFTY Smallcap 250 TRI',
    fundManager: 'R. Srinivasan',
    inceptionDate: '2009-11-09',
    exitLoad: '1% if redeemed within 730 days',
  },
  {
    name: 'Axis Midcap Fund',
    category: 'MID_CAP',
    amc: 'Axis Mutual Fund',
    aum: 22400,
    expenseRatio: 0.56,
    riskLevel: 'HIGH',
    rating: 5,
    minInvestment: 5000,
    benchmark: 'NIFTY Midcap 150 TRI',
    fundManager: 'Shreyash Devalkar',
    inceptionDate: '2011-02-18',
    exitLoad: '1% if redeemed within 365 days',
  },
  {
    name: 'Kotak Emerging Equity Fund',
    category: 'MID_CAP',
    amc: 'Kotak Mahindra Mutual Fund',
    aum: 35600,
    expenseRatio: 0.58,
    riskLevel: 'HIGH',
    rating: 4,
    minInvestment: 5000,
    benchmark: 'NIFTY Midcap 150 TRI',
    fundManager: 'Atul Bhole',
    inceptionDate: '2007-03-30',
    exitLoad: '1% if redeemed within 365 days',
  },
  {
    name: 'ICICI Prudential Bluechip Fund',
    category: 'LARGE_CAP',
    amc: 'ICICI Prudential Mutual Fund',
    aum: 38900,
    expenseRatio: 0.54,
    riskLevel: 'MODERATE',
    rating: 4,
    minInvestment: 1000,
    benchmark: 'NIFTY 100 TRI',
    fundManager: 'Rajat Chandak',
    inceptionDate: '2008-05-30',
    exitLoad: '1% if redeemed within 365 days',
  },
  {
    name: 'HDFC Index Fund - NIFTY 50',
    category: 'INDEX',
    amc: 'HDFC Mutual Fund',
    aum: 15200,
    expenseRatio: 0.20,
    riskLevel: 'MODERATE',
    rating: 4,
    minInvestment: 100,
    benchmark: 'NIFTY 50 TRI',
    fundManager: 'Arun Agarwal',
    inceptionDate: '2013-07-19',
    exitLoad: '0.5% if redeemed within 90 days',
  },
  {
    name: 'Quant Small Cap Fund',
    category: 'SMALL_CAP',
    amc: 'Quant Mutual Fund',
    aum: 18700,
    expenseRatio: 0.69,
    riskLevel: 'VERY_HIGH',
    rating: 5,
    minInvestment: 5000,
    benchmark: 'NIFTY Smallcap 250 TRI',
    fundManager: 'Sandeep Tandon',
    inceptionDate: '1996-01-01',
    exitLoad: '1% if redeemed within 365 days',
  },
  {
    name: 'Canara Robeco Equity Tax Saver',
    category: 'ELSS',
    amc: 'Canara Robeco Mutual Fund',
    aum: 5800,
    expenseRatio: 0.60,
    riskLevel: 'HIGH',
    rating: 4,
    minInvestment: 5000,
    benchmark: 'NIFTY 500 TRI',
    fundManager: 'Shridatta Bhandwaldar',
    inceptionDate: '2007-03-12',
    exitLoad: 'Nil (3-year lock-in)',
  },
  {
    name: 'Nippon India ETF Nifty BeES',
    category: 'INDEX',
    amc: 'Nippon India Mutual Fund',
    aum: 16800,
    expenseRatio: 0.05,
    riskLevel: 'MODERATE',
    rating: 5,
    minInvestment: 500,
    benchmark: 'NIFTY 50',
    fundManager: 'Prathamesh Joshi',
    inceptionDate: '2008-12-30',
    exitLoad: 'Nil',
  },
];

const TOP_HOLDINGS_BY_CATEGORY: Record<string, string[]> = {
  LARGE_CAP: ['HDFCBANK', 'RELIANCE', 'INFY', 'ICICIBANK', 'TCS'],
  MID_CAP: ['AXISBANK', 'BAJFINANCE', 'TATAMOTORS', 'JSWSTEEL', 'HINDALCO'],
  SMALL_CAP: ['CIPLA', 'ONGC', 'NTPC', 'M&M', 'WIPRO'],
  FLEXI_CAP: ['HDFCBANK', 'RELIANCE', 'INFY', 'BAJFINANCE', 'HINDUNILVR'],
  ELSS: ['HDFCBANK', 'INFY', 'RELIANCE', 'TCS', 'SUNPHARMA'],
  INDEX: ['HDFCBANK', 'RELIANCE', 'INFY', 'ICICIBANK', 'TCS'],
};

const ANALYSES: Record<string, string> = {
  'Parag Parikh Flexi Cap Fund': 'A unique flexi-cap fund that invests in Indian and foreign stocks. Known for its value-investing approach and low portfolio churn. Ideal for investors seeking long-term wealth creation with a conservative approach.',
  'Mirae Asset Large Cap Fund': 'One of the most consistent large-cap funds with a track record of beating its benchmark. Low expense ratio and experienced fund management make it a core portfolio holding.',
  'SBI Small Cap Fund': 'High-conviction small-cap fund with a focus on quality small companies. High risk but potential for outsized returns. Best for investors with 7+ year horizon.',
  'Axis Midcap Fund': 'Top-tier mid-cap fund with a growth-oriented approach. Strong risk-adjusted returns and experienced management. Good for investors seeking exposure to mid-sized companies.',
  'Kotak Emerging Equity Fund': 'Well-managed mid-cap fund with a focus on emerging companies. Good track record of identifying multi-baggers. Moderate risk with high return potential.',
  'ICICI Prudential Bluechip Fund': 'Stable large-cap fund with a focus on blue-chip companies. Lower volatility than peers. Good for conservative investors seeking steady returns.',
  'HDFC Index Fund - NIFTY 50': 'Low-cost index fund tracking the NIFTY 50. Perfect for passive investors who want market returns with minimal fees. Expense ratio of just 0.20% is among the lowest.',
  'Quant Small Cap Fund': 'Aggressive small-cap fund with a quantitative approach. Has delivered exceptional returns but with high volatility. Best for risk-tolerant investors with long horizons.',
  'Canara Robeco Equity Tax Saver': 'ELSS fund with 3-year lock-in, perfect for tax saving under Section 80C. Good track record and diversified portfolio. Combines tax benefit with equity exposure.',
  'Nippon India ETF Nifty BeES': 'The original NIFTY ETF with the lowest expense ratio (0.05%). Trades like a stock. Perfect for passive investors and traders alike. Highly liquid.',
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function getMutualFundAnalysis(): MutualFundAnalysis {
  const rng = seededRandom(42);

  const funds: MutualFund[] = FUNDS_DATA.map((f) => {
    const isSmallCap = f.category === 'SMALL_CAP';
    const isIndex = f.category === 'INDEX';
    const baseReturn = isSmallCap ? 35 : isIndex ? 18 : 22;
    const rng1 = rng();
    const returns1Y = baseReturn + (rng1 - 0.4) * 25;
    const returns3Y = baseReturn * 0.85 + (rng() - 0.4) * 15;
    const returns5Y = baseReturn * 0.75 + (rng() - 0.4) * 10;
    const returnsSinceInception = baseReturn * 0.70 + (rng() - 0.3) * 8;
    const benchmarkReturns1Y = isIndex ? returns1Y : returns1Y * 0.85 + (rng() - 0.5) * 5;
    const alpha = returns1Y - benchmarkReturns1Y;
    const beta = isSmallCap ? 1.3 + rng() * 0.2 : isIndex ? 1.0 : 0.9 + rng() * 0.3;
    const sharpeRatio = 0.8 + rng() * 1.5;
    const sortinoRatio = sharpeRatio * 1.4;

    const holdings = TOP_HOLDINGS_BY_CATEGORY[f.category] ?? TOP_HOLDINGS_BY_CATEGORY.LARGE_CAP;
    const weights = holdings.map(() => 5 + rng() * 8);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const topHoldings = holdings.map((sym, i) => ({
      symbol: sym,
      weight: +((weights[i] / totalWeight) * 100).toFixed(1),
    })).sort((a, b) => b.weight - a.weight);

    return {
      ...f,
      returns1Y: +returns1Y.toFixed(1),
      returns3Y: +returns3Y.toFixed(1),
      returns5Y: +returns5Y.toFixed(1),
      returnsSinceInception: +returnsSinceInception.toFixed(1),
      sharpeRatio: +sharpeRatio.toFixed(2),
      sortinoRatio: +sortinoRatio.toFixed(2),
      alpha: +alpha.toFixed(2),
      beta: +beta.toFixed(2),
      topHoldings,
      benchmarkReturns1Y: +benchmarkReturns1Y.toFixed(1),
      analysis: ANALYSES[f.name] ?? `${f.name} is a ${f.category.replace('_', ' ').toLowerCase()} fund managed by ${f.amc}.`,
    };
  });

  // Sort by 3Y returns (best long-term performers first)
  funds.sort((a, b) => b.returns3Y - a.returns3Y);

  // Category summary
  const categorySummary: Record<string, { count: number; avgReturns: number; avgExpense: number }> = {};
  for (const f of funds) {
    if (!categorySummary[f.category]) {
      categorySummary[f.category] = { count: 0, avgReturns: 0, avgExpense: 0 };
    }
    categorySummary[f.category].count++;
    categorySummary[f.category].avgReturns += f.returns3Y;
    categorySummary[f.category].avgExpense += f.expenseRatio;
  }
  for (const cat of Object.keys(categorySummary)) {
    categorySummary[cat].avgReturns = +(categorySummary[cat].avgReturns / categorySummary[cat].count).toFixed(1);
    categorySummary[cat].avgExpense = +(categorySummary[cat].avgExpense / categorySummary[cat].count).toFixed(2);
  }

  return {
    funds,
    bestOverall: funds[0].name,
    bestReturns: funds.reduce((a, b) => a.returns1Y > b.returns1Y ? a : b).name,
    lowestRisk: funds.filter((f) => f.riskLevel === 'LOW' || f.riskLevel === 'MODERATE')
      .reduce((a, b) => a.sharpeRatio > b.sharpeRatio ? a : b).name,
    bestSIP: funds.filter((f) => f.minInvestment <= 1000)
      .reduce((a, b) => a.returns3Y > b.returns3Y ? a : b).name,
    categorySummary,
  };
}
