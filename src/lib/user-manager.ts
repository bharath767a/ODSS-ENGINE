/**
 * ODSS User Manager
 * -----------------
 * Thin wrapper around the Prisma `User` model that enforces:
 *   • bcrypt-hashed passwords
 *   • hard cap of MAX_USERS accounts (default 4)
 *   • default admin seeding on first run
 *
 * Used by:
 *   - src/lib/auth.ts          (NextAuth credentials provider)
 *   - src/app/api/odss/users/route.ts (admin user management)
 */
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';

export const MAX_USERS = 4;

const BCRYPT_ROUNDS = 10;

export type SafeUser = {
  id: string;
  username: string;
  name: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateUserResult =
  | { ok: true; user: SafeUser }
  | { ok: false; error: string };

function strip(user: {
  id: string;
  username: string;
  name: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}): SafeUser {
  // never expose password hash
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Create a new user. Enforces the MAX_USERS cap and bcrypt-hashes the password.
 */
export async function createUser(
  username: string,
  password: string,
  name?: string,
  role: string = 'user',
): Promise<CreateUserResult> {
  const trimmedUsername = username.trim().toLowerCase();
  if (!trimmedUsername) {
    return { ok: false, error: 'Username is required' };
  }
  if (trimmedUsername.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters' };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters' };
  }
  if (!['admin', 'user'].includes(role)) {
    return { ok: false, error: 'Invalid role' };
  }

  const count = await db.user.count();
  if (count >= MAX_USERS) {
    return {
      ok: false,
      error: `Maximum of ${MAX_USERS} users reached. Delete an existing user before adding a new one.`,
    };
  }

  const existing = await db.user.findUnique({ where: { username: trimmedUsername } });
  if (existing) {
    return { ok: false, error: 'Username already taken' };
  }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const created = await db.user.create({
    data: {
      username: trimmedUsername,
      password: hashed,
      name: name?.trim() || null,
      role,
    },
  });
  return { ok: true, user: strip(created) };
}

/**
 * Validate credentials. Returns the safe user object on success, or null.
 */
export async function validateUser(
  username: string,
  password: string,
): Promise<SafeUser | null> {
  const trimmedUsername = username.trim().toLowerCase();
  if (!trimmedUsername || !password) return null;

  const user = await db.user.findUnique({ where: { username: trimmedUsername } });
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  return strip(user);
}

/**
 * Total user count (used by UI to show "X / 4 users").
 */
export async function getUserCount(): Promise<number> {
  return db.user.count();
}

/**
 * List all users (without password hashes).
 */
export async function getUsers(): Promise<SafeUser[]> {
  const users = await db.user.findMany({ orderBy: { createdAt: 'asc' } });
  return users.map(strip);
}

/**
 * Delete a user by id. Returns true if a row was deleted.
 */
export async function deleteUser(id: string): Promise<boolean> {
  try {
    const deleted = await db.user.delete({ where: { id } });
    return !!deleted;
  } catch {
    return false;
  }
}

/**
 * Seed default admin user if the user table is empty.
 *
 * Default credentials:
 *   username: admin
 *   password: admin123
 *   role:     admin
 *
 * Safe to call repeatedly — no-ops once any user exists.
 */
export async function seedDefaultUsers(): Promise<void> {
  const count = await db.user.count();
  if (count > 0) return;

  await createUser('admin', 'admin123', 'ODSS Administrator', 'admin');
  console.log('[user-manager] Seeded default admin user (admin / admin123)');
}

/**
 * Ensure seeding has run. Idempotent. Call from app init paths.
 */
let seedPromise: Promise<void> | null = null;
export function ensureSeedUsers(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedDefaultUsers().catch((err) => {
      console.error('[user-manager] Failed to seed default users:', err);
      // Allow a retry on next call
      seedPromise = null;
    });
  }
  return seedPromise;
}
