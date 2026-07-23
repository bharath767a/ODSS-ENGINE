/**
 * View-only (spectator) mode flag — baked in at build time via
 * NEXT_PUBLIC_ODSS_VIEW_ONLY=1. When true, the UI hides every mutating control
 * (Take / Close / Reset / manual scan) and the Config + Data-Sources tabs, and
 * shows a "VIEW ONLY" banner. The server-side lockdown lives in middleware.ts.
 */
export const VIEW_ONLY = process.env.NEXT_PUBLIC_ODSS_VIEW_ONLY === '1';
