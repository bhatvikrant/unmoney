import { expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { applyOp, detectImportFormat, emptySnapshot, type Snapshot } from "../../shared/ops";
import { findHeaderRow, guessMapping, isMoneyManagerHeader, mappingReady, normaliseBankDate, toImportRows, type Grid } from "./bankImport";
import { readImportFile } from "./importFile";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);

/** An HDFC-style savings statement: account details on top, money out and in in two columns, a closing line. */
const HDFC: Grid = [
  ["HDFC BANK Ltd.", "", "", "", "", "", ""],
  ["Account No : 50100012345678", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
  ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
  ["01/10/26", "UPI-SWIGGY-swiggy@icici-ICIC0DC0099-123456789012-PAYMENT FROM PHONE FOR ORDER 8812 DINNER", "0000123", "01/10/26", "485.00", "", "1,24,515.00"],
  ["02/10/26", "SALARY OCT ACME TECHNOLOGIES PVT LTD", "0000124", "02/10/26", "", "1,20,000.00", "2,44,515.00"],
  ["15/10/26", "NWD-ATM CASH", "0000125", "15/10/26", "2,000.00", "", "2,42,515.00"],
  ["", "", "", "", "", "", ""],
  ["STATEMENT SUMMARY", "", "", "", "", "", ""],
];

test("the header row is found below a statement's account details", () => {
  expect(findHeaderRow(HDFC)).toBe(3);
  expect(findHeaderRow([["Date", "Amount", "Note"], ["2026-10-01", "5", "x"]])).toBe(0);
  expect(findHeaderRow([["", ""], ["a", "b"], ["c", "d"]])).toBe(1);
});

test("an HDFC layout is guessed: date (not value date), narration, withdrawal and deposit; balance never", () => {
  const m = guessMapping(HDFC, 3);
  expect(m).toMatchObject({ date: 0, description: 1, mode: "split", out: 4, in: 5, category: -1 });
  expect(mappingReady(m)).toBe(true);
  const { rows, noAmount } = toImportRows(HDFC, m, { account: "HDFC Savings", categoryFor: (note) => (note.startsWith("UPI-SWIGGY") ? "Food" : undefined) });
  expect(noAmount).toBe(1); // STATEMENT SUMMARY
  expect(rows.map((r) => [r.date, r.type, r.amount, r.category, r.account])).toEqual([
    ["01/10/2026", "Expenses", "485.00", "Food", "HDFC Savings"],
    ["02/10/2026", "Income", "1,20,000.00", "Other", "HDFC Savings"],
    ["15/10/2026", "Expenses", "2,000.00", "Other", "HDFC Savings"],
  ]);
  // a long narration keeps 80 characters as the note, the whole of it in the description
  expect(rows[0].note).toHaveLength(80);
  expect(rows[0].description).toBe(HDFC[4][1]);
  expect(rows[1].description).toBeUndefined();
});

test("an ICICI layout with one amount and a Dr/Cr column", () => {
  const grid: Grid = [
    ["S No.", "Transaction Date", "Transaction Remarks", "Amount (INR)", "Dr / Cr", "Balance (INR)"],
    ["1", "01-Oct-2026", "UPI/ZOMATO", "350.00", "DR", "9,650.00"],
    ["2", "03-Oct-2026", "NEFT REFUND", "120.50", "CR", "9,770.50"],
  ];
  const m = guessMapping(grid, 0);
  expect(m).toMatchObject({ date: 1, description: 2, mode: "single", amount: 3, sign: "drcr", drcr: 4 });
  const { rows } = toImportRows(grid, m, { account: "ICICI" });
  expect(rows.map((r) => [r.date, r.type, r.amount])).toEqual([["2026-10-01", "Expenses", "350.00"], ["2026-10-03", "Refund", "120.50"]]);
});

test("a card statement lists purchases as positive; a bank's single column uses the minus sign", () => {
  const grid: Grid = [["Date", "Description", "Amount"], ["2026-10-04", "AMAZON", "1,299.00"], ["2026-10-20", "PAYMENT RECEIVED", "-5,000.00"]];
  const card = guessMapping(grid, 0, "card");
  expect(card.sign).toBe("positiveOut");
  expect(toImportRows(grid, card, { account: "Card" }).rows.map((r) => [r.type, r.amount])).toEqual([["Expenses", "1,299.00"], ["Income", "5,000.00"]]);
  const bank = guessMapping(grid, 0, "bank");
  expect(bank.sign).toBe("negativeOut");
  expect(toImportRows(grid, bank, { account: "Bank" }).rows.map((r) => r.type)).toEqual(["Income", "Expenses"]);
});

test("bank date spellings are rewritten so the importer reads them", () => {
  expect(normaliseBankDate("01-Oct-2026")).toBe("2026-10-01");
  expect(normaliseBankDate("1 October 2026")).toBe("2026-10-01");
  expect(normaliseBankDate("Oct 1, 2026")).toBe("2026-10-01");
  expect(normaliseBankDate("05/10/26")).toBe("05/10/2026");
  expect(normaliseBankDate("2026-10-05 14:30")).toBe("2026-10-05 14:30");
  expect(normaliseBankDate("Opening Balance")).toBe("Opening Balance");
});

test("end to end: an HDFC statement imports into the chosen method with the right signs, day-first dates read from the file", () => {
  const s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const { rows } = toImportRows(HDFC, guessMapping(HDFC, 3), { account: "Bank" });
  const format = detectImportFormat(rows, { dateOrder: "mdy", decimal: "." });
  expect(format.dateOrder).toBe("dmy");
  const r = run(s, "transactions.importRows", { rows, format, createMissing: true, skipInvalid: true, skipDuplicates: true });
  const res = r.result as { inserted: number; errors: unknown[] };
  expect(res).toMatchObject({ inserted: 3, errors: [] });
  const bank = r.snap.accounts.find((a) => a.name === "Bank")!._id;
  expect(r.snap.transactions.map((t) => [t.date, t.type, t.amount, t.accountId === bank]).sort()).toEqual([
    ["2026-10-01", "expense", 48500, true], ["2026-10-02", "income", 12000000, true], ["2026-10-15", "expense", 200000, true],
  ]);
});

test("Money Manager's own layout keeps the old path; a bank statement goes to the column step", async () => {
  expect(isMoneyManagerHeader(["Period", "Accounts", "Category", "Subcategory", "Note", "INR", "Income/Expense"])).toBe(true);
  expect(isMoneyManagerHeader(["Date", "Account", "Category", "Note", "Amount", "Income/Expense"])).toBe(true);
  expect(isMoneyManagerHeader(HDFC[3])).toBe(false);
  const mm = await readImportFile(new Blob(["Date,Account,Category,Note,Amount,Income/Expense\n2026-10-01,Cash,Food,Tea,40,Expenses\n"]), "export.csv");
  expect([mm.bank, mm.rows.length, mm.rows[0].category]).toEqual([undefined, 1, "Food"]);
  const csv = HDFC.map((r) => r.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",")).join("\n");
  const bank = await readImportFile(new Blob([csv]), "Acct_Statement.csv");
  expect([bank.rows.length, bank.bank?.headerRow]).toEqual([0, 3]);
});

