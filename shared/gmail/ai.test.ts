import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { aiContent, buildAiInput, lowerConfidence, MAX_SUMMARY, OUTPUT_SCHEMA, SYSTEM_PROMPT, validateAiResults } from "./ai";
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
    { id: "m1", isTransaction: true, kind: "debit", amount: 499.5, currency: "inr", date: "2026-10-17", merchant: "Blue Tokai", categoryRef: "e1", methodRef: "a1", confidence: "high", summary: "Paid for coffee" },
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
  expect(reads[0]).toMatchObject({ categoryId: "c1", accountId: "a1", confidence: "high", summary: "Paid for coffee" });
  expect(reads[0].parsed).toMatchObject({ rule: "ai", type: "debit", amount: 499.5, currency: "INR", date: "2026-10-17", merchantRaw: "Blue Tokai" });
  expect(reads[1]).toMatchObject({ categoryId: undefined, confidence: "low" });
});

test("garbage in, nothing out", () => {
  const mails = [mail("m-1")];
  const { ids } = buildAiInput(mails, { categories, accounts, mainCurrency: "INR" });
  expect(validateAiResults(undefined, mails, ids, categories)).toEqual({ reads: [], dropped: 0, clutter: {} });
  expect(validateAiResults([null, 3, "x"], mails, ids, categories)).toEqual({ reads: [], dropped: 0, clutter: {} });
});

test("what stays the same between batches is its own block, marked for caching, before the mails", () => {
  const snap = { categories, accounts, mainCurrency: "INR" };
  const one = aiContent(buildAiInput([mail("m-1")], snap).input, true);
  const two = aiContent(buildAiInput([mail("m-2"), mail("m-3", Date.parse("2026-11-02T06:00:00Z"))], snap).input, true);
  expect(one.map((b) => b.cache_control)).toEqual([{ type: "ephemeral" }, undefined]);
  // a lone batch has nothing to share a cache with, and writing one costs more than not
  expect(aiContent(buildAiInput([mail("m-1")], snap).input, false)).toEqual(one.map(({ type, text }) => ({ type, text })));
  // byte for byte, or the second batch pays full price again
  expect(two[0].text).toBe(one[0].text);
  expect(JSON.parse(one[0].text)).toMatchObject({ currency: "INR", methods: [{ id: "a1", name: "HDFC Savings" }] });
  expect(JSON.parse(two[1].text).map((m: { id: string }) => m.id)).toEqual(["m1", "m2"]);
  // compact JSON, and nothing about the mails in the cached block
  expect(one[0].text).not.toMatch(/\n|Your receipt/);
});

test("the prompt and the schema ask for what the checks read", () => {
  const fields = OUTPUT_SCHEMA.properties.results.items.properties;
  expect(fields.clutter.enum).toEqual(["mandate", "declined", "emi", "statement"]);
  expect(fields.summary.description).toContain(String(MAX_SUMMARY));
  expect(SYSTEM_PROMPT).toContain(`at most ${MAX_SUMMARY} characters`);
  for (const kind of fields.clutter.enum) expect(SYSTEM_PROMPT).toContain(`"${kind}"`);
  expect(Object.keys(fields)).not.toContain("reason");
});

const tx = (id: string, extra: Record<string, unknown> = {}) => ({ id, isTransaction: true, kind: "debit", amount: 500, currency: "INR", date: "2026-10-18", merchant: "Blue Tokai", ...extra });

test("clutter the model names is counted and never a draft; called a payment as well, it is dropped", () => {
  const mails = [mail("m-1"), mail("m-2"), mail("m-3"), mail("m-4"), mail("m-5")];
  const { ids } = buildAiInput(mails, { categories, accounts, mainCurrency: "INR" });
  const { reads, dropped, clutter } = validateAiResults([
    { id: "m1", isTransaction: false, clutter: "mandate" },
    { id: "m2", isTransaction: false, clutter: "mandate" },
    { id: "m3", isTransaction: false, clutter: "newsletter" }, // not a kind the app knows: just not a payment
    tx("m4", { clutter: "statement" }), // both at once: not trusted
    tx("m5", { clutter: "bogus" }), // an unknown kind is no reason to lose a payment
  ], mails, ids, categories);
  expect(clutter).toEqual({ mandate: 2 });
  expect(dropped).toBe(1);
  expect(reads.map((r) => r.mailId)).toEqual(["m-5"]);
});

test("a summary is kept as one capped line, or not at all", () => {
  const mails = [mail("m-1"), mail("m-2"), mail("m-3")];
  const { ids } = buildAiInput(mails, { categories, accounts, mainCurrency: "INR" });
  const { reads } = validateAiResults([
    tx("m1", { summary: `  Card ending 1234\ncharged   for coffee ${"x".repeat(200)}` }),
    tx("m2", { summary: 7 }),
    tx("m3", { summary: "   " }),
  ], mails, ids, categories);
  expect(reads[0].summary).toHaveLength(MAX_SUMMARY);
  expect(reads[0].summary).toMatch(/^Card ending 1234 charged for coffee x+$/);
  expect("summary" in reads[1]).toBe(false);
  expect("summary" in reads[2]).toBe(false);
});

test("two mails are the same payment only when the model says so and they read alike, from different senders", () => {
  const bank = (id: string): Mail => ({ ...mail(id), from: "Bank <alerts@bank.example>" });
  const mails = [mail("m-1"), bank("m-2"), bank("m-3"), bank("m-4"), bank("m-5"), mail("m-6"), bank("m-7")];
  const { ids } = buildAiInput(mails, { categories, accounts, mainCurrency: "INR" });
  const { reads, dropped } = validateAiResults([
    tx("m1"),
    tx("m2", { sameAs: "m1", date: "2026-10-19" }), // the shop's receipt and the bank's alert, a day apart
    tx("m3", { sameAs: "m1", amount: 501 }), // another amount
    tx("m4", { sameAs: "m2" }), // the same sender: two payments
    tx("m5", { sameAs: "m9" }), // no such mail
    tx("m6", { sameAs: "m6" }), // itself
    tx("m7", { sameAs: "m1", kind: "refund" }), // another kind
  ], mails, ids, categories);
  expect(dropped).toBe(0);
  // a "same" that fails a check is ignored and the mail stays a draft of its own: no payment is lost to it
  expect(reads.map((r) => [r.mailId, r.sameAs])).toEqual([["m-1", undefined], ["m-2", "m-1"], ["m-3", undefined], ["m-4", undefined], ["m-5", undefined], ["m-6", undefined], ["m-7", undefined]]);
  // nor to one pointing at a mail whose own answer was dropped
  const lost = validateAiResults([tx("m1", { amount: -1 }), tx("m2", { sameAs: "m1" })], mails, ids, categories);
  expect(lost.reads.map((r) => [r.mailId, r.sameAs])).toEqual([["m-2", undefined]]);
});

test("the lower of two confidences wins", () => {
  expect(lowerConfidence("high", "medium")).toBe("medium");
  expect(lowerConfidence("low", "high")).toBe("low");
});
