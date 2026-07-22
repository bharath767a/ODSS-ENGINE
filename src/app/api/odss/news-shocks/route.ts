import { NextResponse } from 'next/server';
import { loadNewsShocks } from '@/lib/odss/news/shocks-store';

export const dynamic = 'force-dynamic';

// GET /api/odss/news-shocks — timestamped history of detected news-shock events
export async function GET() {
  const items = loadNewsShocks();
  return NextResponse.json({ items, count: items.length });
}
