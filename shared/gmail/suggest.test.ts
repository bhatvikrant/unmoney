import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { suggestMethods } from "./suggest";

type Hint = NonNullable<Doc<"drafts">["proposal"]["accountHint"]>;
const acc = (id: string, name: string, extra: Partial<Doc<"accounts">> = {}) => ({ _id: id as Id<"accounts">, name, kind: "other", ...extra }) as Doc<"accounts">;
let n = 0;
/** A mail the person saved to a method: the draft and the entry it became. */
function saved(accountId: string, hint: Hint, subject = "Transaction alert", tx: Partial<Doc<"transactions">> = {}) {
  const id = `t${++n}` as Id<"transactions">;
  return {
    draft: { _id: `d${n}`, status: "accepted", transactionId: id, subject, from: "SBI Card <alerts@sbicard.com>", proposal: { type: "expense", accountHint: hint } } as unknown as Doc<"drafts">,
    tx: { _id: id, type: "expense", accountId, ...tx } as Doc<"transactions">,
  };
}
const snap = (accounts: Doc<"accounts">[], mails: ReturnType<typeof saved>[]) =>
  ({ accounts, accountGroups: [], drafts: mails.map((m) => m.draft), transactions: mails.map((m) => m.tx) });
const sbi: Hint = { bankName: "SBI", last4: "1234", channel: "card" };

test("mail that agrees fills in the type, bank and digits of a method that has none", () => {
  const got = suggestMethods(snap([acc("a1", "SBI Cashback CC")], [saved("a1", sbi), saved("a1", sbi), saved("a1", { ...sbi, bankName: "sbi" })]));
  expect(got).toEqual([{ accountId: "a1", kind: "card", bankName: "SBI", last4: "1234", looks: "an SBI credit card ending 1234" }]);
});

test("the mails' subjects say credit or debit when the name does not", () => {
  const debit = [saved("a1", { ...sbi, bankName: "Kotak" }, "Your Debit Card was used"), saved("a1", { ...sbi, bankName: "Kotak" })];
  expect(suggestMethods(snap([acc("a1", "Everyday")], debit))[0]).toMatchObject({ kind: "debitCard", looks: "a Kotak debit card ending 1234" });
  // neither says which: no type, and "Other" cannot hold the rest
  expect(suggestMethods(snap([acc("a1", "Everyday")], [saved("a1", sbi), saved("a1", sbi)]))).toEqual([]);
  // both said: no guess
  expect(suggestMethods(snap([acc("a1", "Credit or debit")], [saved("a1", sbi), saved("a1", sbi)]))).toEqual([]);
});

test("only what is missing is offered, and what the person typed stays", () => {
  const card = acc("a1", "Cashback", { kind: "card", last4: "1234" });
  expect(suggestMethods(snap([card], [saved("a1", sbi), saved("a1", sbi)]))).toEqual([{ accountId: "a1", bankName: "SBI", looks: "an SBI credit card ending 1234" }]);
  // a bank account keeps no bank name: its digits only, from mail that is not about a card
  const bank = acc("a2", "Salary account", { kind: "bank" });
  const upi: Hint = { bankName: "HDFC", last4: "7788", channel: "upi" };
  expect(suggestMethods(snap([bank], [saved("a2", upi), saved("a2", upi), saved("a2", sbi)]))).toEqual([{ accountId: "a2", last4: "7788", looks: "an HDFC account ending 7788" }]);
});

test("mail that disagrees suggests nothing for what it disagrees on", () => {
  const card = acc("a1", "Cashback", { kind: "card" });
  // two cards filed under one method: no digits, but the bank they share
  expect(suggestMethods(snap([card], [saved("a1", sbi), saved("a1", { ...sbi, last4: "9999" })]))).toEqual([{ accountId: "a1", bankName: "SBI", looks: "an SBI credit card" }]);
  expect(suggestMethods(snap([card], [saved("a1", sbi), saved("a1", { bankName: "ICICI", last4: "9999", channel: "card" })]))).toEqual([]);
  // mail about other digits than the card's own says nothing about it
  expect(suggestMethods(snap([acc("a1", "Cashback", { kind: "card", last4: "5555" })], [saved("a1", sbi), saved("a1", sbi)]))).toEqual([]);
  // a method with no type whose mail is not all about a card
  expect(suggestMethods(snap([acc("a1", "SBI CC")], [saved("a1", sbi), saved("a1", { ...sbi, channel: "upi" })]))).toEqual([]);
});

test("one mail is not enough", () => {
  expect(suggestMethods(snap([acc("a1", "SBI Cashback CC")], [saved("a1", sbi)]))).toEqual([]);
});

test("nothing for a complete method, one that keeps no digits, or one that is gone", () => {
  const mails = (id: string) => [saved(id, sbi), saved(id, sbi)];
  expect(suggestMethods(snap([acc("a1", "Cashback", { kind: "card", bankName: "SBI", last4: "1234" })], mails("a1")))).toEqual([]);
  expect(suggestMethods(snap([acc("a1", "GPay", { kind: "upi" })], mails("a1")))).toEqual([]);
  expect(suggestMethods(snap([acc("a1", "Old CC", { deletedAt: 1 }), acc("a2", "Shelved CC", { archivedAt: 1 })], [...mails("a1"), ...mails("a2")]))).toEqual([]);
  expect(suggestMethods(snap([acc("a1", "SBI Cashback CC")], []))).toEqual([]);
});

test("only saved mail counts: not a waiting or dismissed draft, a transfer, or a deleted entry", () => {
  const a = [acc("a1", "SBI Cashback CC")];
  const open = saved("a1", sbi), gone = saved("a1", sbi), moved = saved("a1", sbi, "Transaction alert", { type: "transfer" });
  open.draft.status = "open";
  expect(suggestMethods(snap(a, [saved("a1", sbi), open]))).toEqual([]);
  expect(suggestMethods(snap(a, [saved("a1", sbi), moved]))).toEqual([]);
  expect(suggestMethods({ ...snap(a, [saved("a1", sbi), gone]), transactions: [] })).toEqual([]);
});
