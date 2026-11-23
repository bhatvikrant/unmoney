import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { backupExport, budgetHistory, budgetStatus } from "./views";
import { budgetSteps } from "./budgetAmounts";
import { monthRecap, yearRecap, RECAP_MIN_ENTRIES, type RecapCard } from "./recap";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);

/** A ₹20,000 Food budget a month, as an older app version made it (no start recorded), and a way to spend on Food. */
function ledger() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const r = run(s, "budgets.upsert", { period: "monthly", categoryId: food, amount: 2000000 });
  s = r.snap;
  const id = r.result as Id<"budgets">;
  const spend = (snap: Snapshot, date: string, amount: number, category: string = food) =>
    run(snap, "transactions.create", { type: "expense", date, accountId: snap.accounts[0]._id, categoryId: category, amount, note: "", tags: [], photoIds: [] }).snap;
  const set = (snap: Snapshot, amount: number, from?: string) => run(snap, "budgets.upsert", { id, period: "monthly", categoryId: food, amount, from }).snap;
  const limit = (snap: Snapshot, key: string) => budgetStatus(snap, "monthly", key)!.perCategory[0].limit;
  const doc = (snap: Snapshot) => snap.budgets.find((b) => b._id === id)!;
  return { s, food, id, spend, set, limit, doc };
}

test("a new default amount applies from its period on, and earlier periods keep what they had", () => {
  const { s: base, set, limit, doc } = ledger();
  const s = set(base, 1500000, "2026-11");
  expect([limit(s, "2026-09"), limit(s, "2026-10"), limit(s, "2026-11"), limit(s, "2027-01")]).toEqual([2000000, 2000000, 1500000, 1500000]);
  expect(doc(s).earlier).toEqual([{ until: "2026-11", amount: 2000000 }]);
  // a later change adds a step; each stretch keeps its own amount
  const later = set(s, 1800000, "2027-02");
  expect([limit(later, "2026-10"), limit(later, "2026-12"), limit(later, "2027-01"), limit(later, "2027-02")]).toEqual([2000000, 1500000, 1500000, 1800000]);
  expect(budgetSteps(doc(later))).toEqual([{ from: undefined, amount: 2000000 }, { from: "2026-11", amount: 1500000 }, { from: "2027-02", amount: 1800000 }]);
});

test("changing the amount again in the same period replaces the change, and changing it back leaves no trace", () => {
  const { s: base, set, limit, doc } = ledger();
  const fixed = set(set(base, 150000, "2026-11"), 1500000, "2026-11"); // a typo, corrected
  expect(doc(fixed).earlier).toEqual([{ until: "2026-11", amount: 2000000 }]);
  expect(limit(fixed, "2026-11")).toBe(1500000);
  const back = set(fixed, 2000000, "2026-11");
  expect(doc(back).earlier).toBeUndefined();
  expect(limit(back, "2026-10")).toBe(2000000);
  // saving the same amount later is not a change
  expect(doc(set(base, 2000000, "2026-12")).earlier).toBeUndefined();
});

test("a budget first set in a period has no earlier amount when it is changed in that period", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const r = run(s, "budgets.upsert", { period: "monthly", categoryId: food, amount: 2000000, from: "2026-11" });
  const id = r.result as Id<"budgets">;
  s = run(r.snap, "budgets.upsert", { id, period: "monthly", categoryId: food, amount: 1500000, from: "2026-11" }).snap;
  expect(s.budgets[0]).toMatchObject({ amount: 1500000, since: "2026-11" });
  expect(s.budgets[0].earlier).toBeUndefined();
  s = run(s, "budgets.upsert", { id, period: "monthly", categoryId: food, amount: 1000000, from: "2026-12" }).snap;
  expect(budgetSteps(s.budgets[0])).toEqual([{ from: "2026-11", amount: 1500000 }, { from: "2026-12", amount: 1000000 }]);
  // moved to another kind of period, month keys mean nothing: it starts over
  s = run(s, "budgets.upsert", { id, period: "yearly", categoryId: food, amount: 12000000, from: "2026" }).snap;
  expect(s.budgets[0]).toMatchObject({ period: "yearly", since: "2026" });
  expect(s.budgets[0].earlier).toBeUndefined();
});

test("an older app version, sending no period, replaces the current amount only", () => {
  const { s: base, set, limit } = ledger();
  expect(limit(set(base, 1500000), "2026-01")).toBe(1500000);
  const s = set(set(base, 1500000, "2026-11"), 1200000);
  expect([limit(s, "2026-10"), limit(s, "2026-11")]).toEqual([2000000, 1200000]);
});

