/**
 * ODSS - Synthetic Fundamental Data Provider
 *
 * Generates realistic fundamental data for all stocks in the ODSS universe.
 * This is like the market simulator — it provides data so the system works
 * immediately. Later, a real data provider (Screener.in, Tickertape, etc.)
 * can be connected via the same interface.
 *
 * The data is seeded deterministically per symbol so it's consistent
 * across restarts.
 */
import type {
  FundamentalData,
  CompanyProfile,
  ValuationMetrics,
  EarningsData,
  FinancialHealth,
  QuarterlyResult,
  OwnershipData,
  CorporateAction,
  FutureOutlook,
} from './types';
import { ALL_SYMBOLS, getSymbolMeta } from '../universe';

// Seeded PRNG for deterministic data
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Company profiles — realistic data for all stocks
const COMPANY_PROFILES: Record<string, Partial<CompanyProfile>> = {
  HDFCBANK: { name: 'HDFC Bank Ltd', industry: 'Private Sector Banks', description: 'India\'s largest private sector bank by assets, offering banking and financial services including retail banking, wholesale banking, and treasury operations.', website: 'www.hdfcbank.com', founded: 1994, isin: 'INE040A01034' },
  ICICIBANK: { name: 'ICICI Bank Ltd', industry: 'Private Sector Banks', description: 'Leading private sector bank in India with a network of branches and ATMs, providing a wide range of banking products and financial services.', website: 'www.icicibank.com', founded: 1994, isin: 'INE090A01021' },
  SBIN: { name: 'State Bank of India', industry: 'Public Sector Banks', description: 'Largest public sector bank in India with operations in retail banking, corporate banking, and international banking.', website: 'www.sbi.co.in', founded: 1955, isin: 'INE062A01020' },
  AXISBANK: { name: 'Axis Bank Ltd', industry: 'Private Sector Banks', description: 'Third largest private sector bank in India, offering comprehensive financial solutions to retail and corporate customers.', website: 'www.axisbank.com', founded: 1993, isin: 'INE238A01034' },
  KOTAKBANK: { name: 'Kotak Mahindra Bank Ltd', industry: 'Private Sector Banks', description: 'One of India\'s leading financial services conglomerates, offering banking, asset management, and insurance services.', website: 'www.kotak.com', founded: 1985, isin: 'INE237A01028' },
  TCS: { name: 'Tata Consultancy Services Ltd', industry: 'IT Services & Consulting', description: 'Global IT services, consulting, and business solutions organization, one of the largest IT companies in the world.', website: 'www.tcs.com', founded: 1968, isin: 'INE467A01029' },
  INFY: { name: 'Infosys Ltd', industry: 'IT Services & Consulting', description: 'Global leader in next-generation digital services and consulting, helping clients navigate digital transformation.', website: 'www.infosys.com', founded: 1981, isin: 'INE009A01021' },
  WIPRO: { name: 'Wipro Ltd', industry: 'IT Services & Consulting', description: 'Leading global information technology, consulting, and business process services company.', website: 'www.wipro.com', founded: 1945, isin: 'INE075A01022' },
  HCLTECH: { name: 'HCL Technologies Ltd', industry: 'IT Services & Consulting', description: 'Leading global technology company that helps enterprises reimagine their businesses for the digital age.', website: 'www.hcltech.com', founded: 1976, isin: 'INE860H01027' },
  RELIANCE: { name: 'Reliance Industries Ltd', industry: 'Diversified Conglomerate', description: 'India\'s largest private sector company with businesses across energy, petrochemicals, retail, telecommunications (Jio), and digital services.', website: 'www.ril.com', founded: 1966, isin: 'INE002A01018' },
  MARUTI: { name: 'Maruti Suzuki India Ltd', industry: 'Automobiles - Passenger Vehicles', description: 'Largest car manufacturer in India, a subsidiary of Suzuki Motor Corporation, dominating the Indian passenger vehicle market.', website: 'www.marutisuzuki.com', founded: 1981, isin: 'INE885D01041' },
  TATAMOTORS: { name: 'Tata Motors Ltd', industry: 'Automobiles - Commercial & Passenger', description: 'Leading global automobile manufacturer with a portfolio that includes commercial vehicles, passenger cars, and luxury vehicles (Jaguar Land Rover).', website: 'www.tatamotors.com', founded: 1945, isin: 'INE155A01022' },
  'M&M': { name: 'Mahindra & Mahindra Ltd', industry: 'Automobiles - UV & Tractors', description: 'Leading manufacturer of utility vehicles, tractors, and commercial vehicles, with global presence.', website: 'www.mahindra.com', founded: 1945, isin: 'INE101A01026' },
  SUNPHARMA: { name: 'Sun Pharmaceutical Industries Ltd', industry: 'Pharmaceuticals', description: 'Largest pharmaceutical company in India and the fourth largest specialty generic company globally.', website: 'www.sunpharma.com', founded: 1983, isin: 'INE044A01028' },
  CIPLA: { name: 'Cipla Ltd', industry: 'Pharmaceuticals', description: 'Global pharmaceutical company focused on agile and sustainable growth, with a presence in over 80 countries.', website: 'www.cipla.com', founded: 1935, isin: 'INE059G01036' },
  DRREDDY: { name: "Dr. Reddy's Laboratories Ltd", industry: 'Pharmaceuticals', description: 'Global pharmaceutical company that produces affordable and innovative medicines.', website: 'www.drreddys.com', founded: 1984, isin: 'INE089A01023' },
  HINDUNILVR: { name: 'Hindustan Unilever Ltd', industry: 'FMCG', description: 'India\'s largest FMCG company with iconic brands across home care, personal care, and foods segments.', website: 'www.hul.co.in', founded: 1933, isin: 'INE030A01027' },
  ITC: { name: 'ITC Ltd', industry: 'FMCG & Diversified', description: 'Diversified conglomerate with businesses in FMCG, hotels, paperboards, packaging, and agri-business.', website: 'www.itcportal.com', founded: 1910, isin: 'INE154A01025' },
  NESTLEIND: { name: 'Nestle India Ltd', industry: 'FMCG - Foods', description: 'Subsidiary of Nestle S.A., a leading food and beverages company in India with iconic brands like Maggi, Nescafe, and KitKat.', website: 'www.nestle.in', founded: 1912, isin: 'INE239A01017' },
  TATASTEEL: { name: 'Tata Steel Ltd', industry: 'Iron & Steel', description: 'One of the world\'s largest steel companies with operations in 26 countries and a crude steel capacity of 35 MTPA.', website: 'www.tatasteel.com', founded: 1907, isin: 'INE081A01024' },
  JSWSTEEL: { name: 'JSW Steel Ltd', industry: 'Iron & Steel', description: 'Leading integrated steel manufacturer in India with capacity of 29.7 MTPA and global footprint.', website: 'www.jsw.in', founded: 1982, isin: 'INE017Q01019' },
  HINDALCO: { name: 'Hindalco Industries Ltd', industry: 'Aluminium & Copper', description: 'World\'s largest aluminium rolling company and a major copper producer, part of the Aditya Birla Group.', website: 'www.hindalco.com', founded: 1958, isin: 'INE058A01025' },
  ONGC: { name: 'Oil & Natural Gas Corporation Ltd', industry: 'Oil Exploration & Production', description: 'India\'s largest government-owned oil and gas exploration and production company.', website: 'www.ongcindia.com', founded: 1956, isin: 'INE213A01029' },
  NTPC: { name: 'NTPC Ltd', industry: 'Power Generation', description: 'India\'s largest power utility, generating approximately 25% of India\'s electricity.', website: 'www.ntpc.co.in', founded: 1975, isin: 'INE733E01010' },
  BAJFINANCE: { name: 'Bajaj Finance Ltd', industry: 'NBFC - Consumer Finance', description: 'One of India\'s largest and most diversified NBFCs, specializing in consumer durable loans, personal loans, and SME finance.', website: 'www.bajajfinserv.in', founded: 1987, isin: 'INE296A01024' },
  BAJAJFINSV: { name: 'Bajaj Finserv Ltd', industry: 'Financial Services - Diversified', description: 'Financial services company focused on lending, insurance, and wealth management, part of the Bajaj Group.', website: 'www.bajajfinserv.in', founded: 2007, isin: 'INE918I01026' },
};

