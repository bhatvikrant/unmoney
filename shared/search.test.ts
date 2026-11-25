import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { recentCategories, txSearch } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;

function seed() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const cat = (name: string) => s.categories.find((c) => c.name === name)!._id;
  const [cash] = s.accounts;
  const tx = { accountId: cash._id, tags: [], photoIds: [], type: "expense" };
  s = run(s, "transactions.create", { ...tx, categoryId: cat("Food"), amount: 49900, note: "Groceries", date: "2026-01-03" });
  s = run(s, "transactions.create", { ...tx, categoryId: cat("Transport"), amount: 129950, note: "Train", date: "2026-01-04" });
  s = run(s, "transactions.create", { ...tx, categoryId: cat("Food"), amount: 1200, note: "Coffee", date: "2026-01-05" });
  return { s, cat };
}

test("search finds an entry by its amount", () => {
  const { s } = seed();
  expect(txSearch(s, { q: "499" }).map((t) => t.note)).toEqual(["Groceries"]);
  expect(txSearch(s, { q: "1,299.50" }).map((t) => t.note)).toEqual(["Train"]);
  expect(txSearch(s, { q: "12" }).map((t) => t.note)).toEqual(["Coffee"]);
  expect(txSearch(s, { q: "coffee" }).map((t) => t.note)).toEqual(["Coffee"]);
});

test("search keeps to an amount range, ends included, on its own or with the other filters", () => {
  const { s, cat } = seed();
  expect(txSearch(s, { min: 499 }).map((t) => t.note)).toEqual(["Train", "Groceries"]);
  expect(txSearch(s, { max: 499 }).map((t) => t.note)).toEqual(["Coffee", "Groceries"]);
  expect(txSearch(s, { min: 12.01, max: 498.99 })).toEqual([]);
  expect(txSearch(s, { min: 100, categoryIds: [cat("Food")] }).map((t) => t.note)).toEqual(["Groceries"]);
  expect(txSearch(s, { q: "o", max: 100 }).map((t) => t.note)).toEqual(["Coffee"]);
  // no range asked for: nothing is left out, a zero-amount entry included
  expect(txSearch(s, { min: 0 })).toHaveLength(3);
});

test("recent categories: newest first, each once, archived ones left out", () => {
  const { s, cat } = seed();
  expect(recentCategories(s, "expense").map((c) => c.categoryId)).toEqual([cat("Food"), cat("Transport")]);
  const archived = { ...s, categories: s.categories.map((c) => (c._id === cat("Food") ? { ...c, archivedAt: 1 } : c)) };
  expect(recentCategories(archived, "expense").map((c) => c.categoryId)).toEqual([cat("Transport")]);
  expect(recentCategories(s, "income")).toEqual([]);
});
