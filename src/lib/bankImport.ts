/**
 * A bank statement (CSV or Excel) turned into the rows transactions.importRows takes, from a
 * column mapping the user confirms (docs/specs/bank-import.md). Pure: the page guesses a mapping,
 * shows a preview, and hands the rows to the same review as a Money Manager file.
 */
import type { ImportRow } from "../../shared/ops";
import { parseNumber } from "../../shared/money";
import { MONTH_SHORT } from "../../shared/dates";

export type Grid = string[][];
/** -1: no such column. */
export type Col = number;
export type BankMapping = {
  headerRow: number;
  date: Col;
  description: Col;
  /** "single": one amount column, its sign (or a Dr/Cr column) says which way; "split": a money-out and a money-in column. */
  mode: "single" | "split";
  amount: Col;
  out: Col;
  in: Col;
  /** With one amount column: which sign is money out, or a Dr/Cr column says. */
  sign: "negativeOut" | "positiveOut" | "drcr";
  drcr: Col;
  category: Col;
};

const has = (cells: string[], re: RegExp) => cells.some((c) => re.test(c));
const DATE_HEAD = /date|period/i;
const AMOUNT_HEAD = /amount|amt|debit|credit|withdrawal|deposit/i;

/**
 * The header row: the first of the first 30 rows with at least three cells, one naming a date and
 * one an amount. Statements put account details and a blank line or two above it. Failing that,
 * the first row with two or more cells.
 */
export function findHeaderRow(grid: Grid): number {
  const filled = (r: string[]) => r.filter((c) => c.trim()).length;
  for (let i = 0; i < Math.min(30, grid.length); i++) {
    const r = grid[i];
    if (filled(r) >= 3 && has(r, DATE_HEAD) && has(r, AMOUNT_HEAD)) return i;
  }
  const i = grid.findIndex((r) => filled(r) >= 2);
  return Math.max(0, i);
}

/** Header names as the importer keys them: empty ones named by position, repeats numbered ("Amount_1"). */
export function headerNames(row: string[]): string[] {
  const seen = new Map<string, number>();
  return row.map((cell, c) => {
    const h = cell.trim() || `Column ${c + 1}`;
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n ? `${h}_${n}` : h;
  });
}

/** Money Manager's export, or UnMoney's own: date, account, category, amount and a type column. Those keep the old path. */
export function isMoneyManagerHeader(headers: string[]): boolean {
  const h = headers.map((x) => x.trim().toLowerCase());
  const any = (...names: string[]) => names.some((n) => h.includes(n));
  // Money Manager names the main-currency amount column after the currency ("INR")
  const amount = any("amount") || headers.some((x) => /^[A-Z]{3}$/.test(x.trim()));
  return any("date", "period") && amount && any("account", "accounts") && any("category") && any("income/expense", "type");
}

/** The first header matching `re` and none of `not`, among columns not taken yet. */
function pick(headers: string[], re: RegExp, taken: Set<number>, not?: RegExp): Col {
  const i = headers.findIndex((h, c) => !taken.has(c) && re.test(h) && !(not && not.test(h)));
  if (i >= 0) taken.add(i);
  return i;
}

/** Whether most filled cells of a column read Dr/Cr (or Debit/Credit). */
function looksDrCr(grid: Grid, headerRow: number, col: Col): boolean {
  const vals = grid.slice(headerRow + 1, headerRow + 41).map((r) => (r[col] ?? "").trim().toLowerCase()).filter(Boolean);
  return vals.length > 0 && vals.filter((v) => /^(dr|cr|debit|credit|d|c|withdrawal|deposit)\.?$/.test(v)).length >= vals.length * 0.8;
}

/**
 * A first guess from the header names in English bank wording (date, narration, withdrawal,
 * deposit, Dr/Cr…). Balance columns are never picked. A credit card statement lists purchases
 * as positive amounts, so for a card the sign rule starts the other way round.
 */
