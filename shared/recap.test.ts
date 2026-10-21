import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { statsByCategory } from "./views";
import { monthRange, yearRange } from "./period";
import {
  monthRecap, recapIndex, recapNudge, recapText, yearQualifies, yearRecap, yearRecapNudge,
  PERSONALITY, RECAP_MIN_ENTRIES, RECAP_NUDGE_DAYS, RECAP_YEAR_MIN_MONTHS, RECAP_YEAR_NUDGE_DAYS, type RecapCard,
} from "./recap";

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
  // up to three more notes, only ones seen at least twice
  const g = fresh();
  september(g);
  for (const n of ["Lunch", "Uber", "Uber", "Gym", "Gym", "Tea"]) g.expense("2026-09-15", 100, "Food", n);
  expect(card(monthRecap(g.snap, "2026-09")!.cards, "repeat")!.nextNotes).toEqual([{ text: "Uber", count: 3 }, { text: "Lunch", count: 2 }, { text: "Gym", count: 2 }]);
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
  expect(big.runnersUp.map((r) => [r.note, r.amount, r.tx.date])).toEqual([["Rent", 62000, "2026-09-01"], ["Lunch", 9800, "2026-09-13"]]);
  expect(big.topShare).toBeCloseTo((184000 + 62000 + 9800) / 269100);
  const days = card(r.cards, "days")!;
  expect(days.perDay).toHaveLength(30);
  expect(days.busiest).toBe("2026-09-12");
  expect(days.busiestNotes).toEqual(["Flight to Goa", "COFFEE"]);
  expect(days.perDay[11]).toEqual({ date: "2026-09-12", amount: 186100, count: 2 });
  expect(days.noSpend).toBe(30 - 7);
  // 1 Sep 2026 is a Tuesday, so the weekends are 5–6, 12–13, 19–20 and 26–27 Sep
  expect(days.weekendShare).toBeCloseTo((1900 + 186100 + 9800 + 4500 + 3000) / 269100);
  expect(days.entriesPerDay).toBeCloseTo(8 / 30);
  const closer = card(r.cards, "closer")!.summary;
  expect(closer).toMatchObject({ spent: 269100, top: { name: "Transport" }, biggest: { note: "Flight to Goa", amount: 184000 }, noSpend: 23, entries: 8, range: r.range });
  // the colour signature: the top three categories in Stats order, shared by the cover and the closer
  expect(closer.strip.map((c) => c.name)).toEqual(["Transport", "Household", "Food"]);
  expect(card(r.cards, "cover")!.strip).toEqual(closer.strip);
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

test("a recap only judges the budgets that existed in its month", () => {
  const f = fresh();
  september(f);
  // made in October: September is not held against it, unless September got a limit of its own
  const at = (iso: string) => (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: new Date(iso).getTime() }, ctx);
  let s = run(f.snap, "budgets.upsert", { period: "monthly", categoryId: f.cat("Food"), amount: 10000 });
  const late = at("2026-10-05T10:00:00");
  const r = late(s, "budgets.upsert", { period: "monthly", categoryId: f.cat("Transport"), amount: 100000 });
  s = r.snap;
  expect(card(monthRecap(s, "2026-09")!.cards, "budgets")!.budgets).toEqual({ held: 0, total: 1, worst: { name: "Food", over: 5600 } });
  s = late(s, "budgets.setOverride", { id: r.result, key: "2026-09", amount: 50000 }).snap;
  expect(card(monthRecap(s, "2026-09")!.cards, "budgets")!.budgets).toEqual({ held: 0, total: 2, worst: { name: "Transport", over: 138500 } });
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
    range: { from: "2026-09-01", to: "2026-09-30" }, entries: 148, strip: [],
    spent: 8431000, change: -0.08, prevLabel: "August", top: { name: "Food", pct: 0.31 }, biggest: { note: "Flight to Goa", amount: 1840000 },
    keptPct: 30, noSpend: 5, repeat: { text: "Coffee", count: 22 },
  }, "September 2026", fmt)).toBe("September 2026 · UnMoney\nSpent ₹84,310 (8% less than Aug) · Top: Food 31% · Biggest: Flight to Goa ₹18,400\nKept 30% of income · 5 no-spend days · \"Coffee\" ×22");
  expect(recapText({ range: { from: "2026-05-01", to: "2026-05-31" }, entries: 5, strip: [], spent: 100, noSpend: 1 }, "May 2026", fmt)).toBe("May 2026 · UnMoney\nSpent ₹1\n1 no-spend day");
});

