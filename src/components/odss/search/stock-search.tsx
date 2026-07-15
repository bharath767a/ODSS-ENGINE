'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_SYMBOLS, type SymbolMeta } from '@/lib/odss/universe';

interface StockSearchProps {
  /** Called when the user picks a symbol from the dropdown. */
  onSelect: (symbol: string) => void;
  /** Optional className for the wrapper. */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function StockSearch({ onSelect, className }: StockSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter: 2+ chars triggers the dropdown
  const results = useMemo<SymbolMeta[]>(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    return ALL_SYMBOLS.filter((s) => {
      const sym = s.symbol.toUpperCase();
      const name = s.name.toUpperCase();
      return sym.includes(q) || name.includes(q);
    }).slice(0, 12);
  }, [query]);

  // Clamp active index so it never points past the last result
  const safeActiveIdx = results.length === 0 ? 0 : Math.min(activeIdx, results.length - 1);

  // Click-outside to close
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function handleSelect(meta: SymbolMeta) {
    onSelect(meta.symbol);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[safeActiveIdx];
      if (pick) handleSelect(pick);
    }
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex h-8 w-full max-w-xs items-center gap-1.5 rounded-md border bg-white/70 px-2 transition-colors',
          open
            ? 'border-purple-300 ring-2 ring-purple-100'
            : 'border-purple-100 hover:border-purple-200'
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-purple-500" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay close so click on item fires first
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search stock..."
          aria-label="Search stock"
          role="combobox"
          aria-expanded={open}
          aria-controls="stock-search-listbox"
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-purple-50 hover:text-purple-600"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <ul
          id="stock-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-9 z-50 max-h-72 overflow-y-auto rounded-md border border-purple-100 bg-white/95 shadow-lg backdrop-blur-md"
        >
          {results.map((m, i) => (
            <li
              key={m.symbol}
              role="option"
              aria-selected={i === safeActiveIdx}
              onMouseDown={(e) => {
                // prevent input blur before click
                e.preventDefault();
                handleSelect(m);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors',
                i === safeActiveIdx
                  ? 'bg-purple-50 text-purple-700'
                  : 'text-foreground hover:bg-purple-50/60'
              )}
            >
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="font-mono text-[11px] font-bold tracking-wide text-purple-700">
                  {m.symbol}
                </span>
                <span className="truncate font-sans text-[10px] text-muted-foreground">
                  {m.name}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    'rounded px-1 py-0.5 font-mono text-[8px] font-bold tracking-wider',
                    m.type === 'INDEX'
                      ? 'bg-violet-50 text-violet-600'
                      : 'bg-purple-50 text-purple-500'
                  )}
                >
                  {m.type}
                </span>
                <span className="font-mono text-[9px] tracking-wider text-muted-foreground">
                  {m.sector}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* No results hint */}
      {open && query.trim().length >= 2 && results.length === 0 && (
        <div className="absolute left-0 right-0 top-9 z-50 rounded-md border border-purple-100 bg-white/95 px-3 py-2 text-center font-mono text-[10px] text-muted-foreground shadow-lg backdrop-blur-md">
          No matching symbols for “{query.trim()}”
        </div>
      )}
    </div>
  );
}
