import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { dataPath } from '@/lib/odss/data-dir';

export const dynamic = 'force-dynamic';

const QUOTES_FILE = dataPath('quotes.json');
let cache: { data: any; ts: number } = { data: null, ts: 0 };
const CACHE_TTL = 2000;

function readQuotesFile(): any | null {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  try {
    const raw = readFileSync(QUOTES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    cache.data = data;
    cache.ts = Date.now();
    return data;
  } catch {
    return cache.data;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const allData = readQuotesFile();
  if (!allData || !allData.quotes || allData.quotes.length === 0) {
    return NextResponse.json({ error: 'Market service data not available yet', timestamp: Date.now() }, { status: 503 });
  }
  if (symbol === 'all') {
    return NextResponse.json({ quotes: allData.quotes, source: allData.source ?? 'YAHOO', nifty: allData.nifty, bankNifty: allData.bankNifty, vix: allData.vix });
  }
  const sym = symbol.toUpperCase();
  const q = allData.quotes.find((x: any) => x.symbol === sym);
  if (q && q.ltp > 0) return NextResponse.json({ ...q, source: allData.source ?? 'YAHOO' });
  return NextResponse.json({ error: 'No live data for this symbol', symbol: sym, timestamp: Date.now() }, { status: 404 });
}
