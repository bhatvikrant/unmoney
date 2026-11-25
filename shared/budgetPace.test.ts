import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { budgetPace } from "./budgetPace";
import { billsAgainstBudgets } from "./upcoming";
import { budgetStatus } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

/** A ₹1,000 Food budget a month and a way to spend on Food (or another category). */
function ledger(monthStartDay = 1) {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  if (monthStartDay !== 1) s = run(s, "settings.update", { patch: { monthStartDay } }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  s = run(s, "budgets.upsert", { period: "monthly", categoryId: food, amount: 100000 }).snap;
  const spend = (snap: Snapshot, date: string, amount: number, categoryId: string = food, repeat?: { frequency: string }) =>
    run(snap, "transactions.create", { type: "expense", date, accountId: snap.accounts[0]._id, categoryId, amount, note: "", tags: [], photoIds: [], repeat }).snap;
  return { s, food, spend };
}

/** The pace of the Food budget (or of all spending, with `all`) in the month `key` as of `today`. */
function pace(s: Snapshot, key: string, today: string, all = false) {
  const status = budgetStatus(s, "monthly", key, today)!;
  return budgetPace(s, "monthly", status, today).get(all ? "" : status.perCategory[0].budget._id)!;
}

test("rent on day one no longer reads as over pace", () => {
  const { s: base, spend } = ledger();
  let s = base;
  for (const m of ["08", "09", "10", "11"]) s = spend(s, `2026-${m}-01`, 90000);
  // a straight line on 3 Nov says 90,000 ÷ 3/30 = 900,000; every earlier month had it all out by the 3rd
  const p = pace(s, "2026-11", "2026-11-03");
  expect(p).toEqual({ end: 90000, mark: 1 });
  // the bar's warning is spending past the mark: 90% used, mark at 100%
  expect(90000 / 100000 > p.mark).toBe(false);
  // all spending, with no total budget, is paced the same way
  expect(pace(s, "2026-11", "2026-11-03", true).end).toBe(90000);
});

test("spending that comes late in the period is expected, not missed", () => {
  const { s: base, spend } = ledger();
  let s = base;
  for (const m of ["08", "09", "10"]) { s = spend(s, `2026-${m}-01`, 20000); s = spend(s, `2026-${m}-20`, 60000); }
  s = spend(s, "2026-11-01", 20000);
  // a straight line on 10 Nov says 60,000; a quarter is usually out by now
  expect(pace(s, "2026-11", "2026-11-10")).toEqual({ end: 80000, mark: 0.25 });
});

test("thin history falls back to the straight line", () => {
  const { s: base, spend } = ledger();
  // one earlier month is not a pattern
  let s = spend(base, "2026-10-01", 90000);
  s = spend(s, "2026-11-01", 30000);
  expect(pace(s, "2026-11", "2026-11-10")).toEqual({ end: 90000, mark: 10 / 30 });
  // nor is the month the ledger began part-way through: only October is whole here
  let late = spend(base, "2026-09-20", 90000);
  late = spend(late, "2026-10-01", 90000);
  late = spend(late, "2026-11-01", 30000);
  expect(pace(late, "2026-11", "2026-11-10").end).toBe(90000);
  // a usual share near zero (everything on the 25th) is too small to divide by
  let s2 = base;
  for (const m of ["08", "09", "10"]) { s2 = spend(s2, `2026-${m}-01`, 1000); s2 = spend(s2, `2026-${m}-25`, 99000); }
  s2 = spend(s2, "2026-11-02", 3000);
  expect(pace(s2, "2026-11", "2026-11-03").end).toBe(30000);
});

test("a category with no history is paced by the straight line, beside one that has it", () => {
  const { s: base, food, spend } = ledger();
  const other = base.categories.find((c) => c.type === "expense" && c._id !== food && !c.parentId)!._id;
  let s = run(base, "budgets.upsert", { period: "monthly", categoryId: other, amount: 100000 }).snap;
  for (const m of ["08", "09", "10", "11"]) s = spend(s, `2026-${m}-01`, 50000);
  s = spend(s, "2026-11-05", 10000, other);
  const status = budgetStatus(s, "monthly", "2026-11", "2026-11-10")!;
  const paces = budgetPace(s, "monthly", status, "2026-11-10");
  const of = (cat: string) => paces.get(status.perCategory.find((i) => i.budget.categoryId === cat)!.budget._id)!;
  expect(of(food).end).toBe(50000);
  expect(of(other)).toEqual({ end: 30000, mark: 10 / 30 });
  // nothing spent and nothing due: no figure, and the mark is where today falls
  s = run(s, "budgets.upsert", { period: "monthly", categoryId: s.categories.find((c) => c.type === "expense" && c._id !== food && c._id !== other && !c.parentId)!._id, amount: 5000 }).snap;
  const st = budgetStatus(s, "monthly", "2026-11", "2026-11-10")!;
  expect(budgetPace(s, "monthly", st, "2026-11-10").get(st.perCategory.find((i) => i.spent === 0)!.budget._id)).toEqual({ end: 0, mark: 10 / 30 });
});

test("periods follow the month start day", () => {
  const { s: base, spend } = ledger(25);
  let s = base;
  // months run from the 25th: 60,000 on its first day, 40,000 on the 15th after
  for (const [a, b] of [["07", "08"], ["08", "09"], ["09", "10"]]) { s = spend(s, `2026-${a}-25`, 60000); s = spend(s, `2026-${b}-15`, 40000); }
  s = spend(s, "2026-10-25", 60000);
  // 5 Nov is day 12 of 25 Oct – 24 Nov: a straight line says 155,000
  expect(pace(s, "2026-10", "2026-11-05")).toEqual({ end: 100000, mark: 0.6 });
  // the month that starts on 25 Nov is not running yet
  expect(budgetPace(s, "monthly", budgetStatus(s, "monthly", "2026-11", "2026-11-05")!, "2026-11-05").size).toBe(0);
});

test("periods of different lengths line up by how far through they are", () => {
  const { s: base, spend } = ledger();
  let s = base;
  // half on the 10th, half on the last day: 30 Nov, 31 Dec, 31 Jan, 28 Feb
  for (const [m, last] of [["2025-11", "30"], ["2025-12", "31"], ["2026-01", "31"], ["2026-02", "28"]]) { s = spend(s, `${m}-10`, 50000); s = spend(s, `${m}-${last}`, 50000); }
  s = spend(s, "2026-03-10", 50000);
  // 28 Mar is not the end of March though the 28th was the end of February: the second half is still to come
  expect(pace(s, "2026-03", "2026-03-28").end).toBe(100000);
  expect(pace(s, "2026-03", "2026-03-30").end).toBe(100000);
  // and on the last day nothing more is expected
  expect(pace(s, "2026-03", "2026-03-31").end).toBe(50000);
});

test("scheduled bills are counted once: not in the pattern, and not again once they are entries", () => {
  const { s: base, food, spend } = ledger();
  let s = base;
  // 20,000 on the 5th of every month, and a ₹649 schedule on the 20th from July
  for (const m of ["06", "07", "08", "09", "10"]) s = spend(s, `2026-${m}-05`, 20000);
  s = spend(s, "2026-07-20", 64900, food, { frequency: "monthly" });
  s = run(s, "repeats.catchUp", { today: "2026-10-10" }).snap;
  // 10 Oct: 20,000 spent, the bill of the 20th still due. Had the earlier bills been part of the
  // pattern, the 20,000 would read as a quarter of the month and the bill would be added on top (149,800)
  const due = billsAgainstBudgets(s, "2026-10-10").find((o) => o.item.budget.categoryId === food)!;
  expect(due.adds).toBe(64900);
  expect(pace(s, "2026-10", "2026-10-10")).toEqual({ end: 84900, mark: 20000 / 84900 });
  expect(pace(s, "2026-10", "2026-10-10", true).end).toBe(84900);
  // once the bill is an entry the figure is the same
  s = run(s, "repeats.catchUp", { today: "2026-10-21" }).snap;
  expect(pace(s, "2026-10", "2026-10-21")).toEqual({ end: 84900, mark: 1 });
});

test("a scheduled bill is not multiplied, even with no history", () => {
  const { s: base, food, spend } = ledger();
  // a straight line on 3 Nov would turn the rent of the 1st into 900,000
  const s = spend(base, "2026-11-01", 90000, food, { frequency: "monthly" });
  expect(pace(s, "2026-11", "2026-11-03")).toEqual({ end: 90000, mark: 1 });
});

test("subcategory spending counts under the main category's budget", () => {
  const { s: base, food, spend } = ledger();
  const r = run(base, "categories.create", { name: "Lunch", type: "expense", parentId: food });
  let s = r.snap;
  for (const m of ["08", "09", "10", "11"]) s = spend(s, `2026-${m}-01`, 40000, r.result as string);
  expect(pace(s, "2026-11", "2026-11-03").end).toBe(40000);
});

test("the day it goes over is named only when every earlier period agrees", () => {
  const { s: base, spend } = ledger();
  // 25,000 on the 5th, 12th, 19th and 26th of a month
  const shops = (snap: Snapshot, months: string[]) => months.reduce((x, m) => ["05", "12", "19", "26"].reduce((y, d) => spend(y, `2026-${m}-${d}`, 25000), x), snap);
  const usual = shops(base, ["06", "07", "08", "09"]);
  const s = spend(spend(usual, "2026-10-05", 40000), "2026-10-12", 40000);
  // 13 Oct: 80,000 where half is usually out, so 160,000 by the end; past 100,000 at the third shop
  expect(pace(s, "2026-10", "2026-10-13")).toEqual({ end: 160000, mark: 0.5, overOn: "2026-10-19" });
  // already over: nothing left to foretell
  expect(pace(spend(s, "2026-10-13", 30000), "2026-10", "2026-10-13").overOn).toBeUndefined();
  // headed under the limit: no day
  expect(pace(spend(usual, "2026-10-05", 20000), "2026-10", "2026-10-11")).toEqual({ end: 80000, mark: 0.25 });
  // one earlier month had 90% out by the 13th: still on pace for 160,000, but that month alone would end under the limit
  let unsure = spend(spend(shops(base, ["06", "07", "08"]), "2026-09-02", 90000), "2026-09-20", 10000);
  unsure = spend(spend(unsure, "2026-10-05", 40000), "2026-10-12", 40000);
  expect(pace(unsure, "2026-10", "2026-10-13")).toEqual({ end: 160000, mark: 0.5 });
  // two earlier months agree, but two are too few to name a day
  const few = spend(spend(shops(base, ["07", "08", "09"]), "2026-10-05", 40000), "2026-10-12", 40000);
  expect(pace(few, "2026-10", "2026-10-13")).toEqual({ end: 160000, mark: 0.5 });
});

test("only the period running today has a pace", () => {
  const { s: base, spend } = ledger();
  const s = spend(base, "2026-10-05", 30000);
  expect(budgetPace(s, "monthly", budgetStatus(s, "monthly", "2026-10", "2026-11-10")!, "2026-11-10").size).toBe(0);
  expect(budgetPace(s, "monthly", budgetStatus(s, "monthly", "2026-12", "2026-11-10")!, "2026-11-10").size).toBe(0);
});
