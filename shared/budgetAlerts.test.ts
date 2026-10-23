import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { budgetAverage, budgetCrossings, budgetImpact, budgetLevel, budgetStatus, budgetsAt, budgetsForCategory, currentBudgetLevels } from "./views";

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

test("the average spent covers the six whole months before this one, per budget period", () => {
  const { s: base, spend, food } = ledger();
  let s = spend(base, "2026-03-31", 99999); // seven months back: outside the window
  s = spend(s, "2026-04-15", 60000);
  s = spend(s, "2026-09-30", 60000);
  s = spend(s, "2026-10-02", 99999); // this month: not finished, left out
  // Apr–Sep: 1,200 over 6 months
  expect(budgetAverage(s, food, "monthly", "2026-10-23")).toEqual({ amount: 20000, months: 6 });
  expect(budgetAverage(s, food, "yearly", "2026-10-23")!.amount).toBe(240000);
  expect(budgetAverage(s, food, "weekly", "2026-10-23")!.amount).toBe(Math.round((120000 * 7) / 183));
  // the total counts every category; another category on its own spent nothing
  const other = s.categories.find((c) => c.type === "expense" && c._id !== food && !c.parentId)!._id;
  expect(budgetAverage(s, undefined, "monthly", "2026-10-23")!.amount).toBe(20000);
  expect(budgetAverage(s, other, "monthly", "2026-10-23")).toEqual({ amount: 0, months: 6 });
});

test("the average starts at the first entry, and is missing with no earlier month", () => {
  const { s: base, spend, food } = ledger();
  let s = spend(base, "2026-10-05", 50000);
  expect(budgetAverage(s, food, "monthly", "2026-10-23")).toBeNull();
  s = spend(s, "2026-08-20", 40000);
  // Aug–Sep only
  expect(budgetAverage(s, food, "monthly", "2026-10-23")).toEqual({ amount: 20000, months: 2 });
});

test("an entry counts against its main category's budgets in the periods holding its date, else the total ones", () => {
  const { s: base, spend, food } = ledger();
  let s = run(base, "budgets.upsert", { period: "monthly", amount: 500000 }).snap;
  s = spend(s, "2026-09-10", 30000);
  const t = s.transactions[0]._id;
  const lunch = run(s, "categories.create", { name: "Lunch", type: "expense", parentId: food });
  s = lunch.snap;
  // a subcategory counts against its main one
  expect(budgetsForCategory(budgetsAt(s, "2026-09-20"), s, lunch.result as string).map((i) => [i.budget.categoryId, i.spent, i.remaining])).toEqual([[food, 30000, 70000]]);
  // another month starts again
  expect(budgetsForCategory(budgetsAt(s, "2026-10-01"), s, food)[0].spent).toBe(0);
  // a category without a budget of its own counts against the total
  const other = s.categories.find((c) => c.type === "expense" && c._id !== food && !c.parentId)!._id;
  expect(budgetsForCategory(budgetsAt(s, "2026-09-20"), s, other).map((i) => [i.budget.categoryId, i.spent])).toEqual([[undefined, 30000]]);
  // the entry being edited is left out of what was spent
  expect(budgetsForCategory(budgetsAt(s, "2026-09-20", t), s, food)[0].spent).toBe(0);
});

test("pending expenses count against their category's budget and the total, in their own date's period", () => {
  const { s: base, food } = ledger();
  const s = run(base, "budgets.upsert", { period: "monthly", amount: 500000 }).snap;
  const acc = s.accounts[0]._id;
  const other = s.categories.find((c) => c.type === "expense" && c._id !== food && !c.parentId)!._id;
  const hits = budgetImpact(s, [
    { type: "expense", date: "2026-10-03", amount: 80000, accountId: acc, categoryId: food },
    { type: "expense", date: "2026-10-05", amount: 40000, accountId: acc, categoryId: food },
    { type: "expense", date: "2026-10-06", amount: 10000, accountId: acc, categoryId: other },
    { type: "expense", date: "2026-11-02", amount: 10000, accountId: acc, categoryId: food },
  ]);
  // Food in October goes 200 over; the total takes all three October ones; November is its own.
  // Least left (as a share of the limit) first
  expect(hits.map((h) => [h.item.budget.categoryId ?? "total", h.item.range.from, h.adds, h.after])).toEqual([
    [food, "2026-10-01", 120000, -20000],
    ["total", "2026-10-01", 130000, 370000],
    [food, "2026-11-01", 10000, 90000],
    ["total", "2026-11-01", 10000, 490000],
  ]);
});
