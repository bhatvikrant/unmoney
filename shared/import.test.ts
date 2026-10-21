import { describe, expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, detectImportFormat, emptySnapshot, parseImportDate, type ImportFormat, type ImportRow, type Snapshot } from "./ops";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}
const onboarded = () => run(emptySnapshot(), "settings.completeOnboarding", { currency: "EUR" }).snap;
const row = (date: string, amount: string): ImportRow => ({ date, amount, account: "Cash", category: "Food", type: "Expense", note: "x" });
function importRows(rows: ImportRow[], format?: ImportFormat) {
  const { snap, result } = run(onboarded(), "transactions.importRows", { rows, format, skipInvalid: true });
  return { tx: snap.transactions.map((t) => [t.date, t.amount]), result: result as { errors: { row: number; reason: string }[] } };
}

describe("parseImportDate", () => {
  test.each([
    ["2026-03-25", "mdy", "2026-03-25"],
    ["2026/3/5", "mdy", "2026-03-05"],
    ["25.03.2026", "mdy", "2026-03-25"],
    ["03/25/2026", "mdy", "2026-03-25"],
    ["25/03/2026", "dmy", "2026-03-25"],
    ["05/03/2026", "dmy", "2026-03-05"],
    ["05/03/2026", "mdy", "2026-05-03"],
    ["25-03-2026 14:05", "dmy", "2026-03-25"],
  ] as const)("%s as %s is %s", (raw, order, want) => {
    expect(parseImportDate(raw, order)).toBe(want);
  });

  test.each([["25/03/2026", "mdy"], ["2026-02-30", "mdy"], ["2026-13-01", "mdy"], ["31.04.2026", "dmy"], ["soon", "dmy"]] as const)("%s as %s is not a date", (raw, order) => {
    expect(parseImportDate(raw, order)).toBeNull();
  });
});

describe("detectImportFormat", () => {
  const us: ImportFormat = { dateOrder: "mdy", decimal: "." };
  const de: ImportFormat = { dateOrder: "dmy", decimal: "," };
  test("a day above 12 anywhere in the file settles the order", () => {
    expect(detectImportFormat([row("05/03/2026", "1"), row("25/03/2026", "1")], us).dateOrder).toBe("dmy");
    expect(detectImportFormat([row("05/03/2026", "1"), row("03/25/2026", "1")], de).dateOrder).toBe("mdy");
  });
  test("an undecidable file follows the locale", () => {
    expect(detectImportFormat([row("05/03/2026", "1")], de).dateOrder).toBe("dmy");
    expect(detectImportFormat([row("05/03/2026", "1")], us).dateOrder).toBe("mdy");
  });
  test("decimal commas are spotted from the amounts", () => {
    expect(detectImportFormat([row("2026-01-01", "12,50"), row("2026-01-01", "1.234,00")], us).decimal).toBe(",");
    expect(detectImportFormat([row("2026-01-01", "12.50"), row("2026-01-01", "1,234")], de).decimal).toBe(".");
  });
});

describe("importing a European CSV", () => {
  test("DD/MM dates and decimal commas land on the right day with the right amount", () => {
    const rows = [row("25/03/2026", "12,50"), row("05/03/2026", "1.234,56"), row("01/04/2026", "3")];
    const { tx, result } = importRows(rows, detectImportFormat(rows, { dateOrder: "mdy", decimal: "." }));
    expect(result.errors).toEqual([]);
    expect(tx).toEqual([["2026-03-25", 1250], ["2026-03-05", 123456], ["2026-04-01", 300]]);
  });

  test("an impossible date is reported, not stored", () => {
    const { tx, result } = importRows([row("25/03/2026", "1")], { dateOrder: "mdy", decimal: "." });
    expect(tx).toEqual([]);
    expect(result.errors[0].reason).toMatch(/Bad date/);
  });

  test("files without a format keep importing as before", () => {
    expect(importRows([row("2026-03-25", "1,234.50"), row("03/25/2026", "-7")]).tx).toEqual([["2026-03-25", 123450], ["2026-03-25", 700]]);
  });
});

test("a second-currency amount keeps the rate the file's two amounts imply, not today's", () => {
  const s = run(onboarded(), "currencies.add", { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, rate: 1.2, symbolPosition: "before" }).snap;
  const rows = [{ ...row("2026-03-25", "84.50"), subAmount: "100", subCurrency: "USD" }];
  const t = run(s, "transactions.importRows", { rows, skipInvalid: true }).snap.transactions[0];
  expect([t.amount, t.subAmount, t.subCurrency]).toEqual([8450, 10000, "USD"]);
  // the editor works the main amount out as sub ÷ rate: it must come back to 84.50
  expect(t.exchangeRate).toBeCloseTo(100 / 84.5);
  expect(Math.round((t.subAmount! / 100 / t.exchangeRate!) * 100)).toBe(8450);
});
