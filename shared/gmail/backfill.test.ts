import { expect, test } from "vitest";
import { aiShortfall, COUNT_MAX, formatDuration, progressOf, isYearStart, MAX_SPAN_DAYS, nextMonthStart, nextSpanDays, remainingMs, yearProblem } from "./backfill";
import { buildQuery } from "./query";

const now = Date.parse("2026-11-02T10:00:00Z");

test("a year to read back to is 2004 (Gmail's first) up to this one", () => {
  expect(yearProblem(2023, now)).toBeNull();
  expect(yearProblem(2026, now)).toBeNull();
  expect(yearProblem(2004, now)).toBeNull();
  expect(yearProblem(2003, now)).toMatch(/2004/);
  expect(yearProblem(2027, now)).toMatch(/hasn't happened/);
  expect(yearProblem(2023.5, now)).toMatch(/year like/);
});

test("1 January's midnight in any time zone is the start of the year; another day isn't", () => {
  expect(isYearStart(2023, Date.UTC(2023, 0, 1))).toBe(true);
  // India, five and a half hours ahead; Hawaii, ten behind
  expect(isYearStart(2023, Date.UTC(2022, 11, 31, 18, 30))).toBe(true);
  expect(isYearStart(2023, Date.UTC(2023, 0, 1, 10))).toBe(true);
  expect(isYearStart(2023, Date.UTC(2023, 0, 3))).toBe(false);
  expect(isYearStart(2023, Number.NaN)).toBe(false);
});

test("slices grow while they come back light and shrink when one holds more than a check reads", () => {
  expect(nextSpanDays(30, 10, 300)).toBe(60);
  expect(nextSpanDays(30, 200, 300)).toBe(30);
  expect(nextSpanDays(30, 900, 300)).toBe(15);
  expect(nextSpanDays(1, 900, 300)).toBe(1);
  expect(nextSpanDays(200, 0, 300)).toBeGreaterThanOrEqual(MAX_SPAN_DAYS);
});

test("time left: the estimate at first, then the pace of the time spent reading", () => {
  const b = { from: now - 1000 * 86400_000, cursor: now, startedAt: now };
  expect(remainingMs({ ...b, total: null, read: 0 })).toBeNull();
  expect(remainingMs({ ...b, total: 1000, read: 0 })).toBe(450_000);
  // 100 read in 1 minute of reading: 900 more take 9, however long it has been since starting (the count, a wait for AI)
  expect(remainingMs({ ...b, total: 1000, read: 100, startedAt: now - 3 * 3600_000, timedMs: 60_000, timedRead: 100 })).toBe(540_000);
  // too few timed yet (a backfill from before the pace was kept): the usual pace
  expect(remainingMs({ ...b, total: 1000, read: 900, timedMs: 1000, timedRead: 10 })).toBe(45_000);
  expect(remainingMs({ ...b, total: 100, read: 120, timedMs: 60_000, timedRead: 120 })).toBe(0);
  expect(progressOf({ ...b, total: 1000, read: 250 })).toBe(0.25);
  expect(progressOf({ ...b, total: 0, read: 0 })).toBe(1);
});

test("past the count's limit, progress goes by how much of the years is covered, and so does the mail left", () => {
  const startedAt = now - 60 * 60_000;
  const b = { from: startedAt - 1000 * 86400_000, cursor: startedAt - 250 * 86400_000, startedAt, total: COUNT_MAX, read: COUNT_MAX + 4000, timedMs: 24_000 * 100, timedRead: 24_000 };
  expect(progressOf(b)).toBe(0.25);
  // 24,000 in a quarter of the years: about 72,000 more at 100 ms each
  expect(remainingMs(b)).toBe(72_000 * 100);
});

test("durations read as people say them", () => {
  expect(formatDuration(20_000)).toBe("under a minute");
  expect(formatDuration(60_000)).toBe("about 1 minute");
  expect(formatDuration(7 * 60_000)).toBe("about 7 minutes");
  expect(formatDuration(23 * 60_000)).toBe("about 25 minutes");
  expect(formatDuration(60 * 60_000)).toBe("about 1 hour");
  expect(formatDuration(83 * 60_000)).toBe("about 1 hour 20 minutes");
  expect(formatDuration(118 * 60_000)).toBe("about 2 hours");
  expect(formatDuration(6.4 * 60 * 60_000)).toBe("about 6 hours");
});

test("the AI may run short when the likely AI mail needs more calls than the month leaves", () => {
  expect(aiShortfall(1000, 240, 10)).toBe(false);
  expect(aiShortfall(20_000, 240, 10)).toBe(true);
  expect(aiShortfall(100, 0, 10)).toBe(true);
  expect(aiShortfall(0, 0, 10)).toBe(false);
});

test("AI reads come back on the 1st of next month", () => {
  expect(nextMonthStart(now)).toBe(Date.UTC(2026, 11, 1));
  expect(nextMonthStart(Date.UTC(2026, 11, 20))).toBe(Date.UTC(2027, 0, 1));
});

test("a slice's search is bounded on both sides", () => {
  const q = buildQuery({ senders: ["hdfcbank.net"], scanPurchases: false, afterSeconds: 100.4, beforeSeconds: 200.2 });
  expect(q.startsWith("after:100 before:201 (")).toBe(true);
  expect(buildQuery({ senders: [], scanPurchases: false, afterSeconds: 100 })).not.toContain("before:");
});