test("money in that says refund or reversal imports as a refund in the merchant's spending category", () => {
  const grid: Grid = [
    ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt."],
    ["03/10/26", "POS MYNTRA DESIGNS", "2,499.00", ""],
    ["06/10/26", "REFUND - MYNTRA DESIGNS", "", "899.00"],
    ["07/10/26", "UPI/REV/123456/SWIGGY", "", "485.00"],
    ["08/10/26", "SALARY OCT", "", "1,20,000.00"],
    ["09/10/26", "REVATHI STORES", "", "300.00"],
  ];
  const history: Record<string, string> = { "expense|POS MYNTRA DESIGNS": "Apparel", "expense|MYNTRA DESIGNS": "Apparel" };
  const categoryFor = (note: string, type: "income" | "expense") => history[`${type}|${note}`];
  const on = toImportRows(grid, guessMapping(grid, 0), { account: "Bank", categoryFor, spent: [["Swiggy", "Food"], ["Swig", "Wrong"], ["Uber", "Transport"]] });
  expect(on.refunds).toBe(2);
  expect(on.rows.map((r) => [r.note, r.type, r.category])).toEqual([
    ["POS MYNTRA DESIGNS", "Expenses", "Apparel"],
    ["REFUND - MYNTRA DESIGNS", "Refund", "Apparel"],
    ["UPI/REV/123456/SWIGGY", "Refund", "Food"],
    ["SALARY OCT", "Income", "Other"],
    ["REVATHI STORES", "Income", "Other"],
  ]);
  const off = toImportRows(grid, guessMapping(grid, 0), { account: "Bank", categoryFor, refunds: false });
  expect([off.refunds, off.rows.filter((r) => r.type === "Refund").length]).toEqual([0, 0]);

  // stored as an expense below zero, so it nets against the purchase
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  s = run(s, "transactions.importRows", { rows: on.rows, format: detectImportFormat(on.rows, { dateOrder: "mdy", decimal: "." }), createMissing: true, skipInvalid: true }).snap;
  const myntra = s.transactions.filter((t) => t.note.includes("MYNTRA")).map((t) => [t.type, t.amount]);
  expect(myntra.sort()).toEqual([["expense", -89900], ["expense", 249900]]);
});

test("Deposit and Withdrawal words, and a Dr/Cr after the amount, decide the direction", () => {
  const typed: Grid = [
    ["Date", "Narration", "Type", "Amount"],
    ["01/10/2026", "SALARY", "Deposit", "1,20,000.00"],
    ["02/10/2026", "SWIGGY", "Withdrawal", "485.00"],
  ];
  const m = guessMapping(typed, 0);
  expect(m.sign).toBe("drcr");
  expect(toImportRows(typed, m, { account: "Bank" }).rows.map((r) => r.type)).toEqual(["Income", "Expenses"]);
  const suffixed: Grid = [
    ["Date", "Narration", "Amount"],
    ["01/10/2026", "SALARY", "1,20,000.00 Cr"],
    ["02/10/2026", "SWIGGY", "485.00 Dr"],
  ];
  const rows = toImportRows(suffixed, guessMapping(suffixed, 0), { account: "Bank" }).rows;
  expect(rows.map((r) => [r.type, r.amount])).toEqual([["Income", "1,20,000.00"], ["Expenses", "485.00"]]);
});
