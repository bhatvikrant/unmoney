import { expect, test } from "vitest";
import { buildQuery, DEFAULT_SENDERS, matchesSender, normaliseSender, windowStart } from "./query";

test("the query narrows to the window, the senders, Purchases and money subjects", () => {
  const q = buildQuery({ senders: ["hdfcbank.net", "Alerts@AxisBank.com"], scanPurchases: true, afterSeconds: 1_700_000_000.9 });
  expect(q.startsWith("after:1700000000 (")).toBe(true);
  expect(q).toContain("from:(hdfcbank.net OR alerts@axisbank.com)");
  expect(q).toContain("category:purchases");
  expect(q).toContain("subject:(debited OR credited");
});

test("without senders or Purchases only the subject words remain", () => {
  const q = buildQuery({ senders: [], scanPurchases: false, afterSeconds: 0 });
  expect(q).not.toContain("from:");
  expect(q).not.toContain("category:");
  expect(q).toContain("subject:(");
});

test("sender entries are trimmed, lowercased and stripped of display names", () => {
  expect(normaliseSender("  HDFC Bank <Alerts@HDFCBank.net> ")).toBe("alerts@hdfcbank.net");
  expect(normaliseSender("@Amazon.in")).toBe("amazon.in");
  expect(normaliseSender("")).toBe("");
});

test("a From header matches its exact address, its domain or a parent domain", () => {
  const senders = ["alerts@hdfcbank.net", "amazon.in"];
  expect(matchesSender("HDFC Bank <alerts@hdfcbank.net>", senders)).toBe(true);
  expect(matchesSender("HDFC Bank <offers@hdfcbank.net>", senders)).toBe(false);
  expect(matchesSender("order-update@amazon.in", senders)).toBe(true);
  expect(matchesSender("ship-confirm@mail.amazon.in", senders)).toBe(true);
  expect(matchesSender("x@notamazon.in", senders)).toBe(false);
});

test("the default list is already normalised", () => {
  for (const s of DEFAULT_SENDERS) expect(normaliseSender(s)).toBe(s);
});

test("a check's window: the look-back first, then two days of overlap, never before the connection allows", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-10-20T10:00:00Z");
  expect(windowStart({ lookbackDays: 30 }, now)).toBe(now - 30 * day);
  expect(windowStart({ lookbackDays: 30, syncedUpTo: now - day }, now)).toBe(now - 3 * day);
  // "from now on": the first check reads nothing old, and the overlap stops at the moment of connecting
  const connectedAt = now - day;
  expect(windowStart({ lookbackDays: 0, readsFrom: connectedAt }, connectedAt)).toBe(connectedAt);
  expect(windowStart({ lookbackDays: 0, readsFrom: connectedAt, syncedUpTo: connectedAt }, now)).toBe(connectedAt);
  expect(windowStart({ lookbackDays: 0, readsFrom: connectedAt, syncedUpTo: now + 5 * day }, now + 6 * day)).toBe(now + 3 * day);
});
