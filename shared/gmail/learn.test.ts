import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { applyMerchantMemory, learnMerchants, MERCHANT_MAP_MAX, mergeMerchants, merchantKey } from "./learn";

const FOOD = "cat-food" as Id<"categories">, TEA = "cat-tea" as Id<"categories">, SALARY = "cat-salary" as Id<"categories">, GONE = "cat-gone" as Id<"categories">;
const categories = [
  { _id: FOOD, type: "expense" }, { _id: TEA, type: "expense", parentId: FOOD }, { _id: SALARY, type: "income" }, { _id: GONE, type: "expense", deletedAt: 1 },
] as Pick<Doc<"categories">, "_id" | "type" | "deletedAt">[];

const saved = (merchant: string, tx: Partial<Doc<"transactions">>, at = 1, type: "expense" | "income" = "expense") => ({
  draft: { merchant, proposal: { type, note: merchant, date: "2026-10-18", amount: 4000 }, resolvedAt: at } as Pick<Doc<"drafts">, "merchant" | "proposal" | "resolvedAt">,
  tx: { type, note: "", tags: [], ...tx } as Doc<"transactions">,
});

test("a merchant key keeps letters and digits only", () => {
  expect(merchantKey("PAYTMQR28*Chai  Stall!")).toBe("paytmqr28 chai stall");
  expect(merchantKey("$__")).toBe("");
});

test("saved drafts teach the note and category the user gave a merchant; later saves win", () => {
  const learned = learnMerchants([
    saved("Paytmqr2812", { note: "Chai stall", categoryId: FOOD, subcategoryId: TEA }, 1),
    saved("Swiggy", { note: "Swiggy", categoryId: FOOD }, 2),
    saved("Swiggy", { note: "Swiggy dinner", categoryId: FOOD }, 3),
  ], {}, categories);
  expect(learned).toEqual({
    paytmqr2812: { note: "Chai stall", categoryId: FOOD, subcategoryId: TEA },
    swiggy: { note: "Swiggy dinner", categoryId: FOOD },
  });
});

test("not learned: transfers, a type the draft wasn't, a deleted category, or what is already known", () => {
  expect(learnMerchants([saved("HDFC", { type: "transfer", note: "Card bill" })], {}, categories)).toEqual({});
  expect(learnMerchants([saved("Refundy", { type: "income", note: "Refund", categoryId: SALARY })], {}, categories)).toEqual({});
  expect(learnMerchants([saved("Gone", { note: "Gone", categoryId: GONE })], {}, categories)).toEqual({});
  expect(learnMerchants([saved("Swiggy", { note: "Swiggy", categoryId: FOOD })], { swiggy: { note: "Swiggy", categoryId: FOOD } }, categories)).toEqual({});
});

test("a new mail from a merchant starts with what was learned; a category of the wrong type is not used", () => {
  const map = { paytmqr2812: { note: "Chai stall", categoryId: FOOD, subcategoryId: TEA } };
  const p = { type: "expense" as const, note: "Paytmqr2812", categoryId: undefined, subcategoryId: undefined };
  expect(applyMerchantMemory(p, "Paytmqr2812", map, categories)).toEqual({ type: "expense", note: "Chai stall", categoryId: FOOD, subcategoryId: TEA });
  expect(applyMerchantMemory({ ...p, type: "income" as const }, "Paytmqr2812", map, categories)).toEqual({ type: "income", note: "Chai stall", categoryId: undefined, subcategoryId: undefined });
  expect(applyMerchantMemory(p, "Someone else", map, categories)).toBe(p);
  expect(applyMerchantMemory({ ...p, type: "transfer" as const }, "Paytmqr2812", map, categories).note).toBe("Paytmqr2812");
});

test("the map keeps the newest merchants up to its cap", () => {
  let map = {};
  for (let i = 0; i < MERCHANT_MAP_MAX + 5; i++) map = mergeMerchants(map, { [`m${i}`]: { note: `M${i}` } });
  expect(Object.keys(map)).toHaveLength(MERCHANT_MAP_MAX);
  expect(Object.keys(map)[0]).toBe("m5");
  // relearning moves a merchant to the newest end
  expect(Object.keys(mergeMerchants(map, { m5: { note: "again" } })).at(-1)).toBe("m5");
});
