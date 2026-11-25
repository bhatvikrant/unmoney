import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { charged, chargeSignals } from "./chargeSignals";
import { recurringSuggestions } from "./upcoming";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;

const TODAY = "2026-10-21";
const base = () => run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" });

/** Expenses with the same note on the given dates and amounts, added to `s`; `extra` goes on every one. */
function pay(s: Snapshot, list: [string, number][], note: string, extra: object = {}) {
  const food = s.categories.find((c) => c.name === "Food")!._id;
  for (const [date, amount] of list) s = run(s, "transactions.create", { type: "expense", date, accountId: s.accounts[0]._id, categoryId: food, amount, note, tags: [], photoIds: [], ...extra });
  return s;
}
const dismiss = (s: Snapshot, key: string) => run(s, "settings.update", { patch: { dismissedRecurring: [...(s.settings[0].dismissedRecurring ?? []), key] } });

const NETFLIX: [string, number][] = [["2026-07-12", 49900], ["2026-08-12", 49900], ["2026-09-12", 49900], ["2026-10-12", 64900]];

test("a price that steps up is reported once, with the month it went up in", () => {
  let s = pay(base(), NETFLIX, "Netflix");
  const { rises, doubles } = chargeSignals(s, TODAY);
  expect(doubles).toEqual([]);
  expect(rises).toHaveLength(1);
  expect(rises[0].key).toBe("PRICE|netflix||64900");
  expect([rises[0].before.date, rises[0].before.amount]).toEqual(["2026-09-12", 49900]);
  // "Netflix went from ₹499 to ₹649 in October"
  expect([rises[0].after.date, rises[0].after.amount]).toEqual(["2026-10-12", 64900]);
  // the next month at the new price is the same rise, still October's
  s = pay(s, [["2026-11-12", 64900]], "NETFLIX ");
  const later = chargeSignals(s, "2026-11-20").rises;
  expect(later.map((r) => [r.key, r.after.date])).toEqual([["PRICE|netflix||64900", "2026-10-12"]]);
  // two months on it is old news
  expect(chargeSignals(pay(s, [["2026-12-12", 64900]], "Netflix"), "2026-12-20").rises).toEqual([]);
});

test("no price rise: a bill that varies, too little history, a small or downward change, an unsteady interval", () => {
  const rises = (list: [string, number][]) => chargeSignals(pay(base(), list, "Bill"), TODAY).rises;
  // electricity: never the same twice
  expect(rises([["2026-06-12", 121000], ["2026-07-12", 135500], ["2026-08-12", 128000], ["2026-09-12", 131200], ["2026-10-12", 170000]])).toEqual([]);
  // two months at a price is not yet a settled price
  expect(rises([["2026-08-12", 49900], ["2026-09-12", 49900], ["2026-10-12", 64900]])).toEqual([]);
  expect(rises([["2026-07-12", 49900], ["2026-08-12", 49900], ["2026-09-12", 49900], ["2026-10-12", 51900]])).toEqual([]);
  expect(rises([["2026-07-12", 64900], ["2026-08-12", 64900], ["2026-09-12", 64900], ["2026-10-12", 49900]])).toEqual([]);
  // bought now and then, not on a schedule
  expect(rises([["2026-08-01", 49900], ["2026-08-09", 49900], ["2026-09-12", 49900], ["2026-10-12", 64900]])).toEqual([]);
  // the price moved twice: nothing settled to compare with
  expect(rises([["2026-06-12", 49900], ["2026-07-12", 49900], ["2026-08-12", 49900], ["2026-09-12", 54900], ["2026-10-12", 64900]])).toEqual([]);
});

test("a charge of double or more is a price only once it comes round again", () => {
  // a yearly plan, or two months saved as one entry
  let s = pay(base(), [["2026-06-12", 11900], ["2026-07-12", 11900], ["2026-08-12", 11900], ["2026-09-12", 118900]], "Spotify");
  expect(chargeSignals(s, "2026-09-20").rises).toEqual([]);
  // back to the old price: nothing rose
  expect(chargeSignals(pay(s, [["2026-10-12", 11900]], "Spotify"), TODAY).rises).toEqual([]);
  // an offer that ended: the new price holds
  s = pay(base(), [["2026-06-12", 9900], ["2026-07-12", 9900], ["2026-08-12", 9900], ["2026-09-12", 29900], ["2026-10-12", 29900]], "Audible");
  expect(chargeSignals(s, TODAY).rises.map((r) => [r.before.amount, r.after.date])).toEqual([[9900, "2026-09-12"]]);
});

