import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/odss/log — decision log
export async function GET() {
  const logs = await db.decisionLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 200,
  });
  return NextResponse.json({ logs });
}
