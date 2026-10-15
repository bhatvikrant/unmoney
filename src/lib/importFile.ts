/**
 * Turns a file the user picked or shared (Money Manager's Excel export, our TSV/CSV export, or a
 * hand-made sheet) into rows for the transactions.importRows op.
 */
import type { ImportRow } from "../../shared/ops";
import { mapImportRow, parseTable } from "./csv";

export type ParsedImport = {
  rows: ImportRow[];
  headers: string[];
  /** Money Manager lists each transfer twice; the Transfer-In half is dropped. */
  skippedTransferIn: number;
  /** The main currency the file's amounts are in, when the sheet names it (Money Manager does). */
  currency?: string;
};

const SHEET = /\.(xlsx|xlsm|xls)$/i;
const SHEET_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
]);

/** Excel files start with a zip header (xlsx) or the OLE2 header (xls). */
async function looksLikeSheet(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  return zip || ole;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** First worksheet as header-keyed string rows. Date cells become "YYYY-MM-DD HH:MM". */
async function readSheet(file: Blob): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) return { headers: [], rows: [] };
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const text = (r: number, c: number): string => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })] as { t: string; v: unknown; z?: string; w?: string } | undefined;
    if (!cell || cell.v === undefined || cell.v === null) return "";
    if (cell.t === "d" && cell.v instanceof Date) {
      // SheetJS keeps the sheet's wall-clock time in the UTC fields; round to the minute
      const d = new Date(Math.round(cell.v.getTime() / 60000) * 60000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    if (cell.t === "n" && typeof cell.v === "number") {
      if (cell.z && XLSX.SSF.is_date(cell.z)) {
        // round to the minute first: serials like 46310.37847… sit a hair under 09:05
        const p = XLSX.SSF.parse_date_code(Math.round(cell.v * 1440) / 1440);
        return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.H)}:${pad(p.M)}`;
      }
      return String(cell.v);
    }
    return String(cell.w ?? cell.v).trim();
  };
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = text(range.s.r, c) || `Column ${c + 1}`;
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    headers.push(n ? `${h}_${n}` : h);
  }
  const rows: Record<string, string>[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      const v = text(r, range.s.c + i);
      row[h] = v;
      if (v) any = true;
    });
    if (any) rows.push(row);
  }
  return { headers, rows };
}

export async function readImportFile(file: Blob & { name?: string }): Promise<ParsedImport> {
  const isSheet = SHEET.test(file.name ?? "") || SHEET_TYPES.has(file.type) || (await looksLikeSheet(file));
  const { headers, rows } = isSheet ? await readSheet(file) : parseTable(await file.text());
  if (!headers.length) throw new Error("That file has no columns. Export from Money Manager with Settings › Backup › Export to Excel.");
  const currency = headers.find((h) => /^[A-Z]{3}$/.test(h.trim()))?.trim();
  const mapped = rows.map((r) => mapImportRow(r, headers));
  const kept = mapped.filter((r) => !/^transfer[- ]?in/i.test(r.type.trim()));
  return { rows: kept, headers, skippedTransferIn: mapped.length - kept.length, currency };
}

export const IMPORT_ACCEPT = ".xlsx,.xls,.csv,.tsv,.txt,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
