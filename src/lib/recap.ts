/**
 * Per-device marker of the last month whose recap was opened or whose ledger card was dismissed,
 * kept in localStorage by user id like the Money Manager prompt. The ledger card for a month shows
 * only while the stored month is older than it.
 */
import type { MonthKey } from "../../shared/period";

const key = (userId: string) => `unmoney.recap.${userId}`;

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
