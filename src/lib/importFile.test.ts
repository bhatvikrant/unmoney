import { expect, test } from "vitest";
import * as XLSX from "xlsx";
import type { Id } from "../../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "../../shared/ops";
import { Day, moneyManagerSheet, type Cell } from "../../shared/export";
import { readImportFile } from "./importFile";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);

/** A cell as src/lib/xlsx.ts writes it: a date with time, or a Day with a date-only format. */
function toSheetCell(c: Cell): XLSX.CellObject | undefined {
  if (c === null) return undefined;
  const serial = (d: Date) => d.getTime() / 86_400_000 + 25569;
  if (c instanceof Day) return { t: "n", v: serial(c.date), z: "yyyy-mm-dd" };
  if (c instanceof Date) return { t: "n", v: serial(c), z: "yyyy-mm-dd hh:mm:ss" };
  return typeof c === "number" ? { t: "n", v: c } : { t: "s", v: String(c) };
}

test("a Money Manager Excel round trip keeps entries without a time untimed, and keeps real times (00:00 too)", async () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" }).snap;
  const cash = s.accounts.find((a) => a.name === "Cash")!;
  const food = s.categories.find((c) => c.type === "expense" && c.name === "Food")!._id;
  const add = (note: string, time?: string) => {
    s = run(s, "transactions.create", { type: "expense", accountId: cash._id, categoryId: food, amount: 500, note, tags: [], photoIds: [], date: "2026-03-05", ...(time ? { time } : {}) }).snap;
  };
  add("no time");
  add("morning", "09:05");
  add("midnight", "00:00");

  const sheet = moneyManagerSheet(s);
  const ws: XLSX.WorkSheet = {};
  sheet.forEach((row, r) => row.forEach((c, col) => { const cell = toSheetCell(c); if (cell) ws[XLSX.utils.encode_cell({ r, c: col })] = cell; }));
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheet.length - 1, c: sheet[0].length - 1 } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const file = new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })]);

  const { rows } = await readImportFile(file, "money-manager.xlsx");
  const byNote = Object.fromEntries(rows.map((r) => [r.note, { date: r.date.slice(0, 10), time: r.time }]));
  expect(byNote["no time"]).toEqual({ date: "2026-03-05", time: undefined });
  expect(byNote.morning).toEqual({ date: "2026-03-05", time: "09:05" });
  expect(byNote.midnight).toEqual({ date: "2026-03-05", time: "00:00" });
});