test("a quarterly charge is regular too", () => {
  const s = pay(base(), [["2026-01-05", 300000], ["2026-04-05", 300000], ["2026-07-05", 300000], ["2026-10-05", 345000]], "School bus");
  expect(chargeSignals(s, TODAY).rises).toHaveLength(1);
});

test("refunds and foreign currencies do not make a price rise", () => {
  // money back since the rise: what was paid in the end is not known
  expect(chargeSignals(pay(pay(base(), NETFLIX, "Netflix"), [["2026-10-14", -15000]], "Netflix"), TODAY).rises).toEqual([]);
  // an older refund is no charge, and leaves the pattern alone
  expect(chargeSignals(pay(pay(base(), NETFLIX, "Netflix"), [["2026-08-20", -49900]], "Netflix"), TODAY).rises).toHaveLength(1);
  // $20 every month: the rupees move with the rate, the price does not
  const usd = (list: [string, number, number][]) => list.reduce((s, [date, amount, subAmount]) => pay(s, [[date, amount]], "ChatGPT", { subAmount, subCurrency: "USD" }), base());
  expect(chargeSignals(usd([["2026-07-12", 166000, 2000], ["2026-08-12", 166000, 2000], ["2026-09-12", 166000, 2000], ["2026-10-12", 181000, 2000]]), TODAY).rises).toEqual([]);
  // $20 to $22 is a rise, told in dollars
  const [rise] = chargeSignals(usd([["2026-07-12", 166000, 2000], ["2026-08-12", 167500, 2000], ["2026-09-12", 168200, 2000], ["2026-10-12", 184000, 2200]]), TODAY).rises;
  expect([charged(rise.before), charged(rise.after)]).toEqual([2000, 2200]);
  // rupee entries and dollar entries under one note are not one series
  const mixed = pay(pay(base(), NETFLIX.slice(0, 3), "ChatGPT"), [["2026-10-12", 64900]], "ChatGPT", { subAmount: 800, subCurrency: "USD" });
  expect(chargeSignals(mixed, TODAY).rises).toEqual([]);
});

test("a price rise shows on a repeat the person set up", () => {
  let s = pay(base(), [["2026-07-12", 49900]], "Netflix", { repeat: { frequency: "monthly" } });
  s = run(s, "repeats.catchUp", { today: TODAY });
  const oct = s.transactions.find((t) => t.date === "2026-10-12")!;
  const { type, accountId, categoryId, note, tags, photoIds } = oct;
  s = run(s, "transactions.update", { id: oct._id, scope: "future", type, date: oct.date, accountId, categoryId, note, tags, photoIds, amount: 64900 });
  expect(chargeSignals(s, TODAY).rises.map((r) => r.after.date)).toEqual(["2026-10-12"]);
});

test("the same payment twice, on one day or a day apart, is reported", () => {
  const s = pay(pay(base(), [["2026-09-02", 45000]], "Swiggy"), [["2026-10-18", 31200], ["2026-10-18", 31200]], "Swiggy");
  const { doubles, rises } = chargeSignals(s, TODAY);
  expect(rises).toEqual([]);
  expect(doubles.map((d) => [d.key, d.first.date, d.second.date])).toEqual([["TWICE|swiggy||2026-10-18|31200", "2026-10-18", "2026-10-18"]]);
  expect(doubles[0].first._id).not.toBe(doubles[0].second._id);
  expect(chargeSignals(pay(base(), [["2026-10-18", 31200], ["2026-10-19", 31200]], "swiggy"), TODAY).doubles).toHaveLength(1);
});

