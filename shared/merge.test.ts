import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { accountsList } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;
const runResult = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).result;
const acc = (s: Snapshot, name: string) => s.accounts.find((a) => a.name === name)!;

/** Cash, Bank and Card from onboarding, plus "HDFC" (a duplicate bank from an import) with entries both ways. */
function setup() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const food = s.categories.find((c) => c.name === "Food")!._id;
  s = run(s, "accounts.create", { name: "HDFC", kind: "bank", initialBalance: 50000, includeInTotals: true, hidden: false, transferAsExpense: false });
  const [cash, bank, card, hdfc] = ["Cash", "Bank", "Card", "HDFC"].map((x) => acc(s, x)._id);
  s = run(s, "accounts.update", { ...acc(s, "Card"), id: card, billingAccountId: hdfc, settlementDay: 1, paymentDay: 15 });
  s = run(s, "accounts.update", { ...acc(s, "Bank"), id: bank, initialBalance: 100000 });
  const tx = (t: Record<string, unknown>) => { s = run(s, "transactions.create", { note: "", tags: [], photoIds: [], date: "2026-10-01", ...t }); };
  tx({ type: "expense", accountId: hdfc, categoryId: food, amount: 1200, note: "Lunch" });
  tx({ type: "expense", accountId: bank, categoryId: food, amount: 800 });
  tx({ type: "transfer", accountId: bank, toAccountId: hdfc, amount: 10000, feeAmount: 50, note: "Move" }); // between the two: dropped, fee kept
  tx({ type: "transfer", accountId: hdfc, toAccountId: cash, amount: 2000, note: "ATM" });
  s = run(s, "transactions.create", { type: "transfer", accountId: hdfc, toAccountId: bank, amount: 500, note: "Sweep", tags: [], photoIds: [], date: "2026-10-02", repeat: { frequency: "monthly" } });
  s = run(s, "bookmarks.create", { template: { type: "expense", accountId: hdfc, categoryId: food, amount: 300, note: "Coffee", tags: [] } });
  s = run(s, "settings.setDefaultAccount", { id: hdfc });
  return { s, cash, bank, card, hdfc };
}

test("merging moves entries, schedules, bookmarks and balances into the kept method", () => {
  const { s, cash, bank, card, hdfc } = setup();
  const before = accountsList(s, "2026-10-19");
  const bal = (l: typeof before, id: string) => l.accounts.find((a) => a._id === id)?.balance ?? 0;
  const result = runResult(s, "accounts.merge", { sourceIds: [hdfc], targetId: bank }) as { moved: number; droppedTransfers: number };
  const m = run(s, "accounts.merge", { sourceIds: [hdfc], targetId: bank });
  const after = accountsList(m, "2026-10-19");

  expect(m.accounts.some((a) => a._id === hdfc)).toBe(false);
  // the kept bank holds what both held, minus only the fee that now shows as an expense; nothing else moves
  expect(bal(after, bank)).toBe(bal(before, bank) + bal(before, hdfc));
  expect(bal(after, cash)).toBe(bal(before, cash));
  expect([after.assets - after.liabilities]).toEqual([before.assets - before.liabilities]);
  // entries now on Bank; the transfers between the two are gone, the fee is an expense
  expect(m.transactions.some((t) => t.accountId === hdfc || t.toAccountId === hdfc)).toBe(false);
  expect(m.transactions.find((t) => t.note === "Lunch")!.accountId).toBe(bank);
  expect(m.transactions.find((t) => t.note === "ATM")).toMatchObject({ accountId: bank, toAccountId: cash });
  expect(m.transactions.some((t) => t.note === "Move" && t.type === "transfer")).toBe(false);
  const fee = m.transactions.find((t) => t.note === "Fee: Move")!;
  expect(fee).toMatchObject({ type: "expense", amount: 50, accountId: bank });
  expect(m.categories.find((c) => c._id === fee.categoryId)!.name).toBe("Transfer Fee");
  expect(result.droppedTransfers).toBe(2); // "Move" and the first "Sweep"
  // the sweep schedule would transfer Bank to Bank: it goes, like its entry
  expect(m.repeats).toHaveLength(0);
  expect(m.bookmarks[0].template.accountId).toBe(bank);
  // the card billed to HDFC is billed to Bank now, and the default follows
  expect(m.accounts.find((a) => a._id === card)!.billingAccountId).toBe(bank);
  expect(m.settings[0].defaultAccountId).toBe(bank);
  expect(m.accounts.find((a) => a._id === bank)!.initialBalance).toBe(150000);
});

test("merging refuses anything that would move money between banks behind the user's back", () => {
  let { s, bank, card, hdfc } = setup();
  s = run(s, "accounts.create", { name: "Debit", kind: "debitCard", linkedAccountId: hdfc, initialBalance: 0, includeInTotals: true, hidden: false, transferAsExpense: false });
  const debit = acc(s, "Debit")._id;
  // a debit card spending from HDFC cannot join another bank...
  expect(() => run(s, "accounts.merge", { sourceIds: [debit], targetId: bank })).toThrow(/spends from HDFC/);
  // ...but can join HDFC itself
  expect(() => run(s, "accounts.merge", { sourceIds: [debit], targetId: hdfc })).not.toThrow();
  // a card billed to HDFC cannot keep going if HDFC merges into it
  expect(() => run(s, "accounts.merge", { sourceIds: [hdfc], targetId: card })).toThrow(/billed to one of these/);
  expect(() => run(s, "accounts.merge", { sourceIds: [bank], targetId: bank })).toThrow(/at least two/);
});
