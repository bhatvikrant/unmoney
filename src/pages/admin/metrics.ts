/**
 * The superadmin dashboard's numbers, worked out from what admin.overview returns: filtering by user
 * and device, daily series, the hour-of-week grid, sign-up cohorts, streaks. Pure, so it is tested
 * on its own (metrics.test.ts).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";

export type Overview = FunctionReturnType<typeof api.admin.overview>;
export type User = Overview["users"][number];
export type Device = Overview["devices"][number];
export type Daily = Overview["daily"][number];
export type Stats = Overview["stats"][number];
export type Ai = Overview["ai"][number];

export type Filters = {
  /** The period, in days ending today. */
  days: number;
  userId: string;
  os: string;
  mode: "all" | "installed" | "browser";
  /** Count the superadmin's own use too. */
  includeMe: boolean;
};

export const ALL = "all";

// ---- days ----

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

const deviceKey = (userId: string, deviceId: string) => `${userId}|${deviceId}`;

// ---- filtering ----

export type View = {
  users: User[];
  devices: Device[];
  daily: Daily[];
  stats: Stats[];
  /** Claude calls: like storage, they follow the users, not their devices. */
  ai: Ai[];
};

/** What the filters leave. Device filters (OS, installed) narrow usage; storage and features follow the users. */
export function applyFilters(o: Overview, f: Filters, meId: string | null): View {
  const users = o.users.filter((u) => (f.includeMe || u.id !== meId) && (f.userId === ALL || u.id === f.userId));
  const ids = new Set<string>(users.map((u) => u.id));
  const devices = o.devices.filter((d) => ids.has(d.userId)
    && (f.os === ALL || d.os === f.os)
    && (f.mode === "all" || (f.mode === "installed") === d.standalone));
  const keys = new Set(devices.map((d) => deviceKey(d.userId, d.deviceId)));
  const daily = o.daily.filter((r) => keys.has(deviceKey(r.userId, r.deviceId)));
  // with a device filter on, only users who have such a device
  const deviceFiltered = f.os !== ALL || f.mode !== "all";
  const withDevice = new Set(devices.map((d) => d.userId));
  const shown = deviceFiltered ? users.filter((u) => withDevice.has(u.id)) : users;
  const shownIds = new Set<string>(shown.map((u) => u.id));
  return { users: shown, devices, daily, stats: o.stats.filter((s) => shownIds.has(s.userId)), ai: o.ai.filter((r) => shownIds.has(r.userId)) };
}

// ---- series ----

export type DayPoint = {
  day: string; activeUsers: number; opens: number; activeMin: number;
  bytesDown: number; bytesUp: number; photoFetches: number; opsSent: number;
  entries: number; signups: number;
};

/** One point per day from `from` to `to`, zeros where nothing happened. `joinedDay` turns a sign-up instant into a local day. */
export function daySeries(v: View, from: string, to: string, joinedDay: (ms: number) => string = (ms) => dayKey(new Date(ms))): DayPoint[] {
  const by = new Map<string, DayPoint & { who: Set<string> }>();
  for (const day of daysBetween(from, to)) by.set(day, { day, activeUsers: 0, opens: 0, activeMin: 0, bytesDown: 0, bytesUp: 0, photoFetches: 0, opsSent: 0, entries: 0, signups: 0, who: new Set() });
  for (const r of v.daily) {
    const p = by.get(r.day);
    if (!p) continue;
    p.who.add(r.userId);
    p.opens += r.opens;
    p.activeMin += r.activeMs / 60_000;
    p.bytesDown += r.bytesDown;
    p.bytesUp += r.bytesUp;
    p.photoFetches += r.photoFetches;
    p.opsSent += r.opsSent;
  }
  for (const s of v.stats) for (const [day, n] of Object.entries(s.createdByDay)) { const p = by.get(day); if (p) p.entries += n; }
  for (const u of v.users) { const p = by.get(joinedDay(u.joinedAt)); if (p) p.signups += 1; }
  return [...by.values()].map(({ who, ...p }) => ({ ...p, activeUsers: who.size, activeMin: Math.round(p.activeMin * 10) / 10 }));
}

export function inRange(daily: Daily[], from: string, to: string): Daily[] {
  return daily.filter((r) => r.day >= from && r.day <= to);
}

