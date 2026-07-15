'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Newspaper,
  X,
  ExternalLink,
  AlertTriangle,
  Bell,
} from 'lucide-react';

// ============================================================
// News Popup — floating bottom-right popup for breaking news
// ------------------------------------------------------------
// Behaviour:
//   1. Polls /api/odss/market-session every 30s
//   2. If NSE market is OPEN (09:15-15:30 IST, weekdays only):
//        a. Fetch /api/odss/market-brief?type=pre
//        b. Pick "breaking" items (NEGATIVE / POSITIVE sentiment with category Stocks/Volatility)
//        c. Show as floating popups bottom-right
//        d. Auto-dismiss after 10s
//        e. Max 3 visible at once
//   3. If market is closed → popups hidden
//   4. Already-shown news IDs are deduplicated within the session
// ============================================================

type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  sentiment: Sentiment;
  link?: string;
  timestamp: number;
  category?: string;
}

interface MarketBriefLite {
  news: NewsItem[];
  updatedAt: number;
}

interface MarketSession {
  isOpen: boolean;
  isPreOpen: boolean;
  phase: 'PRE_OPEN' | 'OPEN' | 'POST_CLOSE' | 'CLOSED';
  istTime: string;
  weekday: string;
  nextPhase: string;
}

const SESSION_POLL_MS = 30_000;
const NEWS_POLL_MS = 30_000;
const POPUP_TTL_MS = 10_000;
const MAX_VISIBLE = 3;

const SENTIMENT_CONFIG: Record<Sentiment, { color: string; dot: string; border: string; bg: string }> = {
  POSITIVE: {
    color: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
    bg: 'bg-gradient-to-br from-emerald-50 to-white',
  },
  NEGATIVE: {
    color: 'text-rose-700',
    dot: 'bg-rose-500',
    border: 'border-rose-200',
    bg: 'bg-gradient-to-br from-rose-50 to-white',
  },
  NEUTRAL: {
    color: 'text-amber-700',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
    bg: 'bg-gradient-to-br from-amber-50 to-white',
  },
};

function formatRelativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

// Determine if a news item is "breaking" — high-impact categories only
function isBreaking(item: NewsItem): boolean {
  if (item.sentiment === 'NEUTRAL') return false;
  const breakingCategories = ['Market', 'Volatility', 'Stocks', 'Global'];
  if (item.category && breakingCategories.includes(item.category)) return true;
  // Also treat any NEGATIVE VIX-related news as breaking
  if (item.sentiment === 'NEGATIVE' && /vix|volatility/i.test(item.title)) return true;
  return false;
}

interface ActivePopup extends NewsItem {
  popupId: string;
  dismissed: boolean;
}