// Sector-average P/E ratios (approximate real values)
const SECTOR_PE: Record<string, number> = {
  BANKING: 18,
  IT: 25,
  AUTO: 20,
  PHARMA: 28,
  FMCG: 42,
  METAL: 12,
  ENERGY: 12,
  FINANCIAL: 22,
  INDEX: 22,
};

const FUND_MANAGERS = ['Aditya Birla Sun Life', 'HDFC', 'ICICI Prudential', 'SBI', 'Axis', 'Mirae Asset', 'Kotak', 'Nippon India', 'DSP', 'UTI'];

export class FundamentalProvider {
  private cache = new Map<string, { data: FundamentalData; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  getFundamentalData(symbol: string): FundamentalData | null {
    const meta = getSymbolMeta(symbol);
    if (!meta || meta.type !== 'STOCK') return null;

    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const rng = seededRandom(hashString(symbol));
    const data = this.generateData(symbol, meta, rng);
    this.cache.set(symbol, { data, timestamp: Date.now() });
    return data;
  }

  private generateData(symbol: string, meta: any, rng: () => number): FundamentalData {
    const profile = this.generateProfile(symbol, meta);
    const valuation = this.generateValuation(symbol, meta, rng);
    const earnings = this.generateEarnings(symbol, meta, rng);
    const health = this.generateHealth(symbol, meta, rng);
    const quarterly = this.generateQuarterly(rng);
    const ownership = this.generateOwnership(rng);
    const corporateActions = this.generateCorporateActions(symbol, rng);
    const outlook = this.generateOutlook(symbol, meta, rng);

    return {
      profile,
      valuation,
      earnings,
      health,
      quarterly,
      ownership,
      corporateActions,
      outlook,
      lastUpdated: Date.now(),
    };
  }

  private generateProfile(symbol: string, meta: any): CompanyProfile {
    const profile = COMPANY_PROFILES[symbol] ?? {};
    return {
      symbol,
      name: profile.name ?? `${symbol} Ltd`,
      sector: meta.sector,
      industry: profile.industry ?? meta.sector,
      marketCap: meta.basePrice * meta.lotSize * 1000 * (0.8 + Math.random() * 0.4), // approximate
      description: profile.description ?? `${symbol} is a company in the ${meta.sector} sector.`,
      website: profile.website ?? `www.${symbol.toLowerCase()}.com`,
      founded: profile.founded ?? 1980,
      listedOn: 'BOTH',
      isin: profile.isin ?? 'INE' + symbol.substring(0, 3) + 'A010' + Math.floor(Math.random() * 99),
    };
  }

  private generateValuation(symbol: string, meta: any, rng: () => number): ValuationMetrics {
    const sectorPE = SECTOR_PE[meta.sector] ?? 20;
    const peRatio = sectorPE * (0.7 + rng() * 0.8); // 70%-150% of sector PE
    const forwardPE = peRatio * (0.85 + rng() * 0.2); // forward PE slightly lower (growth)
    const eps = meta.basePrice / peRatio;
    const forwardEPS = eps * (1.1 + rng() * 0.15);
    const growthRate = (forwardEPS / eps - 1) * 100;
    const pegRatio = peRatio / Math.max(growthRate, 1);
    const premiumDiscount = ((peRatio - sectorPE) / sectorPE) * 100;

    return {
      peRatio: +peRatio.toFixed(2),
      forwardPE: +forwardPE.toFixed(2),
      pbRatio: +(2 + rng() * 5).toFixed(2),
      psRatio: +(1 + rng() * 8).toFixed(2),
      evEbitda: +(8 + rng() * 15).toFixed(2),
      dividendYield: +(rng() * 3).toFixed(2),
      pegRatio: +pegRatio.toFixed(2),
      sectorPE,
      premiumDiscount: +premiumDiscount.toFixed(1),
    };
  }

  private generateEarnings(symbol: string, meta: any, rng: () => number): EarningsData {
    const eps = meta.basePrice / (SECTOR_PE[meta.sector] ?? 20) * (0.8 + rng() * 0.4);
    const epsGrowthYoY = 5 + rng() * 25; // 5-30%
    const epsGrowth3Y = 8 + rng() * 20;
    const revenue = meta.basePrice * meta.lotSize * 50 * (0.5 + rng());
    const revenueGrowthYoY = 5 + rng() * 25;
    const netProfit = revenue * (0.08 + rng() * 0.15); // 8-23% margin
    const netProfitGrowthYoY = 5 + rng() * 30;
    const operatingMargin = 12 + rng() * 25; // 12-37%
    const netProfitMargin = (netProfit / revenue) * 100;
    const roe = 10 + rng() * 25; // 10-35%
    const roce = 12 + rng() * 20;
    const roa = 5 + rng() * 15;

    return {
      eps: +eps.toFixed(2),
      forwardEPS: +(eps * (1.1 + rng() * 0.15)).toFixed(2),
      epsGrowthYoY: +epsGrowthYoY.toFixed(1),
      epsGrowth3Y: +epsGrowth3Y.toFixed(1),
      revenue: Math.round(revenue),
      revenueGrowthYoY: +revenueGrowthYoY.toFixed(1),
      netProfit: Math.round(netProfit),
      netProfitGrowthYoY: +netProfitGrowthYoY.toFixed(1),
      operatingMargin: +operatingMargin.toFixed(1),
      netProfitMargin: +netProfitMargin.toFixed(1),
      roe: +roe.toFixed(1),
      roce: +roce.toFixed(1),
      roa: +roa.toFixed(1),
    };
  }

  private generateHealth(symbol: string, meta: any, rng: () => number): FinancialHealth {
    const isBank = meta.sector === 'BANKING' || meta.sector === 'FINANCIAL';
    // Banks have higher debt-to-equity naturally; non-banks lower
    const debtToEquity = isBank ? 8 + rng() * 5 : rng() * 1.5;
    const totalDebt = meta.basePrice * meta.lotSize * (isBank ? 200 : 5) * rng();
    const ebitda = totalDebt / (3 + rng() * 5); // for debt/ebitda calculation

    return {
      debtToEquity: +debtToEquity.toFixed(2),
      currentRatio: +(1.2 + rng() * 2).toFixed(2),
      quickRatio: +(0.8 + rng() * 1.5).toFixed(2),
      interestCoverage: +(3 + rng() * 20).toFixed(1),
      totalDebt: Math.round(totalDebt),
      cashAndEquivalents: Math.round(totalDebt * (0.1 + rng() * 0.4)),
      freeCashFlow: Math.round(totalDebt * (0.05 + rng() * 0.2)),
      debtToEbitda: +(debtToEquity * (0.5 + rng())).toFixed(2),
    };
  }

  private generateQuarterly(rng: () => number): QuarterlyResult[] {
    const quarters = ['Q1 FY26', 'Q2 FY26', 'Q3 FY26', 'Q4 FY26'];
    const quarters2 = ['Q1 FY25', 'Q2 FY25', 'Q3 FY25', 'Q4 FY25'];
    const allQuarters = [...quarters2.slice(0, 2), ...quarters.slice(0, 2)];
    // Actually, let's just use last 4 quarters
    const last4 = ['Q1 FY26', 'Q4 FY25', 'Q3 FY25', 'Q2 FY25'];
    let prevRevenue = 1000 + rng() * 5000;
    let prevProfit = prevRevenue * (0.08 + rng() * 0.15);

    return last4.map((q, i) => {
      const revGrowth = (rng() - 0.3) * 25; // -7.5% to +17.5%
      const profitGrowth = (rng() - 0.25) * 30;
      const revenue = prevRevenue * (1 + revGrowth / 100);
      const netProfit = prevProfit * (1 + profitGrowth / 100);
      const eps = (netProfit / 100) * (1 + rng() * 0.5);
      const margin = (netProfit / revenue) * 100;
      const surpriseRoll = rng();
      const surprise = surpriseRoll > 0.55 ? 'BEAT' : surpriseRoll > 0.25 ? 'IN_LINE' : 'MISS';
      const surprisePct = surprise === 'BEAT' ? 2 + rng() * 10 : surprise === 'MISS' ? -(2 + rng() * 8) : (rng() - 0.5) * 2;

      prevRevenue = revenue;
      prevProfit = netProfit;

      return {
        quarter: q,
        revenue: Math.round(revenue),
        netProfit: Math.round(netProfit),
        eps: +eps.toFixed(2),
        revenueGrowthQoQ: +revGrowth.toFixed(1),
        profitGrowthQoQ: +profitGrowth.toFixed(1),
        margin: +margin.toFixed(1),
        surprise: surprise as any,
        surprisePct: +surprisePct.toFixed(1),
      };
    }).reverse(); // most recent first
  }

  private generateOwnership(rng: () => number): OwnershipData {
    const promoterHolding = 40 + rng() * 25; // 40-65%
    const fiiHolding = 8 + rng() * 22; // 8-30%
    const diiHolding = 8 + rng() * 18; // 8-26%
    const publicHolding = 100 - promoterHolding - fiiHolding - diiHolding;
    return {
      promoterHolding: +promoterHolding.toFixed(1),
      promoterHoldingChange: +((rng() - 0.5) * 3).toFixed(1),
      fiiHolding: +fiiHolding.toFixed(1),
      fiiHoldingChange: +((rng() - 0.5) * 4).toFixed(1),
      diiHolding: +diiHolding.toFixed(1),
      diiHoldingChange: +((rng() - 0.5) * 3).toFixed(1),
      publicHolding: +Math.max(0, publicHolding).toFixed(1),
      institutionalHolding: +(fiiHolding + diiHolding).toFixed(1),
    };
  }

  private generateCorporateActions(symbol: string, rng: () => number): CorporateAction[] {
    const actions: CorporateAction[] = [];
    const types: CorporateAction['type'][] = ['DIVIDEND', 'RESULT', 'AGM', 'BONUS', 'SPLIT', 'BUYBACK'];
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - Math.floor(rng() * 180));
      const type = types[Math.floor(rng() * types.length)];
      let description = '';
      switch (type) {
        case 'DIVIDEND':
          description = `Interim dividend of ₹${(1 + rng() * 20).toFixed(1)} per share`;
          break;
        case 'RESULT':
          description = `Quarterly results declared. ${rng() > 0.5 ? 'Beat' : 'Missed'} analyst estimates by ${(1 + rng() * 8).toFixed(1)}%`;
          break;
        case 'AGM':
          description = `Annual General Meeting held. Shareholders approved all resolutions.`;
          break;
        case 'BONUS':
          description = `Bonus shares issued in ratio 1:${Math.ceil(rng() * 3)}`;
          break;
        case 'SPLIT':
          description = `Stock split from ₹10 face value to ₹${rng() > 0.5 ? '1' : '2'} face value`;
          break;
        case 'BUYBACK':
          description = `Buyback of shares at ₹${Math.round(500 + rng() * 3000)} per share`;
          break;
      }
      actions.push({
        date: date.toISOString().slice(0, 10),
        type,
        description,
        value: type === 'DIVIDEND' ? `₹${(1 + rng() * 20).toFixed(1)}` : undefined,
      });
    }
    return actions.sort((a, b) => b.date.localeCompare(a.date));
  }

  private generateOutlook(symbol: string, meta: any, rng: () => number): FutureOutlook {
    const businessPlans = [
      `Expanding ${meta.industry ?? meta.sector} operations with focus on digital transformation`,
      `Investing in new manufacturing capacity to meet growing demand`,
      `Exploring international markets for revenue diversification`,
      `Strategic acquisitions to strengthen market position`,
      `Launching new products in the ${meta.sector} segment`,
    ];
    const capexPlans = `Capex of ₹${Math.round(500 + rng() * 5000)} crores planned over next 2-3 years for capacity expansion and technology upgrades.`;
    const risks = [
      'Regulatory changes in the sector could impact margins',
      'Rising input costs may pressure profitability',
      'Intense competition from domestic and international players',
      'Macroeconomic headwinds and interest rate fluctuations',
    ];
    const catalysts = [
      'New product launches and market share gains',
      'Improving margins from cost optimization initiatives',
      'Strong order book visibility for next 2-3 quarters',
      'Potential re-rating on consistent earnings delivery',
    ];
    const consensusRoll = rng();
    const analystConsensus = consensusRoll > 0.5 ? 'BUY' : consensusRoll > 0.25 ? 'HOLD' : 'SELL';
    const analystTargetPrice = meta.basePrice * (1.05 + rng() * 0.3);

    return {
      businessPlans: businessPlans.slice(0, 3 + Math.floor(rng() * 2)),
      capexPlans,
      risks: risks.slice(0, 2 + Math.floor(rng() * 2)),
      catalysts: catalysts.slice(0, 2 + Math.floor(rng() * 2)),
      managementGuidance: `Management expects ${(8 + rng() * 15).toFixed(0)}-${(15 + rng() * 15).toFixed(0)}% revenue growth in FY26, with margin expansion of ${(0.5 + rng() * 2).toFixed(1)}-${(2 + rng() * 2).toFixed(1)}% from operational efficiencies.`,
      analystConsensus: analystConsensus as any,
      analystTargetPrice: Math.round(analystTargetPrice),
      analystCount: 15 + Math.floor(rng() * 30),
    };
  }
}

// Singleton
let providerInstance: FundamentalProvider | null = null;
export function getFundamentalProvider(): FundamentalProvider {
  if (!providerInstance) providerInstance = new FundamentalProvider();
  return providerInstance;
}
