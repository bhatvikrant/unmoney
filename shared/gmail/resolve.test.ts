import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "../ops";
import { fixtures } from "./fixtures/load";
import type { Parsed } from "./mail";
import { parseMail } from "./rules";
import { accountMapKey, cleanMerchant, resolveAccount, resolveCategory, resolveParsed, type ResolveCtx } from "./resolve";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: Date.parse("2026-10-01T00:00:00Z") + n }, ctx);
}

/** A user with an HDFC savings account, a GPay UPI on it, an HDFC credit card billed to it, an SBI account and an Axis card, plus some history. */
function user() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const acc = (a: Record<string, unknown>) => {
    const r = run(s, "accounts.create", { initialBalance: 0, includeInTotals: true, hidden: false, transferAsExpense: false, ...a });
    s = r.snap;
    return r.result as Id<"accounts">;
  };
  const hdfc = acc({ name: "HDFC Savings", kind: "bank" });
  const gpay = acc({ name: "GPay", kind: "upi", linkedAccountId: hdfc });
  const regalia = acc({ name: "Regalia", kind: "card", bankName: "HDFC", last4: "4521", billingAccountId: hdfc, settlementDay: 18, paymentDay: 5 });
  const sbi = acc({ name: "SBI", kind: "bank" });
  const axis = acc({ name: "Ace", kind: "card", bankName: "Axis", last4: "3344", billingAccountId: sbi, settlementDay: 1, paymentDay: 20 });
  const cat = (name: string) => s.categories.find((c) => c.name === name)!._id;
  const tx = (a: Record<string, unknown>) => { s = run(s, "transactions.create", { type: "expense", accountId: gpay, tags: [], photoIds: [], ...a }).snap; };
  tx({ date: "2026-09-01", amount: 40000, note: "Swiggy", categoryId: cat("Social Life") });
  tx({ date: "2026-09-20", amount: 52000, note: "swiggy ", categoryId: cat("Food") });
  tx({ date: "2026-09-25", amount: 100000, note: "Rahul V", categoryId: cat("Gift") });
  s = run(s, "currencies.add", { code: "USD", name: "US Dollar", symbol: "$", rate: 0.012, decimals: 2, symbolPosition: "before", isCustom: false }).snap;
  const rctx = (accountMap: Record<string, Id<"accounts">> = {}): ResolveCtx => ({ accounts: s.accounts, categories: s.categories, transactions: s.transactions, settings: s.settings[0], currencies: s.currencies, accountMap });
  return { s: () => s, hdfc, gpay, regalia, sbi, axis, cat, rctx, set: (next: Snapshot) => { s = next; } };
}

const fixture = (name: string) => {
  const f = fixtures().find((x) => x.name === name)!;
  return { mail: f.mail, parsed: parseMail(f.mail)! };
};

test("a payment method is found by learned map, then card digits, then bank name (through its UPI method for UPI payments)", () => {
  const u = user();
  const from = "alerts@hdfcbank.net";
  expect(resolveAccount({ last4: "4521", bankName: "HDFC", channel: "card" }, from, u.rctx())).toBe(u.regalia);
  expect(resolveAccount({ last4: "3344" }, from, u.rctx())).toBe(u.axis);
  expect(resolveAccount({ last4: "1234", bankName: "HDFC", channel: "upi" }, from, u.rctx())).toBe(u.gpay);
  expect(resolveAccount({ last4: "1234", bankName: "HDFC", channel: "netbanking" }, from, u.rctx())).toBe(u.hdfc);
  expect(resolveAccount({ bankName: "SBI", channel: "upi" }, from, u.rctx())).toBe(u.sbi); // no UPI method on SBI
  expect(resolveAccount({ bankName: "Kotak" }, from, u.rctx())).toBeUndefined();
  expect(resolveAccount({}, from, u.rctx())).toBeUndefined();
  // what the user picked last time wins over the digits
  expect(accountMapKey("HDFC <alerts@hdfcbank.net>", "4521")).toBe("hdfcbank.net|4521");
  expect(resolveAccount({ last4: "4521" }, from, u.rctx({ "hdfcbank.net|4521": u.axis }))).toBe(u.axis);
  // unless that method is gone
  expect(resolveAccount({ last4: "4521" }, from, u.rctx({ "hdfcbank.net|4521": "gone" as Id<"accounts"> }))).toBe(u.regalia);
});

