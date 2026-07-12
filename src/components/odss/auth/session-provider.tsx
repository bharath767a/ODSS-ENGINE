'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

/**
 * Wraps the app with NextAuth's SessionProvider so client components
 * (page.tsx, login screen, etc.) can call useSession().
 */
export function SessionProviderWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
