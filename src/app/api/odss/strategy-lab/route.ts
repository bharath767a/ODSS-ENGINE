import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/strategy-lab
 *
 * Returns strategy variants from the ODSS strategy performance tracker.
 *
 * Tries to import `@/lib/odss/learning/strategy-performance-tracker` and call
 *   - listVariantsForCurrentRegime()
 *   - getStrategyLabStats()
 *
 * If the module is missing or either function fails, returns an empty
 * variants array and zeroed-out stats so the UI renders cleanly.
 *
 * Output shape (real):
 *   { variants: [...], stats: { total, active, candidate, retired, graveyard } }
 *
 * Output shape (fallback):
 *   { variants: [], stats: { total: 0, active: 0, candidate: 0, retired: 0, graveyard: 0 },
 *     source: 'FALLBACK' }
 */
export async function GET() {
  try {
    try {
      // Use a non-literal specifier so TypeScript does not statically resolve
      // (and reject) the missing module — runtime import is wrapped in try/catch.
      const modulePath = '@/lib/odss/learning/strategy-performance-tracker';
      const mod: any = await import(modulePath);
      const listVariants =
        typeof mod.listVariantsForCurrentRegime === 'function' && mod.listVariantsForCurrentRegime;
      const getStats =
        typeof mod.getStrategyLabStats === 'function' && mod.getStrategyLabStats;

      if (listVariants && getStats) {
        const variants = await listVariants();
        const stats = await getStats();
        return NextResponse.json({
          variants: Array.isArray(variants) ? variants : [],
          stats: stats ?? zeroStats(),
          source: 'STRATEGY_TRACKER',
          timestamp: Date.now(),
        });
      }
    } catch {
      // module missing — fall through
    }

    // Fallback
    return NextResponse.json({
      variants: [],
      stats: zeroStats(),
      source: 'FALLBACK',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      variants: [],
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
    active: 0,
    candidate: 0,
    retired: 0,
    graveyard: 0,
  };
}
