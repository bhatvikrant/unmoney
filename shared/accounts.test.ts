import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;
const acc = (s: Snapshot, name: string) => s.accounts.find((a) => a.name === name)!;
const method = { initialBalance: 0, includeInTotals: true, hidden: false, transferAsExpense: false };

/** Cash, Bank and Card from onboarding; Card billed to Bank; a debit card and a UPI spending from Bank. */
function setup() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const bank = acc(s, "Bank")._id;
  s = run(s, "accounts.update", { ...acc(s, "Card"), id: acc(s, "Card")._id, billingAccountId: bank, settlementDay: 1, paymentDay: 15 });
  s = run(s, "accounts.create", { ...method, name: "Debit", kind: "debitCard", linkedAccountId: bank });
  s = run(s, "accounts.create", { ...method, name: "GPay", kind: "upi", linkedAccountId: bank });
  return s;
}

test("a bank cannot be deleted while a card is billed to it or a method spends from it", () => {
  let s = setup();
  const bank = acc(s, "Bank")._id;
  expect(() => run(s, "accounts.remove", { id: bank })).toThrow(/Card is billed to Bank/);
  s = run(s, "accounts.update", { ...acc(s, "Card"), id: acc(s, "Card")._id, billingAccountId: acc(s, "Cash")._id });
  expect(() => run(s, "accounts.remove", { id: bank })).toThrow(/Debit spends from Bank/);
  s = run(s, "accounts.remove", { id: acc(s, "Debit")._id });
  expect(() => run(s, "accounts.remove", { id: bank })).toThrow(/GPay spends from Bank/);
  s = run(s, "accounts.remove", { id: acc(s, "GPay")._id });
  // with nothing depending on it any more, it goes
  expect(run(s, "accounts.remove", { id: bank }).accounts.find((a) => a._id === bank)!.deletedAt).toBeDefined();
});

test("a card is paid only from a live method that is not a credit card", () => {
  let s = setup();
  const card = acc(s, "Card")._id;
  const pay = (from: string) => run(s, "accounts.payCard", { id: card, amount: 1000, date: "2026-10-01", fromAccountId: from });
  expect(pay(acc(s, "Cash")._id).transactions.length).toBe(1);
  expect(() => pay(card)).toThrow(/itself or another credit card/);
  s = run(s, "accounts.create", { ...method, name: "Amex", kind: "card", billingAccountId: acc(s, "Bank")._id, settlementDay: 1, paymentDay: 15 });
  expect(() => pay(acc(s, "Amex")._id)).toThrow(/itself or another credit card/);
  s = run(s, "accounts.remove", { id: acc(s, "Cash")._id });
  expect(() => pay(acc(s, "Cash")._id)).toThrow(/Cash has been deleted/);
});

test("a bank account keeps the last 4 digits of its number; other non-card methods do not", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  s = run(s, "accounts.create", { ...method, name: "Axis Savings", kind: "bank", last4: "9900", bankName: "Axis", color: "#123456" });
  const axis = acc(s, "Axis Savings");
  // only the digits: bank name and colour belong to cards
  expect([axis.last4, axis.bankName, axis.color]).toEqual(["9900", undefined, undefined]);
  expect(() => run(s, "accounts.create", { ...method, name: "Bad", kind: "bank", last4: "99" })).toThrow(/4 numbers/);
  s = run(s, "accounts.create", { ...method, name: "Wallet", kind: "cash", last4: "1111" });
  expect(acc(s, "Wallet").last4).toBeUndefined();
});
