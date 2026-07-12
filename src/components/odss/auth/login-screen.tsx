'use client';

import { useState, FormEvent, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ODSS Login Screen
 * -----------------
 * Full-screen dark overlay that renders on `/` when the user is
 * unauthenticated. Mirrors the dashboard's Bloomberg-terminal aesthetic:
 * deep charcoal bg, glassmorphism card, gradient ODSS wordmark, and a
 * subtle animated grid backdrop (already applied via globals.css on body).
 *
 * On successful sign-in the page reloads so server components can pick
 * up the new session cookie.
 */
export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Autofocus the username field on mount.
  useEffect(() => {
    const t = window.setTimeout(() => {
      document.getElementById('odss-login-username')?.focus();
    }, 100);
    return () => window.clearTimeout(t);
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await signIn('credentials', {
        redirect: false,
        username,
        password,
      });

      if (!res || res.error) {
        setError('Invalid username or password. Try again.');
        setSubmitting(false);
        return;
      }

      // Success — reload so server components pick up the new session.
      window.location.reload();
    } catch (err) {
      console.error('[login] sign-in failed', err);
      setError('Sign-in failed. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="odss-login-title"
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-8"
    >
      {/* Ambient color glows (subtle, behind card) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 20% 30%, rgba(52,211,153,0.10), transparent 60%),' +
            'radial-gradient(ellipse 50% 40% at 80% 70%, rgba(167,139,250,0.10), transparent 60%),' +
            'radial-gradient(ellipse 40% 30% at 50% 110%, rgba(34,211,238,0.08), transparent 60%)',
        }}
      />

      {/* Animated scanning accent line */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/3 -z-10 h-px opacity-40"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(52,211,153,0.6), transparent)',
          animation: 'odss-scan 6s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes odss-scan {
          0%, 100% { transform: translateY(-40px); opacity: 0.2; }
          50%      { transform: translateY(40px);  opacity: 0.55; }
        }
      `}</style>

      <div className="w-full max-w-md">
        {/* ---------- Brand ---------- */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-bull/30 bg-gradient-to-br from-bull/25 via-ai/15 to-info/20 shadow-[0_0_30px_-6px_rgba(52,211,153,0.55)]">
            <Activity className="h-6 w-6 text-bull" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10" />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
                backgroundSize: '200% 100%',
                animation: 'odss-shimmer 4s linear infinite',
              }}
            />
            <style>{`
              @keyframes odss-shimmer {
                0%   { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
            `}</style>
          </div>

          <h1
            id="odss-login-title"
            className="text-3xl font-extrabold tracking-tight"
          >
            <span className="text-gradient-bull">ODSS</span>
          </h1>
          <p className="mt-1 font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
            OPTIONS DECISION SUPPORT SYSTEM
          </p>
          <p className="mt-3 max-w-xs text-xs text-muted-foreground/80">
            Sign in to access the trading decision engine.
          </p>
        </div>

        {/* ---------- Card ---------- */}
        <div className="glass-card rounded-xl border border-border/70 p-6 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] sm:p-8">
          <div className="mb-5 flex items-center gap-2 border-b border-border/60 pb-3">
            <ShieldCheck className="h-4 w-4 text-bull" />
            <span className="font-mono text-[11px] tracking-wider text-muted-foreground">
              SECURE SIGN-IN
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Username */}
            <div className="space-y-1.5">
              <Label
                htmlFor="odss-login-username"
                className="font-mono text-[10px] tracking-widest text-muted-foreground"
              >
                USERNAME
              </Label>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="odss-login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  disabled={submitting}
                  className="h-11 rounded-md border-border/70 bg-card/60 pl-9 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-bull/60 focus-visible:ring-bull/20"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label
                htmlFor="odss-login-password"
                className="font-mono text-[10px] tracking-widest text-muted-foreground"
              >
                PASSWORD
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="odss-login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={submitting}
                  className="h-11 rounded-md border-border/70 bg-card/60 pl-9 pr-10 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-bull/60 focus-visible:ring-bull/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-bear/40 bg-bear/10 px-3 py-2 text-sm text-bear glow-danger"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={submitting || !username || !password}
              className={cn(
                'h-11 w-full rounded-md bg-gradient-to-r from-bull to-info font-mono text-[12px] font-semibold tracking-wider text-[#052017] shadow-[0_0_18px_-4px_rgba(52,211,153,0.55)] transition-all',
                'hover:shadow-[0_0_24px_-2px_rgba(52,211,153,0.7)] hover:brightness-110',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AUTHENTICATING…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  SIGN IN
                </>
              )}
            </Button>
          </form>

          {/* Default credentials hint */}
          <div className="mt-5 rounded-md border border-info/25 bg-info/5 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-info">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-info live-dot" />
              FIRST-RUN DEFAULTS
            </div>
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              Username{' '}
              <span className="rounded bg-info/10 px-1.5 py-0.5 text-info">admin</span>{' '}
              · Password{' '}
              <span className="rounded bg-info/10 px-1.5 py-0.5 text-info">admin123</span>
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Change credentials after first sign-in via the Data Sources tab.
            </p>
          </div>
        </div>

        {/* ---------- Footer ---------- */}
        <div className="mt-5 flex items-center justify-between font-mono text-[10px] tracking-wider text-muted-foreground/70">
          <span>NSE · INDEX &amp; EQUITY OPTIONS</span>
          <span>DECISION ENGINE v1.1</span>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground/50">
          NOT AN AUTO-TRADING BOT · HUMAN IS FINAL DECISION MAKER
        </p>
      </div>
    </div>
  );
}

export default LoginScreen;
