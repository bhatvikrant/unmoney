import { expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { buildReceiptInput, validateReceipt } from "./receiptAi";

const cat = (id: string, name: string, over: object = {}) => ({ _id: id, name, type: "expense", order: 0, ...over }) as unknown as Doc<"categories">;
let n = 0;
const tx = (note: string, date: string, over: object = {}) => ({ _id: `t${++n}`, _creationTime: n, type: "expense", note, date, ...over }) as unknown as Doc<"transactions">;
const settings = (over: object = {}) => [{ mainCurrency: "INR", subcategoryEnabled: true, ...over }] as unknown as Doc<"settings">[];

const categories = [
  cat("food", "Food", { order: 1 }), cat("groceries", "Groceries", { order: 2, parentId: "food" }), cat("fuel", "Fuel", { order: 3 }),
  cat("old", "Old", { order: 4, archivedAt: 1 }), cat("orphan", "Orphan", { order: 5, parentId: "old" }), cat("salary", "Salary", { type: "income", order: 6 }),
];
const transactions = [
  tx("Swiggy", "2026-11-20", { categoryId: "food" }),
  tx("swiggy ", "2026-11-22", { categoryId: "food", description: "Dinner  for two" }),
  tx("BigBasket", "2026-11-21", { categoryId: "food", subcategoryId: "groceries" }),
  tx("Shell", "2026-11-01", { categoryId: "old" }),
  tx("", "2026-11-23", { categoryId: "fuel" }),
  tx("Pay", "2026-11-23", { type: "income", categoryId: "salary" }),
];

test("the model sees the categories an entry can go under and the person's notes, most used first", () => {
  const { input, ids } = buildReceiptInput({ settings: settings(), categories, transactions }, "expense", "2026-11-25");
  // archived, its subcategory and the other type are left out
  expect(input.categories).toEqual([{ id: "c1", name: "Food", parent: undefined }, { id: "c2", name: "Groceries", parent: "c1" }, { id: "c3", name: "Fuel", parent: undefined }]);
  expect(ids).toEqual({ c1: "food", c2: "groceries", c3: "fuel" });
  // one note however it was typed, as last written, with the description last used with it; a subcategory wins over its parent
  expect(input.notes).toEqual([
    { note: "swiggy", category: "c1", description: "Dinner for two", used: 2 },
    { note: "BigBasket", category: "c2", description: undefined, used: 1 },
    { note: "Shell", category: undefined, description: undefined, used: 1 },
  ]);
  expect(input).toMatchObject({ type: "expense", today: "2026-11-25", currency: "INR" });
  // subcategories turned off: only main categories are offered
  expect(buildReceiptInput({ settings: settings({ subcategoryEnabled: false }), categories, transactions }, "expense", "2026-11-25").input.categories.map((c) => c.name)).toEqual(["Food", "Fuel"]);
});

test("an answer fills in only what checks out", () => {
  const ids = { c1: "food", c2: "groceries" } as unknown as Record<string, Id<"categories">>;
  const check = (raw: object) => validateReceipt({ isReceipt: true, note: null, description: null, category: null, date: null, ...raw }, ids, categories, "2026-11-25");
  expect(check({ note: "  Big   Basket ", description: "Vegetables, milk", category: "c2", date: "2026-11-24" }))
    .toEqual({ note: "Big Basket", description: "Vegetables, milk", categoryId: "food", subcategoryId: "groceries", date: "2026-11-24" });
  expect(check({ category: "c1" })).toEqual({ categoryId: "food" });
  // a category that is not the person's, a description that only repeats the note, and dates that cannot be right
  expect(check({ note: "Shell", description: "Shell", category: "c9" })).toEqual({ note: "Shell" });
  expect(check({ category: "constructor" })).toEqual({});
  for (const date of ["2026-11-27", "2025-11-01", "2026-02-31", "24/11/2026"]) expect(check({ date })).toEqual({});
  // tomorrow is today somewhere else
  expect(check({ date: "2026-11-26" })).toEqual({ date: "2026-11-26" });
  expect(check({ note: "x".repeat(200) }).note).toHaveLength(60);
  // not a receipt, or not an answer at all
  expect(validateReceipt({ isReceipt: false, note: "Cat photo" }, ids, categories, "2026-11-25")).toEqual({});
  expect(validateReceipt(null, ids, categories, "2026-11-25")).toEqual({});
});
