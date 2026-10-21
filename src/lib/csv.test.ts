import { expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "../../shared/ops";
import { txCsvRows } from "../../shared/views";
import { mapImportRow, parseTable, toCSV } from "./csv";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);

function fresh(): Snapshot {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" }).snap;
  s = run(s, "currencies.add", { code: "EUR", name: "Euro", symbol: "€", rate: 0.9, decimals: 2, symbolPosition: "before", isCustom: false }).snap;
  return s;
}

const entries = (s: Snapshot) => s.transactions.map((t) => ({
  type: t.type, date: t.date, amount: t.amount, fee: t.feeAmount, note: t.note, tags: t.tags, sub: t.subAmount, cur: t.subCurrency,
})).sort((a, b) => a.note.localeCompare(b.note));

test.each([",", "\t"] as const)("an export separated by %j imports back to the same entries, fees, tags and sub-currency amounts", (delim) => {
  let s = fresh();
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const [cash, bank] = s.accounts;
  s = run(s, "transactions.create", { type: "expense", accountId: cash._id, categoryId: food, amount: 1234, note: "lunch", tags: ["work", "team lunch"], photoIds: [], date: "2026-01-02" }).snap;
  s = run(s, "transactions.create", { type: "expense", accountId: cash._id, categoryId: food, amount: 1389, subAmount: 1250, subCurrency: "EUR", exchangeRate: 0.9, note: "paris", tags: [], photoIds: [], date: "2026-01-03" }).snap;
  s = run(s, "transactions.create", { type: "transfer", accountId: bank._id, toAccountId: cash._id, amount: 5000, feeAmount: 150, note: "atm", tags: [], photoIds: [], date: "2026-01-04" }).snap;

  const file = toCSV(txCsvRows(s), delim);
  const { headers, rows } = parseTable(file);
  const r = run(fresh(), "transactions.importRows", { rows: rows.map((row) => mapImportRow(row, headers)), skipInvalid: true });
  expect((r.result as { errors: unknown[] }).errors).toEqual([]);
  expect(entries(r.snap)).toEqual(entries(s));
});

test("a note that looks like a formula is exported inert and imports back unchanged", () => {
  let s = fresh();
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const tx = { type: "expense", accountId: s.accounts[0]._id, categoryId: food, amount: 100, tags: [], photoIds: [], date: "2026-01-02" };
  for (const note of ['=HYPERLINK("http://x","pay")', "+91 refund", "-5 off", "@home", "'quoted"]) s = run(s, "transactions.create", { ...tx, note }).snap;
  const file = toCSV(txCsvRows(s));
  expect(file).toContain(`"'=HYPERLINK(""http://x"",""pay"")"`);
  expect(file).not.toMatch(/,=HYPERLINK/);
  const { headers, rows } = parseTable(file);
  const r = run(fresh(), "transactions.importRows", { rows: rows.map((row) => mapImportRow(row, headers)), skipInvalid: true });
  expect(entries(r.snap).map((e) => e.note)).toEqual(entries(s).map((e) => e.note));
});
