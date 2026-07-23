import { NextResponse } from 'next/server';
import { loadEODReport } from '@/lib/odss/engines/eod-positioning';

export const dynamic = 'force-dynamic';

// GET /api/odss/eod-positioning — latest end-of-day positioning report
// (tomorrow's bullish/bearish watchlist from the day's option-chain OI).
export async function GET() {
  const report = loadEODReport();
  return NextResponse.json(report ?? { date: '', generatedAt: 0, count: 0, bullish: [], bearish: [], all: [] });
}
