import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, RECENT_IMPORTS, type ImportRow, type Snapshot } from "./ops";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: 1000 + n }, ctx);
}
const rows = (k: number, note = "Tea"): ImportRow[] =>
  Array.from({ length: k }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, account: "Cash", category: "Food", note, amount: String(10 + i), type: "Expenses" }));

test("an import's entries carry its id, and its chunks add up to one line in the recent imports", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const batch = { id: "imp_1", name: "money-manager.xlsx" };
  s = run(s, "transactions.importRows", { rows: rows(3), batch }).snap;
  s = run(s, "transactions.importRows", { rows: rows(2, "Coffee"), batch, rowOffset: 3 }).snap;
  expect(s.transactions.map((t) => t.importId)).toEqual(Array(5).fill("imp_1"));
  expect(s.settings[0].recentImports).toEqual([{ id: "imp_1", name: "money-manager.xlsx", at: expect.any(Number), count: 5 }]);
  // an entry typed by hand has no import id
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-21", accountId: s.accounts[0]._id, categoryId: s.transactions[0].categoryId, amount: 5, note: "", tags: [], photoIds: [] }).snap;
  expect(s.transactions.filter((t) => !t.importId)).toHaveLength(1);
});

test("an import with nothing new is not listed, and only the last ten are kept, newest first", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  s = run(s, "transactions.importRows", { rows: rows(1), batch: { id: "imp_a", name: "a.csv" } }).snap;
  // the same row again is a duplicate: nothing inserted, nothing listed
  s = run(s, "transactions.importRows", { rows: rows(1), skipDuplicates: true, batch: { id: "imp_b", name: "b.csv" } }).snap;
  expect(s.settings[0].recentImports!.map((x) => x.id)).toEqual(["imp_a"]);
  for (let i = 0; i < 12; i++) s = run(s, "transactions.importRows", { rows: rows(1, `n${i}`), batch: { id: `imp_${i}`, name: `${i}.csv` } }).snap;
  const list = s.settings[0].recentImports!;
  expect(list).toHaveLength(RECENT_IMPORTS);
  expect(list[0].id).toBe("imp_11");
  // older entries keep their id even once their import drops off the list
  expect(s.transactions.some((t) => t.importId === "imp_a")).toBe(true);
});

test("undoing an import removes exactly its entries", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  s = run(s, "transactions.importRows", { rows: rows(4), batch: { id: "imp_x", name: "x.csv" } }).snap;
  s = run(s, "transactions.importRows", { rows: rows(2, "Coffee"), batch: { id: "imp_y", name: "y.csv" } }).snap;
  const ids = s.transactions.filter((t) => t.importId === "imp_x").map((t) => t._id);
  s = run(s, "transactions.bulkRemove", { ids, ifPresent: true }).snap;
  expect(s.transactions.map((t) => t.importId)).toEqual(["imp_y", "imp_y"]);
});
