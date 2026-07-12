'use client';

import { useEffect, useRef, useState } from 'react';

const HISTORY_LENGTH = 24;

/**
 * Tiny inline SVG sparkline that tracks the recent price movement of a symbol.
 * Renders green when price has moved up over the window, red when down.
 *
 * Price history is tracked client-side using a ref-guarded state update so
 * the sparkline grows organically as the simulator ticks.
 */
export function Sparkline({
  price,
  width = 60,
  height = 20,
  color,
  strokeWidth = 1.75,
  className,
}: {
  price?: number;
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}) {
  const [history, setHistory] = useState<number[]>([]);
  const lastPriceRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    if (price === undefined || price === null) return;
    // Throttle to ~1 update per 250ms to avoid spamming state on every tick
    const now = Date.now();
    if (now - lastTsRef.current < 200) return;
    if (price === lastPriceRef.current) return;
    lastPriceRef.current = price;
    lastTsRef.current = now;
    // Defer setState via microtask so the effect doesn't cascade synchronously
    Promise.resolve().then(() => {
      setHistory((h) => {
        const next = [...h, price];
        if (next.length > HISTORY_LENGTH) next.shift();
        return next;
      });
    });
  }, [price]);

  if (history.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#1c2330"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const padY = 2;
  const usableH = height - padY * 2;

  const points = history
    .map((p, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = padY + usableH - ((p - min) / range) * usableH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const up = history[history.length - 1] >= history[0];
  const stroke = color ?? (up ? '#34d399' : '#fb7185');

  // Build a smooth-ish area fill from the line
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-fill-${up ? 'u' : 'd'}`} x1="0" y1="0" x2="0" y2="1">
          {up ? (
            <>
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#fb7185" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
            </>
          )}
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#spark-fill-${up ? 'u' : 'd'})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