export function NewsPopup() {
  const [session, setSession] = useState<MarketSession | null>(null);
  const [popups, setPopups] = useState<ActivePopup[]>([]);
  // Track shown IDs to prevent re-popup of the same item within the session
  const shownIdsRef = useRef<Set<string>>(new Set());
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ---------- Session check ----------
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/odss/market-session', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data: MarketSession = await res.json();
        if (cancelled) return;
        setSession(data);
      } catch {
        // silently ignore — popups just won't show
      }
    };
    run();
    const id = setInterval(run, SESSION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // ---------- Dismiss handler (declared first so other callbacks can depend on it) ----------
  const dismissPopup = useCallback((popupId: string) => {
    setPopups((prev) => prev.map((p) => (p.popupId === popupId ? { ...p, dismissed: true } : p)));
    // Remove from DOM after exit animation
    setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.popupId !== popupId));
    }, 350);
    const t = dismissTimersRef.current.get(popupId);
    if (t) {
      clearTimeout(t);
      dismissTimersRef.current.delete(popupId);
    }
  }, []);

  // ---------- News fetching (only when market is OPEN) ----------
  const fetchBreakingNews = useCallback(async () => {
    try {
      const res = await fetch('/api/odss/market-brief?type=pre', { cache: 'no-store' });
      if (!res.ok) return;
      const data: MarketBriefLite = await res.json();
      const breaking = (data.news ?? []).filter(isBreaking);
      const newOnes = breaking.filter((n) => !shownIdsRef.current.has(n.id));

      if (newOnes.length === 0) return;

      // Mark as shown
      for (const n of newOnes) shownIdsRef.current.add(n.id);

      // Cap the shown-id set size (keep last 200)
      if (shownIdsRef.current.size > 200) {
        const arr = Array.from(shownIdsRef.current);
        shownIdsRef.current = new Set(arr.slice(-200));
      }

      // Add to active popups (cap MAX_VISIBLE — drop oldest first if overflow)
      const now = Date.now();
      const toAdd: ActivePopup[] = newOnes
        .slice(0, MAX_VISIBLE)
        .map((n) => ({ ...n, popupId: `${n.id}-${now}`, dismissed: false }));

      setPopups((prev) => {
        const remainingSlots = Math.max(0, MAX_VISIBLE - toAdd.length);
        const kept = prev.slice(0, remainingSlots);
        return [...toAdd, ...kept];
      });

      // Schedule auto-dismiss for each new popup
      for (const p of toAdd) {
        const tid = setTimeout(() => {
          dismissPopup(p.popupId);
        }, POPUP_TTL_MS);
        dismissTimersRef.current.set(p.popupId, tid);
      }
    } catch {
      // silently ignore
    }
  }, [dismissPopup]);

  // Only poll for breaking news when market is OPEN.
  // Derived state: visible popups are gated by marketOpen at render time
  // (so closing the market hides them without a synchronous setState).
  useEffect(() => {
    if (!session?.isOpen) return;
    fetchBreakingNews();
    const id = setInterval(fetchBreakingNews, NEWS_POLL_MS);
    return () => clearInterval(id);
  }, [session?.isOpen, fetchBreakingNews]);

  // Clear all dismiss timers when market closes (no setState — pure side-effect cleanup)
  useEffect(() => {
    if (session?.isOpen) return;
    dismissTimersRef.current.forEach((t) => clearTimeout(t));
    dismissTimersRef.current.clear();
  }, [session?.isOpen]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = dismissTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const handleManualDismiss = (popupId: string) => {
    dismissPopup(popupId);
  };

  // ---------- Render ----------
  const marketOpen = session?.isOpen ?? false;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 sm:w-96">
      {/* Market-status indicator */}
      {session && (
        <div className="pointer-events-auto mb-1 flex items-center justify-between rounded-lg border border-purple-200 bg-white/85 px-3 py-1.5 shadow-md backdrop-blur">
          <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">
            <Bell className="h-3 w-3 text-purple-500" />
            {marketOpen ? 'MARKET OPEN · BREAKING ALERTS' : `MARKET ${session.phase.replace(/_/g, ' ')}`}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-purple-700">
            {session.istTime} IST
          </span>
        </div>
      )}

      {/* Popups */}
      {marketOpen &&
        popups.map((p) => {
          const cfg = SENTIMENT_CONFIG[p.sentiment];
          const content = (
            <div
              className={cn(
                'pointer-events-auto relative overflow-hidden rounded-lg border bg-white/95 p-3 shadow-xl backdrop-blur transition-all',
                cfg.border,
                p.dismissed ? 'news-pop-exit opacity-0' : 'news-pop-enter',
              )}
            >
              {/* Progress bar (counts down from 10s) */}
              {!p.dismissed && (
                <div className={cn('absolute bottom-0 left-0 h-0.5', cfg.dot)} style={{ animation: 'news-progress 10s linear forwards' }} />
              )}

              {/* Header */}
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot, 'live-pulse-soft')} />
                  <span className={cn('font-mono text-[9px] font-bold uppercase tracking-widest', cfg.color)}>
                    {p.sentiment}
                  </span>
                  {p.category && (
                    <span className="rounded border border-purple-200 bg-purple-50 px-1 font-mono text-[9px] tracking-wider text-purple-700">
                      {p.category.toUpperCase()}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleManualDismiss(p.popupId)}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-purple-50 hover:text-purple-700"
                  aria-label="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {/* Title */}
              <p className="text-xs leading-snug font-medium text-foreground/90">{p.title}</p>

              {/* Footer */}
              <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Newspaper className="h-2.5 w-2.5 text-purple-400" />
                  <span className="font-semibold">{p.source}</span>
                  <span className="text-purple-200">·</span>
                  <span>{formatRelativeTime(p.timestamp)}</span>
                </span>
                {p.link && (
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleManualDismiss(p.popupId)}
                    className="flex items-center gap-0.5 text-purple-600 transition-colors hover:text-purple-800"
                  >
                    OPEN <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          );
          return <div key={p.popupId}>{content}</div>;
        })}

      {/* No-alerts placeholder when market is open but no breaking news */}
      {marketOpen && popups.length === 0 && (
        <div className="pointer-events-none flex items-center gap-2 rounded-lg border border-purple-100 bg-white/60 px-3 py-2 text-muted-foreground backdrop-blur">
          <AlertTriangle className="h-3 w-3 text-purple-400" />
          <span className="font-mono text-[10px] tracking-wider">Watching for breaking news...</span>
        </div>
      )}
    </div>
  );
}
