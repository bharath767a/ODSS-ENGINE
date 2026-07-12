import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  createUser,
  deleteUser,
  getUserCount,
  getUsers,
  MAX_USERS,
  ensureSeedUsers,
} from '@/lib/user-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odss/users
 *   Returns all users (without password hashes) + the current count / max.
 *   Auth required — admin role recommended but not strictly enforced
 *   per the task spec ("for simplicity skip role check").
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Make sure default admin exists on every fetch (idempotent).
  await ensureSeedUsers();

  const [users, count] = await Promise.all([getUsers(), getUserCount()]);
  return NextResponse.json({
    users,
    count,
    max: MAX_USERS,
    canAdd: count < MAX_USERS,
  });
}

/**
 * POST /api/odss/users
 *   Body: { username, password, name?, role? }
 *   Creates a new user. Enforces MAX_USERS cap.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Optional soft check — only admins can add users.
  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can add users' },
      { status: 403 },
    );
  }

  let body: {
    username?: string;
    password?: string;
    name?: string;
    role?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { username, password, name, role } = body;
  if (!username || !password) {
    return NextResponse.json(
      { error: 'username and password are required' },
      { status: 400 },
    );
  }

  const result = await createUser(username, password, name, role);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const count = await getUserCount();
  return NextResponse.json({
    ok: true,
    user: result.user,
    count,
    max: MAX_USERS,
    canAdd: count < MAX_USERS,
  });
}

/**
 * DELETE /api/odss/users?id=<userId>
 *   Deletes a user by id.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can delete users' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  // Don't let a user delete their own account.
  if (id === session.user.id) {
    return NextResponse.json(
      { error: 'You cannot delete your own account while signed in' },
      { status: 400 },
    );
  }

  const deleted = await deleteUser(id);
  if (!deleted) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const count = await getUserCount();
  return NextResponse.json({
    ok: true,
    count,
    max: MAX_USERS,
    canAdd: count < MAX_USERS,
  });
}