/** Sums of a period: totals and how many distinct users and days were active. */
export function totals(daily: Daily[]) {
  const users = new Set<string>();
  const t = { opens: 0, activeMs: 0, bytesDown: 0, bytesUp: 0, photoFetches: 0, opsSent: 0 };
  const userDays = new Set<string>();
  for (const r of daily) {
    users.add(r.userId);
    userDays.add(`${r.userId}|${r.day}`);
    t.opens += r.opens;
    t.activeMs += r.activeMs;
    t.bytesDown += r.bytesDown;
    t.bytesUp += r.bytesUp;
    t.photoFetches += r.photoFetches;
    t.opsSent += r.opsSent;
  }
  return { ...t, activeUsers: users.size, userDays: userDays.size };
}

/** What Claude cost over some rows of aiDaily: in all, per feature, and how many users it was for. */
export function aiTotals(rows: Ai[]) {
  const t = { costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0, tidy: 0, gmail: 0 };
  const users = new Set<string>();
  for (const r of rows) {
    users.add(r.userId);
    t.costUsd += r.costUsd;
    t.calls += r.calls;
    t.inputTokens += r.inputTokens + r.cacheWriteTokens + r.cacheReadTokens;
    t.outputTokens += r.outputTokens;
    t[r.feature] += r.costUsd;
  }
  return { ...t, users: users.size };
}

/** Claude's cost per day from `from` to `to`, split by feature; zeros where nothing was asked. */
export function aiSeries(rows: Ai[], from: string, to: string): { day: string; tidy: number; gmail: number }[] {
  const by = new Map(daysBetween(from, to).map((day) => [day, { day, tidy: 0, gmail: 0 }]));
  for (const r of rows) { const p = by.get(r.day); if (p) p[r.feature] += r.costUsd; }
  return [...by.values()];
}

/** Photo downloads in bytes, estimated: fetches times the user's average stored photo. */
export function photoBytes(daily: Daily[], stats: Stats[]): number {
  const avg = new Map(stats.map((s) => [s.userId as string, s.files.count ? s.files.bytes / s.files.count : 0]));
  return daily.reduce((sum, r) => sum + r.photoFetches * (avg.get(r.userId) ?? 0), 0);
}

/** Sums of a record field across rows ("screens", "lengths", "hours"). */
export function sumRecords(rows: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) for (const [k, n] of Object.entries(r)) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** Opens by weekday (Monday first) and local hour. */
export function hourOfWeek(daily: Daily[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of daily) {
    const w = weekdayOf(r.day);
    for (const [h, n] of Object.entries(r.hours)) grid[w][Number(h.slice(1))] += n;
  }
  return grid;
}

