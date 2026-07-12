import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/odss/journal — trade journal (completed trades)
export async function GET() {
  const trades = await db.tradeJournal.findMany({
    orderBy: { entryTime: 'desc' },
    take: 200,
  });
  return NextResponse.json({ trades });
}
