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
const BLOCKED_READ = ['/api/odss/credentials', '/api/odss/bridge-config'];

export function middleware(req: NextRequest) {
  if (process.env.ODSS_VIEW_ONLY !== '1') return NextResponse.next();

  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Refuse anything that changes state.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return NextResponse.json({ error: 'View-only mode — actions are disabled' }, { status: 403 });
  }
  // Never expose credentials / bridge configuration.
  if (BLOCKED_READ.some(p => pathname.startsWith(p))) {
    return NextResponse.json({ error: 'View-only mode' }, { status: 403 });
  }
  return NextResponse.next();
}

// Only guard API routes (pages are read-only presentational content).
export const config = { matcher: '/api/:path*' };
