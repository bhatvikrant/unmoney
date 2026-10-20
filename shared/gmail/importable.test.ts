import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "../ops";
import { fallbackAccount, fallbackCategory, importable } from "./importable";

const ctx = { userId: "u" as Id<"users"> };
function ledger() {
  const s: Snapshot = applyOp(emptySnapshot(), { id: "o1", kind: "settings.completeOnboarding", args: { currency: "INR" }, at: 1 }, ctx).snap;
  const [cash, bank, card] = s.accounts;
  const cat = (name: string, type: "income" | "expense") => s.categories.find((c) => c.name === name && c.type === type && !c.parentId)!._id;
  return { s, cash, bank, card, food: cat("Food", "expense"), otherExpense: cat("Other", "expense"), otherIncome: cat("Other", "income"), salary: cat("Salary", "income") };
}
const of = (s: Snapshot, extra: { defaultAccountId?: Id<"accounts"> } = {}) => ({ accounts: s.accounts, categories: s.categories, currencies: s.currencies, decimals: 2, ...extra });
const draft = (proposal: Partial<Doc<"drafts">["proposal"]>) => ({ proposal: { type: "expense" as const, date: "2026-10-18", amount: 48500, note: "Swiggy", ...proposal } });

test("a complete draft imports as it stands, nothing filled in", () => {
  const { s, card, food } = ledger();
  const r = importable(draft({ accountId: card._id, categoryId: food }), of(s))!;
  expect(r.filled).toEqual([]);
  expect(r.fields).toMatchObject({ type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: card._id, categoryId: food, tags: [], photoIds: [] });
});

test("a missing method takes the default one, a missing category the Other of its type", () => {
  const { s, bank, otherExpense, otherIncome } = ledger();
  const r = importable(draft({}), of(s, { defaultAccountId: bank._id }))!;
  expect(r.filled).toEqual(["method", "category"]);
  expect([r.fields.accountId, r.fields.categoryId]).toEqual([bank._id, otherExpense]);
  expect(importable(draft({ type: "income", accountId: bank._id }), of(s))!.fields.categoryId).toBe(otherIncome);
});

test("without a chosen default the first visible method is used; hidden, archived and deleted ones never", () => {
  const { s, cash, bank } = ledger();
  expect(fallbackAccount({ accounts: s.accounts })).toBe(cash._id);
  const accounts = s.accounts.map((a) => (a._id === cash._id ? { ...a, hidden: true } : a));
  expect(fallbackAccount({ accounts, defaultAccountId: cash._id })).toBe(bank._id);
  // a method the draft names that was archived since is treated as missing
  const archived = s.accounts.map((a) => (a._id === bank._id ? { ...a, archivedAt: 1 } : a));
  const r = importable(draft({ accountId: bank._id }), { ...of(s), accounts: archived })!;
  expect(r.filled).toContain("method");
  expect(r.fields.accountId).toBe(cash._id);
});

test("with no category called Other, the last top-level one of the type stands in", () => {
  const { s, otherExpense } = ledger();
  const categories = s.categories.filter((c) => c._id !== otherExpense);
  const last = categories.filter((c) => c.type === "expense" && !c.parentId).sort((a, b) => a.order - b.order).at(-1)!;
  expect(fallbackCategory({ categories }, "expense")).toBe(last._id);
});

test("a transfer needs both its methods; without one it has to be finished in the form", () => {
  const { s, bank, card } = ledger();
  expect(importable(draft({ type: "transfer", accountId: bank._id, toAccountId: card._id }), of(s))!.fields).toMatchObject({ accountId: bank._id, toAccountId: card._id, categoryId: undefined });
  expect(importable(draft({ type: "transfer", accountId: bank._id }), of(s))).toBeNull();
  expect(importable(draft({ type: "transfer", toAccountId: card._id }), of(s))).toBeNull();
  expect(importable(draft({ amount: 0 }), of(s))).toBeNull();
});

test("mail in another currency keeps its sub-amount and the rate it implies", () => {
  const { s, card, food } = ledger();
  const r = importable(draft({ accountId: card._id, categoryId: food, amount: 830000, subAmount: 10000, subCurrency: "USD" }), { ...of(s), currencies: [{ code: "USD", decimals: 2 }] })!;
  expect([r.fields.subAmount, r.fields.subCurrency]).toEqual([10000, "USD"]);
  expect(r.fields.exchangeRate).toBeCloseTo(100 / 8300);
});
