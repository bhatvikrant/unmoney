import { expect, test } from "vitest";
import { aiSeries, aiTotals, applyFilters, cohorts, daySeries, fmtUsd, hourOfWeek, streaks, userRows, weekOf, type Ai, type Daily, type Overview } from "./metrics";

const row = (over: object): Daily => ({
  userId: "u1", deviceId: "d1", day: "2026-11-02", opens: 1, activeMs: 60_000, bytesDown: 100, bytesUp: 10, photoFetches: 0, opsSent: 0,
  hours: { h9: 1 }, screens: {}, lengths: {}, ...over,
} as unknown as Daily);

const device = (over: object) => ({
  userId: "u1", deviceId: "d1", firstSeenAt: 0, lastSeenAt: 0, os: "iOS", browser: "Safari", formFactor: "phone", standalone: true, appVersion: "v1", tzOffset: 330, sessions: 1, ...over,
}) as unknown as Overview["devices"][number];

const ai = (over: object): Ai => ({
  userId: "u1", day: "2026-11-02", feature: "gmail", calls: 1, inputTokens: 1000, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0.00015, ...over,
} as unknown as Ai);

const overview = (): Overview => ({
  users: [
    { id: "me", name: "Me", email: "a", image: null, joinedAt: Date.UTC(2026, 9, 1) },
    { id: "u1", name: "One", email: "b", image: null, joinedAt: Date.UTC(2026, 9, 26) },
    { id: "u2", name: "Two", email: "c", image: null, joinedAt: Date.UTC(2026, 9, 27) },
  ] as Overview["users"],
  devices: [device({}), device({ userId: "u2", deviceId: "d2", os: "Android", standalone: false }), device({ userId: "me", deviceId: "d3" })],
  daily: [row({}), row({ day: "2026-11-01" }), row({ userId: "u2", deviceId: "d2", day: "2026-11-02" }), row({ userId: "me", deviceId: "d3" })],
  stats: [],
  ai: [ai({}), ai({ feature: "tidy", costUsd: 0.0008 }), ai({ userId: "u2", day: "2026-11-01", costUsd: 0.002, calls: 4 }), ai({ userId: "me", costUsd: 1 })],
  truncated: false,
  now: 0,
});

test("filters leave out the superadmin and narrow usage by device", () => {
  const base = { days: 30, userId: "all", os: "all", mode: "all" as const, includeMe: false };
  expect(applyFilters(overview(), base, "me").users.map((u) => u.id)).toEqual(["u1", "u2"]);
  const android = applyFilters(overview(), { ...base, os: "Android" }, "me");
  expect(android.users.map((u) => u.id)).toEqual(["u2"]);
  expect(android.daily).toHaveLength(1);
  expect(applyFilters(overview(), { ...base, mode: "installed", includeMe: true }, "me").daily).toHaveLength(3);
});

test("a day series counts each user once a day", () => {
  const v = applyFilters(overview(), { days: 30, userId: "all", os: "all", mode: "all", includeMe: true }, "me");
  const s = daySeries(v, "2026-11-01", "2026-11-02");
  expect(s.map((p) => [p.day, p.activeUsers, p.opens])).toEqual([["2026-11-01", 1, 1], ["2026-11-02", 3, 3]]);
});

test("opens land on their weekday and hour", () => {
  // 2026-11-02 is a Monday
  expect(hourOfWeek([row({ hours: { h9: 2, h23: 1 } })])[0]).toEqual(expect.arrayContaining([2]));
  expect(hourOfWeek([row({ hours: { h9: 2 } })])[0][9]).toBe(2);
  expect(hourOfWeek([row({ day: "2026-11-08", hours: { h0: 1 } })])[6][0]).toBe(1);
});

test("streaks: the longest run, and the current one only while it reaches today or yesterday", () => {
  expect(streaks(["2026-10-01", "2026-10-02", "2026-10-03", "2026-11-01", "2026-11-02"], "2026-11-02")).toEqual({ current: 2, longest: 3 });
  expect(streaks(["2026-10-01"], "2026-11-02")).toEqual({ current: 0, longest: 1 });
});

test("cohorts: the share of a sign-up week that came back each week after", () => {
  const o = overview();
  // u1 and u2 joined the week of 26 Oct; u1 was in on Sunday 1 Nov (same week), both on Monday 2 Nov
  const c = cohorts(o.users, o.daily, "2026-11-02", 2, (ms) => new Date(ms).toISOString().slice(0, 10));
  expect(c.map((x) => x.week)).toEqual([weekOf("2026-10-26"), weekOf("2026-11-02")]);
  expect(c[0]).toEqual({ week: "2026-10-26", size: 2, weeks: [0.5, 1] });
  expect(c[1].weeks[1]).toBeNull();
});

test("user rows sum each user's use", () => {
  const v = applyFilters(overview(), { days: 30, userId: "all", os: "all", mode: "all", includeMe: false }, "me");
  const u1 = userRows(v, v.daily, "2026-11-02").find((u) => u.id === "u1")!;
  expect(u1).toMatchObject({ opens: 2, activeDays: 2, devices: 1, installed: true, streak: 2 });
});

test("AI cost follows the users shown, and sums per user, feature and day", () => {
  const v = applyFilters(overview(), { days: 30, userId: "all", os: "all", mode: "all", includeMe: false }, "me");
  expect(v.ai).toHaveLength(3);
  const t = aiTotals(v.ai);
  expect(t.costUsd).toBeCloseTo(0.00295, 10);
  expect(t).toMatchObject({ calls: 6, users: 2 });
  expect(t.tidy).toBeCloseTo(0.0008, 10);
  expect(aiSeries(v.ai, "2026-11-01", "2026-11-02").map((p) => [p.day, +p.gmail.toFixed(5), p.tidy])).toEqual([["2026-11-01", 0.002, 0], ["2026-11-02", 0.00015, 0.0008]]);
  const rows = userRows(v, v.daily, "2026-11-02", v.ai);
  expect(rows.find((u) => u.id === "u1")!.aiCost).toBeCloseTo(0.00095, 10);
  expect(rows.find((u) => u.id === "u2")).toMatchObject({ aiCalls: 4 });
});

test("dollars keep the places a small bill needs", () => {
  expect([0, 0.00078, 0.042, 3.1].map(fmtUsd)).toEqual(["$0", "$0.0008", "$0.042", "$3.10"]);
});