test("an archived or deleted method is never proposed", () => {
  const u = user();
  u.set(run(u.s(), "accounts.setArchived", { ids: [u.regalia], archived: true }).snap);
  expect(resolveAccount({ last4: "4521" }, "alerts@hdfcbank.net", u.rctx())).toBeUndefined();
  u.set(run(u.s(), "accounts.remove", { id: u.gpay }).snap);
  expect(resolveAccount({ bankName: "HDFC", channel: "upi" }, "alerts@hdfcbank.net", u.rctx())).toBe(u.hdfc);
});

test("the category comes from the most recent entry with the same note, of the same type", () => {
  const u = user();
  expect(resolveCategory("SWIGGY", "expense", u.rctx())).toEqual({ categoryId: u.cat("Food"), subcategoryId: undefined });
  expect(resolveCategory("Swiggy", "income", u.rctx())).toEqual({});
  expect(resolveCategory("Zepto", "expense", u.rctx())).toEqual({});
  expect(resolveCategory("", "expense", u.rctx())).toEqual({});
});

test("merchant strings are cleaned to what the user would type", () => {
  const cases: [string, string][] = [
    ["SWIGGY*ORDER 8812-BLR", "Swiggy"], ["AMAZON PAY INDIA", "Amazon"], ["AMZN Mktp IN", "Amazon"], ["PAYTM-BESCOM", "BESCOM"], ["RAZORPAY*MYNTRA", "Myntra"],
    ["petrol.pump@okaxis", "Petrol Pump"], ["rahul.v@okicici", "Rahul V"], ["zomato@ptybl", "Zomato"],
    ["VIKRAM ENTERPRISES PVT LTD", "Vikram Enterprises"], ["BIG BAZAAR BENGALURU", "Big Bazaar"], ["Mr RAVI KUMAR", "Mr Ravi Kumar"], ["ACME TECH PVT LTD", "Acme Tech"],
    ["Bengaluru Metro Rail", "Bengaluru Metro Rail"], ["NETFLIX.COM", "Netflix"], ["PAYU*BOOKMYSHOW ORDER 55812", "BookMyShow"], ["THE COFFEE HOUSE #4412", "The Coffee House"],
    ["HDFC card payment", "HDFC card payment"], ["", ""], ["   ", ""],
  ];
  for (const [raw, want] of cases) expect(cleanMerchant(raw), raw).toBe(want);
});

test("a UPI debit alert becomes an expense on the right method, filed like last time", () => {
  const u = user();
  const { mail, parsed } = fixture("hdfc-upi-debit");
  const r = resolveParsed(parsed, mail, u.rctx());
  expect(r.confidence).toBe("high");
  expect(r.proposal).toEqual({
    type: "expense", date: "2026-10-18", time: undefined, amount: 125000, note: "Swiggy", accountId: u.gpay, categoryId: u.cat("Food"), subcategoryId: undefined,
    description: "HDFC alert · a/c ending 1234", accountHint: { bankName: "HDFC", last4: "1234", channel: "upi" },
  });
});

test("a card purchase lands on the card with that number", () => {
  const u = user();
  const { mail, parsed } = fixture("hdfc-card-debit");
  const r = resolveParsed(parsed, mail, u.rctx());
  expect([r.proposal.type, r.proposal.accountId, r.proposal.note, r.proposal.time, r.proposal.description]).toEqual(["expense", u.regalia, "Amazon", "14:32", "HDFC alert · card ending 4521"]);
  expect(r.proposal.categoryId).toBeUndefined();
});

