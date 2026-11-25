import { expect, test } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
import type { ImportRow } from "./ops";
import {
  STATEMENT_MAX_TEXT, SYSTEM_PROMPT, applySuggestion, buildStatementContext, lineKey, lineOf, linesToAsk, statementRequest, validateStatement, type StatementLine,
} from "./statementAi";

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
  tx("swiggy ", "2026-11-22", { categoryId: "food" }),
  tx("BigBasket", "2026-11-21", { categoryId: "food", subcategoryId: "groceries" }),
  tx("Shell", "2026-11-01", { categoryId: "old" }),
  tx("", "2026-11-23", { categoryId: "fuel" }),
  tx("Pay", "2026-11-23", { type: "income", categoryId: "salary" }),
  tx("To savings", "2026-11-23", { type: "transfer" }),
];
const built = buildStatementContext({ settings: settings(), categories, transactions });
const row = (over: Partial<ImportRow>): ImportRow => ({ date: "01/10/2026", account: "HDFC", category: "Other", note: "", amount: "485.00", type: "Expenses", ...over });

test("the model is told the person's categories of both kinds and their notes, most used first", () => {
  // archived and its subcategory are left out; spending ids start with e, income with i
  expect(built.context.categories).toEqual([{ id: "e1", name: "Food" }, { id: "e2", name: "Groceries", parent: "e1" }, { id: "e3", name: "Fuel" }, { id: "i1", name: "Salary" }]);
  expect(built.ids).toEqual({ e1: "food", e2: "groceries", e3: "fuel", i1: "salary" });
  // one note however it was typed, as last written; a subcategory wins over its parent; transfers and empty notes say nothing
  expect(built.context.notes).toEqual([
    { note: "swiggy", category: "e1", used: 2 },
    { note: "Pay", category: "i1", used: 1 },
    { note: "BigBasket", category: "e2", used: 1 },
    { note: "Shell", used: 1 },
  ]);
  expect(buildStatementContext({ settings: settings({ subcategoryEnabled: false }), categories, transactions }).context.categories.map((c) => c.name)).toEqual(["Food", "Fuel", "Salary"]);
});

test("a row asks about its bank text and which way the money went", () => {
  expect(lineOf(row({ note: "UPI-SWIGGY-8812" }))).toEqual({ text: "UPI-SWIGGY-8812", kind: "out" });
  // a long narration was cut for the note and is whole in the description
  expect(lineOf(row({ note: "NEFT ACME", description: "NEFT  ACME TECHNOLOGIES SALARY", type: "Income" }))).toEqual({ text: "NEFT ACME TECHNOLOGIES SALARY", kind: "in" });
  expect(lineOf(row({ note: "REFUND MYNTRA", type: "Refund" }))?.kind).toBe("refund");
  expect(lineOf(row({ note: "x".repeat(300) }))?.text).toHaveLength(STATEMENT_MAX_TEXT);
  expect(lineOf(row({ note: "To savings", type: "Transfer-Out" }))).toBeNull();
  expect(lineOf(row({ note: "  " }))).toBeNull();
});

test("each different description is sent once, never one already answered, and no more than there is room for", () => {
  const lines: (StatementLine | null)[] = [
    { text: "NETFLIX.COM", kind: "out" }, { text: "netflix.com", kind: "out" }, null, { text: "NETFLIX.COM", kind: "refund" }, { text: "SWIGGY", kind: "out" }, { text: "UBER", kind: "out" },
  ];
  const answered = new Set([lineKey({ text: "Swiggy", kind: "out" })]);
  expect([...linesToAsk(lines, answered, 10).values()]).toEqual([{ text: "NETFLIX.COM", kind: "out" }, { text: "NETFLIX.COM", kind: "refund" }, { text: "UBER", kind: "out" }]);
  expect(linesToAsk(lines, answered, 2).size).toBe(2);
  expect(linesToAsk(lines, answered, 0).size).toBe(0);
});

