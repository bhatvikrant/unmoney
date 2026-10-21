/**
 * Turns a file the user picked or shared (Money Manager's Excel export, our TSV/CSV export, or a
 * hand-made sheet) into rows for the transactions.importRows op.
 */
import type { ImportRow } from "../../shared/ops";
import Papa from "papaparse";
import { mapImportRow, unescapeFormula } from "./csv";
import { findHeaderRow, headerNames, isMoneyManagerHeader, type Grid } from "./bankImport";

export type ParsedImport = {
  rows: ImportRow[];
  headers: string[];
  /** Money Manager lists each transfer twice; the Transfer-In half is dropped. */
  skippedTransferIn: number;
  /** The main currency the file's amounts are in, when the sheet names it (Money Manager does). */
  currency?: string;
  /**
   * Not Money Manager's layout (a bank statement): the cells as they are, and where the header row
   * was found, for the "Match the columns" step. `rows` is empty until that step has run.
   */
  bank?: { grid: Grid; headerRow: number };
  /** Rows the column mapping left out because they had no amount (src/lib/bankImport.ts). */
  noAmount?: number;
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

/** First worksheet's cells as text. Date cells become "YYYY-MM-DD HH:MM", or "YYYY-MM-DD" when formatted without a time. */
async function readSheet(file: Blob): Promise<Grid> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) return [];
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
        const day = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
        // a date-only format (an entry saved without a time) has no hours; quoted text is not a token
        return /h/i.test(cell.z.replace(/"[^"]*"/g, "")) ? `${day} ${pad(p.H)}:${pad(p.M)}` : day;
      }
      return String(cell.v);
    }
    return String(cell.w ?? cell.v).trim();
  };
  const grid: Grid = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) row.push(text(r, c));
    grid.push(row);
  }
  return grid;
}

/** A CSV/TSV's cells, the delimiter guessed. */
function readText(text: string): Grid {
  return (Papa.parse<string[]>(text.trim(), { header: false, skipEmptyLines: true, delimiter: "", transform: unescapeFormula }).data ?? []).map((r) => r.map((c) => String(c ?? "")));
}

/**
 * `name` is the filename when the blob has none of its own (a shared or downloaded file). A picked
 * File is never mutated: `File.name` is a getter-only property and assigning it throws in Safari.
 */
export async function readImportFile(file: Blob, name = (file as File).name ?? ""): Promise<ParsedImport> {
  const isSheet = SHEET.test(name) || SHEET_TYPES.has(file.type) || (await looksLikeSheet(file));
  const grid = isSheet ? await readSheet(file) : readText(await file.text());
  if (!grid.some((r) => r.some((c) => c.trim()))) throw new Error("That file has no columns. Export from Money Manager with Settings › Backup › Export to Excel.");
  // statements put account details above the header row
  const headerRow = findHeaderRow(grid);
  const headers = headerNames(grid[headerRow]);
  if (!isMoneyManagerHeader(headers)) return { rows: [], headers, skippedTransferIn: 0, bank: { grid, headerRow } };
  const rows = grid.slice(headerRow + 1).filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  const currency = headers.find((h) => /^[A-Z]{3}$/.test(h.trim()))?.trim();
  const mapped = rows.map((r) => mapImportRow(r, headers));
  const kept = mapped.filter((r) => !/^transfer[- ]?in/i.test(r.type.trim()));
  return { rows: kept, headers, skippedTransferIn: mapped.length - kept.length, currency };
}

export const IMPORT_ACCEPT = ".xlsx,.xls,.csv,.tsv,.txt,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
