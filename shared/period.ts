import {
  type ISODate, addDays, addMonths, clampDay, compareISO, daysInMonth, make, parts, weekday,
} from "./dates";

export type Range = { from: ISODate; to: ISODate };

/** Key of a logical month, e.g. "2026-07". With monthStartDay 25, "2026-07" spans Jul 25 to Aug 24. */
export type MonthKey = string;

export function monthKey(y: number, m: number): MonthKey {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function parseMonthKey(k: MonthKey): { y: number; m: number } {
  const [y, m] = k.split("-").map(Number);
  return { y, m };
}

export function shiftMonthKey(k: MonthKey, n: number): MonthKey {
  const { y, m } = parseMonthKey(k);
  const total = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(total / 12), (total % 12) + 1);
}

/** The date range of a logical month given the user's month start day (1-28). */
export function monthRange(k: MonthKey, monthStartDay: number): Range {
  const { y, m } = parseMonthKey(k);
  const startDay = clampDay(y, m, monthStartDay);
  const from = make(y, m, startDay);
  if (monthStartDay <= 1) {
    return { from, to: make(y, m, daysInMonth(y, m)) };
  }
  const next = addMonths(make(y, m, 1), 1);
  const { y: ny, m: nm } = parts(next);
  const nextStart = make(ny, nm, clampDay(ny, nm, monthStartDay));
  return { from, to: addDays(nextStart, -1) };
}

/** Which logical month a calendar date belongs to. */
export function monthKeyForDate(date: ISODate, monthStartDay: number): MonthKey {
  const { y, m, d } = parts(date);
  if (monthStartDay <= 1 || d >= clampDay(y, m, monthStartDay)) return monthKey(y, m);
  const prev = addMonths(make(y, m, 1), -1);
  const p = parts(prev);
  return monthKey(p.y, p.m);
}

/** A logical year is 12 logical months starting at month 1. */
export function yearRange(y: number, monthStartDay: number): Range {
  return { from: monthRange(monthKey(y, 1), monthStartDay).from, to: monthRange(monthKey(y, 12), monthStartDay).to };
}

/** The week containing `date`, starting on weekStartDay (0 = Sunday). */
export function weekRange(date: ISODate, weekStartDay: number): Range {
  const wd = weekday(date);
  const back = (wd - weekStartDay + 7) % 7;
  const from = addDays(date, -back);
  return { from, to: addDays(from, 6) };
}

/** Weeks that intersect a range, each clipped to the range. */
export function weeksInRange(range: Range, weekStartDay: number): Range[] {
  const out: Range[] = [];
  let cursor = weekRange(range.from, weekStartDay).from;
  while (compareISO(cursor, range.to) <= 0) {
    const w = { from: cursor, to: addDays(cursor, 6) };
    out.push({
      from: compareISO(w.from, range.from) < 0 ? range.from : w.from,
      to: compareISO(w.to, range.to) > 0 ? range.to : w.to,
    });
    cursor = addDays(cursor, 7);
  }
  return out;
}

export function inRange(date: ISODate, r: Range): boolean {
  return date >= r.from && date <= r.to;
}

/** Budget period key for a date. */
export function periodKey(
  period: "weekly" | "monthly" | "yearly",
  date: ISODate,
  monthStartDay: number,
  weekStartDay: number,
): string {
  if (period === "monthly") return monthKeyForDate(date, monthStartDay);
  if (period === "weekly") return weekRange(date, weekStartDay).from;
  return String(parts(monthKeyForDate(date, monthStartDay) + "-01").y);
}

export function periodRange(
  period: "weekly" | "monthly" | "yearly",
  key: string,
  monthStartDay: number,
  weekStartDay: number,
): Range {
  if (period === "monthly") return monthRange(key, monthStartDay);
  if (period === "weekly") return weekRange(key, weekStartDay);
  return yearRange(Number(key), monthStartDay);
}

/** Fraction of a range elapsed as of `today` (0..1), used for the budget "today" marker. */
export function elapsedFraction(r: Range, today: ISODate): number {
  const total = Math.max(1, (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86400000 + 1);
  const done = Math.min(total, Math.max(0, (new Date(today).getTime() - new Date(r.from).getTime()) / 86400000 + 1));
  return done / total;
}

/** Whether any of `dates` (sorted ascending, no duplicates needed) falls inside `r`. Binary search. */
export function rangeHasDate(dates: ISODate[], r: Range): boolean {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < r.from) lo = mid + 1; else hi = mid;
  }
  return lo < dates.length && dates[lo] <= r.to;
}

/**
 * The nearest period before (`dir` -1) or after (`dir` 1) `key` that holds one of `dates` or `today`,
 * so the arrows skip empty months and stop at the first and last ones with anything in them.
 * Undefined when there is no such period, so the arrow can be disabled.
 */
export function neighbourPeriod(
  key: string,
  dir: 1 | -1,
  dates: ISODate[],
  today: ISODate,
  rangeOf: (k: string) => Range,
  shift: (k: string, n: number) => string,
): string | undefined {
  const first = dates.length ? (dates[0] < today ? dates[0] : today) : today;
  const last = dates.length ? (dates[dates.length - 1] > today ? dates[dates.length - 1] : today) : today;
  let k = key;
  for (let i = 0; i < 10000; i++) {
    k = shift(k, dir);
    const r = rangeOf(k);
    if (dir > 0 ? r.from > last : r.to < first) return undefined;
    if (inRange(today, r) || rangeHasDate(dates, r)) return k;
  }
  return undefined;
}
