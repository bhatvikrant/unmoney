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
    subAmount: get("Amount Sub", "AmountSub", "subAmount") || undefined,
    subCurrency: get("Currency", "subCurrency") || undefined,
  };
}
