import Papa from "papaparse";
import type { NewImportAccount } from "../../shared/ops";

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(rows: Record<string, unknown>[], delimiter = ","): string {
  return Papa.unparse(rows, { delimiter });
}

export function parseTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, delimiter: "" });
  const headers = res.meta.fields ?? [];
  return { headers, rows: res.data };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  // read-excel-file returns dates as UTC-midnight-based Date objects
  if (v instanceof Date) {
    // Excel stores times as day fractions, so 13:41:00 can read back as 13:40:59.999; round to the nearest second
    const t = new Date(Math.round(v.getTime() / 1000) * 1000);
    const d = `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
    const hasTime = t.getUTCHours() || t.getUTCMinutes() || t.getUTCSeconds();
    return hasTime ? `${d} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}` : d;
  }
  return String(v).trim();
}

/** Read an Excel (.xlsx) export, e.g. from Money Manager. Every sheet that has a Date and Amount column is merged. */
export async function parseXlsx(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const { default: readExcelFile } = await import("read-excel-file/browser");
  const sheets = await readExcelFile(file);
  let headers: string[] = [];
  const rows: Record<string, string>[] = [];
  for (const { data } of sheets) {
    const headerIdx = data.findIndex((r) => {
      const cells = r.map((c) => cellToString(c).toLowerCase());
      return (cells.includes("date") || cells.includes("period")) && cells.includes("amount");
    });
    if (headerIdx < 0) continue;
    // Money Manager repeats "Amount" for the sub-currency amount; keep the first as-is, call the second "Amount Sub"
    const seen = new Set<string>();
    const cols = data[headerIdx].map((c) => {
      let name = cellToString(c);
      if (name && seen.has(name.toLowerCase()) && name.toLowerCase() === "amount") name = "Amount Sub";
      seen.add(name.toLowerCase());
      return name;
    });
    if (!headers.length) headers = cols.filter(Boolean);
    for (const r of data.slice(headerIdx + 1)) {
      const obj: Record<string, string> = {};
      // Money Manager also repeats "Accounts" at the end; the first column wins
      cols.forEach((name, i) => { if (name && !(name in obj)) obj[name] = cellToString(r[i]); });
      if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
    }
  }
  return { headers, rows };
}

/** Map arbitrary headers (Money Manager export, our export, or hand-made) to import fields. */
export function mapImportRow(row: Record<string, string>): {
  date: string; account: string; category: string; subcategory?: string; note?: string; amount: string; type: string;
  description?: string; subAmount?: string; subCurrency?: string; time?: string;
} {
  const get = (...names: string[]) => {
    for (const n of names) {
      const key = Object.keys(row).find((k) => k.trim().toLowerCase() === n.toLowerCase());
      if (key !== undefined && row[key] !== undefined && row[key] !== "") return row[key];
    }
    return "";
  };
  // Money Manager names its main-currency amount column after the currency ("INR"); its "Amount" is then the original amount.
  const curKey = Object.keys(row).find((k) => /^[A-Z]{3}$/.test(k.trim()) && row[k] !== "");
  const date = get("Date", "Period", "date");
  const t = date.match(/[ T](\d{1,2}):(\d{2})/);
  return {
    date,
    time: t ? `${t[1].padStart(2, "0")}:${t[2]}` : undefined,
    account: get("Account", "Accounts", "account"),
    category: get("Category", "category"),
    subcategory: get("Subcategory", "Sub Category", "subcategory") || undefined,
    note: get("Note", "Contents", "note") || undefined,
    amount: curKey ? row[curKey] : get("Amount", "amount"),
    type: get("Income/Expense", "Type", "type"),
    description: get("Description", "Memo", "description") || undefined,
    subAmount: (curKey ? get("Amount Sub", "Amount") : get("Amount Sub", "Amount_1", "AmountSub", "subAmount")) || undefined,
    subCurrency: get("Currency", "subCurrency") || undefined,
  };
}

/**
 * Money Manager records every transfer twice (a Transfer-Out and a mirrored Transfer-In row).
 * Keep only the Transfer-Out side so each transfer is imported once, in the right direction.
 */
export function dropTransferIns<T extends { type: string }>(rows: T[]): { rows: T[]; dropped: number } {
  const kept = rows.filter((r) => !/^transfer[- ]?in/i.test(r.type.trim()));
  return { rows: kept, dropped: rows.length - kept.length };
}

export const ACCOUNT_KINDS: { kind: NewImportAccount["groupKind"]; label: string }[] = [
  { kind: "bank", label: "Bank account" },
  { kind: "card", label: "Credit card" },
  { kind: "debitCard", label: "Debit card" },
  { kind: "cash", label: "Cash" },
  { kind: "prepaid", label: "Wallet / prepaid" },
  { kind: "savings", label: "Savings" },
  { kind: "investment", label: "Investments" },
  { kind: "other", label: "Other" },
];

/** Best guess at an account's group from its name, so the user mostly just confirms. */
export function guessGroupKind(name: string): NewImportAccount["groupKind"] {
  const n = name.toLowerCase();
  if (/debit/.test(n)) return "debitCard";
  if (/\bcc\b|credit|\bcard\b/.test(n)) return "card";
  if (/\bcash\b/.test(n)) return "cash";
  if (/upi|wallet|\bpay\b|paytm|pluxee|sodexo|balance|prepaid/.test(n)) return "prepaid";
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