test("a period's own amount still wins, and carrying over counts each period at the amount it had", () => {
  const { s: base, id, set, spend, limit } = ledger();
  let s = run(base, "budgets.setRollover", { id, from: "2026-10" }).snap;
  s = spend(s, "2026-10-10", 1700000); // 3,000 left of October's 20,000
  s = set(s, 1500000, "2026-11");
  s = spend(s, "2026-11-10", 1600000); // 2,000 left of November's 15,000 + 3,000
  expect(budgetStatus(s, "monthly", "2026-11")!.perCategory[0]).toMatchObject({ limit: 1800000, carry: 300000 });
  expect(budgetStatus(s, "monthly", "2026-12")!.perCategory[0]).toMatchObject({ limit: 1700000, carry: 200000 });
  s = run(s, "budgets.setOverride", { id, key: "2026-10", amount: 2500000 }).snap;
  expect(limit(s, "2026-10")).toBe(2500000);
});

test("amounts change scale with the currency's decimals, and survive a backup", () => {
  const { s: base, set, doc } = ledger();
  const s = set(base, 1500000, "2026-11");
  const whole = run(s, "settings.changeDecimals", { decimals: 0 }).snap;
  expect(doc(whole)).toMatchObject({ amount: 15000, earlier: [{ until: "2026-11", amount: 20000 }] });
  const target = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const restored = run(target, "backup.restore", { data: JSON.parse(JSON.stringify(backupExport(s))) }).snap;
  expect(restored.budgets[0]).toMatchObject({ amount: 1500000, earlier: [{ until: "2026-11", amount: 2000000 }] });
  expect(budgetStatus(restored, "monthly", "2026-10")!.perCategory[0].limit).toBe(2000000);
});

test("merging a category into another adds their budgets period by period, and undoing puts both back", () => {
  const { s: base, food, set, doc, limit } = ledger();
  let s = set(base, 1500000, "2026-11");
  const culture = s.categories.find((c) => c.name === "Culture")!._id;
  const r = run(s, "budgets.upsert", { period: "monthly", categoryId: culture, amount: 300000 });
  s = run(r.snap, "budgets.upsert", { id: r.result, period: "monthly", categoryId: culture, amount: 500000, from: "2026-12" }).snap;
  const merged = run(s, "categories.applyCleanup", { steps: [{ kind: "merge", sourceIds: [culture], target: { id: food } }] });
  expect(merged.snap.budgets).toHaveLength(1);
  expect(["2026-10", "2026-11", "2026-12"].map((k) => limit(merged.snap, k))).toEqual([2300000, 1800000, 2000000]);
  const undone = run(merged.snap, "categories.undoCleanup", { id: (merged.result as { cleanupId: string }).cleanupId }).snap;
  expect(doc(undone)).toMatchObject({ amount: 1500000, earlier: [{ until: "2026-11", amount: 2000000 }] });
  expect(undone.budgets.find((b) => b.categoryId === culture)).toMatchObject({ amount: 500000, earlier: [{ until: "2026-12", amount: 300000 }] });
});

test("a budget's history sets each amount against what went out while it applied", () => {
  const { s: base, id, set, spend } = ledger();
  let s = spend(base, "2026-09-10", 1900000);
  s = spend(s, "2026-10-10", 1700000);
  s = set(s, 1500000, "2026-11");
  s = spend(s, "2026-11-10", 1400000);
  s = spend(s, "2026-12-10", 1200000);
  s = spend(s, "2027-01-05", 100000); // the month running: not averaged
  const b = s.budgets.find((x) => x._id === id)!;
  expect(budgetHistory(s, b, "2027-01-15")).toEqual([
    { from: undefined, amount: 2000000, avgSpent: 1800000, periods: 2 },
    { from: "2026-11", amount: 1500000, avgSpent: 1300000, periods: 2 },
  ]);
});

const card = <K extends RecapCard["kind"]>(cards: RecapCard[], kind: K) => cards.find((c) => c.kind === kind) as Extract<RecapCard, { kind: K }>;

test("the recaps say when a budget's amount changed, and how spending moved around it", () => {
  const { s: base, set, spend } = ledger();
  let s = base;
  const household = s.categories.find((c) => c.name === "Household")!._id;
  for (let m = 1; m <= 12; m++) {
    const k = `2026-${String(m).padStart(2, "0")}`;
    for (let d = 1; d <= RECAP_MIN_ENTRIES; d++) s = spend(s, `${k}-0${d}`, 1000, household);
    s = spend(s, `${k}-15`, m < 11 ? 1800000 : 1400000);
  }
  s = set(s, 1500000, "2026-11");
  const row = (month: string) => card(monthRecap(s, month)!.cards, "budgets").rows!.find((r) => r.name === "Food")!;
  // October is still judged against 20,000: it held
  expect(row("2026-10")).toMatchObject({ limit: 2000000, spent: 1800000 });
  expect(row("2026-10").was).toBeUndefined();
  expect(row("2026-11")).toMatchObject({ limit: 1500000, was: 2000000, streak: 11 });
  expect(row("2026-12").was).toBeUndefined();
  const food = card(yearRecap(s, 2026)!.cards, "budgets").yearRows!.find((r) => r.name === "Food")!;
  expect(food).toMatchObject({ held: 12, over: 0, change: { month: 10, from: 2000000, to: 1500000, avgBefore: 1800000, avgAfter: 1400000 } });
});
