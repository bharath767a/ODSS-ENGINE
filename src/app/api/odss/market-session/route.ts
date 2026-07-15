import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// GET /api/odss/market-session
// ============================================================
// Returns the current NSE market session status.
//
// NSE equity / F&O cash segment hours:
//   Pre-open:        09:00 - 09:15 IST
//   Normal market:   09:15 - 15:30 IST (Monday-Friday)
//   Post-close:      15:30 - 16:00 IST
//   Settlement/trading holidays excluded (no holiday calendar — best-effort)
//
// All times are computed in IST (UTC+5:30) regardless of server TZ.
// ============================================================

interface MarketSessionResponse {
  isOpen: boolean;
  isPreOpen: boolean;
  isPostClose: boolean;
  phase: 'PRE_OPEN' | 'OPEN' | 'POST_CLOSE' | 'CLOSED';
  istTime: string; // HH:MM:SS
  istDate: string; // YYYY-MM-DD
  weekday: string;
  nextChange: number; // ms until next phase change (approx)
  nextPhase: string;
  sessionStart: number; // epoch ms of today's 09:15 IST
  sessionEnd: number; // epoch ms of today's 15:30 IST
  timestamp: number;
}

function getISTParts(now: Date) {
  // IST = UTC+5:30
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffsetMs);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    weekday: ist.getUTCDay(), // 0 Sun .. 6 Sat
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    seconds: ist.getUTCSeconds(),
  };
}

function istTimeStr(now: Date): string {
  const p = getISTParts(now);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
}

function istDateStr(now: Date): string {
  const p = getISTParts(now);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

// Build an epoch ms timestamp for a given IST Y-M-D H:M (treating it as IST).
function istEpoch(year: number, month: number, day: number, hours: number, minutes: number): number {
  const utc = Date.UTC(year, month, day, hours, minutes, 0);
  // The Date.UTC call interprets these as UTC; we want them as IST.
  // IST = UTC + 5:30 → IST noon = UTC 06:30.
  // So to convert an IST wall-clock to epoch, subtract 5:30 from the UTC-interpretation.
  return utc - 5.5 * 60 * 60 * 1000;
}

export async function GET() {
  const now = new Date();
  const p = getISTParts(now);

  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekday = weekdayNames[p.weekday];

  const sessionStart = istEpoch(p.year, p.month, p.day, 9, 15);
  const sessionEnd = istEpoch(p.year, p.month, p.day, 15, 30);
  const preOpenStart = istEpoch(p.year, p.month, p.day, 9, 0);
  const postCloseEnd = istEpoch(p.year, p.month, p.day, 16, 0);

  const isWeekday = p.weekday >= 1 && p.weekday <= 5;
  const nowMs = now.getTime();

  let phase: 'PRE_OPEN' | 'OPEN' | 'POST_CLOSE' | 'CLOSED';
  let isOpen = false;
  let isPreOpen = false;
  let isPostClose = false;
  let nextChange: number;
  let nextPhase: string;

  if (!isWeekday) {
    phase = 'CLOSED';
    nextChange = 0;
    nextPhase = 'Weekend — markets closed';
  } else if (nowMs >= preOpenStart && nowMs < sessionStart) {
    phase = 'PRE_OPEN';
    isPreOpen = true;
    nextChange = sessionStart - nowMs;
    nextPhase = 'Market open';
  } else if (nowMs >= sessionStart && nowMs < sessionEnd) {
    phase = 'OPEN';
    isOpen = true;
    nextChange = sessionEnd - nowMs;
    nextPhase = 'Market close';
  } else if (nowMs >= sessionEnd && nowMs < postCloseEnd) {
    phase = 'POST_CLOSE';
    isPostClose = true;
    nextChange = postCloseEnd - nowMs;
    nextPhase = 'Post-close ends';
  } else if (nowMs < preOpenStart) {
    // Before pre-open on a weekday
    phase = 'CLOSED';
    nextChange = preOpenStart - nowMs;
    nextPhase = 'Pre-open';
  } else {
    // After post-close on a weekday
    phase = 'CLOSED';
    // Next event is tomorrow's pre-open (or Monday's if Friday)
    const nextDayOffset = p.weekday === 5 ? 3 : 1;
    const nextPre = istEpoch(p.year, p.month, p.day + nextDayOffset, 9, 0);
    nextChange = nextPre - nowMs;
    nextPhase = 'Next session pre-open';
  }

  const response: MarketSessionResponse = {
    isOpen,
    isPreOpen,
    isPostClose,
    phase,
    istTime: istTimeStr(now),
    istDate: istDateStr(now),
    weekday,
    nextChange,
    nextPhase,
    sessionStart,
    sessionEnd,
    timestamp: nowMs,
  };

  return NextResponse.json(response);
}
