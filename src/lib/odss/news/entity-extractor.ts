/**
 * ODSS - News Entity Extractor
 * Extracts stocks, sectors, event types from news headlines.
 */
import { ALL_SYMBOLS } from '../../odss/universe';

export type EventType = 'EARNINGS'|'M&A'|'ORDER'|'POLICY'|'GLOBAL'|'CRUDE'|'RATING'|'BLOCK_DEAL'|'IPO'|'INSIDER'|'FII_DII'|'MACRO'|'SECTOR'|'STOCK_SPECIFIC'|'GUIDANCE'|'GENERAL';
export type ImpactMagnitude = 'HIGH'|'MEDIUM'|'LOW';
export type TimeHorizon = 'INTRADAY'|'SWING'|'POSITIONAL';

export interface NewsEntities {
  stocks: string[]; sectors: string[]; eventTypes: EventType[];
  impactMagnitude: ImpactMagnitude; timeHorizon: TimeHorizon; keywords: string[];
}

const COLLOQUIAL: Record<string,string> = {
  'RELIANCE INDUSTRIES':'RELIANCE','INFOSYS':'INFY','TATA CONSULTANCY':'TCS','HCL TECH':'HCLTECH',
  'HDFC':'HDFCBANK','ICICI':'ICICIBANK','AXIS':'AXISBANK','KOTAK':'KOTAKBANK','SBI':'SBIN','STATE BANK':'SBIN',
  'MARUTI SUZUKI':'MARUTI','TATA MOTORS':'TATAMOTORS','MAHINDRA':'M&M','SUN PHARMA':'SUNPHARMA','DR REDDY':'DRREDDY',
  'HINDUSTAN UNILEVER':'HINDUNILVR','NESTLE':'NESTLEIND','TATA STEEL':'TATASTEEL','JSW':'JSWSTEEL',
  'BAJAJ FINANCE':'BAJFINANCE','BAJAJ FINSERV':'BAJAJFINSV','NIFTY':'NIFTY','BANK NIFTY':'BANKNIFTY','FIN NIFTY':'FINNIFTY',
};

const SECTOR_KW: Record<string,string[]> = {
  BANKING:['BANK','BANKING','NPA','CREDIT','LOAN','RBI'], FINANCIAL:['NBFC','FINANCE','FINANCIAL','INSURANCE'],
  IT:['IT ','SOFTWARE','TECH','INFY','TCS','WIPRO','HCLTECH','CHIP','SEMICONDUCTOR'], PHARMA:['PHARMA','DRUG','MEDICINE','HEALTHCARE','CIPLA','SUN PHARMA','DR REDDY','USFDA'],
  AUTO:['AUTO','AUTOMOBILE','CAR','VEHICLE','MARUTI','TATA MOTORS','M&M','EV','TRACTOR'], FMCG:['FMCG','CONSUMER','HINDUSTAN UNILEVER','ITC','NESTLE','HUL'],
  METAL:['METAL','STEEL','IRON','ALUMINIUM','COPPER','TATA STEEL','JSW','HINDALCO','MINING'], ENERGY:['OIL','GAS','CRUDE','PETROLEUM','RELIANCE','ONGC','NTPC','POWER','ENERGY','OPEC'],
  INFRA:['INFRA','INFRASTRUCTURE','CONSTRUCTION','ROAD','HIGHWAY','L&T','BUILD'], TELECOM:['TELECOM','JIO','AIRTEL','IDEA','VODAFONE'],
};

