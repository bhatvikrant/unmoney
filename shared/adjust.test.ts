import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { accountsList, budgetStatus, statsByCategory } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

/** Bank with 1,000.00, a card billed to it, and one 200.00 grocery expense from the bank. */
function ledger() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const bank = s.accounts.find((a) => a.name === "Bank")!;
  const card = s.accounts.find((a) => a.name === "Card")!;
  s = run(s, "accounts.update", { ...bank, id: bank._id, initialBalance: 100000 }).snap;
  s = run(s, "accounts.update", { ...card, id: card._id, billingAccountId: bank._id, settlementDay: 5, paymentDay: 25 }).snap;
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-10", accountId: bank._id, categoryId: food, amount: 20000, note: "Groceries", tags: [], photoIds: [] }).snap;
  s = run(s, "budgets.upsert", { period: "monthly", amount: 50000 }).snap;
  return { s, bank: bank._id, card: card._id };
}
const balanceOf = (s: Snapshot, id: string) => accountsList(s, "2026-10-21").accounts.find((a) => a._id === id)!.balance;

test("the bank says more: the difference comes in from Balance adjustments and the balance matches", () => {
  const { s, bank } = ledger();
  expect(balanceOf(s, bank)).toBe(80000);
  const r = run(s, "accounts.adjustBalance", { id: bank, delta: 1550, balance: 81550, date: "2026-10-21" });
  expect(balanceOf(r.snap, bank)).toBe(81550);
  const adj = r.snap.accounts.find((a) => a.system === "adjustments")!;
  expect(adj).toMatchObject({ name: "Balance adjustments", hidden: true, includeInTotals: false });
  expect(r.snap.transactions.find((t) => t._id === r.result)).toMatchObject({ type: "transfer", accountId: adj._id, toAccountId: bank, amount: 1550, date: "2026-10-21" });
  expect(r.snap.accounts.find((a) => a._id === bank)!.reconciledAt).toBe("2026-10-21");
  expect(r.snap.history.at(-1)!.text).toBe("Adjusted Bank to $ 815.50 (+$ 15.50)");
});

test("an adjustment never counts as income or spending, and net worth follows the bank", () => {
  const { s, bank } = ledger();
  const before = accountsList(s, "2026-10-21");
  const after = run(s, "accounts.adjustBalance", { id: bank, delta: -5000, balance: 75000, date: "2026-10-21" }).snap;
  expect(statsByCategory(after, "2026-10-01", "2026-10-31", "expense").total).toBe(20000);
  expect(statsByCategory(after, "2026-10-01", "2026-10-31", "income").total).toBe(0);
  expect(budgetStatus(after, "monthly", "2026-10", "2026-10-21")!.total!.spent).toBe(20000);
  const list = accountsList(after, "2026-10-21");
  expect(list.total).toBe(before.total - 5000);
  // the adjustments account is in no list, but its name still resolves for the entry
  expect(list.accounts.some((a) => a.system)).toBe(false);
  expect(list.groups.flatMap((g) => g.accounts).some((a) => a.system)).toBe(false);
  expect(list.system.map((a) => a.name)).toEqual(["Balance adjustments"]);
});

test("one adjustments account is reused; a matching balance only marks the method reconciled", () => {
  const { s, bank, card } = ledger();
  let x = run(s, "accounts.adjustBalance", { id: bank, delta: 100, balance: 80100, date: "2026-10-20" }).snap;
  // the card owes 30.00 more than the app knew: money went out of the card to the adjustments account
  const r = run(x, "accounts.adjustBalance", { id: card, delta: -3000, balance: -3000, date: "2026-10-21" });
  x = r.snap;
  expect(x.accounts.filter((a) => a.system === "adjustments")).toHaveLength(1);
  expect(balanceOf(x, card)).toBe(-3000);
  const m = run(x, "accounts.adjustBalance", { id: bank, delta: 0, balance: 80100, date: "2026-10-22" });
  expect(m.result).toBeNull();
  expect(m.snap.transactions.length).toBe(x.transactions.length);
  expect(m.snap.accounts.find((a) => a._id === bank)!.reconciledAt).toBe("2026-10-22");
  expect(m.snap.history.at(-1)!.text).toBe("Checked Bank: it matched");
});

test("debit cards, the adjustments account itself and deleted methods can't be adjusted", () => {
  const { s, bank } = ledger();
  const debit = run(s, "accounts.create", { name: "Debit", kind: "debitCard", linkedAccountId: bank, initialBalance: 0, includeInTotals: true, hidden: false, transferAsExpense: false });
  expect(() => run(debit.snap, "accounts.adjustBalance", { id: debit.result, delta: 100, balance: 100, date: "2026-10-21" })).toThrow(/bank account it draws from/);
  const x = run(s, "accounts.adjustBalance", { id: bank, delta: 100, balance: 80100, date: "2026-10-21" }).snap;
  const adj = x.accounts.find((a) => a.system)!._id;
  expect(() => run(x, "accounts.adjustBalance", { id: adj, delta: 100, balance: 100, date: "2026-10-21" })).toThrow(/can't be adjusted/);
  const gone = run(x, "accounts.remove", { id: bank }).snap;
  expect(() => run(gone, "accounts.adjustBalance", { id: bank, delta: 100, balance: 80200, date: "2026-10-21" })).toThrow(/deleted/);
  expect(() => run(x, "accounts.adjustBalance", { id: bank, delta: 1.5, balance: 80100, date: "2026-10-21" })).toThrow(/whole number/);
});
