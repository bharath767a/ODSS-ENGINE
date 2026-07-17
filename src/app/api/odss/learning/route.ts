import { NextResponse } from 'next/server';
import {
  listPatternsForCurrentRegime,
  getLearningStats,
} from '@/lib/odss/learning/learning-engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const patterns = await listPatternsForCurrentRegime();
    const stats = await getLearningStats();
    return NextResponse.json({
      patterns: Array.isArray(patterns) ? patterns : [],
      stats: stats ?? zeroStats(),
      source: 'LEARNING_ENGINE',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      patterns: [], stats: zeroStats(), source: 'FALLBACK', timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

function zeroStats() { return { total: 0, reliable: 0, preliminary: 0, insufficient: 0 }; }