export function guessMapping(grid: Grid, headerRow: number, accountKind?: string): BankMapping {
  const headers = (grid[headerRow] ?? []).map((h) => h.trim());
  const taken = new Set<number>(headers.map((h, i) => (/balance/i.test(h) ? i : -1)).filter((i) => i >= 0));
  // the transaction's own date over the value date when a statement has both
  const dateCols = headers.map((_, i) => i).filter((i) => !taken.has(i) && /date|period/i.test(headers[i]));
  const date = dateCols.find((i) => !/value/i.test(headers[i])) ?? dateCols[0] ?? -1;
  if (date >= 0) taken.add(date);
  const description = pick(headers, /narration|description|particulars|details|remarks|memo|merchant|payee|transaction$/i, taken);
  let drcr = -1;
  for (let c = 0; c < headers.length; c++) {
    if (taken.has(c)) continue;
    if (/^(dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit|type|txn type|transaction type)$/i.test(headers[c]) && looksDrCr(grid, headerRow, c)) { drcr = c; taken.add(c); break; }
  }
  const out = pick(headers, /withdraw|debit|money out|paid out|\bdr\b|spent/i, taken);
  const inn = pick(headers, /deposit|credit|money in|paid in|\bcr\b|received/i, taken);
  const amount = pick(headers, /amount|amt/i, taken);
  const category = pick(headers, /^category$/i, taken);
  const split = out >= 0 && inn >= 0;
  return {
    headerRow, date, description, mode: split ? "split" : "single",
    amount: split ? amount : amount >= 0 ? amount : out >= 0 ? out : inn,
    out: split ? out : -1, in: split ? inn : -1,
    sign: drcr >= 0 ? "drcr" : accountKind === "card" ? "positiveOut" : "negativeOut", drcr, category,
  };
}

/** Whether a mapping can produce rows: a date and somewhere to read the amount. */
export function mappingReady(m: BankMapping): boolean {
  if (m.date < 0) return false;
  if (m.mode === "split") return m.out >= 0 && m.in >= 0 && m.out !== m.in;
  return m.amount >= 0 && (m.sign !== "drcr" || m.drcr >= 0);
}

const MONTH = new Map(MONTH_SHORT.map((m, i) => [m.toLowerCase(), i + 1]));
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Bank date spellings the importer's date reader doesn't know, written the way it does: "01-Oct-2026",
 * "1 Oct 2026" and "Oct 1, 2026" become "2026-10-01"; a two-digit year ("01/10/26") gets its century,
 * keeping the slashes so day-first vs month-first is still decided for the whole file.
 */
export function normaliseBankDate(raw: string): string {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})[\s\-/.]([A-Za-z]{3})[A-Za-z]*[\s\-/.,]+(\d{2}|\d{4})\b/);
  if (m && MONTH.has(m[2].toLowerCase())) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(MONTH.get(m[2].toLowerCase())!)}-${pad(Number(m[1]))}`;
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*[\s\-.]+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTH.has(m[1].toLowerCase())) return `${m[3]}-${pad(MONTH.get(m[1].toLowerCase())!)}-${pad(Number(m[2]))}`;
  m = s.match(/^(\d{1,2})([/-])(\d{1,2})\2(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}${m[2]}20${m[4]}`;
  return s;
}

/** A note keeps the first 80 characters of a long bank narration; the whole of it goes in the description. */
export const NOTE_MAX = 80;

/** Money in that a statement calls a refund or a reversal ("REFUND MYNTRA", "UPI/REV/…", "CHARGEBACK"): money back on an expense. */
const REFUND_WORDS = /\b(refund(ed)?|reversal|reversed|rev|chargeback|charge back)\b/gi;
export const isRefundText = (text: string) => new RegExp(REFUND_WORDS.source, "i").test(text);
/** The merchant once the refund wording is taken off ("Refund - Myntra" → "Myntra"), to find what the user files it under. */
export const withoutRefundWords = (text: string) => text.replace(REFUND_WORDS, " ").replace(/^[\s\-/:.,]+|[\s\-/:.,]+$/g, "").replace(/\s+/g, " ");

