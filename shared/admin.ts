/**
 * The superadmin dashboard (/admin, src/pages/admin) and the usage counts behind it (convex/usage.ts,
 * convex/admin.ts). Only this address can open the page or call its functions; for everyone else the
 * page's code is never downloaded.
 */
export const SUPERADMIN_EMAIL = "vik.bhat223@gmail.com";

export const isSuperadmin = (email: string | null | undefined) => !!email && email.toLowerCase() === SUPERADMIN_EMAIL;

/**
 * A screen's name for the usage counts: its path with ids and other values taken out, so every entry
 * counts as "t/:id" and the counts stay a short list. "/" is the ledger.
 */
export function screenKey(pathname: string): string {
  // no screen's own name has a digit: Convex ids, tmp ids, period keys like 2026-10 all do
  const parts = pathname.split("/").filter(Boolean).map((p) => (/\d/.test(p) ? ":id" : p));
  return parts.length ? parts.join("/").slice(0, 60) : "ledger";
}

/** Session length buckets, by time the app was on screen. Labels are what the dashboard shows. */
export const LENGTH_BUCKETS = [
  { key: "lt10s", label: "< 10s", upTo: 10_000 },
  { key: "lt30s", label: "10–30s", upTo: 30_000 },
  { key: "lt1m", label: "30s–1m", upTo: 60_000 },
  { key: "lt3m", label: "1–3m", upTo: 180_000 },
  { key: "lt10m", label: "3–10m", upTo: 600_000 },
  { key: "lt30m", label: "10–30m", upTo: 1_800_000 },
  { key: "gte30m", label: "30m+", upTo: Infinity },
] as const;

export function lengthBucket(activeMs: number): string {
  return LENGTH_BUCKETS.find((b) => activeMs < b.upTo)!.key;
}

/** YYYY-MM-DD of an instant, at a UTC offset in minutes (east positive). */
export function dayAt(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);
}

/** The hour 0–23 of an instant, at a UTC offset in minutes. */
export function hourAt(ms: number, offsetMin: number): number {
  return new Date(ms + offsetMin * 60_000).getUTCHours();
}
