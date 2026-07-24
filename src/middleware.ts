import { NextRequest, NextResponse } from 'next/server';

/**
 * VIEW-ONLY LOCKDOWN
 * ==================
 * When the server runs with ODSS_VIEW_ONLY=1 (the public "share with mentor"
 * mode) this middleware makes the whole app read-only and hides anything that
 * could leak engine internals or credentials:
 *   - every mutating request (POST/PUT/PATCH/DELETE) is refused,
 *   - the credential + bridge-config endpoints are blocked entirely,
 *   - source maps / the Next internals route is not served (handled by running
 *     a production build, which ships no readable source).
 * Normal (owner) mode passes everything through untouched.
 */
// Everything that could leak credentials, infrastructure or engine internals.
// The dashboard's read-only DATA routes (state, quotes, news, option chain,
// eod-positioning, …) stay open — that's what a viewer is meant to see.
const BLOCKED_READ = [
  '/api/odss/credentials',    // broker keys
  '/api/odss/bridge-config',  // bridge URL + token
  '/api/odss/providers',      // data-source wiring
  '/api/odss/health',         // infrastructure detail
  '/api/odss/config',         // engine configuration
  '/api/odss/users',          // accounts
  '/api/odss/strategy-lab',   // strategy genomes / internals
  '/api/odss/reset',
  '/api/odss/replay',
  '/api/odss/trade',
  '/api/auth',
];

export function middleware(req: NextRequest) {
  if (process.env.ODSS_VIEW_ONLY !== '1') return NextResponse.next();

  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Refuse anything that changes state.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return NextResponse.json({ error: 'View-only mode — actions are disabled' }, { status: 403 });
  }
  // Never expose credentials / config / internals.
  if (BLOCKED_READ.some(p => pathname.startsWith(p))) {
    return NextResponse.json({ error: 'View-only mode' }, { status: 403 });
  }
  const res = NextResponse.next();
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

// Only guard API routes (pages are read-only presentational content).
export const config = { matcher: '/api/:path*' };
