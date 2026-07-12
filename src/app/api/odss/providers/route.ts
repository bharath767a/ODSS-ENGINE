import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/odss/providers — returns health status of all data providers
export async function GET() {
  // Import the router dynamically to avoid circular deps
  const { getDataRouter } = await import('@/lib/odss/data-providers/router');
  const router = getDataRouter();
  const health = router.getAllProviderHealth();
  const preferred = router.getPreferredProvider();

  return NextResponse.json({
    providers: health.map((h) => ({
      ...h,
      lastSuccess: h.lastSuccess ? new Date(h.lastSuccess).toISOString() : null,
      rateLimitUntil: h.rateLimitUntil ? new Date(h.rateLimitUntil).toISOString() : null,
    })),
    preferredProvider: preferred,
    timestamp: Date.now(),
  });
}
