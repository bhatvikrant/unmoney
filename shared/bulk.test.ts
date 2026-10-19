import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, restoreRowsFrom, type BackupData, type RestoreIds, type Snapshot } from "./ops";
import { backupExport } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

/** A ledger with the awkward cases: a transfer with a fee, a subcategory, an installment series, a sub-currency. */
function ledger(): Snapshot {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const [cash, bank] = s.accounts;
  const sub = run(s, "categories.create", { type: "expense", name: "Groceries", parentId: food });
  s = sub.snap;
  const tx = { type: "expense", accountId: cash._id, categoryId: food, amount: 1234, note: "a", tags: ["t"], photoIds: [], date: "2026-01-02" };
  s = run(s, "transactions.create", { ...tx, subcategoryId: sub.result }).snap;
  s = run(s, "transactions.create", { ...tx, installment: { count: 3 } }).snap;
  s = run(s, "transactions.create", { ...tx, amount: 900, subAmount: 1000, subCurrency: "EUR", exchangeRate: 0.9 }).snap;
  s = run(s, "transactions.create", { type: "transfer", accountId: bank._id, toAccountId: cash._id, amount: 5000, feeAmount: 150, note: "ATM", tags: [], photoIds: [], date: "2026-01-03" }).snap;
  return s;
}

/** Entries described by names, not ids, so two restores can be compared. */
function describe(s: Snapshot) {
  const acc = (id?: string) => s.accounts.find((a) => a._id === id)?.name;
  const cat = (id?: string) => s.categories.find((c) => c._id === id)?.name;
  const rep = (id?: string) => (id ? s.repeats.find((r) => r._id === id)?.kind : undefined);
  return s.transactions.map((t) => ({
    type: t.type, date: t.date, amount: t.amount, fee: t.feeAmount, note: t.note, tags: t.tags, sub: [t.subAmount, t.subCurrency, t.exchangeRate],
    acc: acc(t.accountId), to: acc(t.toAccountId), cat: cat(t.categoryId), subcat: cat(t.subcategoryId), rep: rep(t.repeatId), inst: [t.installmentIndex, t.installmentCount, t.installmentTotal],
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test("a chunked restore ends up exactly where the one-shot restore did", () => {
  const source = ledger();
  const data = JSON.parse(JSON.stringify(backupExport(source))) as BackupData;
  const target = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" }).snap;

  const oneShot = run(target, "backup.restore", { data }).snap;

  const restored = run(target, "backup.restore", { data: { ...data, transactions: [] }, entries: false });
  let chunked = restored.snap;
  const rows = restoreRowsFrom(data, restored.result as RestoreIds);
  for (let i = 0; i < rows.length; i += 2) chunked = run(chunked, "transactions.restoreRows", { rows: rows.slice(i, i + 2) }).snap;

  expect(describe(chunked)).toEqual(describe(oneShot));
  expect(describe(chunked)).toEqual(describe(source));
  expect(chunked.repeats.length).toBe(oneShot.repeats.length);
});

test("rescaling in chunks matches changing currency in one go", () => {
  const source = ledger();
  const oneShot = run(source, "settings.changeMainCurrency", { code: "JPY", keepData: true }).snap;
  let chunked = run(source, "transactions.rescale", { ids: source.transactions.slice(0, 3).map((t) => t._id), factor: 0.01 }).snap;
  chunked = run(chunked, "transactions.rescale", { ids: source.transactions.slice(3).map((t) => t._id), factor: 0.01 }).snap;
  chunked = run(chunked, "settings.changeMainCurrency", { code: "JPY", keepData: true, entries: false }).snap;
  expect(describe(chunked)).toEqual(describe(oneShot));
  expect(chunked.accounts).toEqual(oneShot.accounts);
  expect(chunked.settings).toEqual(oneShot.settings);
});

test("restored rows cannot point at accounts the user does not have", () => {
  const s = ledger();
  const r = run(s, "transactions.restoreRows", { rows: [{ type: "expense", date: "2026-01-01", accountId: "someone-elses", amount: 1, note: "", tags: [], photoIds: [] }] });
  expect(r.result).toBe(0);
  expect(r.snap.transactions.length).toBe(s.transactions.length);
});
