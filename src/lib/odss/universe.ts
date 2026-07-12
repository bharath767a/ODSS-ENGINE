/**
 * ODSS - Indian Market Universe
 * Symbols, sectors, lot sizes, strike steps for the Indian options market.
 */

export interface SymbolMeta {
  symbol: string;
  name: string;
  sector: string;
  type: 'INDEX' | 'STOCK';
  strikeStep: number; // strike interval
  lotSize: number;
  basePrice: number; // approximate reference price for simulator
  beta: number; // relative volatility vs NIFTY
}

// Index options
export const INDICES: SymbolMeta[] = [
  { symbol: 'NIFTY', name: 'Nifty 50', sector: 'INDEX', type: 'INDEX', strikeStep: 50, lotSize: 75, basePrice: 24800, beta: 1.0 },
  { symbol: 'BANKNIFTY', name: 'Nifty Bank', sector: 'INDEX', type: 'INDEX', strikeStep: 100, lotSize: 35, basePrice: 54200, beta: 1.25 },
  { symbol: 'FINNIFTY', name: 'Nifty Financial Services', sector: 'INDEX', type: 'INDEX', strikeStep: 50, lotSize: 65, basePrice: 25300, beta: 1.1 },
  { symbol: 'MIDCPNIFTY', name: 'Nifty Midcap Select', sector: 'INDEX', type: 'INDEX', strikeStep: 25, lotSize: 140, basePrice: 12800, beta: 1.15 },
];

// Sector stocks - curated liquid F&O universe
export const STOCKS: SymbolMeta[] = [
  // BANKING
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 550, basePrice: 1680, beta: 1.0 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 700, basePrice: 1280, beta: 1.1 },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'BANKING', type: 'STOCK', strikeStep: 5, lotSize: 1500, basePrice: 845, beta: 1.2 },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 625, basePrice: 1180, beta: 1.2 },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 1760, beta: 0.95 },

  // IT
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 175, basePrice: 4100, beta: 0.8 },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 1850, beta: 0.9 },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', type: 'STOCK', strikeStep: 5, lotSize: 1500, basePrice: 565, beta: 0.95 },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', type: 'STOCK', strikeStep: 10, lotSize: 700, basePrice: 1820, beta: 0.9 },

  // AUTO
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'ENERGY', type: 'STOCK', strikeStep: 20, lotSize: 250, basePrice: 2950, beta: 1.1 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'AUTO', type: 'STOCK', strikeStep: 100, lotSize: 50, basePrice: 12500, beta: 0.85 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'AUTO', type: 'STOCK', strikeStep: 5, lotSize: 1425, basePrice: 985, beta: 1.3 },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', sector: 'AUTO', type: 'STOCK', strikeStep: 10, lotSize: 700, basePrice: 2950, beta: 1.15 },

  // PHARMA
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'PHARMA', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 1810, beta: 0.85 },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'PHARMA', type: 'STOCK', strikeStep: 10, lotSize: 1050, basePrice: 1560, beta: 0.85 },
  { symbol: 'DRREDDY', name: 'Dr. Reddys Labs', sector: 'PHARMA', type: 'STOCK', strikeStep: 20, lotSize: 250, basePrice: 6420, beta: 0.9 },

  // FMCG
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', type: 'STOCK', strikeStep: 20, lotSize: 300, basePrice: 2480, beta: 0.7 },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG', type: 'STOCK', strikeStep: 10, lotSize: 1600, basePrice: 478, beta: 0.75 },
  { symbol: 'NESTLEIND', name: 'Nestle India', sector: 'FMCG', type: 'STOCK', strikeStep: 50, lotSize: 250, basePrice: 2520, beta: 0.65 },

  // METAL
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'METAL', type: 'STOCK', strikeStep: 5, lotSize: 2850, basePrice: 152, beta: 1.4 },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'METAL', type: 'STOCK', strikeStep: 10, lotSize: 680, basePrice: 925, beta: 1.3 },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'METAL', type: 'STOCK', strikeStep: 10, lotSize: 1075, basePrice: 685, beta: 1.35 },

  // ENERGY
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3850, basePrice: 275, beta: 1.1 },
  { symbol: 'NTPC', name: 'NTPC', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 2925, basePrice: 360, beta: 1.0 },

  // FINANCIAL
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 50, lotSize: 125, basePrice: 7200, beta: 1.25 },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 20, lotSize: 175, basePrice: 1820, beta: 1.15 },
];

export const ALL_SYMBOLS: SymbolMeta[] = [...INDICES, ...STOCKS];

export const SECTORS = Array.from(new Set(STOCKS.map((s) => s.sector)));

export function getSymbolMeta(symbol: string): SymbolMeta | undefined {
  return ALL_SYMBOLS.find((s) => s.symbol === symbol);
}

export function getSymbolsBySector(sector: string): SymbolMeta[] {
  return STOCKS.filter((s) => s.sector === sector);
}

// Nearest valid strike rounded to step
export function roundToStrike(price: number, step: number): number {
  return Math.round(price / step) * step;
}

// Compute weekly Thursday expiry for an offset (0=this week, 1=next)
export function getThursdayExpiry(weekOffset = 0): string {
  const now = new Date();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  let daysToThursday = (4 - day + 7) % 7;
  if (daysToThursday === 0 && now.getHours() >= 15) daysToThursday = 7;
  const d = new Date(now);
  d.setDate(now.getDate() + daysToThursday + weekOffset * 7);
  return d.toISOString().slice(0, 10);
}
