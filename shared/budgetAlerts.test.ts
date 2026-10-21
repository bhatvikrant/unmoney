import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { budgetCrossings, budgetLevel, budgetStatus, currentBudgetLevels } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

/** A ₹1,000 Food budget a month (month starts on the 1st) and a way to spend on Food. */
function ledger(monthStartDay = 1) {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  if (monthStartDay !== 1) s = run(s, "settings.update", { patch: { monthStartDay } }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const r = run(s, "budgets.upsert", { period: "monthly", categoryId: food, amount: 100000 });
  s = r.snap;
  const budget = r.result as Id<"budgets">;
  const spend = (snap: Snapshot, date: string, amount: number) =>
    run(snap, "transactions.create", { type: "expense", date, accountId: snap.accounts[0]._id, categoryId: food, amount, note: "", tags: [], photoIds: [] }).snap;
  return { s, food, budget, spend };
}

test("without carrying over, every month starts from the budget", () => {
  const { s: base, spend } = ledger();
  const s = spend(base, "2026-09-10", 30000);
  expect(budgetStatus(s, "monthly", "2026-10")!.perCategory[0]).toMatchObject({ limit: 100000, carry: 0, remaining: 100000 });
});

test("carrying over adds what was left in each month since it was turned on, and takes away overspending", () => {
  const { s: base, budget, spend } = ledger();
  let s = run(base, "budgets.setRollover", { id: budget, from: "2026-08" }).snap;
  s = spend(s, "2026-07-10", 99999); // before it was on: ignored
  s = spend(s, "2026-08-10", 30000); // 700 left
  s = spend(s, "2026-09-05", 150000); // 500 over
  s = run(s, "budgets.setOverride", { id: budget, key: "2026-09", amount: 120000 }).snap; // September's budget was 1,200
  s = spend(s, "2026-10-02", 10000);
  const oct = budgetStatus(s, "monthly", "2026-10")!.perCategory[0];
  // +700 from August, −300 from September (1,200 − 1,500)
  expect(oct).toMatchObject({ carry: 40000, limit: 140000, spent: 10000, remaining: 130000 });
  expect(budgetStatus(s, "monthly", "2026-08")!.perCategory[0].carry).toBe(0);
  expect(budgetStatus(s, "monthly", "2026-09")!.perCategory[0]).toMatchObject({ carry: 70000, limit: 190000 });
  // turning it off forgets the carry
  const off = run(s, "budgets.setRollover", { id: budget, from: null }).snap;
  expect(budgetStatus(off, "monthly", "2026-10")!.perCategory[0]).toMatchObject({ carry: 0, limit: 100000 });
});

test("carrying over follows custom month starts and weekly budgets", () => {
  const { s: base, budget, spend, food } = ledger(25);
  let s = run(base, "budgets.setRollover", { id: budget, from: "2026-09" }).snap;
  // "2026-09" runs 25 Sep – 24 Oct with a month start of 25
  s = spend(s, "2026-09-26", 20000);
  s = spend(s, "2026-10-24", 20000);
  expect(budgetStatus(s, "monthly", "2026-10")!.perCategory[0].carry).toBe(60000);
  const w = run(s, "budgets.upsert", { period: "weekly", categoryId: food, amount: 10000 });
  s = run(w.snap, "budgets.setRollover", { id: w.result, from: "2026-10-04" }).snap; // weeks start on Sunday
  s = spend(s, "2026-10-05", 4000);
  expect(budgetStatus(s, "weekly", "2026-10-18")!.perCategory[0].carry).toBe((10000 - 4000) + 10000);
});

test("levels: under 80%, from 80%, at or over the limit; a zero budget with spending is over", () => {
  expect(budgetLevel({ limit: 1000, spent: 799 })).toBe(0);
  expect(budgetLevel({ limit: 1000, spent: 800 })).toBe(1);
  expect(budgetLevel({ limit: 1000, spent: 1000 })).toBe(2);
  expect(budgetLevel({ limit: 0, spent: 1 })).toBe(2);
  expect(budgetLevel({ limit: 0, spent: 0 })).toBe(0);
});

test("an entry that pushes a budget past 80% or over is a crossing; staying in the same band, or a new budget, is not", () => {
  const { s: base, spend, food } = ledger();
  let s = spend(base, "2026-10-02", 50000);
  const before = currentBudgetLevels(s, "2026-10-21");
  s = spend(s, "2026-10-21", 35000);
  const mid = currentBudgetLevels(s, "2026-10-21");
  expect(budgetCrossings(before, mid).map((i) => [i.budget.categoryId, i.level])).toEqual([[food, 1]]);
  const later = currentBudgetLevels(spend(s, "2026-10-21", 1000), "2026-10-21");
  expect(budgetCrossings(mid, later)).toEqual([]);
  const over = currentBudgetLevels(spend(s, "2026-10-21", 20000), "2026-10-21");
  expect(budgetCrossings(mid, over).map((i) => i.level)).toEqual([2]);
  // an entry in another month changes nothing this month
  expect(budgetCrossings(mid, currentBudgetLevels(spend(s, "2026-09-21", 99000), "2026-10-21"))).toEqual([]);
  // a budget made just now that is already over doesn't alert
  const total = run(s, "budgets.upsert", { period: "monthly", amount: 1000 }).snap;
  expect(budgetCrossings(mid, currentBudgetLevels(total, "2026-10-21"))).toEqual([]);
});