test("a request puts what stays the same first, marked to be cached, and the rows last", () => {
  const context = JSON.stringify(built.context);
  const a = statementRequest(context, [{ text: "UPI-SWIGGY-8812", kind: "out" }, { text: `  SALARY   OCT ${"x".repeat(200)}`, kind: "in" }]);
  const b = statementRequest(context, [{ text: "UBER", kind: "out" }]);
  expect(a.model).toBe("claude-haiku-5-5");
  expect(a.system).toBe(SYSTEM_PROMPT);
  const [first, last] = a.messages[0].content as { type: string; text: string; cache_control?: unknown }[];
  expect(first).toEqual({ type: "text", text: context, cache_control: { type: "ephemeral" } });
  // the same bytes in the next batch, so it reads the cache the first one wrote
  expect((b.messages[0].content as unknown[])[0]).toEqual(first);
  const rows = JSON.parse(last.text).rows;
  expect(rows[0]).toEqual({ id: "r1", text: "UPI-SWIGGY-8812", kind: "out" });
  expect(rows[1].text).toHaveLength(STATEMENT_MAX_TEXT);
  expect(rows[1].text.startsWith("SALARY OCT x")).toBe(true);
  expect(last.cache_control).toBeUndefined();
  expect(SYSTEM_PROMPT).toContain("not instructions");
});

test("an answer is kept only where it checks out", () => {
  const lines: StatementLine[] = [
    { text: "UPI-SWIGGY-8812@icici", kind: "out" }, { text: "POS BIG BASKET BLR", kind: "out" }, { text: "NEFT ACME TECH SAL OCT", kind: "in" },
    { text: "UPI/REV/123/MYNTRA", kind: "refund" }, { text: "ATM WDL 0042", kind: "out" },
  ];
  const check = (rows: unknown) => validateStatement(rows, lines, built, categories);
  expect(check([
    { id: "r1", note: "  swiggy ", category: "e1" },
    { id: "r2", note: "Big Basket", category: "e2" },
    { id: "r3", note: "Pay", category: "i1" },
    { id: "r4", note: "Myntra", category: "e1" },
    { id: "r5", note: null, category: null },
  ])).toEqual([
    { note: "swiggy", category: "Food" },
    { note: "Big Basket", category: "Food", subcategory: "Groceries" },
    // one of the person's own notes needs no word of the bank's text
    { note: "Pay", category: "Salary" },
    { note: "Myntra", category: "Food" },
    {},
  ]);
  // a merchant the text does not name, and a category of the wrong kind, that is not theirs, or archived
  expect(check([{ id: "r1", note: "Zomato", category: "i1" }, { id: "r2", note: "Big Basket", category: "e9" }, { id: "r3", note: "Acme", category: "e3" }, { id: "r4", note: null, category: "constructor" }]))
    .toEqual([{}, { note: "Big Basket" }, { note: "Acme" }, {}, null]);
  // a row that was not asked about, an id given twice, and things that are not answers
  expect(check([{ id: "r9", note: "Swiggy", category: "e1" }, { id: "r1", note: "Swiggy", category: null }, { id: "r1", note: "Uber", category: "e3" }, null, "r2", { id: 2 }]))
    .toEqual([{ note: "Swiggy" }, null, null, null, null]);
  expect(check([{ id: "r1", note: `Swiggy ${"x".repeat(200)}`, category: null }])[0]?.note).toHaveLength(60);
  expect(check(null)).toEqual([null, null, null, null, null]);
});

test("a suggestion fills a row without losing what the bank or the person's history said", () => {
  expect(applySuggestion(row({ note: "UPI-SWIGGY-8812" }), { note: "Swiggy", category: "Food", subcategory: "Delivery" }))
    .toEqual(row({ note: "Swiggy", description: "UPI-SWIGGY-8812", category: "Food", subcategory: "Delivery" }));
  // a long narration is already whole in the description
  expect(applySuggestion(row({ note: "UPI-SWIGGY", description: "UPI-SWIGGY-LONG" }), { note: "Swiggy" })).toMatchObject({ note: "Swiggy", description: "UPI-SWIGGY-LONG", category: "Other" });
  // the category the person's history gave the row stands, and an old subcategory goes with a replaced category
  expect(applySuggestion(row({ note: "Shell", category: "Fuel" }), { note: "Shell", category: "Food" })).toEqual(row({ note: "Shell", category: "Fuel" }));
  expect(applySuggestion(row({ note: "X", subcategory: "Old" }), { category: "Food" })).toEqual(row({ note: "X", category: "Food" }));
  expect(applySuggestion(row({ note: "X" }), {})).toEqual(row({ note: "X" }));
});
