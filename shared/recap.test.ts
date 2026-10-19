import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { statsByCategory } from "./views";
import { monthRange } from "./period";
import { monthRecap, recapNudge, recapText, RECAP_MIN_ENTRIES, RECAP_NUDGE_DAYS, type RecapCard } from "./recap";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;

function fresh(monthStartDay = 1) {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" });
  if (monthStartDay !== 1) s = run(s, "settings.update", { patch: { monthStartDay } });
  const cat = (name: string) => s.categories.find((c) => c.name === name)!._id;
  const [cash, bank] = s.accounts;
  const base = { accountId: cash._id, tags: [], photoIds: [], description: undefined };
  const expense = (date: string, amount: number, category: string, note = "", extra: Record<string, unknown> = {}) => {
    s = run(s, "transactions.create", { ...base, type: "expense", categoryId: cat(category), amount, note, date, ...extra });
  };
  const income = (date: string, amount: number) => {
    s = run(s, "transactions.create", { ...base, type: "income", categoryId: cat("Salary"), amount, note: "Pay", date });
  };
  return { get snap() { return s; }, expense, income, cat, cash, bank };
}

const kinds = (cards: RecapCard[]) => cards.map((c) => c.kind);
const card = <K extends RecapCard["kind"]>(cards: RecapCard[], kind: K) => cards.find((c) => c.kind === kind) as Extract<RecapCard, { kind: K }> | undefined;

/** A September with enough in it for every card. */
function september(f: ReturnType<typeof fresh>) {
  f.expense("2026-09-01", 62000, "Household", "Rent");
  f.expense("2026-09-02", 1800, "Food", "coffee");
  f.expense("2026-09-05", 1900, "Food", "Coffee ");
  f.expense("2026-09-12", 2100, "Food", "COFFEE");
  f.expense("2026-09-12", 184000, "Transport", "Flight to Goa");
  f.expense("2026-09-13", 9800, "Food", "Lunch");
  f.expense("2026-09-20", 4500, "Transport", "Uber");
  f.expense("2026-09-26", 3000, "Social Life", "");
}

test("the recap total is exactly the month's Expenses figure on Stats, with the same categories", () => {
  const f = fresh();
  september(f);
  // a transfer to an account that counts as expense, like Stats counts it
  let s = run(f.snap, "accounts.update", { ...f.bank, id: f.bank._id, transferAsExpense: true });
  s = run(s, "transactions.create", { type: "transfer", accountId: f.cash._id, toAccountId: f.bank._id, amount: 5000, note: "", tags: [], photoIds: [], date: "2026-09-28" });
  const r = monthRecap(s, "2026-09")!;
  const stats = statsByCategory(s, "2026-09-01", "2026-09-30", "expense");
  expect(card(r.cards, "total")!.amount).toBe(stats.total);
  const cats = card(r.cards, "categories")!;
  expect(cats.total).toBe(stats.total);
  expect(cats.top.map((t) => t.id)).toEqual(stats.items.slice(0, 3).map((i) => i.id));
  expect(cats.top.reduce((a, t) => a + t.amount, 0) + cats.rest.amount).toBe(stats.total);
  expect(cats.rest.count).toBe(stats.items.length - 3);
  expect(r.range).toEqual(monthRange("2026-09", 1));
});

test("fewer than RECAP_MIN_ENTRIES expense entries gives no recap, and income entries do not count", () => {
  const f = fresh();
  for (let i = 0; i < RECAP_MIN_ENTRIES - 1; i++) f.expense(`2026-09-0${i + 1}`, 100, "Food");
  f.income("2026-09-01", 100000);
  f.income("2026-09-02", 100000);
  expect(monthRecap(f.snap, "2026-09")).toBeNull();
  f.expense("2026-09-09", 100, "Food");
  expect(monthRecap(f.snap, "2026-09")).not.toBeNull();
});

test("the cards that do not apply are skipped: no income, no previous month, one category", () => {
  const f = fresh();
  september(f);
  const r = monthRecap(f.snap, "2026-09")!;
  expect(kinds(r.cards)).toEqual(["cover", "total", "categories", "biggest", "days", "repeat", "closer"]);
  expect(card(r.cards, "cover")!.count).toBe(r.cards.length);
  expect(card(r.cards, "total")!.prev).toBeUndefined();

  // a month with five entries in one category: cards 1, 2, 4, 5, 9 only
  const g = fresh();
  for (let i = 1; i <= 5; i++) g.expense(`2026-09-0${i}`, 100 * i, "Food", `note ${i}`);
  expect(kinds(monthRecap(g.snap, "2026-09")!.cards)).toEqual(["cover", "total", "biggest", "days", "closer"]);
});