test("recapIndex lists every month with expenses, newest first, with the current month on top", () => {
  const f = fresh();
  september(f);
  f.expense("2026-06-03", 500, "Food", "Snack");
  f.expense("2026-06-10", 700, "Food", "Snack");
  f.income("2026-07-01", 100000); // income only: no row
  f.expense("2026-10-02", 620, "Food", "Groceries");
  const rows = recapIndex(f.snap, "2026-10-19");
  expect(rows.map((r) => [r.kind === "month" ? r.month : r.year, r.state, r.entries])).toEqual([
    ["2026-10", "current", 1],
    ["2026-09", "ready", 8],
    ["2026-06", "thin", 2],
  ]);
  expect(rows[0].readyOn).toBe("2026-11-01");
  expect(rows[1].cards).toBe(monthRecap(f.snap, "2026-09")!.cards.length);
  expect(rows[1].spent).toBe(269100);
  // an empty ledger still shows the current month, so the page can say when the first recap comes
  expect(recapIndex(fresh().snap, "2026-10-19")).toEqual([{ kind: "month", month: "2026-10", entries: 0, spent: 0, state: "current", readyOn: "2026-11-01" }]);
  // with monthStartDay 25 the current month's recap is ready the day after its logical end
  const g = fresh(25);
  expect(recapIndex(g.snap, "2026-10-19")[0]).toMatchObject({ month: "2026-09", state: "current", readyOn: "2026-10-25" });
});

// ---- the year (docs/specs/yearly-recap.md) ----

const yearCard = <K extends RecapCard["kind"]>(cards: RecapCard[], kind: K) => card(cards, kind)!;

/**
 * A full 2026: rent on the 1st (scheduled), coffee most days, lunches, a few big entries, times on
 * most entries, income every month, and a 2025 to compare with.
 */
function fullYear(f: ReturnType<typeof fresh>) {
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    f.expense(`2026-${mm}-01`, 60000, "Household", "Rent", { repeat: { frequency: "monthly" }, time: "09:00" });
    for (let d = 2; d <= 28; d += 2) f.expense(`2026-${mm}-${String(d).padStart(2, "0")}`, 180 + m, "Food", "Coffee", { time: d % 4 === 0 ? "20:15" : "08:30" });
    for (let d = 3; d <= 27; d += 4) f.expense(`2026-${mm}-${String(d).padStart(2, "0")}`, 450, "Food", "Lunch", { time: "13:05", accountId: f.bank._id });
    for (let d = 5; d <= 25; d += 5) f.expense(`2026-${mm}-${String(d).padStart(2, "0")}`, 330, "Transport", "Uber");
    f.income(`2026-${mm}-01`, 150000);
  }
  f.expense("2026-12-12", 80000, "Transport", "Flights to Lisbon", { time: "05:40", accountId: f.bank._id });
  f.expense("2026-07-03", 42500, "Apparel", "Laptop", { accountId: f.bank._id });
  // 2025: thinner, no Apparel, more Transport
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    f.expense(`2025-${mm}-01`, 55000, "Household", "Rent");
    f.expense(`2025-${mm}-10`, 9000, "Transport", "Trains");
    f.expense(`2025-${mm}-11`, 1000, "Food", "Lunch");
    f.expense(`2025-${mm}-12`, 1000, "Food", "Lunch");
    f.expense(`2025-${mm}-13`, 1000, "Food", "Lunch");
    f.income(`2025-${mm}-01`, 120000);
  }
}

