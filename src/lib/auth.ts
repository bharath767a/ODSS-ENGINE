/**
 * ODSS NextAuth Configuration
 * ---------------------------
 * Credentials provider backed by the Prisma `User` table.
 * JWT-based sessions (no DB session store — keeps it simple for the
 * single-process ODSS deployment).
 *
 * Session token includes: id, username, role.
 */
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { validateUser, ensureSeedUsers, type SafeUser } from '@/lib/user-manager';

// Augment NextAuth types so the session/JWT carry our user fields.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      username: string;
      name?: string | null;
      role: string;
    };
  }
  interface User {
    id: string;
    username: string;
    name?: string | null;
    role: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    username?: string;
    role?: string;
    name?: string | null;
  }
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
  pages: {
    // We don't ship a dedicated /auth/signin page — login is an overlay on /.
    // Keep this so any internal redirects stay on /.
    signIn: '/',
  },
  providers: [
    CredentialsProvider({
      name: 'ODSS Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // Ensure default admin exists on first run.
        await ensureSeedUsers();

        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const user: SafeUser | null = await validateUser(
          credentials.username,
          credentials.password,
        );
        if (!user) return null;

        return {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as SafeUser).username;
        token.role = (user as SafeUser).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? '';
        session.user.username = token.username ?? '';
        session.user.role = token.role ?? 'user';
        session.user.name = token.name ?? null;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || 'odss-dev-secret-change-me-in-production',
};

export default authOptions;