test("income adds the in-vs-out card and a previous month adds what changed", () => {
  const f = fresh();
  september(f);
  f.income("2026-09-01", 400000);
  // August: Transport was much bigger, Food about the same, Household absent
  f.expense("2026-08-03", 60000, "Transport", "Trains");
  f.expense("2026-08-10", 12000, "Food", "Coffee");
  f.income("2026-08-01", 300000);
  const r = monthRecap(f.snap, "2026-09")!;
  expect(kinds(r.cards)).toEqual(["cover", "total", "categories", "biggest", "days", "repeat", "changes", "inout", "closer"]);

  const total = card(r.cards, "total")!;
  expect(total.prev).toBe(72000);
  expect(total.prevLabel).toBe("August");
  expect(total.change).toBeCloseTo((269100 - 72000) / 72000);

  const inout = card(r.cards, "inout")!;
  expect(inout.income).toBe(400000);
  expect(inout.spent).toBe(269100);
  expect(inout.keptPct).toBe(Math.round(((400000 - 269100) / 400000) * 100));
  expect(inout.prevKeptPct).toBe(Math.round(((300000 - 72000) / 300000) * 100));
  expect(inout.budgets).toBeUndefined();

  const changes = card(r.cards, "changes")!;
  expect(changes.prevLabel).toBe("August");
  expect(changes.threshold).toBeCloseTo(269100 * 0.05);
  // Transport moved most, then Household (new); Food's +3,600 is under the 5% threshold (13,455)
  expect(changes.movers.map((m) => [m.name, m.before, m.after])).toEqual([
    ["Transport", 60000, 188500],
    ["Household", 0, 62000],
  ]);
  expect(changes.movers[0].pct).toBeCloseTo((188500 - 60000) / 60000);
  expect(changes.movers[1].pct).toBeUndefined();
});

test("a previous month with no entries means no what-changed card and no comparison", () => {
  const f = fresh();
  september(f);
  f.expense("2026-07-03", 60000, "Transport", "July only");
  const r = monthRecap(f.snap, "2026-09")!;
  expect(card(r.cards, "changes")).toBeUndefined();
  expect(card(r.cards, "total")!.change).toBeUndefined();
});

test("notes are grouped case-insensitively and trimmed; empty notes are skipped", () => {
  const f = fresh();
  september(f);
  const rep = card(monthRecap(f.snap, "2026-09")!.cards, "repeat")!;
  expect(rep.note).toEqual({ text: "coffee", count: 3, amount: 5800 });
  expect(rep.nextNotes).toEqual([]);
  expect(rep.scheduled).toBeUndefined();
  expect(rep.account).toEqual({ name: f.cash.name, share: 1 });
  expect(card(monthRecap(f.snap, "2026-09")!.cards, "closer")!.summary.repeat).toEqual({ text: "coffee", count: 3 });
});

test("scheduled entries count on the repeat card even without a repeated note", () => {
  const f = fresh();
  f.expense("2026-09-01", 50000, "Household", "Rent", { repeat: { frequency: "monthly" } });
  for (let i = 2; i <= 6; i++) f.expense(`2026-09-0${i}`, 100, "Food", `thing ${i}`);
  const rep = card(monthRecap(f.snap, "2026-09")!.cards, "repeat")!;
  expect(rep.note).toBeUndefined();
  expect(rep.scheduled).toEqual({ amount: 50000, count: 1 });
});

test("biggest spend, days and the closer come from the same entries", () => {
  const f = fresh();
  september(f);
  const r = monthRecap(f.snap, "2026-09")!;
  const big = card(r.cards, "biggest")!;
  expect(big.tx.note).toBe("Flight to Goa");
  expect(big.share).toBeCloseTo(184000 / 269100);
  // an empty note falls back to the category name
  expect(big.runnersUp).toEqual([{ note: "Rent", amount: 62000 }, { note: "Lunch", amount: 9800 }]);
  const days = card(r.cards, "days")!;
  expect(days.perDay).toHaveLength(30);
  expect(days.busiest).toBe("2026-09-12");
  expect(days.perDay[11]).toEqual({ date: "2026-09-12", amount: 186100, count: 2 });
  expect(days.noSpend).toBe(30 - 7);
  // 1 Sep 2026 is a Tuesday, so the weekends are 5–6, 12–13, 19–20 and 26–27 Sep
  expect(days.weekendShare).toBeCloseTo((1900 + 186100 + 9800 + 4500 + 3000) / 269100);
  expect(days.entriesPerDay).toBeCloseTo(8 / 30);
  const closer = card(r.cards, "closer")!.summary;
  expect(closer).toMatchObject({ spent: 269100, top: { name: "Transport" }, biggest: { note: "Flight to Goa", amount: 184000 }, noSpend: 23 });
  expect(closer.keptPct).toBeUndefined();
});