test("the year total equals statsByCategory over yearRange, and the cards run in spec order", () => {
  const f = fresh();
  fullYear(f);
  const r = yearRecap(f.snap, 2026)!;
  const range = yearRange(2026, 1);
  expect(r.range).toEqual(range);
  expect(r.month).toBe("2026");
  const stats = statsByCategory(f.snap, range.from, range.to, "expense");
  expect(yearCard(r.cards, "total").amount).toBe(stats.total);
  expect(yearCard(r.cards, "total").scope).toBe("year");
  expect(yearCard(r.cards, "total").prevLabel).toBe("2025");
  expect(yearCard(r.cards, "categories").total).toBe(stats.total);
  expect(yearCard(r.cards, "categories").top.map((t) => t.id)).toEqual(stats.items.slice(0, 5).map((i) => i.id));
  expect(yearCard(r.cards, "months").perMonth.reduce((s, m) => s + m.amount, 0)).toBe(stats.total);
  expect(kinds(r.cards)).toEqual(["cover", "total", "months", "categories", "top5", "biggest", "calendar", "clock", "methods", "changes", "new", "inout", "personality", "closer"]);
  expect(yearCard(r.cards, "cover")).toMatchObject({ scope: "year", count: 14, days: 365 });
  expect(yearCard(r.cards, "changes")).toMatchObject({ scope: "year", prevLabel: "2025", threshold: stats.total * 0.02 });
  expect(yearCard(r.cards, "biggest").tx.note).toBe("Flights to Lisbon");
  // only notes seen more than once make the list
  expect(yearCard(r.cards, "top5").notes.map((n) => [n.text, n.count])).toEqual([["Coffee", 14 * 12], ["Lunch", 7 * 12], ["Uber", 5 * 12], ["Rent", 12]]);
  expect(yearCard(r.cards, "top5").everyDays).toBeCloseTo(365 / (14 * 12));
  const inout = yearCard(r.cards, "inout");
  expect(inout.income).toBe(150000 * 12);
  expect(inout.keptPct).toBe(Math.round(((150000 * 12 - stats.total) / (150000 * 12)) * 100));
  expect(inout.bestMonth).toBeDefined();
  expect(inout.budgetMonths).toBeUndefined();
  const closer = yearCard(r.cards, "closer").summary;
  expect(closer).toMatchObject({ spent: stats.total, prevLabel: "2025", biggest: { note: "Flights to Lisbon", amount: 80000 }, repeat: { text: "Coffee", count: 14 * 12 } });
  expect(closer.personality).toBeDefined();
});

test("a year needs RECAP_YEAR_MIN_MONTHS qualifying months", () => {
  const f = fresh();
  for (let m = 1; m < RECAP_YEAR_MIN_MONTHS; m++) for (let i = 1; i <= RECAP_MIN_ENTRIES; i++) f.expense(`2026-0${m}-0${i}`, 100, "Food", `n${i}`);
  expect(yearQualifies(f.snap, 2026)).toBe(false);
  expect(yearRecap(f.snap, 2026)).toBeNull();
  // a thin month does not count
  for (let i = 1; i < RECAP_MIN_ENTRIES; i++) f.expense(`2026-0${RECAP_YEAR_MIN_MONTHS}-0${i}`, 100, "Food", `n${i}`);
  expect(yearQualifies(f.snap, 2026)).toBe(false);
  f.expense(`2026-0${RECAP_YEAR_MIN_MONTHS}-09`, 100, "Food", "last");
  expect(yearQualifies(f.snap, 2026)).toBe(true);
  const r = yearRecap(f.snap, 2026)!;
  // a sparse year: no previous year, no times, one method, no income
  expect(kinds(r.cards)).toEqual(["cover", "total", "months", "biggest", "calendar", "personality", "closer"]);
  expect(yearCard(r.cards, "total").change).toBeUndefined();
});

test("months: the priciest and lightest months, against the average of the months with entries", () => {
  const f = fresh();
  const amounts = [72, 61, 88, 79, 83, 90, 95, 84, 84, 81, 79, 112];
  amounts.forEach((a, i) => { for (let d = 1; d <= 5; d++) f.expense(`2026-${String(i + 1).padStart(2, "0")}-0${d}`, (a * 1000) / 5, "Food", `n${d}`); });
  const m = yearCard(yearRecap(f.snap, 2026)!.cards, "months");
  expect(m.priciest).toBe("2026-12");
  expect(m.lightest).toBe("2026-02");
  expect(m.ratio).toBeCloseTo(112 / 61);
  const avg = amounts.reduce((s, a) => s + a, 0) / 12;
  expect(m.aboveAvg).toBe(amounts.filter((a) => a > avg).length);
  expect(m.swing).toBeCloseTo(amounts.reduce((s, a) => s + Math.abs(a - avg), 0) / 12 / avg);
  expect(m.perMonth.map((x) => x.amount)).toEqual(amounts.map((a) => a * 1000));
});

