import type { Cell, SheetRows } from "../../shared/export";

const DATE_FORMAT = "yyyy-mm-dd hh:mm:ss";

async function save(filename: string, sheets: { sheet: string; data: SheetRows }[]) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const toCell = (c: Cell, header: boolean) => {
    if (c === null) return null;
    if (c instanceof Date) return { value: c, format: DATE_FORMAT };
    return header ? { value: c, fontWeight: "bold" as const } : c;
  };
  await writeExcelFile(sheets.map(({ sheet, data }) => ({
    sheet,
    data: data.map((row, i) => row.map((c) => toCell(c, i === 0))),
  }))).toFile(filename);
}

export const downloadXlsx = (filename: string, data: SheetRows, sheet = "Sheet1") => save(filename, [{ sheet, data }]);
export const downloadWorkbook = save;
