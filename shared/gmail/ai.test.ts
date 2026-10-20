import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { buildAiInput, lowerConfidence, validateAiResults } from "./ai";
import type { Mail } from "./mail";

const cat = (id: string, name: string, type: "income" | "expense", extra: Partial<Doc<"categories">> = {}) =>
  ({ _id: id as Id<"categories">, _creationTime: 0, userId: "u" as Id<"users">, name, type, order: 0, ...extra }) as Doc<"categories">;
const acc = (id: string, name: string, extra: Partial<Doc<"accounts">> = {}) =>
  ({ _id: id as Id<"accounts">, _creationTime: 0, userId: "u" as Id<"users">, name, kind: "bank", initialBalance: 0, includeInTotals: true, hidden: false, order: 0, transferAsExpense: false, ...extra }) as Doc<"accounts">;
const mail = (id: string, receivedAt = Date.parse("2026-10-18T06:00:00Z")): Mail => ({ id, threadId: "t", from: "shop@example.com", subject: "Your receipt", receivedAt, text: "Total ₹500 paid" });

const categories = [cat("c1", "Food", "expense"), cat("c2", "Salary", "income"), cat("c3", "Old", "expense", { deletedAt: 1 })];
const accounts = [acc("a1", "HDFC Savings", { bankName: "HDFC" }), acc("a2", "Hidden", { hidden: true })];

test("the model sees short ids for live categories and methods, and the mails capped", () => {
  const { input, ids } = buildAiInput([mail("m-abc")], { categories, accounts, mainCurrency: "INR" });
  expect(input.context.categories.map((c) => c.id)).toEqual(["e1", "i1"]);
  expect(input.context.methods.map((m) => m.id)).toEqual(["a1"]);
  expect(ids.categories.e1).toBe("c1");
  expect(ids.mails.m1).toBe("m-abc");
  expect(input.mails[0].received).toContain("2026-10-18");
});

test("only answers that check out become reads", () => {
  const mails = [mail("m-1"), mail("m-2"), mail("m-3"), mail("m-4"), mail("m-5")];
  const { ids } = buildAiInput(mails, { categories, accounts, mainCurrency: "INR" });
  const raw = [
    { id: "m1", isTransaction: true, kind: "debit", amount: 499.5, currency: "inr", date: "2026-10-17", merchant: "Blue Tokai", categoryRef: "e1", methodRef: "a1", confidence: "high", reason: "receipt" },
    { id: "m2", isTransaction: false },
    { id: "m3", isTransaction: true, kind: "debit", amount: -5, currency: "INR", date: "2026-10-18", merchant: "X" }, // bad amount
    { id: "m4", isTransaction: true, kind: "credit", amount: 50, currency: "INR", date: "2026-09-01", merchant: "Y" }, // date too far
    { id: "m5", isTransaction: true, kind: "credit", amount: 50, currency: "INR", date: "2026-10-18", merchant: "Z", categoryRef: "e1", confidence: "silly" }, // category of the wrong type
    { id: "m9", isTransaction: true, kind: "debit", amount: 1, currency: "INR", date: "2026-10-18", merchant: "ghost" }, // unknown mail
    { id: "m1", isTransaction: true, kind: "debit", amount: 1, currency: "INR", date: "2026-10-18", merchant: "again" }, // repeated
  ];
  const { reads, dropped } = validateAiResults(raw, mails, ids, categories);
  expect(dropped).toBe(2);
  expect(reads.map((r) => r.mailId)).toEqual(["m-1", "m-5"]);
  expect(reads[0]).toMatchObject({ categoryId: "c1", accountId: "a1", confidence: "high" });
  expect(reads[0].parsed).toMatchObject({ rule: "ai", type: "debit", amount: 499.5, currency: "INR", date: "2026-10-17", merchantRaw: "Blue Tokai" });
  expect(reads[1]).toMatchObject({ categoryId: undefined, confidence: "low" });
});

test("garbage in, nothing out", () => {
  const mails = [mail("m-1")];
  const { ids } = buildAiInput(mails, { categories, accounts, mainCurrency: "INR" });
  expect(validateAiResults(undefined, mails, ids, categories)).toEqual({ reads: [], dropped: 0 });
  expect(validateAiResults([null, 3, "x"], mails, ids, categories)).toEqual({ reads: [], dropped: 0 });
});

test("the lower of two confidences wins", () => {
  expect(lowerConfidence("high", "medium")).toBe("medium");
  expect(lowerConfidence("low", "high")).toBe("low");
});