test("each personality rule fires on a constructed year, and a flat year is The All-Rounder", () => {
  const base = () => {
    const f = fresh();
    // a flat year: six categories at equal share on fixed days, months swinging well past 15%, no repeats, no times
    const cats = ["Food", "Household", "Transport", "Apparel", "Health", "Culture"];
    for (let m = 1; m <= 12; m++) cats.forEach((c, i) => { for (let k = 0; k < 2; k++) f.expense(`2026-${String(m).padStart(2, "0")}-${String(6 + i * 2 + k * 10).padStart(2, "0")}`, 1000 * (1 + (m % 3)), c, `${c} ${k}`); });
    return f;
  };
  const archetype = (f: { snap: Snapshot }) => yearCard(yearRecap(f.snap, 2026)!.cards, "personality");
  const flat = archetype(base());
  expect(flat.archetype).toBe("The All-Rounder");
  expect(flat.why).toBe("No single thing dominated: spread across categories, days and months.");
  expect(flat.traits).toHaveLength(4);
  expect(flat.traits.every((t) => !t.matched)).toBe(true);
  // The Planner: scheduled entries ≥ 35% of spend (the base year is 288,000)
  const planner = base();
  planner.expense("2026-03-15", 200000, "Household", "Rent", { repeat: { frequency: "monthly" } });
  expect(archetype(planner).archetype).toBe("The Planner");
  expect(archetype(planner).traits[0]).toMatchObject({ label: "Scheduled entries", matched: true });
  // The Planner by budgets: every budget held in 9+ months
  let withBudget = run(base().snap, "budgets.upsert", { period: "monthly", amount: 100000000 });
  const byBudget = archetype({ snap: withBudget });
  expect(byBudget.archetype).toBe("The Planner");
  expect(byBudget.traits[0]).toEqual({ label: "Months within budget", value: "12 of 12", matched: true });
  expect(byBudget.traits.slice(1).every((t) => !t.matched)).toBe(true);
  withBudget = run(withBudget, "budgets.upsert", { period: "monthly", amount: 1 });
  expect(archetype({ snap: withBudget }).archetype).toBe("The All-Rounder");
  // The Homebody: Household ≥ 40%
  const home = base();
  home.expense("2026-03-15", 150000, "Household", "Deposit");
  expect(archetype(home).archetype).toBe("The Homebody");
  // The Foodie: Food ≥ 30%, widened by a category whose name says food
  const foodie = base();
  foodie.expense("2026-03-15", 70000, "Food", "Feast");
  expect(archetype(foodie).archetype).toBe("The Foodie");
  const eating = fresh();
  let s2 = run(eating.snap, "categories.create", { type: "expense", name: "Eating out" });
  const eatId = s2.categories.find((c) => c.name === "Eating out")!._id;
  for (let m = 1; m <= 12; m++) {
    s2 = run(s2, "transactions.create", { type: "expense", accountId: eating.cash._id, categoryId: eatId, amount: 1000, note: "Dinner", date: `2026-${String(m).padStart(2, "0")}-10`, tags: [], photoIds: [] });
    for (let k = 1; k <= 5; k++) s2 = run(s2, "transactions.create", { type: "expense", accountId: eating.cash._id, categoryId: eating.cat(k <= 2 ? "Household" : "Culture"), amount: 300, note: `h${k}`, date: `2026-${String(m).padStart(2, "0")}-1${k}`, tags: [], photoIds: [] });
  }
  expect(archetype({ snap: s2 }).archetype).toBe("The Foodie");
  expect(archetype({ snap: s2 }).traits[0]).toEqual({ label: "Food", value: "40% of spend", matched: true });
  // The Explorer: Travel + Transport ≥ 20%
  const explorer = base();
  explorer.expense("2026-03-15", 20000, "Transport", "Flights");
  expect(archetype(explorer).archetype).toBe("The Explorer");
  // The Weekender: ≥ 45% on Saturdays and Sundays (6 Jun 2026 is a Saturday)
  const weekender = base();
  weekender.expense("2026-06-06", 150000, "Health", "Marathon");
  expect(archetype(weekender).archetype).toBe("The Weekender");
  // The Night Owl: ≥ 40% of timed entries at or after 21:00, with times on at least half the entries
  const owl = base();
  for (let m = 1; m <= 12; m++) for (let k = 0; k < 13; k++) owl.expense(`2026-${String(m).padStart(2, "0")}-2${k % 8 + 1}`, 10, "Food", "Late snack", { time: "22:30" });
  expect(archetype(owl).archetype).toBe("The Night Owl");
  expect(archetype(owl).traits[0]).toEqual({ label: "After 9 pm", value: "100% of entries", matched: true });
  // The Big-Day Spender: the ten largest entries ≥ 40% of the year
  const big = base();
  big.expense("2026-03-15", 60000, "Health", "Surgery");
  big.expense("2026-03-16", 60000, "Apparel", "Suit");
  big.expense("2026-04-16", 60000, "Culture", "Festival");
  expect(archetype(big).archetype).toBe("The Big-Day Spender");
});

