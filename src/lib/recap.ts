/**
 * Per-device markers of the last month and the last year whose recap was opened or whose ledger
 * card was dismissed, kept in localStorage by user id like the Money Manager prompt. The ledger
 * card for a month (or year) shows only while the stored one is older than it.
 */
import type { MonthKey } from "../../shared/period";

const key = (userId: string) => `unmoney.recap.${userId}`;
const yearKey = (userId: string) => `unmoney.recapYear.${userId}`;
const aiKey = (userId: string) => `unmoney.recapAi.${userId}`;

/**
 * Whether a recap that has just finished gets its AI insights when it is opened, without asking
 * again. On from the first "Get insights" on this device (the sheet says so), off again in
 * Preferences. Per device like the markers below: each device asks once.
 */
export function recapAiAuto(userId: string | null): boolean {
  try {
    return !!userId && localStorage.getItem(aiKey(userId)) === "on";
  } catch {
    return false;
  }
}

export function setRecapAiAuto(userId: string, on: boolean) {
  try {
    localStorage.setItem(aiKey(userId), on ? "on" : "off");
  } catch {
    // private mode: the recap asks again next time
  }
}

export function recapSeenMonth(userId: string): MonthKey | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

/** Remembers `month` as seen; an older month never replaces a newer one (opening June's recap in October keeps September's card away). */
export function markRecapSeen(userId: string, month: MonthKey) {
  try {
    const was = localStorage.getItem(key(userId));
    if (was && was >= month) return;
    localStorage.setItem(key(userId), month);
  } catch {
    // private mode: the card may show again next time
  }
}

/** Whether the ledger card for `month` should still show on this device. */
export function recapUnseen(userId: string | null, month: MonthKey): boolean {
  if (!userId) return false;
  const seen = recapSeenMonth(userId);
  return !seen || seen < month;
}

export function recapSeenYear(userId: string): number | null {
  try {
    const v = localStorage.getItem(yearKey(userId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/** Remembers `year` as seen; an older year never replaces a newer one. */
export function markRecapYearSeen(userId: string, year: number) {
  try {
    const was = recapSeenYear(userId);
    if (was !== null && was >= year) return;
    localStorage.setItem(yearKey(userId), String(year));
  } catch {
    // private mode: the card may show again next time
  }
}

/** Whether the ledger card for `year` should still show on this device. */
export function recapYearUnseen(userId: string | null, year: number): boolean {
  if (!userId) return false;
  const seen = recapSeenYear(userId);
  return seen === null || seen < year;
}
