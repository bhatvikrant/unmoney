/**
 * Reading back to a year the user picks ("since 2023"): the mailbox from 1 January of that year up
 * to the moment they chose it, a slice at a time, on the server (convex/gmail.ts backfillStep).
 * Pure, so the server and the settings page agree on what is allowed and how long it takes.
 */

/** Gmail opened in 2004: no mailbox holds older mail. */
export const FIRST_YEAR = 2004;
/** The most a count lists before saying "20,000+": 40 list calls, 200 of Gmail's quota units. */
export const COUNT_MAX = 20_000;
/**
 * AI reads per month a backfill leaves alone, so new mail can still be read by AI while (and after)
 * years of old mail use up the rest.
 */
export const BACKFILL_AI_RESERVE = 60;
/** A slice of the backfill spans this many days at first; it doubles while slices come back light and halves when one is too full. */
export const START_SPAN_DAYS = 30;
export const MAX_SPAN_DAYS = 365;
/**
 * About how long one mail takes, end to end: fetched at Gmail's pace (10 a second), read by AI for
 * some (10 a call, a call every 10-20 s), and the pauses between slices. Only until a backfill has
 * read enough to measure its own pace.
 */
export const MS_PER_MAIL = 450;
/** Mails a backfill reads before its own pace replaces MS_PER_MAIL. */
const MEASURE_AFTER = 50;
/** About this share of money mail no rule reads, so it goes to AI (each call reads AI_BATCH of them). */
const AI_SHARE = 0.2;

const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;

/** Why a typed year can't be used, or null when it can. */
export function yearProblem(year: number, now: number): string | null {
  if (!Number.isInteger(year)) return "Enter a year like 2023";
  const thisYear = new Date(now).getFullYear();
  if (year > thisYear) return "That year hasn't happened yet";
  if (year < FIRST_YEAR) return `Gmail started in ${FIRST_YEAR}; pick ${FIRST_YEAR} or later`;
  return null;
}

/**
 * Whether `fromMs` is the start of 1 January `year` in some time zone (the device's, which the
 * server doesn't know): within the 14 hours either side of midnight UTC that zones reach.
 */
export function isYearStart(year: number, fromMs: number): boolean {
  const utc = Date.UTC(year, 0, 1);
  return Number.isFinite(fromMs) && fromMs >= utc - MAX_OFFSET_MS && fromMs <= utc + MAX_OFFSET_MS;
}

/** Midnight on 1 January `year` on this device. */
export const yearStart = (year: number) => new Date(year, 0, 1).getTime();

/** The next slice's span: double while a slice had room to spare, halve when it held more than one check reads. */
export function nextSpanDays(spanDays: number, unread: number, perCheck: number): number {
  if (unread > perCheck) return Math.max(1, Math.floor(spanDays / 2));
  if (unread < perCheck / 2) return Math.min(MAX_SPAN_DAYS, spanDays * 2);
  return spanDays;
}

/** How long reading `mails` takes, before there is anything to measure. */
export const estimateMs = (mails: number) => mails * MS_PER_MAIL;

/** Mails that will likely go to AI, and whether that is more than the AI reads this month leave. */
export function aiShortfall(mails: number, aiLeft: number, batch: number): boolean {
  return Math.ceil((mails * AI_SHARE) / batch) > Math.max(0, aiLeft);
}

type Progress = { total?: number | null; read: number; startedAt: number; from: number; cursor: number };

/** Whether the count stopped at COUNT_MAX, so there is more mail than it says. */
export const countCapped = (total: number | null | undefined) => (total ?? 0) >= COUNT_MAX;

/**
 * How far along a backfill is, 0 to 1: by mails read against the count, or by the time it has
 * covered when there was more mail than the count goes to.
 */
export function progressOf(b: Progress): number {
  if (countCapped(b.total)) return Math.min(1, Math.max(0, (b.startedAt - b.cursor) / Math.max(1, b.startedAt - b.from)));
  if (!b.total) return b.total === 0 ? 1 : 0;
  return Math.min(1, b.read / b.total);
}

/**
 * Time left for a running backfill: its own pace once it has read enough mail, the estimate until
 * then. Null while it is still counting.
 */
export function remainingMs(b: Progress, now: number): number | null {
  if (b.total === undefined || b.total === null) return null;
  if (countCapped(b.total)) {
    const done = progressOf(b);
    // too early to tell how dense the rest is: the count's worth at the usual pace
    return done < 0.05 ? estimateMs(Math.max(0, b.total - b.read)) : Math.round(((now - b.startedAt) / done) * (1 - done));
  }
  const left = Math.max(0, b.total - b.read);
  if (b.read < MEASURE_AFTER) return estimateMs(left);
  return Math.round(((now - b.startedAt) / b.read) * left);
}

/** "under a minute", "about 5 minutes", "about 1 hour 20 minutes", "about 6 hours". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "under a minute";
  if (min < 60) {
    // round to 5 above 10 minutes: the estimate isn't that precise
    const m = min > 10 ? Math.round(min / 5) * 5 : min;
    return `about ${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  const h = Math.floor(min / 60);
  const rest = Math.round((min % 60) / 10) * 10;
  if (h >= 4 || rest === 0) return `about ${Math.round(min / 60)} ${Math.round(min / 60) === 1 ? "hour" : "hours"}`;
  if (rest === 60) return `about ${h + 1} hours`;
  return `about ${h} ${h === 1 ? "hour" : "hours"} ${rest} minutes`;
}

/** The first day of the month after `now`, when the monthly AI reads start again. */
export function nextMonthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
