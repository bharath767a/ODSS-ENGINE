import { NextResponse } from 'next/server';
import { getMutualFundAnalysis } from '@/lib/odss/fundamentals/mutual-funds';

export const dynamic = 'force-dynamic';

// GET /api/odss/mutual-funds — top 10 mutual funds with analysis
export async function GET() {
  const analysis = getMutualFundAnalysis();
  return NextResponse.json(analysis);
}
