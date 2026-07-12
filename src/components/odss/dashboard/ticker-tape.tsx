'use client';

import { useODSS } from '@/hooks/use-odss';
import { Sparkline } from './sparkline';
import { cn } from '@/lib/utils';

interface TickerItem {
  symbol: string;
  price?: number;
  changePct?: number;
  vwap?: number;
  priority: number; // lower = earlier
}

/**
 * Live ticker tape — Bloomberg/Reuters style horizontal scrolling feed of
 * indices + top stocks with price, change% and an inline sparkline.
 *
 * Data comes from the useODSS hook (liveQuotes, nifty, bankNifty). Items are
 * duplicated so the scroll loop is seamless.
 */
export function TickerTape() {
  const { nifty, bankNifty, liveQuotes } = useODSS();

  // Build a deterministic, ordered ticker list.
  // Indices first (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY), then top stocks
  // ranked by absolute change% so the most active names surface to the right.
  const items: TickerItem[] = [];

  const indexOrder = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
  for (const sym of indexOrder) {
    if (sym === 'NIFTY' && nifty) {
      items.push({
        symbol: 'NIFTY 50',
        price: nifty.ltp,
        changePct: nifty.changePct,
        vwap: nifty.vwap,
        priority: 0,
      });
    } else if (sym === 'BANKNIFTY' && bankNifty) {
      items.push({
        symbol: 'BANKNIFTY',
        price: bankNifty.ltp,
        changePct: bankNifty.changePct,
        vwap: bankNifty.vwap,
        priority: 1,
      });
    } else if (liveQuotes[sym]) {
      const q = liveQuotes[sym];
      items.push({
        symbol: sym,
        price: q.ltp,
        changePct: q.changePct,
        vwap: q.vwap,
        priority: indexOrder.indexOf(sym),
      });
    }
  }

  // Top stocks sorted by absolute changePct (most active) — keep only stocks
  const stockItems: TickerItem[] = Object.entries(liveQuotes)
    .filter(([sym]) => !indexOrder.includes(sym))
    .map(([sym, q]) => ({
      symbol: sym,
      price: q.ltp,
      changePct: q.changePct,
      vwap: q.vwap,
      priority: 100,
    }))
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, 12);

  items.push(...stockItems);

  // If nothing yet, show a placeholder line so the tape still scrolls
  if (items.length === 0) {
    return (
      <div className="relative z-20 border-y border-border/60 bg-[#0c1118]/80 backdrop-blur-sm">
        <div className="overflow-hidden">
          <div className="whitespace-nowrap px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
            Awaiting market data…
          </div>
        </div>
      </div>
    );
  }

  // Duplicate items for seamless scroll
  const loopItems = [...items, ...items];

  return (
    <div className="ticker-track relative z-20 overflow-hidden border-y border-border/60 bg-[#0c1118]/80 backdrop-blur-sm">
      {/* Edge fades for visual polish */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-[#0c1118] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-[#0c1118] to-transparent" />

      <div className="flex w-max animate-ticker items-center">
        {loopItems.map((item, i) => {
          const positive = (item.changePct ?? 0) >= 0;
          const isIndex = item.priority < 100;
          return (
            <div
              key={`${item.symbol}-${i}`}
              className={cn(
                'flex items-center gap-2 border-r border-border/40 px-4 py-1.5 font-mono text-[11px] tnum',
                isIndex && 'bg-[#0e131a]/60'
              )}
            >
              <span
                className={cn(
                  'font-semibold tracking-wide',
                  isIndex ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {item.symbol}
              </span>
              {item.price !== undefined && (
                <span className="text-foreground/90">
                  {item.price.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
              {item.changePct !== undefined && (
                <span
                  className={cn(
                    'font-medium',
                    positive ? 'text-bull text-glow-bull' : 'text-bear text-glow-bear'
                  )}
                >
                  {positive ? '▲' : '▼'} {Math.abs(item.changePct).toFixed(2)}%
                </span>
              )}
              {item.price !== undefined && (
                <Sparkline price={item.price} width={48} height={14} className="opacity-80" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
