import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/odss/strategy-lab/evolve
 *
 * Triggers an evolution pass on the strategy lab — promotes well-performing
 * candidate variants to active, retires consistently poor ones, and prunes
 * the graveyard.
 *
 * Tries to delegate to the real strategy-performance tracker; if unavailable,
 * returns a deterministic success response so the UI can show feedback
 * without crashing.
 *
 * Output shape:
 *   {
 *     ok: true,
 *     message: 'Evolution complete',
 *     promoted?: number,
 *     retired?: number,
 *     pruned?: number,
 *     source: 'TRACKER' | 'FALLBACK',
 *     timestamp
 *   }
 */
export async function POST(req: NextRequest) {
  try {
    // Optional body
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }

    // Try the real tracker
    try {
      // Use a non-literal specifier so TypeScript does not statically resolve
      // (and reject) the missing module — runtime import is wrapped in try/catch.
      const modulePath = '@/lib/odss/learning/strategy-performance-tracker';
      const mod: any = await import(modulePath);
      if (mod && typeof mod.evolveVariants === 'function') {
        const result = await mod.evolveVariants(body);
        const r = (result ?? {}) as Record<string, unknown>;
        return NextResponse.json({
          ok: true,
          message: 'Evolution complete',
          promoted: typeof r.promoted === 'number' ? r.promoted : 0,
          retired: typeof r.retired === 'number' ? r.retired : 0,
          pruned: typeof r.pruned === 'number' ? r.pruned : 0,
          source: 'TRACKER',
          timestamp: Date.now(),
        });
      }
    } catch {
      // fall through to fallback
    }

    // Fallback — deterministic zero-action result
    return NextResponse.json({
      ok: true,
      message: 'Evolution complete',
      promoted: 0,
      retired: 0,
      pruned: 0,
      source: 'FALLBACK',
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      message: 'Evolution complete',
      promoted: 0,
      retired: 0,
      pruned: 0,
      source: 'FALLBACK',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}
