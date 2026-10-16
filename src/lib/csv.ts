import Papa from "papaparse";

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
    const d = `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
    return d;
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
      return cells.includes("date") && cells.includes("amount");
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
      cols.forEach((name, i) => { if (name) obj[name] = cellToString(r[i]); });
      if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
    }
  }
  return { headers, rows };
}

/** Map arbitrary headers (Money Manager export, our export, or hand-made) to import fields. */
export function mapImportRow(row: Record<string, string>): {
  date: string; account: string; category: string; subcategory?: string; note?: string; amount: string; type: string;
  description?: string; subAmount?: string; subCurrency?: string;
} {
  const get = (...names: string[]) => {
    for (const n of names) {
      const key = Object.keys(row).find((k) => k.trim().toLowerCase() === n.toLowerCase());
      if (key !== undefined && row[key] !== undefined && row[key] !== "") return row[key];
    }
    return "";
  };
  return {
    date: get("Date", "Period", "date"),
    account: get("Account", "Accounts", "account"),
    category: get("Category", "category"),
    subcategory: get("Subcategory", "Sub Category", "subcategory") || undefined,
    note: get("Note", "Contents", "note") || undefined,
    amount: get("Amount", "amount"),
    type: get("Income/Expense", "Type", "type"),
    description: get("Description", "Memo", "description") || undefined,
    subAmount: get("Amount Sub", "Amount_1", "AmountSub", "subAmount") || undefined,
    subCurrency: get("Currency", "subCurrency") || undefined,
  };
}