const words = (s: string) => ` ${s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/**
 * The category of the longest past spending note (3+ characters) that appears in `text` as whole
 * words: a refund's narration names the merchant among codes ("UPI/REV/123456/Swiggy" → Swiggy's).
 */
export function categoryInText(text: string, spent: [note: string, category: string][]): string | undefined {
  const t = words(text);
  let best: [number, string] | undefined;
  for (const [note, category] of spent) {
    const n = words(note);
    if (n.trim().length >= 3 && t.includes(n) && (!best || n.length > best[0])) best = [n.length, category];
  }
  return best?.[1];
}

export type BankRows = { rows: ImportRow[]; noAmount: number; refunds: number };

/**
 * The rows for transactions.importRows. Every row goes to `account`. Money out is an expense and
 * money in an income. The category is the mapped column, else `categoryFor` (what the user's
 * history files that note under), else "Other". With `refunds` (on unless false), money in whose
 * description says refund or reversal is a refund instead: an expense below zero in the category the
 * user files that merchant's spending under (the note, the note without the refund words, or a past
 * spending note named in it: `spent`), so it nets against it. Blank rows and rows with no amount (or 0) are
 * left out and counted. A row whose date doesn't read (opening and closing balance lines) goes
 * through, and the review lists it as skipped with the reason.
 */
export function toImportRows(grid: Grid, m: BankMapping, opts: { account: string; categoryFor?: (note: string, type: "income" | "expense") => string | undefined; refunds?: boolean; spent?: [note: string, category: string][] }): BankRows {
  const rows: ImportRow[] = [];
  let noAmount = 0;
  let refunds = 0;
  const cell = (r: string[], c: Col) => (c >= 0 ? (r[c] ?? "").trim() : "");
  for (const r of grid.slice(m.headerRow + 1)) {
    if (!r.some((c) => c.trim())) continue;
    let raw = "";
    let out: boolean | null = null;
    if (m.mode === "split") {
      const o = cell(r, m.out), i = cell(r, m.in);
      const ov = o ? parseNumber(o) : null, iv = i ? parseNumber(i) : null;
      if (ov) { raw = o; out = true; }
      else if (iv) { raw = i; out = false; }
    } else {
      raw = cell(r, m.amount);
      const v = raw ? parseNumber(raw) : null;
      if (v) {
        if (m.sign === "drcr") {
          const d = cell(r, m.drcr).toLowerCase();
          // whole words: "deposit" starts with d but is money in
          out = /^(dr|debit|w|withdrawal)\.?$/.test(d) ? true : /^(cr|credit|c|d|deposit)\.?$/.test(d) ? false : v < 0;
        } else {
          // "350.00 Dr" / "350.00 Cr" on the amount itself says which way it went; else the sign rule
          const tail = /\b(dr|cr)\.?$/i.exec(raw)?.[1].toLowerCase();
          out = tail ? tail === "dr" : m.sign === "negativeOut" ? v < 0 : v > 0;
        }
      }
    }
    if (out === null) { noAmount++; continue; }
    const text = cell(r, m.description).replace(/\s+/g, " ");
    const refund = !out && opts.refunds !== false && isRefundText(text);
    if (refund) refunds++;
    const type = out || refund ? "expense" : "income";
    const note = text.length > NOTE_MAX ? text.slice(0, NOTE_MAX).trim() : text;
    const category = cell(r, m.category) || opts.categoryFor?.(note, type)
      || (refund ? opts.categoryFor?.(withoutRefundWords(note), "expense") : undefined)
      // a note the user filed before, inside the narration ("UPI-SWIGGY-…" holds "swiggy"): its category, rather than Other
      || (type === "expense" ? categoryInText(text, opts.spent ?? []) : undefined)
      || "Other";
    rows.push({
      date: normaliseBankDate(cell(r, m.date)), account: opts.account, category, note,
      amount: raw.replace(/^[-+]\s*|\s*(dr|cr)\.?$/gi, "").replace(/^\((.*)\)$/, "$1"),
      type: refund ? "Refund" : type === "expense" ? "Expenses" : "Income",
      ...(text.length > NOTE_MAX ? { description: text } : {}),
    });
  }
  return { rows, noAmount, refunds };
}