const EVENT_KW: Record<EventType,string[]> = {
  EARNINGS:['Q1','Q2','Q3','Q4','RESULT','PROFIT','PAT','EPS','REVENUE','MARGIN','EARNINGS','NET PROFIT','BEAT','MISS'],
  GUIDANCE:['GUIDANCE','OUTLOOK','FORECAST','REVISE'],'M&A':['ACQUIRE','ACQUISITION','MERGER','DEAL','BUYOUT','STAKE','JOINT VENTURE','JV','SUBSIDIARY'],
  ORDER:['ORDER','CONTRACT','WINS','SECURES','BAGS'], POLICY:['RBI','POLICY','RATE','REPO','GOVERNMENT','MINISTRY','REGULATION','SEBI','BUDGET','TAX','GST'],
  GLOBAL:['GLOBAL','US ','WALL STREET','ASIAN','JAPAN','CHINA','EUROPE','FED','DOW','NASDAQ','NIKKEI'],
  CRUDE:['CRUDE','OIL','BRENT','WTI','OPEC','PETROLEUM'], RATING:['RATING','UPGRADE','DOWNGRADE','BROKER','TARGET','BUY RATING','SELL RATING'],
  BLOCK_DEAL:['BLOCK DEAL','BULK DEAL','PROMOTER','INSTITUTIONAL'], IPO:['IPO','LISTING','PUBLIC ISSUE'],
  INSIDER:['PROMOTER','INSIDER','PLEDGE','ENCUMBERED'], FII_DII:['FII','DII','FOREIGN INSTITUTIONAL','DOMESTIC INSTITUTIONAL'],
  MACRO:['GDP','INFLATION','CPI','WPI','IIP','TRADE DEFICIT','CURRENT ACCOUNT'], SECTOR:['SECTOR','INDUSTRY','INDEX'],
  STOCK_SPECIFIC:['SHARE','STOCK','EQUITY'], GENERAL:[],
};

export function extractEntities(title: string, description?: string): NewsEntities {
  const text = `${title} ${description||''}`.toUpperCase();
  const stocks = new Set<string>(); const sectors = new Set<string>(); const events = new Set<EventType>(); const keywords: string[] = [];
  for (const [alias, sym] of Object.entries(COLLOQUIAL)) { if (text.includes(alias)) { stocks.add(sym); keywords.push(alias); } }
  for (const meta of ALL_SYMBOLS) { if (text.includes(meta.symbol)) stocks.add(meta.symbol); const words = meta.name.toUpperCase().split(/\s+/); if (words[0] && words[0].length >= 4 && text.includes(words[0])) stocks.add(meta.symbol); }
  for (const [sec, kws] of Object.entries(SECTOR_KW)) { for (const kw of kws) { if (text.includes(kw)) { sectors.add(sec); keywords.push(kw); break; } } }
  for (const [evt, kws] of Object.entries(EVENT_KW)) { for (const kw of kws) { if (text.includes(kw)) { events.add(evt as EventType); keywords.push(kw); break; } } }
  if (events.size === 0) events.add('GENERAL');
  const highEvents: EventType[] = ['POLICY','M&A','EARNINGS','GLOBAL','CRUDE','MACRO'];
  let highCount = 0; for (const e of events) if (highEvents.includes(e)) highCount++;
  const highKw = ['CRASH','SURGE','PLUNGE','SPIKE','BAN','DEFAULT','BANKRUPTCY','MERGER','ACQUISITION','RATE CUT','RATE HIKE','EMERGENCY','WAR','CRISIS'];
  const hasHighKw = highKw.some(kw => text.includes(kw));
  const impactMagnitude: ImpactMagnitude = (highCount >= 2 || hasHighKw) ? 'HIGH' : (highCount >= 1 || stocks.size >= 2) ? 'MEDIUM' : 'LOW';
  const posEvents: EventType[] = ['POLICY','M&A','MACRO'];
  const swingEvents: EventType[] = ['EARNINGS','GUIDANCE','RATING','BLOCK_DEAL','INSIDER','IPO','ORDER'];
  const timeHorizon: TimeHorizon = Array.from(events).some(e => posEvents.includes(e)) ? 'POSITIONAL' : Array.from(events).some(e => swingEvents.includes(e)) ? 'SWING' : 'INTRADAY';
  return { stocks: Array.from(stocks), sectors: Array.from(sectors), eventTypes: Array.from(events), impactMagnitude, timeHorizon, keywords };
}