test("a credit card payment is a transfer from the billing account when the card is known, else an expense that says so", () => {
  const u = user();
  const known = fixture("hdfc-card-payment-received");
  const r = resolveParsed(known.parsed, known.mail, u.rctx());
  expect([r.proposal.type, r.proposal.accountId, r.proposal.toAccountId, r.proposal.amount, r.confidence]).toEqual(["transfer", u.hdfc, u.regalia, 2345000, "high"]);
  const unknown = fixture("sbicard-payment-received");
  const r2 = resolveParsed(unknown.parsed, unknown.mail, u.rctx());
  expect([r2.proposal.type, r2.proposal.accountId, r2.confidence]).toEqual(["expense", undefined, "medium"]);
  expect(r2.proposal.description).toContain("looks like a credit card payment");
});

test("credits are income, refunds are income that say so, and a receipt's product goes in the description", () => {
  const u = user();
  const credit = fixture("gpay-received");
  const r = resolveParsed(credit.parsed, credit.mail, u.rctx());
  expect([r.proposal.type, r.proposal.note, r.proposal.accountId, r.proposal.categoryId]).toEqual(["income", "Rahul V", u.gpay, undefined]);
  const refund = fixture("hdfc-card-refund");
  const r2 = resolveParsed(refund.parsed, refund.mail, u.rctx());
  expect([r2.proposal.type, r2.proposal.note, r2.proposal.accountId]).toEqual(["income", "Myntra", u.regalia]);
  expect(r2.proposal.description).toBe("HDFC alert · card ending 4521 · refund");
  const apple = fixture("apple-receipt");
  expect(resolveParsed(apple.parsed, apple.mail, u.rctx()).proposal.description).toBe("Apple receipt · card ending 4521 · iCloud+ 50GB");
});

test("mail in another currency keeps its amount as the sub-amount and converts at the saved rate", () => {
  const u = user();
  const base: Parsed = { rule: "apple", type: "debit", amount: 12.99, currency: "USD", date: "2026-10-18", dateSource: "mail", last4: "4521", channel: "card", merchantRaw: "Apple" };
  const r = resolveParsed(base, { from: "no_reply@email.apple.com" }, u.rctx());
  expect([r.proposal.amount, r.proposal.subAmount, r.proposal.subCurrency, r.confidence]).toEqual([108250, 1299, "USD", "medium"]);
  expect(r.proposal.description).toContain("converted at the saved USD rate");
  const noRate = resolveParsed({ ...base, currency: "EUR" }, { from: "no_reply@email.apple.com" }, u.rctx());
  expect([noRate.proposal.amount, noRate.proposal.subAmount, noRate.proposal.subCurrency, noRate.confidence]).toEqual([0, 1299, "EUR", "low"]);
});

test("a date taken from when the mail arrived lowers confidence", () => {
  const u = user();
  const p: Parsed = { rule: "hdfc", type: "debit", amount: 100, currency: "INR", date: "2026-10-18", dateSource: "received", merchantRaw: "X", bankName: "HDFC" };
  expect(resolveParsed(p, { from: "alerts@hdfcbank.net" }, u.rctx()).confidence).toBe("medium");
});

test("every kept fixture resolves to a proposal the drafts table accepts", () => {
  const u = user();
  for (const f of fixtures().filter((x) => x.expected.triage === "keep")) {
    const parsed = parseMail(f.mail)!;
    const r = resolveParsed(parsed, f.mail, u.rctx());
    const p = r.proposal as Doc<"drafts">["proposal"];
    expect(Number.isInteger(p.amount) && p.amount > 0, f.name).toBe(true);
    expect(["income", "expense", "transfer"], f.name).toContain(p.type);
    expect(p.note.length > 0, f.name).toBe(true);
    expect(p.description, f.name).toBeTruthy();
    if (p.type === "transfer") expect(p.toAccountId, f.name).toBeTruthy();
  }
});
