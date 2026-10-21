import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const op = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
const run = (snap: Snapshot, kind: string, args: unknown) => op(snap, kind, args).snap;

function fresh() {
  const s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" });
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const base = { type: "expense", accountId: s.accounts[0]._id, categoryId: food, tags: [], photoIds: [], note: "Gym" };
  return { s, base };
}

test("installments split the foreign-currency amount like the amount, remainder on the first", () => {
  const { s, base } = fresh();
  const r = op(s, "transactions.create", { ...base, date: "2026-01-10", amount: 10000, subAmount: 1000, subCurrency: "USD", installment: { count: 3 } });
  const rows = r.snap.transactions.filter((t) => t.repeatId).sort((a, b) => (a.date < b.date ? -1 : 1));
  expect(rows.map((t) => [t.date, t.amount, t.subAmount])).toEqual([["2026-01-10", 3334, 334], ["2026-02-10", 3333, 333], ["2026-03-10", 3333, 333]]);
});

test("'this and future' with a new date moves the later entries and the schedule with it", () => {
  const { s: s0, base } = fresh();
  let s = run(s0, "transactions.create", { ...base, date: "2026-01-05", amount: 500, repeat: { frequency: "monthly" } });
  s = run(s, "repeats.catchUp", { today: "2026-03-20" });
  const series = () => s.transactions.filter((t) => t.repeatId).map((t) => t.date).sort();
  expect(series()).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  // one of the later ones deleted on its own: the rest keep their place on the schedule
  s = run(s, "transactions.remove", { id: s.transactions.find((t) => t.date === "2026-02-05")!._id });
  const jan = s.transactions.find((t) => t.date === "2026-01-05")!;
  s = run(s, "transactions.update", { ...base, id: jan._id, scope: "future", date: "2026-01-20", amount: 700 });
  expect(series()).toEqual(["2026-01-20", "2026-03-20"]);
  expect(s.repeats[0]).toMatchObject({ startDate: "2026-01-20", nextDate: "2026-04-20" });
  s = run(s, "repeats.catchUp", { today: "2026-04-25" });
  expect(series()).toEqual(["2026-01-20", "2026-03-20", "2026-04-20"]);
  // the same date keeps everything where it was
  const mar = s.transactions.find((t) => t.date === "2026-03-20")!;
  s = run(s, "transactions.update", { ...base, id: mar._id, scope: "future", date: "2026-03-20", amount: 800 });
  expect(series()).toEqual(["2026-01-20", "2026-03-20", "2026-04-20"]);
});

test("editing a schedule checks its entry like any other and refuses an empty amount", () => {
  const { s: s0, base } = fresh();
  const s = run(s0, "transactions.create", { ...base, date: "2026-01-05", amount: 500, repeat: { frequency: "monthly" } });
  const rep = s.repeats[0];
  expect(() => op(s, "repeats.update", { id: rep._id, template: { ...rep.template, amount: 0 } })).toThrow("Enter an amount");
  const salary = s.categories.find((c) => c.name === "Salary")!._id;
  expect(() => op(s, "repeats.update", { id: rep._id, template: { ...rep.template, categoryId: salary } })).toThrow("Category type does not match");
  const ok = run(s, "repeats.update", { id: rep._id, template: { ...rep.template, amount: 900, note: " Gym " } });
  expect(ok.repeats[0].template).toMatchObject({ amount: 900, note: "Gym" });
});
