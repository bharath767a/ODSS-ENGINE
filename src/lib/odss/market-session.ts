/**
 * ODSS — Market Session Utility
 * Determines whether NSE is currently open.
 * Used to FREEZE the engine when market is closed.
 */

export type MarketPhase = 'PRE_OPEN' | 'OPEN' | 'POST_CLOSE' | 'CLOSED';

export interface MarketSession {
  isOpen: boolean;
  isPreOpen: boolean;
  isPostClose: boolean;
  phase: MarketPhase;
  istTime: string;
  istDate: string;
  weekday: string;
  nextChange: number;
  nextPhase: string;
  sessionStart: number;
  sessionEnd: number;
  timestamp: number;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTParts(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    weekday: ist.getUTCDay(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    seconds: ist.getUTCSeconds(),
  };
}

function istEpoch(year: number, month: number, day: number, hours: number, minutes: number): number {
  const utc = Date.UTC(year, month, day, hours, minutes, 0);
  return utc - IST_OFFSET_MS;
}

export function getMarketSession(now: Date = new Date()): MarketSession {
  const p = getISTParts(now);
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekday = weekdayNames[p.weekday];
  const sessionStart = istEpoch(p.year, p.month, p.day, 9, 15);
  const sessionEnd = istEpoch(p.year, p.month, p.day, 15, 30);
  const preOpenStart = istEpoch(p.year, p.month, p.day, 9, 0);
  const postCloseEnd = istEpoch(p.year, p.month, p.day, 16, 0);
  const isWeekday = p.weekday >= 1 && p.weekday <= 5;
  const nowMs = now.getTime();
  let phase: MarketPhase;
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
    phase = 'CLOSED';
    nextChange = preOpenStart - nowMs;
    nextPhase = 'Pre-open';
  } else {
    phase = 'CLOSED';
    const nextDayOffset = p.weekday === 5 ? 3 : 1;
    const nextPre = istEpoch(p.year, p.month, p.day + nextDayOffset, 9, 0);
    nextChange = nextPre - nowMs;
    nextPhase = 'Next session pre-open';
  }

  const pad = (n: number) => n.toString().padStart(2, '0');
  const istTime = `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
  const istDate = `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
  return {
    isOpen, isPreOpen, isPostClose, phase, istTime, istDate, weekday,
    nextChange, nextPhase, sessionStart, sessionEnd, timestamp: nowMs,
  };
}

export function shouldEngineBeActive(now: Date = new Date()): boolean {
  const session = getMarketSession(now);
  return session.isOpen || session.isPreOpen || session.isPostClose;
}

export function shouldPollRealData(now: Date = new Date()): boolean {
  const session = getMarketSession(now);
  if (session.isOpen || session.isPreOpen || session.isPostClose) return true;
  const p = getISTParts(now);
  const preOpenStart = istEpoch(p.year, p.month, p.day, 9, 0);
  const postCloseEnd = istEpoch(p.year, p.month, p.day, 16, 0);
  const nowMs = now.getTime();
  if (p.weekday >= 1 && p.weekday <= 5) {
    if (nowMs >= preOpenStart - 30 * 60 * 1000 && nowMs < preOpenStart) return true;
    if (nowMs >= postCloseEnd && nowMs < postCloseEnd + 30 * 60 * 1000) return true;
  }
  return false;
}
