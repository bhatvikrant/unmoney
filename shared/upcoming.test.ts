import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { firstDateAfter } from "./repeat";
import { billsAgainstBudgets, monthlyCost, next30Days, recurringSuggestions, subscriptionsList, upcomingOccurrences } from "./upcoming";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

function base() {
  const s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const cash = s.accounts[0]._id;
  return { s, food, cash };
}

/** A monthly Netflix schedule whose first entry was on `date`. */
function withRepeat(date: string, frequency = "monthly", endDate?: string) {
  const { s, food, cash } = base();
  const snap = run(s, "transactions.create", {
    type: "expense", date, accountId: cash, categoryId: food, amount: 64900, note: "Netflix", tags: [], photoIds: [], repeat: { frequency, endDate },
  }).snap;
  return { s: snap, food, cash, rep: snap.repeats[0] };
}

test("upcoming rows: the coming dates of a schedule in the month, none on or before today", () => {
  const { s } = withRepeat("2026-09-14", "weekly");
  // next is 21 Sep; catch up to 21 Oct leaves 26 Oct as next
  const caught = run(s, "repeats.catchUp", { today: "2026-10-21" }).snap;
  const occ = upcomingOccurrences(caught, "2026-10-01", "2026-10-31", "2026-10-21");
  expect(occ.map((o) => o.date)).toEqual(["2026-10-26"]);
  expect(occ[0].isNext).toBe(true);
  const nov = upcomingOccurrences(caught, "2026-11-01", "2026-11-30", "2026-10-21");
  expect(nov.map((o) => o.date)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  expect(nov.every((o) => !o.isNext)).toBe(true);
});

test("upcoming rows stop at the end date, and stopped schedules or installments show none", () => {
  const { s, rep } = withRepeat("2026-10-14", "monthly", "2026-12-31");
  expect(upcomingOccurrences(s, "2026-10-01", "2027-03-31", "2026-10-21").map((o) => o.date)).toEqual(["2026-11-14", "2026-12-14"]);
  const stopped = run(s, "repeats.update", { id: rep._id, active: false }).snap;
  expect(upcomingOccurrences(stopped, "2026-10-01", "2027-03-31", "2026-10-21")).toEqual([]);
  const { s: b, food, cash } = base();
  const inst = run(b, "transactions.create", { type: "expense", date: "2026-10-01", accountId: cash, categoryId: food, amount: 3000, note: "Phone", tags: [], photoIds: [], installment: { count: 3 } }).snap;
  expect(upcomingOccurrences(inst, "2026-10-01", "2027-03-31", "2026-10-21")).toEqual([]);
});

test("a schedule on a deleted payment method has nothing coming", () => {
  const { s, cash } = withRepeat("2026-10-14");
  const gone = run(s, "accounts.remove", { id: cash }).snap;
  expect(upcomingOccurrences(gone, "2026-10-01", "2026-12-31", "2026-10-21")).toEqual([]);
});

test("with repeats shown on the 1st, this month's dates are already entries, so only later months are upcoming", () => {
  const { s } = withRepeat("2026-09-25");
  const first = run(s, "settings.update", { patch: { repeatDisplay: "firstOfMonth" } }).snap;
  const caught = run(first, "repeats.catchUp", { today: "2026-10-21" }).snap;
  expect(caught.transactions.map((t) => t.date).sort()).toEqual(["2026-09-25", "2026-10-25"]);
  expect(upcomingOccurrences(caught, "2026-10-01", "2026-11-30", "2026-10-21").map((o) => o.date)).toEqual(["2026-11-25"]);
});

test("Add now saves the next one today and moves the schedule on", () => {
  const { s, rep } = withRepeat("2026-09-25");
  expect(rep.nextDate).toBe("2026-10-25");
  const r = run(s, "repeats.addNext", { id: rep._id, date: "2026-10-25", entryDate: "2026-10-21" });
  const added = r.snap.transactions.find((t) => t._id === r.result)!;
  expect(added).toMatchObject({ date: "2026-10-21", amount: 64900, note: "Netflix", repeatId: rep._id });
  expect(r.snap.repeats[0].nextDate).toBe("2026-11-25");
  // the same date again (another device, a double tap) is refused
  expect(() => run(r.snap, "repeats.addNext", { id: rep._id, date: "2026-10-25", entryDate: "2026-10-21" })).toThrow(/already added or skipped/);
});

test("Add now on the last date of a schedule stops it", () => {
  const { s, rep } = withRepeat("2026-09-25", "monthly", "2026-10-31");
  const r = run(s, "repeats.addNext", { id: rep._id, date: "2026-10-25", entryDate: "2026-10-21" });
  expect(r.snap.repeats[0]).toMatchObject({ active: false, nextDate: "2026-11-25" });
});

test("Add now refuses when the schedule's category was deleted", () => {
  const { s, rep, food } = withRepeat("2026-09-25");
  const gone = run(s, "categories.remove", { id: food }).snap;
  expect(() => run(gone, "repeats.addNext", { id: rep._id, date: "2026-10-25", entryDate: "2026-10-21" })).toThrow(/deleted/);
});

test("Skip moves the schedule on without adding anything; skipping a date already past is a no-op", () => {
  const { s, rep } = withRepeat("2026-01-31");
  const caught = run(s, "repeats.catchUp", { today: "2026-10-21" }).snap;
  expect(caught.repeats[0].nextDate).toBe("2026-10-31");
  const entries = caught.transactions.length;
  const skipped = run(caught, "repeats.skip", { id: rep._id, date: "2026-10-31" }).snap;
  // the anchor day (31st) is kept: November has 30 days
  expect(skipped.repeats[0].nextDate).toBe("2026-11-30");
  expect(skipped.transactions.length).toBe(entries);
  expect(run(skipped, "repeats.skip", { id: rep._id, date: "2026-10-31" }).snap.repeats[0].nextDate).toBe("2026-11-30");
  expect(() => run(skipped, "repeats.skip", { id: rep._id, date: "2026-12-31" })).toThrow(/2026-11-30 one first/);
});

test("Make it a repeat: the first date is the first one after today, and the payment joins the schedule", () => {
  const { s, food, cash } = base();
  const made = run(s, "transactions.create", { type: "expense", date: "2026-09-05", accountId: cash, categoryId: food, amount: 19900, note: "Spotify", tags: [], photoIds: [] });
  const r = run(made.snap, "repeats.create", {
    template: { type: "expense", accountId: cash, categoryId: food, amount: 19900, note: "Spotify", tags: [] }, frequency: "monthly", after: "2026-09-05", today: "2026-10-21", fromTransactionId: made.result,
  });
  const rep = r.snap.repeats.find((x) => x._id === r.result)!;
  // 5 Oct has gone by without an entry: it is not back-filled
  expect(rep).toMatchObject({ kind: "repeat", startDate: "2026-09-05", nextDate: "2026-11-05", active: true });
  expect(r.snap.transactions.find((t) => t._id === made.result)!.repeatId).toBe(r.result);
  expect(run(r.snap, "repeats.catchUp", { today: "2026-10-21" }).result).toBe(0);
});

test("firstDateAfter keeps the anchor day and never lands on or before today", () => {
  expect(firstDateAfter("2026-01-31", "monthly", "2026-02-27")).toBe("2026-02-28");
  expect(firstDateAfter("2026-01-31", "monthly", "2026-02-28")).toBe("2026-03-31");
  expect(firstDateAfter("2026-10-21", "weekly", "2026-10-21")).toBe("2026-10-28");
  expect(firstDateAfter("2024-02-29", "yearly", "2026-10-21")).toBe("2027-02-28");
});

test("monthly cost of each frequency", () => {
  expect(monthlyCost(1200, "monthly")).toBe(1200);
  expect(monthlyCost(1200, "yearly")).toBe(100);
  expect(monthlyCost(1200, "weekly")).toBe(5200);
  expect(monthlyCost(1200, "biweekly")).toBe(2600);
  expect(monthlyCost(100, "daily")).toBe(3042);
});

test("subscriptions are active repeating expenses, soonest first", () => {
  const { s, food, cash } = withRepeat("2026-10-14");
  const salaryCat = s.categories.find((c) => c.type === "income")!._id;
  const more = run(s, "transactions.create", { type: "income", date: "2026-10-01", accountId: cash, categoryId: salaryCat, amount: 100, note: "Salary", tags: [], photoIds: [], repeat: { frequency: "monthly" } }).snap;
  const gym = run(more, "transactions.create", { type: "expense", date: "2026-10-03", accountId: cash, categoryId: food, amount: 120000, note: "Gym", tags: [], photoIds: [], repeat: { frequency: "yearly" } }).snap;
  const list = subscriptionsList(gym);
  expect(list.map((x) => [x.repeat.template.note, x.monthly])).toEqual([["Netflix", 64900], ["Gym", 10000]]);
});

test("next 30 days covers the dates after today", () => {
  const { s } = withRepeat("2026-09-21", "biweekly");
  const caught = run(s, "repeats.catchUp", { today: "2026-10-21" }).snap;
  expect(next30Days(caught, "2026-10-21").map((o) => o.date)).toEqual(["2026-11-02", "2026-11-16"]);
});

/** Expenses with the same note on the given dates and amounts. */
function payments(list: [string, number][], note = "Airtel") {
  let { s } = base();
  const food = s.categories.find((c) => c.name === "Food")!._id;
  for (const [date, amount] of list) s = run(s, "transactions.create", { type: "expense", date, accountId: s.accounts[0]._id, categoryId: food, amount, note, tags: [], photoIds: [] }).snap;
  return s;
}

test("a payment back about once a month at about the same amount is suggested as a subscription", () => {
  const s = payments([["2026-07-12", 59900], ["2026-08-11", 59900], ["2026-09-12", 61900], ["2026-10-12", 61900]]);
  const [sug] = recurringSuggestions(s, "2026-10-21");
  expect(sug).toMatchObject({ key: "airtel", count: 4, nextDate: "2026-11-12" });
  expect(sug.last.date).toBe("2026-10-12");
});

test("not suggested: twice a month, too few, stopped, amounts all over, already scheduled, or dismissed", () => {
  // two in one month breaks the monthly run
  expect(recurringSuggestions(payments([["2026-08-12", 500], ["2026-09-12", 500], ["2026-09-20", 500], ["2026-10-12", 500]]), "2026-10-21")).toEqual([]);
  expect(recurringSuggestions(payments([["2026-09-12", 500], ["2026-10-12", 500]]), "2026-10-21")).toEqual([]);
  // the last one is two months ago
  expect(recurringSuggestions(payments([["2026-06-12", 500], ["2026-07-12", 500], ["2026-08-12", 500]]), "2026-10-21")).toEqual([]);
  expect(recurringSuggestions(payments([["2026-08-12", 500], ["2026-09-12", 900], ["2026-10-12", 500]]), "2026-10-21")).toEqual([]);
  const monthly = payments([["2026-08-12", 500], ["2026-09-12", 500], ["2026-10-12", 500]], "Airtel  Postpaid");
  expect(recurringSuggestions(monthly, "2026-10-21")).toHaveLength(1);
  const dismissed = run(monthly, "settings.update", { patch: { dismissedRecurring: ["airtel postpaid"] } }).snap;
  expect(recurringSuggestions(dismissed, "2026-10-21")).toEqual([]);
  const last = monthly.transactions.find((t) => t.date === "2026-10-12")!;
  const scheduled = run(monthly, "repeats.create", {
    template: { type: "expense", accountId: last.accountId, categoryId: last.categoryId, amount: 500, note: "airtel postpaid", tags: [] }, frequency: "monthly", after: last.date, today: "2026-10-21",
  }).snap;
  expect(recurringSuggestions(scheduled, "2026-10-21")).toEqual([]);
});

test("catching up never adds a date the schedule already has an entry for", () => {
  const { s, rep } = withRepeat("2026-09-14", "weekly");
  const caught = run(s, "repeats.catchUp", { today: "2026-10-21" }).snap;
  const n = caught.transactions.length;
  // its next date moved back by hand to one already added
  const back = run(caught, "repeats.update", { id: rep._id, nextDate: "2026-09-21" }).snap;
  const again = run(back, "repeats.catchUp", { today: "2026-10-21" });
  expect(again.result).toBe(0);
  expect(again.snap.transactions.length).toBe(n);
  expect(again.snap.repeats[0].nextDate).toBe("2026-10-26");
});

test("bills still due count against the budgets running today, not the next period's", () => {
  // weekly Netflix (₹649) from 14 Sep: after catching up to 21 Oct, 26 Oct is still due this month; November's are not
  const { s, food } = withRepeat("2026-09-14", "weekly");
  let snap = run(s, "repeats.catchUp", { today: "2026-10-21" }).snap;
  snap = run(snap, "budgets.upsert", { period: "monthly", categoryId: food, amount: 300000 }).snap;
  snap = run(snap, "budgets.upsert", { period: "monthly", amount: 500000 }).snap;
  const other = snap.categories.find((c) => c.type === "expense" && c._id !== food && !c.parentId)!._id;
  snap = run(snap, "budgets.upsert", { period: "monthly", categoryId: other, amount: 100000 }).snap;
  const out = billsAgainstBudgets(snap, "2026-10-21");
  // Oct entries: 5, 12, 19 Oct = 3 × 649 spent; the 26th is due. A budget no bill touches is left out
  const food_ = out.find((o) => o.item.budget.categoryId === food)!;
  expect(food_).toMatchObject({ adds: 64900, after: 300000 - 4 * 64900 });
  expect(food_.bills.map((b) => b.date)).toEqual(["2026-10-26"]);
  expect(out.find((o) => !o.item.budget.categoryId)).toMatchObject({ adds: 64900 });
  expect(out.some((o) => o.item.budget.categoryId === other)).toBe(false);
  // a small budget goes over once the bill is in, and sorts first
  snap = run(snap, "budgets.upsert", { id: food_.item.budget._id, period: "monthly", categoryId: food, amount: 200000 }).snap;
  const tight = billsAgainstBudgets(snap, "2026-10-21");
  expect(tight[0].item.budget.categoryId).toBe(food);
  expect(tight[0].after).toBe(200000 - 4 * 64900);
});
