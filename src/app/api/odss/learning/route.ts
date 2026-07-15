import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/learning
 *
 * Returns learned patterns from the ODSS learning engine.
 *
 * Tries to import `@/lib/odss/learning/learning-engine` and call
 *   - listPatternsForCurrentRegime()
 *   - getLearningStats()
 *
 * If the module is missing or either function fails, returns an empty
 * patterns array and zeroed-out stats so the UI renders cleanly.
 *
 * Output shape (real):
 *   { patterns: [...], stats: { total, reliable, preliminary, insufficient } }
 *
 * Output shape (fallback):
 *   { patterns: [], stats: { total: 0, reliable: 0, preliminary: 0, insufficient: 0 },
 *     source: 'FALLBACK' }
 */
export async function GET() {
  try {
    try {
      // Use a non-literal specifier so TypeScript does not statically resolve
      // (and reject) the missing module — runtime import is wrapped in try/catch.
      const modulePath = '@/lib/odss/learning/learning-engine';
      const mod: any = await import(modulePath);
      const listPatterns =
        typeof mod.listPatternsForCurrentRegime === 'function' && mod.listPatternsForCurrentRegime;
      const getStats =
        typeof mod.getLearningStats === 'function' && mod.getLearningStats;

      if (listPatterns && getStats) {
        const patterns = await listPatterns();
        const stats = await getStats();
        return NextResponse.json({
          patterns: Array.isArray(patterns) ? patterns : [],
          stats: stats ?? zeroStats(),
          source: 'LEARNING_ENGINE',
          timestamp: Date.now(),
        });
      }
    } catch {
      // module missing — fall through
    }

    // Fallback
    return NextResponse.json({
      patterns: [],
      stats: zeroStats(),
      source: 'FALLBACK',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      patterns: [],
      stats: zeroStats(),
      source: 'FALLBACK',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

function zeroStats() {
  return {
    total: 0,
    reliable: 0,
    preliminary: 0,
    insufficient: 0,
  };
}
