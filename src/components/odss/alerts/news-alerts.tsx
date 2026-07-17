'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Loader2,
  RefreshCw,
  Newspaper,
  ExternalLink,
  AlertTriangle,
  Radio,
} from 'lucide-react';

// ============================================================
// News Alerts — sidebar panel showing the latest news items
// ------------------------------------------------------------
// Fetches /api/odss/market-brief?type=pre every 60s and renders
// the latest 10 news items with title, source, sentiment badge,
// and a clickable external link.
//
// Used in:
//   - Dashboard tab (right sidebar)
//   - Opportunities tab (left column under the opportunity table)
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
  source: string;
}

const POLL_INTERVAL_MS = 60_000;

const SENTIMENT_CONFIG: Record<Sentiment, { color: string; dot: string; label: string }> = {
  POSITIVE: { color: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', label: 'POSITIVE' },
  NEGATIVE: { color: 'border-rose-200 bg-rose-50 text-rose-700', dot: 'bg-rose-500', label: 'NEGATIVE' },
  NEUTRAL: { color: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500', label: 'NEUTRAL' },
};

function formatRelativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-IN');
}

export function NewsAlerts() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch REAL news from the dedicated news API (Economic Times, Moneycontrol, etc.)
      const res = await fetch('/api/odss/news?type=all&limit=15', { cache: 'no-store' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setNews((data.news ?? []).slice(0, 10));
      setUpdatedAt(data.timestamp ?? Date.now());
      setSource(data.sources ? data.sources.join(', ') : 'Live RSS Feeds');
    } catch (e) {
      setError((e as Error).message || 'Failed to load news');
      setNews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const id = setInterval(fetchNews, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchNews]);

  return (
    <Card className="border-purple-100 bg-white/70 shadow-card-soft backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md border border-purple-200 bg-gradient-to-br from-purple-100 to-violet-50">
              <Newspaper className="h-3 w-3 text-purple-600" />
            </div>
            <div className="leading-tight">
              <h3 className="text-sm font-bold tracking-tight">
                <span className="text-gradient-ai">News Alerts</span>
              </h3>
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
                LATEST 10 · POLLS EVERY 60s
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchNews}
            disabled={loading}
            className="h-7 border-purple-200 bg-white/70 px-2 font-mono text-[10px] tracking-wider text-purple-700 hover:bg-purple-50 hover:text-purple-800"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-1">
        {/* Loading skeleton on first load */}
        {loading && news.length === 0 && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-purple-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground">LOADING NEWS...</p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
            <p className="text-xs font-bold text-rose-700">News unavailable</p>
            <p className="font-mono text-[9px] text-rose-600">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchNews} className="mt-1 h-7 border-rose-200 bg-white px-2 font-mono text-[10px] text-rose-700 hover:bg-rose-50">
              <RefreshCw className="mr-1 h-3 w-3" /> RETRY
            </Button>
          </div>
        )}

        {/* News list */}
        {!error && news.length > 0 && (
          <>
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
              {news.map((item) => {
                const cfg = SENTIMENT_CONFIG[item.sentiment];
                const content = (
                  <div className="group flex gap-2 rounded border border-purple-100 bg-white/70 px-2 py-1.5 transition-all hover:border-purple-300 hover:bg-purple-50/40">
                    <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', cfg.dot)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-snug text-foreground/90 group-hover:text-purple-800">
                        {item.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[9px] tracking-wider text-muted-foreground">
                        <span className="font-semibold">{item.source}</span>
                        {item.category && (
                          <>
                            <span className="text-purple-200">·</span>
                            <span className="text-purple-600">{item.category.toUpperCase()}</span>
                          </>
                        )}
                        <span className="text-purple-200">·</span>
                        <span>{formatRelativeTime(item.timestamp)}</span>
                        {item.link && (
                          <ExternalLink className="ml-auto h-2.5 w-2.5 text-purple-400 opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn('h-fit shrink-0 font-mono text-[9px]', cfg.color)}>
                      {item.sentiment}
                    </Badge>
                  </div>
                );

                if (item.link) {
                  return (
                    <a
                      key={item.id}
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {content}
                    </a>
                  );
                }
                return <div key={item.id}>{content}</div>;
              })}
            </div>

            {/* Footer */}
            <div className="mt-2 flex items-center justify-between border-t border-purple-100 pt-1.5 font-mono text-[9px] tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1">
                <Radio className="h-2.5 w-2.5 text-purple-500 live-pulse-soft" />
                LIVE FEED
              </span>
              <span>
                {updatedAt > 0 ? new Date(updatedAt).toLocaleTimeString('en-IN', { hour12: false }) : '—'}
                {source && <span className="ml-1 text-purple-200">·</span>}
                {source && <span className="ml-1 text-purple-600">{source}</span>}
              </span>
            </div>
          </>
        )}

        {/* Empty state */}
        {!error && !loading && news.length === 0 && (
          <div className="flex h-24 flex-col items-center justify-center gap-1 text-center">
            <Newspaper className="h-5 w-5 text-purple-300" />
            <p className="font-mono text-[10px] tracking-wider text-muted-foreground">NO NEWS ITEMS</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