test("budgets ride on the in-vs-out card, or get a card of their own without income", () => {
  const f = fresh();
  september(f);
  let s = run(f.snap, "budgets.upsert", { period: "monthly", amount: 300000 });
  s = run(s, "budgets.upsert", { period: "monthly", categoryId: f.cat("Food"), amount: 10000 });
  s = run(s, "budgets.upsert", { period: "monthly", categoryId: f.cat("Transport"), amount: 100000 });
  const alone = monthRecap(s, "2026-09")!;
  expect(card(alone.cards, "inout")).toBeUndefined();
  expect(card(alone.cards, "budgets")!.budgets).toEqual({ held: 1, total: 3, worst: { name: "Transport", over: 88500 } });
  s = run(s, "transactions.create", { type: "income", accountId: f.cash._id, categoryId: f.cat("Salary"), amount: 500000, note: "", tags: [], photoIds: [], date: "2026-09-01" });
  const withIncome = monthRecap(s, "2026-09")!;
  expect(card(withIncome.cards, "budgets")).toBeUndefined();
  expect(card(withIncome.cards, "inout")!.budgets).toEqual({ held: 1, total: 3, worst: { name: "Transport", over: 88500 } });
});

test("with monthStartDay 25 the recap covers 25 Sep to 24 Oct and compares the same logical months", () => {
  const f = fresh(25);
  for (let i = 0; i < 5; i++) f.expense(`2026-09-2${5 + i}`, 1000, "Food", "Coffee");
  f.expense("2026-10-24", 7000, "Transport", "Last day");
  f.expense("2026-10-25", 99999, "Transport", "Next month");
  f.expense("2026-09-24", 99999, "Transport", "Previous month");
  const r = monthRecap(f.snap, "2026-09")!;
  expect(r.range).toEqual({ from: "2026-09-25", to: "2026-10-24" });
  expect(card(r.cards, "total")!.amount).toBe(12000);
  expect(card(r.cards, "days")!.perDay).toHaveLength(30);
  expect(card(r.cards, "cover")!.days).toBe(30);
});

test("recapNudge: the previous month during its first week, when it qualifies", () => {
  const f = fresh();
  september(f);
  expect(recapNudge(f.snap, "2026-10-01")).toBe("2026-09");
  expect(recapNudge(f.snap, `2026-10-0${RECAP_NUDGE_DAYS}`)).toBe("2026-09");
  expect(recapNudge(f.snap, `2026-10-0${RECAP_NUDGE_DAYS + 1}`)).toBeNull();
  expect(recapNudge(f.snap, "2026-09-30")).toBeNull();
  // the month after: October has nothing in it
  expect(recapNudge(f.snap, "2026-11-02")).toBeNull();
  // across a year boundary
  const g = fresh();
  for (let i = 1; i <= 5; i++) g.expense(`2025-12-1${i}`, 100, "Food");
  expect(recapNudge(g.snap, "2026-01-03")).toBe("2025-12");
});

test("recapNudge with monthStartDay 25 counts the week from the 25th", () => {
  const f = fresh(25);
  for (let i = 0; i < 5; i++) f.expense(`2026-09-2${5 + i}`, 1000, "Food");
  // 25–31 Oct are the first 7 days of logical October; September is the previous month
  expect(recapNudge(f.snap, "2026-10-25")).toBe("2026-09");
  expect(recapNudge(f.snap, "2026-10-31")).toBe("2026-09");
  expect(recapNudge(f.snap, "2026-11-01")).toBeNull();
  // 1–7 Oct are mid-September (logical), so no nudge
  expect(recapNudge(f.snap, "2026-10-03")).toBeNull();
});

test("recapText writes the three-line summary", () => {
  const fmt = (n: number) => `₹${(n / 100).toLocaleString("en-IN")}`;
  expect(recapText({
    spent: 8431000, change: -0.08, prevLabel: "August", top: { name: "Food", pct: 0.31 }, biggest: { note: "Flight to Goa", amount: 1840000 },
    keptPct: 30, noSpend: 5, repeat: { text: "Coffee", count: 22 },
  }, "September 2026", fmt)).toBe("September 2026 · UnMoney\nSpent ₹84,310 (8% less than Aug) · Top: Food 31% · Biggest: Flight to Goa ₹18,400\nKept 30% of income · 5 no-spend days · \"Coffee\" ×22");
  expect(recapText({ spent: 100, noSpend: 1 }, "May 2026", fmt)).toBe("May 2026 · UnMoney\nSpent ₹1\n1 no-spend day");
});
