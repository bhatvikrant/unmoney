import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type ImportRow, type Snapshot } from "./ops";
import { accountsList, budgetStatus, statsByCategory, statsEntries, txCsvRows } from "./views";
import { importable } from "./gmail/importable";
import { monthRecap } from "./recap";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

/** A ₹2,499 Myntra order on the card, half of it returned: the refund is an expense below zero in the same category. */
function ledger() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const apparel = s.categories.find((c) => c.name === "Apparel")!._id;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const card = s.accounts.find((a) => a.name === "Card")!;
  const bank = s.accounts.find((a) => a.name === "Bank")!;
  s = run(s, "accounts.update", { ...card, id: card._id, billingAccountId: bank._id, settlementDay: 1, paymentDay: 15 }).snap;
  const tx = (date: string, amount: number, categoryId: string, note: string) =>
    (s = run(s, "transactions.create", { type: "expense", date, accountId: card._id, categoryId, amount, note, tags: [], photoIds: [] }).snap);
  tx("2026-10-03", 249900, apparel, "Myntra");
  tx("2026-10-05", 60000, food, "Swiggy");
  tx("2026-10-09", -89900, apparel, "Myntra");
  s = run(s, "budgets.upsert", { period: "monthly", categoryId: apparel, amount: 200000 }).snap;
  return { s, apparel, card: card._id };
}

test("a refund comes off its category in stats, and never shows as income", () => {
  const { s, apparel } = ledger();
  const exp = statsByCategory(s, "2026-10-01", "2026-10-31", "expense");
  expect(exp.total).toBe(249900 - 89900 + 60000);
  expect(exp.items.find((i) => i.id === apparel)!.amount).toBe(160000);
  expect(statsByCategory(s, "2026-10-01", "2026-10-31", "income").total).toBe(0);
  // the category's own list adds up to the same figure, the refund included
  expect(statsEntries(s, "2026-10-01", "2026-10-31", "expense").filter((e) => e.bucket === apparel).reduce((a, e) => a + e.amount, 0)).toBe(160000);
});

test("a refund frees up the budget and lowers what the card owes", () => {
  const { s, card } = ledger();
  const b = budgetStatus(s, "monthly", "2026-10", "2026-10-21")!;
  expect(b.perCategory[0]).toMatchObject({ spent: 160000, remaining: 40000 });
  const row = accountsList(s, "2026-10-21").accounts.find((a) => a._id === card)!;
  expect(row.balance).toBe(-(249900 + 60000 - 89900));
  expect(row.outstanding).toBe(249900 + 60000 - 89900);
});

test("the monthly recap's total nets refunds too", () => {
  let { s } = ledger();
  const food = s.categories.find((c) => c.name === "Food")!._id;
  for (let d = 10; d < 20; d++) s = run(s, "transactions.create", { type: "expense", date: `2026-10-${d}`, accountId: s.accounts[0]._id, categoryId: food, amount: 1000, note: "Tea", tags: [], photoIds: [] }).snap;
  const total = monthRecap(s, "2026-10")!.cards.find((c) => c.kind === "total") as { amount: number };
  expect(total.amount).toBe(249900 - 89900 + 60000 + 10 * 1000);
});

test("a refund survives export and import as a refund", () => {
  const { s } = ledger();
  const rows = txCsvRows(s);
  const refundRow = rows.find((r) => r["Income/Expense"] === "Refund")!;
  expect(refundRow).toMatchObject({ Category: "Apparel", Amount: -899 });
  const fresh = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const toImport: ImportRow[] = rows.map((r) => ({ date: String(r.Date), account: String(r.Account), category: String(r.Category), note: String(r.Note), amount: String(r.Amount), type: String(r["Income/Expense"]) }));
  const imported = run(fresh, "transactions.importRows", { rows: toImport, createMissing: true, createAccounts: true }).snap;
  expect(imported.transactions.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-89900, 60000, 249900]);
});

test("a Gmail refund draft (negative expense) can be imported in bulk; other negatives can't", () => {
  const { s, apparel, card } = ledger();
  const ictx = { accounts: s.accounts, categories: s.categories, currencies: s.currencies, decimals: 2 };
  const draft = (type: "income" | "expense", amount: number) => ({ proposal: { type, date: "2026-10-19", amount, note: "Myntra", accountId: card, categoryId: apparel } });
  expect(importable(draft("expense", -89900) as never, ictx as never)?.fields.amount).toBe(-89900);
  expect(importable(draft("income", -89900) as never, ictx as never)).toBeNull();
});
