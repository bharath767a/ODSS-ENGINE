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

// Sector stocks - comprehensive NSE F&O universe (89 symbols)
export const STOCKS: SymbolMeta[] = [
  // BANKING
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 550, basePrice: 1680, beta: 1.0 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 700, basePrice: 1280, beta: 1.1 },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'BANKING', type: 'STOCK', strikeStep: 5, lotSize: 1500, basePrice: 845, beta: 1.2 },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 625, basePrice: 1180, beta: 1.2 },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 1760, beta: 0.95 },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 1450, beta: 1.15 },
  { symbol: 'PNB', name: 'Punjab National Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 5, lotSize: 2750, basePrice: 105, beta: 1.3 },
  { symbol: 'BANKBARODA', name: 'Bank of Baroda', sector: 'BANKING', type: 'STOCK', strikeStep: 5, lotSize: 2250, basePrice: 240, beta: 1.25 },
  { symbol: 'FEDERALBNK', name: 'Federal Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 5, lotSize: 2200, basePrice: 155, beta: 1.1 },
  { symbol: 'IDFCFIRSTB', name: 'IDFC First Bank', sector: 'BANKING', type: 'STOCK', strikeStep: 5, lotSize: 3500, basePrice: 70, beta: 1.2 },

  // IT
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 175, basePrice: 4100, beta: 0.8 },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 1850, beta: 0.9 },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', type: 'STOCK', strikeStep: 5, lotSize: 1500, basePrice: 565, beta: 0.95 },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', type: 'STOCK', strikeStep: 10, lotSize: 700, basePrice: 1820, beta: 0.9 },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 550, basePrice: 1650, beta: 0.95 },
  { symbol: 'LTIM', name: 'LTIMindtree', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 300, basePrice: 5800, beta: 0.9 },
  { symbol: 'PERSISTENT', name: 'Persistent Systems', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 250, basePrice: 5400, beta: 0.85 },
  { symbol: 'COFORGE', name: 'Coforge', sector: 'IT', type: 'STOCK', strikeStep: 20, lotSize: 250, basePrice: 6800, beta: 0.85 },

  // AUTO
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'AUTO', type: 'STOCK', strikeStep: 100, lotSize: 50, basePrice: 12500, beta: 0.85 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'AUTO', type: 'STOCK', strikeStep: 5, lotSize: 1425, basePrice: 985, beta: 1.3 },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', sector: 'AUTO', type: 'STOCK', strikeStep: 10, lotSize: 700, basePrice: 2950, beta: 1.15 },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', sector: 'AUTO', type: 'STOCK', strikeStep: 50, lotSize: 200, basePrice: 9000, beta: 0.9 },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'AUTO', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 4800, beta: 0.9 },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'AUTO', type: 'STOCK', strikeStep: 20, lotSize: 500, basePrice: 4500, beta: 0.85 },
  { symbol: 'TVSMOTOR', name: 'TVS Motor Company', sector: 'AUTO', type: 'STOCK', strikeStep: 10, lotSize: 800, basePrice: 2200, beta: 0.9 },
  { symbol: 'ASHOKLEY', name: 'Ashok Leyland', sector: 'AUTO', type: 'STOCK', strikeStep: 5, lotSize: 1700, basePrice: 220, beta: 1.1 },

  // PHARMA
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'PHARMA', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 1810, beta: 0.85 },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'PHARMA', type: 'STOCK', strikeStep: 10, lotSize: 1050, basePrice: 1560, beta: 0.85 },
  { symbol: 'DRREDDY', name: 'Dr. Reddys Labs', sector: 'PHARMA', type: 'STOCK', strikeStep: 20, lotSize: 250, basePrice: 6420, beta: 0.9 },
  { symbol: 'DIVISLAB', name: 'Divis Laboratories', sector: 'PHARMA', type: 'STOCK', strikeStep: 20, lotSize: 200, basePrice: 5800, beta: 0.8 },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', sector: 'PHARMA', type: 'STOCK', strikeStep: 20, lotSize: 300, basePrice: 6500, beta: 0.85 },
  { symbol: 'AUROPHARMA', name: 'Aurobindo Pharma', sector: 'PHARMA', type: 'STOCK', strikeStep: 10, lotSize: 1100, basePrice: 1250, beta: 1.0 },
  { symbol: 'LUPIN', name: 'Lupin', sector: 'PHARMA', type: 'STOCK', strikeStep: 20, lotSize: 500, basePrice: 1800, beta: 0.9 },
  { symbol: 'BIOCON', name: 'Biocon', sector: 'PHARMA', type: 'STOCK', strikeStep: 10, lotSize: 1300, basePrice: 330, beta: 0.95 },

  // FMCG
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', type: 'STOCK', strikeStep: 20, lotSize: 300, basePrice: 2480, beta: 0.7 },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG', type: 'STOCK', strikeStep: 10, lotSize: 1600, basePrice: 478, beta: 0.75 },
  { symbol: 'NESTLEIND', name: 'Nestle India', sector: 'FMCG', type: 'STOCK', strikeStep: 50, lotSize: 250, basePrice: 2520, beta: 0.65 },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG', type: 'STOCK', strikeStep: 20, lotSize: 300, basePrice: 5200, beta: 0.7 },
  { symbol: 'DABUR', name: 'Dabur India', sector: 'FMCG', type: 'STOCK', strikeStep: 10, lotSize: 1300, basePrice: 540, beta: 0.75 },
  { symbol: 'MARICO', name: 'Marico', sector: 'FMCG', type: 'STOCK', strikeStep: 10, lotSize: 1300, basePrice: 620, beta: 0.7 },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products', sector: 'FMCG', type: 'STOCK', strikeStep: 20, lotSize: 700, basePrice: 1150, beta: 0.75 },
  { symbol: 'GODREJCP', name: 'Godrej Consumer Products', sector: 'FMCG', type: 'STOCK', strikeStep: 10, lotSize: 700, basePrice: 1250, beta: 0.75 },
  { symbol: 'COLPAL', name: 'Colgate Palmolive', sector: 'FMCG', type: 'STOCK', strikeStep: 20, lotSize: 600, basePrice: 2900, beta: 0.65 },
  { symbol: 'VARUNBEV', name: 'Varun Beverages', sector: 'FMCG', type: 'STOCK', strikeStep: 10, lotSize: 800, basePrice: 650, beta: 0.8 },

  // METAL
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'METAL', type: 'STOCK', strikeStep: 5, lotSize: 2850, basePrice: 152, beta: 1.4 },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'METAL', type: 'STOCK', strikeStep: 10, lotSize: 680, basePrice: 925, beta: 1.3 },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'METAL', type: 'STOCK', strikeStep: 10, lotSize: 1075, basePrice: 685, beta: 1.35 },
  { symbol: 'JINDALSTEL', name: 'Jindal Steel & Power', sector: 'METAL', type: 'STOCK', strikeStep: 10, lotSize: 900, basePrice: 920, beta: 1.3 },
  { symbol: 'VEDL', name: 'Vedanta', sector: 'METAL', type: 'STOCK', strikeStep: 10, lotSize: 1300, basePrice: 450, beta: 1.4 },
  { symbol: 'SAIL', name: 'Steel Authority of India', sector: 'METAL', type: 'STOCK', strikeStep: 5, lotSize: 3500, basePrice: 140, beta: 1.4 },
  { symbol: 'NMDC', name: 'NMDC', sector: 'METAL', type: 'STOCK', strikeStep: 5, lotSize: 3300, basePrice: 230, beta: 1.3 },
  { symbol: 'NATIONALUM', name: 'National Aluminium', sector: 'METAL', type: 'STOCK', strikeStep: 5, lotSize: 4500, basePrice: 190, beta: 1.3 },

  // ENERGY
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'ENERGY', type: 'STOCK', strikeStep: 20, lotSize: 250, basePrice: 2950, beta: 1.1 },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3850, basePrice: 275, beta: 1.1 },
  { symbol: 'NTPC', name: 'NTPC', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 2925, basePrice: 360, beta: 1.0 },
  { symbol: 'POWERGRID', name: 'Power Grid Corp', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3500, basePrice: 320, beta: 0.85 },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3600, basePrice: 410, beta: 0.95 },
  { symbol: 'BPCL', name: 'Bharat Petroleum', sector: 'ENERGY', type: 'STOCK', strikeStep: 10, lotSize: 1200, basePrice: 650, beta: 1.1 },
  { symbol: 'IOC', name: 'Indian Oil Corp', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3300, basePrice: 165, beta: 1.0 },
  { symbol: 'GAIL', name: 'GAIL India', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3000, basePrice: 200, beta: 0.95 },
  { symbol: 'TATAPOWER', name: 'Tata Power', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3000, basePrice: 430, beta: 1.05 },
  { symbol: 'ADANIGREEN', name: 'Adani Green Energy', sector: 'ENERGY', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 1800, beta: 1.2 },
  { symbol: 'ADANIPOWER', name: 'Adani Power', sector: 'ENERGY', type: 'STOCK', strikeStep: 10, lotSize: 900, basePrice: 650, beta: 1.25 },

  // FINANCIAL
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 50, lotSize: 125, basePrice: 7200, beta: 1.25 },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 20, lotSize: 175, basePrice: 1820, beta: 1.15 },
  { symbol: 'JIOFIN', name: 'Jio Financial Services', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 5, lotSize: 3500, basePrice: 350, beta: 1.1 },
  { symbol: 'CHOLAFIN', name: 'Cholamandalam Investment', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 10, lotSize: 900, basePrice: 1450, beta: 1.1 },
  { symbol: 'PFC', name: 'Power Finance Corp', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 5, lotSize: 3500, basePrice: 450, beta: 1.0 },
  { symbol: 'RECLTD', name: 'REC Limited', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 5, lotSize: 3500, basePrice: 520, beta: 1.0 },
  { symbol: 'MUTHOOTFIN', name: 'Muthoot Finance', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 1900, beta: 0.95 },
  { symbol: 'SHRIRAMFIN', name: 'Shriram Finance', sector: 'FINANCIAL', type: 'STOCK', strikeStep: 10, lotSize: 900, basePrice: 2500, beta: 1.1 },

  // TELECOM
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'TELECOM', type: 'STOCK', strikeStep: 20, lotSize: 475, basePrice: 1600, beta: 0.9 },
  { symbol: 'IDEA', name: 'Vodafone Idea', sector: 'TELECOM', type: 'STOCK', strikeStep: 5, lotSize: 5000, basePrice: 15, beta: 1.5 },

  // INFRA / CONSTRUCTION
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'INFRA', type: 'STOCK', strikeStep: 50, lotSize: 150, basePrice: 3600, beta: 1.0 },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'INFRA', type: 'STOCK', strikeStep: 100, lotSize: 50, basePrice: 11500, beta: 0.9 },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'INFRA', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 2600, beta: 0.95 },
  { symbol: 'SHREECEM', name: 'Shree Cement', sector: 'INFRA', type: 'STOCK', strikeStep: 100, lotSize: 50, basePrice: 26000, beta: 0.85 },
  { symbol: 'AMBUJACEM', name: 'Ambuja Cements', sector: 'INFRA', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 600, beta: 0.9 },
  { symbol: 'ACC', name: 'ACC Cement', sector: 'INFRA', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 2300, beta: 0.9 },
  { symbol: 'DLF', name: 'DLF', sector: 'INFRA', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 850, beta: 1.0 },
  { symbol: 'GODREJPROP', name: 'Godrej Properties', sector: 'INFRA', type: 'STOCK', strikeStep: 20, lotSize: 300, basePrice: 3100, beta: 1.0 },
  { symbol: 'IOC', name: 'Indian Oil Corp', sector: 'ENERGY', type: 'STOCK', strikeStep: 5, lotSize: 3300, basePrice: 165, beta: 1.0 },

  // CONSUMER / RETAIL
  { symbol: 'TITAN', name: 'Titan Company', sector: 'CONSUMER', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 3400, beta: 0.85 },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'CONSUMER', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 2900, beta: 0.8 },
  { symbol: 'PIDILITIND', name: 'Pidilite Industries', sector: 'CONSUMER', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 2900, beta: 0.8 },

  // MEDIA
  { symbol: 'PVRINOX', name: 'PVR INOX', sector: 'MEDIA', type: 'STOCK', strikeStep: 20, lotSize: 500, basePrice: 1600, beta: 1.1 },
  { symbol: 'SUNTV', name: 'Sun TV Network', sector: 'MEDIA', type: 'STOCK', strikeStep: 20, lotSize: 400, basePrice: 620, beta: 0.85 },

  // CHEMICAL
  { symbol: 'PIIND', name: 'PI Industries', sector: 'CHEMICAL', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 3900, beta: 0.85 },
  { symbol: 'UPL', name: 'UPL Limited', sector: 'CHEMICAL', type: 'STOCK', strikeStep: 10, lotSize: 900, basePrice: 550, beta: 1.0 },
  { symbol: 'SRF', name: 'SRF Limited', sector: 'CHEMICAL', type: 'STOCK', strikeStep: 20, lotSize: 350, basePrice: 2600, beta: 0.9 },
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