test("The Steady Hand fires on even months, and not on a swinging year", () => {
  // even months, spread over many categories so nothing else fires
  const f = fresh();
  const cats = ["Food", "Household", "Transport", "Apparel", "Health", "Culture", "Pets", "Beauty"];
  for (let m = 1; m <= 12; m++) cats.forEach((c, i) => f.expense(`2026-${String(m).padStart(2, "0")}-${String(3 + i * 2).padStart(2, "0")}`, 1000, c, c));
  const p = yearCard(yearRecap(f.snap, 2026)!.cards, "personality");
  expect(p.archetype).toBe("The Steady Hand");
  expect(p.traits[0]).toEqual({ label: "Month swing", value: "±0%", matched: true });
  f.expense("2026-12-15", 20000, "Culture", "Concert");
  expect(yearCard(yearRecap(f.snap, 2026)!.cards, "personality").archetype).toBe("The All-Rounder");
});

test("On the clock is skipped when fewer than half the entries have a time", () => {
  const f = fresh();
  for (let m = 1; m <= 12; m++) for (let k = 1; k <= 6; k++) f.expense(`2026-${String(m).padStart(2, "0")}-0${k}`, 100, "Food", `n${k}`, k <= 3 ? { time: `${String(18 + k).padStart(2, "0")}:00` } : {});
  // exactly half: enough
  const half = yearCard(yearRecap(f.snap, 2026)!.cards, "clock");
  expect(half).toMatchObject({ timed: 36, total: 72, peakHour: 19, morningShare: 0 });
  expect(half.eveningShare).toBe(1);
  expect(half.perHour[19]).toBe(12);
  expect(half.first).toEqual({ time: "19:00", note: "n1", date: "2026-01-01" });
  f.expense("2026-06-20", 100, "Food", "untimed");
  expect(card(yearRecap(f.snap, 2026)!.cards, "clock")).toBeUndefined();
});

test("New this year ignores categories and methods used the year before", () => {
  const f = fresh();
  fullYear(f);
  const n = yearCard(yearRecap(f.snap, 2026)!.cards, "new");
  // Apparel has one entry (under 5), Food and Transport existed in 2025; the bank account is new in 2026 with 12+ lunches
  expect(n.items.map((i) => [i.kind, i.name])).toEqual([["account", f.bank.name]]);
  expect(n.items[0]).toMatchObject({ first: "2026-01-03", count: 7 * 12 + 2 });
  // a category used in 2025 never counts, even with many entries
  f.expense("2025-05-05", 100, "Apparel", "Socks");
  for (let m = 1; m <= 6; m++) f.expense(`2026-0${m}-20`, 2000, "Apparel", "Shirt");
  expect(yearCard(yearRecap(f.snap, 2026)!.cards, "new").items.some((i) => i.name === "Apparel")).toBe(false);
  // one never used before does, from its first entry
  for (let m = 1; m <= 6; m++) f.expense(`2026-0${m}-21`, 500, "Health", "Gym");
  const items = yearCard(yearRecap(f.snap, 2026)!.cards, "new").items;
  expect(items.find((i) => i.name === "Health")).toEqual({ kind: "category", name: "Health", first: "2026-01-21", count: 6, amount: 3000 });
});

test("the calendar's rows follow monthStartDay 25", () => {
  const f = fresh(25);
  for (let m = 1; m <= 12; m++) { for (let k = 5; k <= 8; k++) f.expense(`2026-${String(m).padStart(2, "0")}-2${k}`, 100 * k, "Food", `n${k}`); f.expense(`2026-${String(m).padStart(2, "0")}-25`, 100, "Food", "n0"); }
  const r = yearRecap(f.snap, 2026)!;
  expect(r.range).toEqual({ from: "2026-01-25", to: "2027-01-24" });
  const cal = yearCard(r.cards, "calendar");
  expect(cal.rows).toHaveLength(12);
  expect(cal.rows[0]).toEqual({ month: "2026-01", from: "2026-01-25", days: 31 });
  expect(cal.rows[1]).toEqual({ month: "2026-02", from: "2026-02-25", days: 28 });
  expect(cal.rows[11]).toEqual({ month: "2026-12", from: "2026-12-25", days: 31 });
  expect(cal.perDay).toHaveLength(365);
  expect(cal.perDay[0].date).toBe("2026-01-25");
  expect(cal.rows.reduce((s, x) => s + x.days, 0)).toBe(365);
  // 25–28 of each month: a four-day streak
  expect(cal.streak).toBe(4);
  expect(cal.noSpend).toBe(365 - 48);
  expect(cal.busiest).toBe("2026-01-28");
  expect(cal.busiestNotes).toEqual(["n8"]);
  expect(cal.spendDay.share).toBeGreaterThan(0);
});

