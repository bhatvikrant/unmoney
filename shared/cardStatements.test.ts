import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { statementCycles, statementDue } from "./ledger";
import { accountsList, cardStatements, cardsDue, creditAvailable } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

test("statement cycles run settlement day to the day before the next, due on the first payment day after", () => {
  const cycles = statementCycles({ settlementDay: 5, paymentDay: 25 }, "2026-10-21", 3);
  expect(cycles).toEqual([
    { from: "2026-10-05", to: "2026-11-04", due: "2026-11-25", open: true },
    { from: "2026-09-05", to: "2026-10-04", due: "2026-10-25", open: false },
    { from: "2026-08-05", to: "2026-09-04", due: "2026-09-25", open: false },
  ]);
  // the closed cycle's due date is the payable's due date
  expect(cycles[1].due).toBe(statementDue({ settlementDay: 5, paymentDay: 25 }, "2026-10-21"));
  // settlement on the 31st: short months settle on their last day
  expect(statementCycles({ settlementDay: 31, paymentDay: 10 }, "2026-03-15", 2)).toEqual([
    { from: "2026-02-28", to: "2026-03-30", due: "2026-04-10", open: true },
    { from: "2026-01-31", to: "2026-02-27", due: "2026-03-10", open: false },
  ]);
  // payment day before the settlement day: due next month
  expect(statementCycles({ settlementDay: 20, paymentDay: 5 }, "2026-10-21", 2)[1]).toEqual({ from: "2026-09-20", to: "2026-10-19", due: "2026-11-05", open: false });
});

/** Bank 50,000; HDFC card settles on the 5th, due on the 25th, limit 1,00,000. */
function ledger(creditLimit?: number) {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const bank = s.accounts.find((a) => a.name === "Bank")!;
  const card = s.accounts.find((a) => a.name === "Card")!;
  s = run(s, "accounts.update", { ...card, id: card._id, billingAccountId: bank._id, settlementDay: 5, paymentDay: 25, creditLimit }).snap;
  const spend = (date: string, amount: number) => (s = run(s, "transactions.create", { type: "expense", date, accountId: card._id, categoryId: food, amount, note: "", tags: [], photoIds: [] }).snap);
  spend("2026-09-10", 2000000);
  spend("2026-09-28", 500000);
  spend("2026-10-02", -100000); // a refund
  spend("2026-10-12", 300000);
  s = run(s, "accounts.payCard", { id: card._id, amount: 1000000, date: "2026-10-15", fromAccountId: bank._id }).snap;
  return { s, card: card._id, bank: bank._id };
}

test("each statement adds up its charges (less refunds) and the payments into the card", () => {
  const { s, card } = ledger();
  const [open, last] = cardStatements(s, card, "2026-10-21", 2);
  expect(open).toMatchObject({ from: "2026-10-05", charges: 300000, payments: 1000000 });
  expect(last).toMatchObject({ from: "2026-09-05", to: "2026-10-04", due: "2026-10-25", charges: 2400000, payments: 0 });
});

test("cards due within three days, or overdue, with something payable", () => {
  const { s } = ledger();
  // payable: 24,000 from September's statement less the 10,000 paid = 14,000, due 25 Oct
  const rows = (today: string) => accountsList(s, today).accounts;
  expect(cardsDue(rows("2026-10-21"), "2026-10-21")).toEqual([]);
  expect(cardsDue(rows("2026-10-22"), "2026-10-22").map((d) => [d.due, d.payable, d.days, d.overdue])).toEqual([["2026-10-25", 1400000, 3, false]]);
  expect(cardsDue(rows("2026-10-27"), "2026-10-27").map((d) => [d.days, d.overdue])).toEqual([[-2, true]]);
  // paid in full: nothing to remind about
  const card = s.accounts.find((a) => a.name === "Card")!;
  const paid = run(s, "accounts.payCard", { id: card._id, amount: 1400000, date: "2026-10-22", fromAccountId: card.billingAccountId }).snap;
  expect(cardsDue(accountsList(paid, "2026-10-23").accounts, "2026-10-23")).toEqual([]);
});

test("available credit is the limit less what the card owes, later installments included", () => {
  const { s, card } = ledger(10000000);
  const row = () => accountsList(x, "2026-10-21").accounts.find((a) => a._id === card)!;
  let x = s;
  expect(row().creditLimit).toBe(10000000);
  expect(creditAvailable(row())).toBe(10000000 - 1700000);
  const food = x.categories.find((c) => c.name === "Food")!._id;
  // a 3-month installment: two parts are dated later but already block the limit
  x = run(x, "transactions.create", { type: "expense", date: "2026-10-20", accountId: card, categoryId: food, amount: 900000, note: "Phone", tags: [], photoIds: [], installment: { count: 3 } }).snap;
  expect(creditAvailable(row())).toBe(10000000 - 1700000 - 900000);
  expect(creditAvailable({ balance: -5, upcoming: 0 })).toBeUndefined();
});

test("a credit limit is for credit cards only and moves with a change of decimals", () => {
  const { s, card, bank } = ledger(10000000);
  const b = s.accounts.find((a) => a._id === bank)!;
  expect(run(s, "accounts.update", { ...b, id: bank, creditLimit: 500 }).snap.accounts.find((a) => a._id === bank)!.creditLimit).toBeUndefined();
  const c = s.accounts.find((a) => a._id === card)!;
  expect(() => run(s, "accounts.update", { ...c, id: card, creditLimit: -1 })).toThrow(/Credit limit/);
  const scaled = run(s, "settings.changeDecimals", { decimals: 0 }).snap;
  expect(scaled.accounts.find((a) => a._id === card)!.creditLimit).toBe(100000);
  // left out keeps it (a settings page that doesn't know about limits), null removes it
  const { creditLimit: _keep, ...withoutLimit } = c;
  void _keep;
  expect(run(s, "accounts.update", { ...withoutLimit, id: card }).snap.accounts.find((a) => a._id === card)!.creditLimit).toBe(10000000);
  expect(run(s, "accounts.update", { ...c, id: card, creditLimit: null }).snap.history.at(-1)!.text).toBe("Edited Card: credit limit removed");
});
