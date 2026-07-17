import { NextResponse } from 'next/server';
import {
  listVariantsForCurrentRegime,
  getStrategyLabStats,
} from '@/lib/odss/learning/strategy-performance-tracker';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const variants = await listVariantsForCurrentRegime();
    const stats = await getStrategyLabStats();
    return NextResponse.json({
      variants: Array.isArray(variants) ? variants : [],
      stats: stats ?? zeroStats(),
      source: 'STRATEGY_TRACKER',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      variants: [], stats: zeroStats(), source: 'FALLBACK', timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

function zeroStats() { return { total: 0, active: 0, candidate: 0, retired: 0, graveyard: 0 }; }