/** How many of a list have each value, most first. */
export function tally<T>(items: T[], key: (t: T) => string | null | undefined): { label: string; value: number }[] {
  const m = new Map<string, number>();
  for (const it of items) { const k = key(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// ---- per user ----

export type UserRow = User & {
  /** The latest of the app's last usage report and the last change it saved. */
  lastSeenAt: number | null;
  /** When the app last reported usage (usage.ping), on any device. */
  lastPingAt: number | null;
  /** Usage that is missing though the user is still around (usageGap). */
  gap: UsageGap;
  opens: number; activeDays: number; activeMs: number; bandwidth: number;
  entries: number; storage: number; devices: number; installed: boolean;
  appVersion: string | null; gmail: string | null; streak: number; longestStreak: number; nightShare: number;
  /** Claude's cost in USD for this user over the period, and how many calls. */
  aiCost: number; aiCalls: number;
};

/**
 * A user still saving changes whose app reports no usage, so their zeros are not real: an installed
 * build from before usage counting, or one stuck on an old version. "none": no usage report ever;
 * "stopped": the last report is more than a day older than the last change saved.
 */
export type UsageGap = "none" | "stopped" | null;

export const GAP_AFTER_MS = 24 * 60 * 60 * 1000;

export function usageGap(lastPingAt: number | null, lastSyncAt: number | null): UsageGap {
  if (!lastSyncAt) return null;
  if (!lastPingAt) return "none";
  return lastSyncAt - lastPingAt > GAP_AFTER_MS ? "stopped" : null;
}

/** Days in a row with any use, ending at the last one, and the longest such run. */
export function streaks(days: string[], today: string): { current: number; longest: number } {
  const sorted = [...new Set(days)].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // a run still counts as current when its last day is today or yesterday
  const current = prev && (prev === today || addDays(prev, 1) === today) ? run : 0;
  return { current, longest };
}

/** One row per user. `daily` and `ai` are the period's. */
export function userRows(v: View, daily: Daily[], today: string, ai: Ai[] = []): UserRow[] {
  const stats = new Map(v.stats.map((s) => [s.userId as string, s]));
  return v.users.map((u) => {
    const mine = daily.filter((r) => r.userId === u.id);
    const spent = aiTotals(ai.filter((r) => r.userId === u.id));
    const t = totals(mine);
    const devs = v.devices.filter((d) => d.userId === u.id).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    const s = stats.get(u.id);
    const hours = sumRecords(mine.map((r) => r.hours));
    const night = [0, 1, 2, 3, 4].reduce((n, h) => n + (hours[`h${h}`] ?? 0), 0);
    const { current, longest } = streaks(mine.map((r) => r.day), today);
    const lastPingAt = devs[0]?.lastSeenAt ?? null;
    return {
      ...u,
      lastSeenAt: Math.max(lastPingAt ?? 0, u.lastSyncAt ?? 0) || null,
      lastPingAt,
      gap: usageGap(lastPingAt, u.lastSyncAt),
      opens: t.opens,
      activeDays: new Set(mine.map((r) => r.day)).size,
      activeMs: t.activeMs,
      bandwidth: t.bytesDown + t.bytesUp + photoBytes(mine, s ? [s] : []),
      entries: s?.tables.transactions?.count ?? 0,
      storage: s ? storageOf(s) : 0,
      devices: devs.length,
      installed: devs.some((d) => d.standalone),
      appVersion: devs[0]?.appVersion ?? null,
      gmail: s?.gmail?.status ?? null,
      streak: current,
      longestStreak: longest,
      nightShare: t.opens ? night / t.opens : 0,
      aiCost: spent.costUsd,
      aiCalls: spent.calls,
    };
  });
}

/** Documents plus files. */
export function storageOf(s: Stats): number {
  return Object.values(s.tables).reduce((n, t) => n + t.bytes, 0) + s.files.bytes;
}

// ---- cohorts ----

/** Monday of the week a day is in. */
export function weekOf(day: string): string {
  return addDays(day, -weekdayOf(day));
}

export type Cohort = { week: string; size: number; weeks: (number | null)[] };

/**
 * Users by the week they signed up, and for each week since, the share of them that opened the app.
 * Weeks still to come are null. Only cohorts whose sign-up week is covered by `daily`.
 */
export function cohorts(users: User[], daily: Daily[], today: string, count = 8, joinedDay: (ms: number) => string = (ms) => dayKey(new Date(ms))): Cohort[] {
  const active = new Map<string, Set<string>>();
  for (const r of daily) {
    const w = weekOf(r.day);
    if (!active.has(w)) active.set(w, new Set());
    active.get(w)!.add(r.userId);
  }
  const thisWeek = weekOf(today);
  const out: Cohort[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const week = addDays(thisWeek, -7 * i);
    const members = users.filter((u) => weekOf(joinedDay(u.joinedAt)) === week).map((u) => u.id as string);
    const weeks: (number | null)[] = [];
    for (let n = 0; n < count; n++) {
      const w = addDays(week, 7 * n);
      if (w > thisWeek) { weeks.push(null); continue; }
      const seen = active.get(w);
      weeks.push(members.length ? members.filter((id) => seen?.has(id)).length / members.length : null);
    }
    out.push({ week, size: members.length, weeks });
  }
  return out;
}

// ---- formatting ----

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
export const fmtNum = (n: number) => (Math.abs(n) < 1000 ? String(Math.round(n * 10) / 10) : compact.format(n));

export function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

export const fmtPct = (x: number) => `${Math.round(x * 100)}%`;

/** Dollars, with as many places as a Claude bill of fractions of a cent needs: $0.0008, $0.042, $3.10. */
export function fmtUsd(n: number): string {
  if (!n) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Change from the previous period, as "+12%"; null when there was nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return (now - before) / before;
}
