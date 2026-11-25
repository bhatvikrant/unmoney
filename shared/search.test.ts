import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { recentCategories, statsByCategory, txSearch, type SearchArgs } from "./views";
import { answerSearch } from "./searchAnswer";
import type { SearchAnswer } from "./searchAi";

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

// ---- answers worked out from the entries a search matched (searchAnswer.ts) ----

const money = (minor: number) => `₹${minor / 100}`;

/** Food in July, August and October (none in September), a Myntra order half refunded, a salary, and a transfer with a fee. */
function ledger(monthStartDay = 1) {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" });
  s = run(s, "settings.update", { patch: { monthStartDay } });
  const cat = (name: string, type = "expense") => s.categories.find((c) => c.name === name && c.type === type)!._id;
  const acc = (name: string) => s.accounts.find((a) => a.name === name)!;
  s = run(s, "categories.create", { type: "expense", name: "Groceries", parentId: cat("Food") });
  const tx = (date: string, amount: number, note: string, over: object = {}) =>
    (s = run(s, "transactions.create", { type: "expense", accountId: acc("Cash")._id, categoryId: cat("Food"), amount, note, date, tags: [], photoIds: [], ...over }));
  tx("2026-07-28", 30000, "Dmart", { subcategoryId: cat("Groceries") });
  tx("2026-08-05", 12000, "Swiggy");
  tx("2026-10-01", 500000, "Pay", { type: "income", categoryId: cat("Salary", "income"), accountId: acc("Bank")._id });
  tx("2026-10-03", 249900, "Myntra", { categoryId: cat("Apparel"), accountId: acc("Card")._id });
  // half of it sent back: a refund is an expense below zero in the same category
  tx("2026-10-09", -89900, "Myntra", { categoryId: cat("Apparel"), accountId: acc("Card")._id });
  tx("2026-10-12", 50000, "dmart", { subcategoryId: cat("Groceries") });
  // paid in dollars: it counts at its amount in the main currency
  tx("2026-10-20", 8000, "Swiggy", { subAmount: 100, subCurrency: "USD" });
  tx("2026-10-15", 100000, "To savings", { type: "transfer", categoryId: undefined, toAccountId: acc("Bank")._id, feeAmount: 500 });
  const answer = (filters: SearchArgs, a: Partial<SearchAnswer>, today = "2026-10-25") =>
    answerSearch(s, txSearch(s, filters), { of: "spent", measure: "total", by: "none", order: "highest", ...a }, filters, money, today);
  return { s: () => s, set: (next: Snapshot) => (s = next), cat, acc, answer };
}
const october = { from: "2026-10-01", to: "2026-10-31" };

test("an answer: a total, a count and an average, in a sentence written from the figures", () => {
  const { cat, answer } = ledger();
  const food = { categoryIds: [cat("Food")], ...october };
  expect(answer(food, {})).toEqual({ kind: "expense", rows: [], text: "You spent ₹580 on Food in October 2026, across 2 entries." });
  expect(answer(food, { measure: "average" })!.text).toBe("You spent ₹290 an entry on average on Food in October 2026, across 2 entries.");
  expect(answer({ q: "swiggy" }, { measure: "count" })).toEqual({ kind: "count", rows: [], text: 'You have 2 entries matching "swiggy".' });
  expect(answer({ type: "income", from: "2026-10-01" }, { of: "received" })!.text).toBe("You received ₹5000 since Oct 1, 2026, across 1 entry.");
  // nothing matched: no answer, and the list says "No matches"
  expect(answer({ q: "nothing like this" }, {})).toBeNull();
});

test("an answer: an average per month counts a month with nothing in it, but no month before the first entry or after today", () => {
  const { cat, answer } = ledger();
  const food = [cat("Food")];
  // July, August, September (empty) and October: 1,000 over four months
  expect(answer({ categoryIds: food, from: "2026-07-01", to: "2026-10-31" }, { measure: "monthlyAverage" })!.text)
    .toBe("You spent ₹250 a month on average on Food from Jul 1, 2026 to Oct 31, 2026, over 4 months.");
  // no dates asked for: from the first entry matched to today
  expect(answer({ categoryIds: food }, { measure: "monthlyAverage" })!.text).toBe("You spent ₹250 a month on average on Food, over 4 months.");
  // "this year": the months before the ledger began and the ones still to come do not thin it out
  expect(answer({ categoryIds: food, from: "2026-01-01", to: "2026-12-31" }, { measure: "monthlyAverage" })!.text).toBe("You spent ₹250 a month on average on Food in 2026, over 4 months.");
  expect(answer({ categoryIds: food }, { measure: "monthlyAverage" }, "2026-12-02")!.text).toBe("You spent ₹166.67 a month on average on Food, over 6 months.");
});