test("yearRecapNudge: the previous year during the first 14 days of logical month 1", () => {
  const f = fresh();
  fullYear(f);
  expect(yearRecapNudge(f.snap, "2027-01-01")).toBe(2026);
  expect(yearRecapNudge(f.snap, `2027-01-${RECAP_YEAR_NUDGE_DAYS}`)).toBe(2026);
  expect(yearRecapNudge(f.snap, `2027-01-${RECAP_YEAR_NUDGE_DAYS + 1}`)).toBeNull();
  expect(yearRecapNudge(f.snap, "2026-12-31")).toBeNull();
  expect(yearRecapNudge(f.snap, "2027-02-03")).toBeNull();
  // 2025 has five entries a month, so it qualifies too; an empty 2024 does not
  expect(yearRecapNudge(f.snap, "2026-01-03")).toBe(2025);
  expect(yearRecapNudge(f.snap, "2025-01-03")).toBeNull();
  // with monthStartDay 25, logical 2026 runs 25 Jan 2026 – 24 Jan 2027 and logical January 2027 starts on 25 Jan 2027
  const g = fresh(25);
  for (let m = 1; m <= 12; m++) { for (let k = 5; k <= 8; k++) g.expense(`2026-${String(m).padStart(2, "0")}-2${k}`, 100, "Food", `n${k}`); g.expense(`2026-${String(m).padStart(2, "0")}-25`, 100, "Food", "n0"); }
  expect(yearRecapNudge(g.snap, "2027-01-25")).toBe(2026);
  expect(yearRecapNudge(g.snap, "2027-02-07")).toBe(2026);
  expect(yearRecapNudge(g.snap, "2027-02-08")).toBeNull();
  expect(yearRecapNudge(g.snap, "2027-01-24")).toBeNull();
  expect(yearRecapNudge(g.snap, "2027-01-03")).toBeNull();
});

test("recapIndex puts a year row before each finished year's months", () => {
  const f = fresh();
  fullYear(f);
  const rows = recapIndex(f.snap, "2027-01-03");
  expect(rows[0]).toMatchObject({ kind: "month", month: "2027-01", state: "current" });
  expect(rows[1]).toMatchObject({ kind: "year", year: 2026, state: "ready", months: 12, cards: 14 });
  expect(rows[2]).toMatchObject({ kind: "month", month: "2026-12", state: "ready" });
  expect(rows.find((r) => r.kind === "year" && r.year === 2025)).toMatchObject({ kind: "year", state: "ready", months: 12 });
  // a year with too few qualifying months is listed, muted
  const h = fresh();
  for (let m = 1; m <= 2; m++) for (let k = 1; k <= 5; k++) h.expense(`2025-0${m}-0${k}`, 100, "Food", `n${k}`);
  const thin = recapIndex(h.snap, "2026-10-19").find((r) => r.kind === "year")!;
  expect(thin).toMatchObject({ kind: "year", year: 2025, state: "thin", months: 2, entries: 10, spent: 1000 });
  expect(thin.cards).toBeUndefined();
  // the year's spent is the Stats figure for the year
  expect(rows[1].spent).toBe(statsByCategory(f.snap, "2026-01-01", "2026-12-31", "expense").total);
  // the current year has no row
  expect(recapIndex(f.snap, "2026-10-19").some((r) => r.kind === "year" && r.year === 2026)).toBe(false);
});

test("recapText writes the four-line year summary", () => {
  const fmt = (n: number) => `₹${(n / 100).toLocaleString("en-IN")}`;
  expect(recapText({
    range: { from: "2026-01-01", to: "2026-12-31" }, entries: 1842, strip: [],
    spent: 98431000, change: 0.06, prevLabel: "2025", top: { name: "Food", pct: 0.27 }, biggest: { note: "Flights to Lisbon", amount: 4800000 },
    keptPct: 34, noSpend: 58, repeat: { text: "Coffee", count: 226 }, personality: "The Planner",
  }, "2026", fmt, "year")).toBe("2026 · UnMoney\nSpent ₹9,84,310 (6% more than 2025)\nTop: Food 27% · Biggest: Flights to Lisbon ₹48,000 · Most logged: \"Coffee\" ×226\nKept 34% of income · 58 no-spend days · The Planner");
});