test("not a double charge: another amount, method, note or day, an old one, or one already refunded", () => {
  const s = base();
  const twice = (extra: object = {}, note = "Swiggy", date = "2026-10-18", amount = 31200) => pay(pay(s, [["2026-10-18", 31200]], "Swiggy"), [[date, amount]], note, extra);
  expect(chargeSignals(twice(), TODAY).doubles).toHaveLength(1);
  expect(chargeSignals(twice({}, "Swiggy", "2026-10-18", 31300), TODAY).doubles).toEqual([]);
  expect(chargeSignals(twice({ accountId: s.accounts[1]._id }), TODAY).doubles).toEqual([]);
  expect(chargeSignals(twice({}, "Zomato"), TODAY).doubles).toEqual([]);
  expect(chargeSignals(twice({}, "Swiggy", "2026-10-20"), TODAY).doubles).toEqual([]);
  // only the last two months are looked at
  expect(chargeSignals(twice(), "2026-12-25").doubles).toEqual([]);
  expect(chargeSignals(pay(twice(), [["2026-10-20", -31200]], "Swiggy"), TODAY).doubles).toEqual([]);
  // entries without a note cannot be told apart
  expect(chargeSignals(pay(s, [["2026-10-18", 2000], ["2026-10-18", 2000]], ""), TODAY).doubles).toEqual([]);
});

test("paying the same place twice in a day out of habit is not a double charge", () => {
  // two coffees on the 3rd as well, at another price
  const habit = pay(base(), [["2026-10-03", 18000], ["2026-10-03", 22000], ["2026-10-18", 18000], ["2026-10-18", 18000]], "Blue Tokai");
  expect(chargeSignals(habit, TODAY).doubles).toEqual([]);
  // every day
  const daily = pay(base(), [["2026-10-15", 5000], ["2026-10-16", 5000], ["2026-10-17", 5000], ["2026-10-18", 5000]], "Parking");
  expect(chargeSignals(daily, TODAY).doubles).toEqual([]);
});

test("transfers, scheduled entries, instalments and entries shared on UnSplit are not double charges", () => {
  const s = base();
  const [a, b] = s.accounts;
  const move = { type: "transfer", date: "2026-10-18", accountId: a._id, toAccountId: b._id, amount: 500000, note: "To savings", tags: [], photoIds: [] };
  expect(chargeSignals(run(run(s, "transactions.create", move), "transactions.create", move), TODAY).doubles).toEqual([]);
  // two schedules of the same name and amount
  const day: [string, number][] = [["2026-10-18", 150000], ["2026-10-18", 150000]];
  expect(chargeSignals(pay(s, day, "Tuition", { repeat: { frequency: "monthly" } }), TODAY).doubles).toEqual([]);
  // two phones bought on instalments
  expect(chargeSignals(pay(s, day, "Phone", { installment: { count: 2 } }), TODAY).doubles).toEqual([]);
  const dinner = pay(s, day, "Dinner");
  expect(chargeSignals(dinner, TODAY).doubles).toHaveLength(1);
  const shared = run(dinner, "transactions.setSplit", { ids: dinner.transactions.map((t) => t._id), split: { app: "unsplit", expenseId: "e1" } });
  expect(chargeSignals(shared, TODAY).doubles).toEqual([]);
});

test("a dismissed signal stays dismissed, and the same charge can still be suggested as a subscription", () => {
  let s = pay(pay(base(), NETFLIX, "Netflix"), [["2026-10-18", 31200], ["2026-10-18", 31200]], "Swiggy");
  const { rises, doubles } = chargeSignals(s, TODAY);
  s = dismiss(dismiss(s, rises[0].key), doubles[0].key);
  expect(chargeSignals(s, TODAY)).toEqual({ rises: [], doubles: [] });
  // another month at that price, another Swiggy order: neither comes back
  s = pay(pay(s, [["2026-11-12", 64900]], "Netflix"), [["2026-11-02", 31200]], "Swiggy");
  expect(chargeSignals(s, "2026-11-20")).toEqual({ rises: [], doubles: [] });
  // "Not a bill" is kept in the same setting under the bare note: these keys leave it alone
  const monthly = pay(base(), [["2026-08-12", 49900], ["2026-09-12", 49900], ["2026-10-12", 49900]], "Netflix");
  expect(recurringSuggestions(dismiss(monthly, "PRICE|netflix||64900"), TODAY)).toHaveLength(1);
  // a new price later is a new rise
  s = pay(s, [["2026-12-12", 64900], ["2027-01-12", 79900]], "Netflix");
  expect(chargeSignals(s, "2027-01-20").rises.map((r) => r.key)).toEqual(["PRICE|netflix||79900"]);
});