test("an answer by category is Stats' own list: subcategories under their category, a refund off its category, a transfer's fee under Fees", () => {
  const { s, set, cat, acc, answer } = ledger();
  const byCategory = () => answer(october, { by: "category" })!;
  const stats = () => statsByCategory(s(), october.from, october.to, "expense");
  expect(byCategory().rows).toEqual([
    { key: cat("Apparel"), label: "Apparel", value: 249900 - 89900 },
    { key: cat("Food"), label: "Food", value: 50000 + 8000 },
    { key: "fees", label: "Fees", value: 500 },
  ]);
  expect(byCategory().text).toBe("Spending by category in October 2026: Apparel is highest at ₹1600.");
  expect(byCategory().rows.map((r) => [r.key, r.value])).toEqual(stats().items.map((i) => [i.id, i.amount]));
  // the one figure is Stats' total too: the refund comes off, the transfer counts only its fee, the salary not at all
  expect(answer(october, {})!.text).toBe(`You spent ${money(stats().total)} in October 2026, across 5 entries.`);
  expect(stats().total).toBe(249900 - 89900 + 50000 + 8000 + 500);
  expect(answer(october, { of: "net" })).toEqual({ kind: "auto", rows: [], text: "You received ₹2815 more than you spent in October 2026, across 6 entries." });
  expect(answer({ ...october, type: "expense" }, { of: "net" })!.text).toBe("You spent ₹2180 more than you received in October 2026, across 4 entries.");

  // money moved to an account that counts as spending is spending, here as in Stats
  set(run(s(), "accounts.update", { ...acc("Bank"), id: acc("Bank")._id, transferAsExpense: true }));
  expect(byCategory().rows.map((r) => [r.key, r.value])).toEqual(stats().items.map((i) => [i.id, i.amount]));
  expect(byCategory().rows.find((r) => r.label === "Transfer to Bank")!.value).toBe(100000);
  // a card's spending counted when the card is paid: what was bought on it is not spending, in either place
  set(run(s(), "settings.update", { patch: { cardExpenseDisplay: "lumpSum" } }));
  expect(byCategory().rows.map((r) => [r.key, r.value])).toEqual(stats().items.map((i) => [i.id, i.amount]));
  expect(byCategory().rows.some((r) => r.label === "Apparel")).toBe(false);
});

test("an answer by month uses the person's own months, and an empty one can be the lowest", () => {
  // months start on the 25th: 28 July and 5 August are both in "July", and all of October's entries in "September"
  const { cat, answer } = ledger(25);
  const food = { categoryIds: [cat("Food")] };
  expect(answer(food, { by: "month", order: "time" }, "2026-10-20")).toEqual({
    kind: "expense", text: "Spending by month on Food: ₹1000 in all.",
    rows: [{ key: "2026-09", label: "September 2026", value: 58000 }, { key: "2026-08", label: "August 2026", value: 0 }, { key: "2026-07", label: "July 2026", value: 42000 }],
  });
  expect(answer(food, { by: "month", limit: 1 }, "2026-10-20")).toEqual({ kind: "expense", text: "Spending by month on Food: September 2026 is highest at ₹580.", rows: [{ key: "2026-09", label: "September 2026", value: 58000 }] });
  expect(answer(food, { by: "month", order: "lowest" }, "2026-10-20")!.text).toBe("Spending by month on Food: August 2026 is lowest at ₹0.");
  // a range that is one of those months is named as one
  expect(answer({ ...food, from: "2026-09-25", to: "2026-10-24" }, {})!.text).toBe("You spent ₹580 on Food in September 2026, across 2 entries.");
});

test("an answer: the largest entries, and the other ways to split", () => {
  const { cat, acc, answer } = ledger();
  expect(answer({ from: "2026-06-01" }, { measure: "largest", limit: 2 })).toEqual({
    kind: "expense", text: "Your largest expense since Jun 1, 2026 is ₹2499: Myntra, Oct 3, 2026.",
    rows: [{ key: expect.any(String), label: "Myntra, Oct 3, 2026", value: 249900 }, { key: expect.any(String), label: "dmart, Oct 12, 2026", value: 50000 }],
  });
  // a refund is not a small expense; a transfer's fee is one
  expect(answer({}, { measure: "largest", order: "lowest", limit: 1 })!.text).toBe("Your smallest expense is ₹5: To savings, Oct 15, 2026.");
  expect(answer({}, { measure: "largest", of: "received" })!.rows.map((r) => r.label)).toEqual(["Pay, Oct 1, 2026"]);
  expect(answer({ type: "income" }, { measure: "largest" })).toBeNull();

  // who is paid the most: by note, however it was capitalised
  expect(answer({ categoryIds: [cat("Food")] }, { by: "note" })).toEqual({
    kind: "expense", text: "Spending by note on Food: dmart is highest at ₹800.",
    rows: [{ key: "dmart", label: "dmart", value: 80000 }, { key: "swiggy", label: "Swiggy", value: 20000 }],
  });
  expect(answer(october, { by: "account", measure: "average" })!.rows).toEqual([
    { key: acc("Card")._id, label: "Card", value: (249900 - 89900) / 2 }, { key: acc("Cash")._id, label: "Cash", value: (50000 + 8000 + 500) / 3 },
  ]);
  // every weekday has a row, in the person's week (it starts on Sunday here)
  expect(answer(october, { by: "weekday", measure: "count", order: "time" })).toEqual({
    kind: "count", text: "Entries by weekday in October 2026: 6 in all.",
    rows: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({ key: String(i), label, value: [0, 1, 1, 0, 2, 1, 1][i] })),
  });
  expect(answer(october, { by: "weekday", measure: "count", limit: 1 })!.text).toBe("Entries by weekday in October 2026: Thursday is highest at 2.");
});
