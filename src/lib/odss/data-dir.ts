/**
 * ODSS — Data Directory Resolver
 * ==============================
 *
 * Single source of truth for where the engine keeps its runtime state
 * (engine-state.json, quotes.json, conviction-state.json, bridge-config.json,
 * the archive/ tree, pm2-logs/, the SQLite db, etc.).
 *
 * WHY THIS EXISTS
 * ---------------
 * The engine originally hardcoded the absolute Linux path `/home/z/odss-data`
 * in ~18 files. That path does not exist on Windows or on Replit, so every
 * read/write silently failed (all wrapped in empty `catch {}`), which is why
 * the system was "difficult to set up" anywhere but the original sandbox.
 *
 * RESOLUTION ORDER
 * ----------------
 *   1. `ODSS_DATA_DIR` env var, if set  (use this on Replit: a persistent dir)
 *   2. The legacy `/home/z/odss-data`   (only if it already exists — back-compat
 *      with the original sandbox so nothing breaks there)
 *   3. `<home>/.odss-data`              (cross-platform default: Windows/Linux/mac)
 *
 * The default is deliberately an ABSOLUTE, cwd-independent path so that the
 * Next.js web server (cwd = repo root) and the bun market service
 * (cwd = mini-services/odss-market) always resolve the SAME directory.
 */
import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

const LEGACY_DIR = '/home/z/odss-data';

function resolveDataDir(): string {
  const env = process.env.ODSS_DATA_DIR?.trim();
  if (env) return isAbsolute(env) ? env : join(process.cwd(), env);
  // Back-compat: if the original sandbox path exists, keep using it.
  try {
    if (existsSync(LEGACY_DIR)) return LEGACY_DIR;
  } catch {
    /* existsSync can throw on some sandboxed FS — fall through to default */
  }
  return join(homedir(), '.odss-data');
}

/** Absolute path to the ODSS runtime data directory. Resolved once at load. */
export const DATA_DIR: string = resolveDataDir();

/** Build a path inside the data dir, e.g. dataPath('quotes.json'). */
export function dataPath(...segments: string[]): string {
  return join(DATA_DIR, ...segments);
}

/**
 * Ensure the data dir (or a subfolder of it) exists and return its path.
 * Safe to call repeatedly; swallows errors like the original code did.
 */
export function ensureDataDir(...segments: string[]): string {
  const dir = segments.length ? join(DATA_DIR, ...segments) : DATA_DIR;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort, matches prior behaviour */
  }
  return dir;
}
