import { expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "../../shared/ops";
import { buildHandoff, decodePayload, encodePayload, expenseUrl, handoffUrl, parseReturn } from "./unsplit";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);

/** Two expenses on different days, an income and a transfer. */
function ledger() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const salary = s.categories.find((c) => c.type === "income")!._id;
  const [cash, bank] = s.accounts;
  const base = { accountId: cash._id, tags: [], photoIds: [] };
  s = run(s, "transactions.create", { ...base, type: "expense", categoryId: food, amount: 4550, note: "Taxi", date: "2026-10-14" }).snap;
  s = run(s, "transactions.create", { ...base, type: "expense", categoryId: food, amount: 120000, note: "Dinner", description: "Birthday", date: "2026-10-12" }).snap;
  s = run(s, "transactions.create", { ...base, type: "income", categoryId: salary, amount: 999, note: "Pay", date: "2026-10-13" }).snap;
  s = run(s, "transactions.create", { ...base, type: "transfer", toAccountId: bank._id, amount: 500, note: "ATM", date: "2026-10-13" }).snap;
  return s;
}
const label = (s: Snapshot) => (t: { categoryId?: string }) => s.categories.find((c) => c._id === t.categoryId)?.name ?? "";

test("payloads survive the trip through base64url, accents and all", () => {
  const v = { v: 1, description: "Café ₹ — ünïcode", refs: ["a", "b"] };
  const s = encodePayload(v);
  expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(decodePayload(s)).toEqual(v);
  expect(decodePayload("not base64!")).toBeNull();
});

test("several entries become one itemised expense in date order; income and transfers are left out", () => {
  const s = ledger();
  const h = buildHandoff(s.transactions, { currency: "USD", decimals: 2, categoryLabel: label(s) })!;
  expect(h.refs).toEqual([s.transactions[1]._id, s.transactions[0]._id]);
  expect(h.description).toBe("Dinner, Taxi");
  expect(h.date).toBe("2026-10-12");
  expect(h.amount).toBe("1245.50");
  expect(h.category).toBe("Food");
  expect(h.items).toEqual([
    { ref: s.transactions[1]._id, name: "Dinner", amount: "1200.00" },
    { ref: s.transactions[0]._id, name: "Taxi", amount: "45.50" },
  ]);
  expect(h.notes).toBeUndefined();
  expect(handoffUrl(h)).toMatch(/^https:\/\/unsplit\.vercel\.app\/expenses\/new#unmoney=[A-Za-z0-9_-]+$/);
});

test("one entry goes as it is, with its description as the notes", () => {
  const s = ledger();
  const dinner = s.transactions.find((t) => t.note === "Dinner")!;
  const h = buildHandoff([dinner], { currency: "INR", decimals: 0, categoryLabel: label(s) })!;
  expect(h).toMatchObject({ description: "Dinner", notes: "Birthday", amount: "120000", currency: "INR" });
  expect(h.items).toBeUndefined();
});

test("nothing to split gives null", () => {
  const s = ledger();
  expect(buildHandoff(s.transactions.filter((t) => t.type !== "expense"), { currency: "USD", decimals: 2, categoryLabel: label(s) })).toBeNull();
});

test("the return trip names the expense and the entries; anything else is refused", () => {
  const ok = encodePayload({ v: 1, expenseId: " k57abc ", refs: ["t1", "t2"] });
  expect(parseReturn(`#unsplit=${ok}`)).toEqual({ v: 1, expenseId: "k57abc", refs: ["t1", "t2"] });
  expect(parseReturn("#unsplit=" + encodePayload({ v: 2, expenseId: "x", refs: [] }))).toBeNull();
  expect(parseReturn("#unsplit=" + encodePayload({ v: 1, expenseId: "", refs: [] }))).toBeNull();
  expect(parseReturn("#unsplit=" + encodePayload({ v: 1, expenseId: "x", refs: [1] }))).toBeNull();
  expect(parseReturn("#other=1")).toBeNull();
  expect(expenseUrl("k57abc")).toBe("https://unsplit.vercel.app/expenses/k57abc");
});

test("setSplit links the entries that still exist, and null unlinks them", () => {
  let s = ledger();
  const [taxi, dinner] = s.transactions;
  s = run(s, "transactions.setSplit", { ids: [taxi._id, dinner._id, "gone"], split: { app: "unsplit", expenseId: "k57" } }).snap;
  expect(s.transactions.filter((t) => t.split?.expenseId === "k57").map((t) => t.note)).toEqual(["Taxi", "Dinner"]);
  const copy = run(s, "transactions.copy", { id: taxi._id, useToday: false });
  expect(copy.snap.transactions.find((t) => t._id === copy.result)!.split).toBeUndefined();
  s = run(s, "transactions.setSplit", { ids: [taxi._id], split: null }).snap;
  expect(s.transactions.find((t) => t._id === taxi._id)!.split).toBeUndefined();
  expect(s.transactions.find((t) => t._id === dinner._id)!.split).toEqual({ app: "unsplit", expenseId: "k57" });
  expect(() => run(s, "transactions.setSplit", { ids: [taxi._id], split: { app: "unsplit", expenseId: " " } })).toThrow();
});
