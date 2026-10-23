import Papa from "papaparse";
import type { ImportRow, NewImportAccount } from "../../shared/ops";

export function downloadText(filename: string, text: string, mime = "text/plain") {
  // a byte-order mark, so Excel on Windows opens a CSV as UTF-8 (₹, accents, Hindi notes) rather than ANSI; readers drop it
  const bom = /^text\/(csv|tab-separated-values)/.test(mime) ? "\uFEFF" : "";
  const blob = new Blob([bom + text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A text cell starting with = + - @ gets a leading ' so a spreadsheet shows it rather than running it as a formula. */
export function toCSV(rows: Record<string, unknown>[], delimiter = ","): string {
  return Papa.unparse(rows, { delimiter, escapeFormulae: true });
}

/** The ' that toCSV puts before a would-be formula comes off again, so an export imports back as it was. */
export const unescapeFormula = (v: string) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

export function parseTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, delimiter: "", transform: unescapeFormula });
  const headers = res.meta.fields ?? [];
  return { headers, rows: res.data };
}

/**
 * Map arbitrary headers (Money Manager export, our export, or hand-made) to import fields.
 * Money Manager's Excel export has a column named after the main currency (e.g. "INR") holding
 * the amount in that currency, with "Amount" and "Currency" holding what was actually spent.
 */
export function mapImportRow(row: Record<string, string>, headers: string[] = Object.keys(row)): ImportRow {
  const get = (...names: string[]) => {
    for (const n of names) {
      const key = Object.keys(row).find((k) => k.trim().toLowerCase() === n.toLowerCase());
      if (key !== undefined && row[key] !== undefined && row[key] !== "") return String(row[key]);
    }
    return "";
  };
  const mainCol = headers.find((h) => /^[A-Z]{3}$/.test(h.trim()));
  const when = get("Date", "Period", "date");
  const time = when.match(/\d[ T](\d{1,2}:\d{2})/)?.[1] || get("Time", "time") || undefined;
  return {
    date: when,
    time,
    account: get("Account", "Accounts", "account"),
    category: get("Category", "category"),
    subcategory: get("Subcategory", "Sub Category", "subcategory") || undefined,
    note: get("Note", "Contents", "note") || undefined,
    amount: mainCol ? row[mainCol] ?? "" : get("Amount", "amount"),
    type: get("Income/Expense", "Type", "type"),
    description: get("Description", "Memo", "description") || undefined,
    subAmount: (mainCol ? get("Amount Sub", "Amount") : get("Amount Sub", "Amount_1", "AmountSub", "subAmount")) || undefined,
    subCurrency: get("Currency", "subCurrency") || undefined,
    fee: get("Fee", "fee") || undefined,
    tags: get("Tags", "tags") || undefined,
  };
}

/** Best guess at a payment method's type from its name, so the user mostly just confirms. */
export function guessKind(name: string): NewImportAccount["kind"] {
  const n = name.toLowerCase();
  if (/debit/.test(n)) return "debitCard";
  if (/\bcc\b|credit|\bcard\b/.test(n)) return "card";
  if (/\bcash\b/.test(n)) return "cash";
  if (/upi|gpay|google pay|phonepe|bhim/.test(n)) return "upi";
  if (/wallet|\bpay\b|paytm|pluxee|sodexo|balance|prepaid/.test(n)) return "prepaid";
  if (/saving/.test(n)) return "savings";
  return "bank";
}

/** Account names the rows refer to (including transfer destinations) in first-seen order. */
export function accountNamesIn(rows: { account: string; category: string; type: string }[]): string[] {
  const seen = new Map<string, string>();
  const add = (n: string) => { const t = n.trim(); if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t); };
  for (const r of rows) { add(r.account); if (/^trans/i.test(r.type.trim())) add(r.category); }
  return [...seen.values()];
}
