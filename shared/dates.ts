/** Calendar-date helpers. Every date is a "YYYY-MM-DD" string; math is done in UTC so DST never bites. */

export type ISODate = string;

export function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function toISO(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function parts(s: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

export function make(y: number, m: number, d: number): ISODate {
  return toISO(new Date(Date.UTC(y, m - 1, d)));
}

export function todayISO(): ISODate {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** Add months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(s: ISODate, n: number): ISODate {
  const { y, m, d } = parts(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return make(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(s: ISODate, n: number): ISODate {
  const { y, m, d } = parts(s);
  return make(y + n, m, Math.min(d, daysInMonth(y + n, m)));
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(s: ISODate): number {
  return fromISO(s).getUTCDay();
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clampDay(y: number, m: number, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(y, m));
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
