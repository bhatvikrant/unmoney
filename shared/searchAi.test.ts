import { expect, test } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
import { OUTPUT_SCHEMA, SEARCH_EFFORT, SEARCH_MODEL, SYSTEM_PROMPT, buildSearchContext, searchAsk, searchRequest, validateSearch, type SearchIds } from "./searchAi";

const cat = (id: string, name: string, over: object = {}) => ({ _id: id, name, type: "expense", order: 0, ...over }) as unknown as Doc<"categories">;
const acc = (id: string, name: string, over: object = {}) => ({ _id: id, name, order: 0, ...over }) as unknown as Doc<"accounts">;
const tx = (tags: string[], over: object = {}) => ({ note: "Secret dinner", description: "with Asha", amount: 123456, tags, ...over }) as unknown as Doc<"transactions">;
const settings = (over: object = {}) => [{ mainCurrency: "INR", monthStartDay: 1, weekStartDay: 1, ...over }] as unknown as Doc<"settings">[];

const snap = {
  settings: settings(),
  categories: [
    cat("salary", "Salary", { type: "income", order: 1 }), cat("food", "Food", { order: 1 }), cat("out", "Eating  out ", { order: 2, parentId: "food" }),
    cat("travel", "Travel", { order: 3, archivedAt: 1 }), cat("gone", "Gone", { order: 4, deletedAt: 1 }),
  ],
  accounts: [acc("hdfc", "HDFC Card", { order: 2 }), acc("cash", "Cash", { order: 1 }), acc("adj", "Adjustments", { system: "adjustments" }), acc("old", "Old", { deletedAt: 1 })],
  transactions: [tx(["trip", "work"]), tx(["work"]), tx(["goa"]), tx([])],
};

test("Claude is told the names the search filters offer, with short ids, and nothing from the entries but their tags", () => {
  const { context, ids } = buildSearchContext(snap);
  expect(context).toEqual({
    currency: "INR", monthStartDay: 1, weekStartDay: 1,
    // archived ones can still be searched; deleted ones cannot
    expenseCategories: [{ id: "c1", name: "Food", parent: undefined }, { id: "c2", name: "Eating out", parent: "c1" }, { id: "c3", name: "Travel", parent: undefined }],
    incomeCategories: [{ id: "c4", name: "Salary", parent: undefined }],
    // the app's own adjustments account is not a payment method
    paymentMethods: [{ id: "p1", name: "Cash" }, { id: "p2", name: "HDFC Card" }],
    tags: ["goa", "trip", "work"],
  });
  expect(ids).toEqual({ categories: { c1: "food", c2: "out", c3: "travel", c4: "salary" }, accounts: { p1: "cash", p2: "hdfc" } });
  const sent = JSON.stringify(context);
  for (const secret of ["Secret", "Asha", "123456"]) expect(sent).not.toContain(secret);
});

test("the names are the same bytes from one question to the next, so they can be cached", () => {
  const first = JSON.stringify(buildSearchContext(snap).context);
  // a tag used more often than before, and the entries in another order: nothing the model is told changes
  const later = { ...snap, transactions: [tx(["goa"]), tx(["goa"]), tx(["goa"]), ...snap.transactions].reverse() };
  expect(JSON.stringify(buildSearchContext(later).context)).toBe(first);
});

test("only the most used tags are sent", () => {
  const transactions = [...Array.from({ length: 80 }, (_, i) => tx([`rare${i}`])), tx(["often"]), tx(["often"])];
  const { tags } = buildSearchContext({ ...snap, transactions }).context;
  expect(tags).toHaveLength(60);
  expect(tags).toContain("often");
});

test("the request: the prompt and the names first and marked for the cache, the question and today last", () => {
  const { context } = buildSearchContext(snap);
  const req = searchRequest(context, "food over 500 last month", "2026-11-25");
  expect(req).toMatchObject({ model: SEARCH_MODEL, system: SYSTEM_PROMPT, output_config: { effort: SEARCH_EFFORT, format: { type: "json_schema", schema: OUTPUT_SCHEMA } } });
  const [names, ask] = req.messages[0].content as { text: string; cache_control?: object }[];
  expect(names).toEqual({ type: "text", text: JSON.stringify(context), cache_control: { type: "ephemeral" } });
  expect(names.text).not.toContain("2026");
  expect(ask.cache_control).toBeUndefined();
  expect(JSON.parse(ask.text)).toEqual({
    today: "2026-11-25", weekday: "Wednesday",
    thisMonth: { from: "2026-11-01", to: "2026-11-30" }, lastMonth: { from: "2026-10-01", to: "2026-10-31" },
    thisWeek: { from: "2026-11-23", to: "2026-11-29" }, lastWeek: { from: "2026-11-16", to: "2026-11-22" },
    question: "food over 500 last month",
  });
});

test("this month and last month are the person's own months", () => {
  // months that start on the 25th: 24 November is still in the month that began on 25 October
  expect(searchAsk({ monthStartDay: 25, weekStartDay: 0 }, "q", "2026-11-24")).toMatchObject({
    thisMonth: { from: "2026-10-25", to: "2026-11-24" }, lastMonth: { from: "2026-09-25", to: "2026-10-24" },
    thisWeek: { from: "2026-11-22", to: "2026-11-28" }, weekday: "Tuesday",
  });
});

test("an answer sets only the filters that check out", () => {
  const ids = { categories: { c1: "food", c2: "out" }, accounts: { p1: "cash", p2: "hdfc" } } as unknown as SearchIds;
  const none = { text: null, from: null, to: null, type: null, categories: [], accounts: [], tag: null, min: null, max: null };
  const check = (raw: object) => validateSearch({ ...none, ...raw }, ids, ["Trip", "work"]);
  expect(check({ text: "  swiggy   order ", from: "2026-10-01", to: "2026-10-31", type: "expense", categories: ["c1", "c2", "c1"], accounts: ["p2"], tag: "#trip", min: 500, max: 2000 }))
    .toEqual({ text: "swiggy order", from: "2026-10-01", to: "2026-10-31", type: "expense", categoryIds: ["food", "out"], accountIds: ["hdfc"], tag: "Trip", min: 500, max: 2000 });
  // ids that are not the person's, including names every object has
  expect(check({ categories: ["c9", "constructor", 3], accounts: ["c1", "__proto__"] })).toEqual({});
  expect(check({ categories: ["c9", "c2"] })).toEqual({ categoryIds: ["out"] });
  // a tag they do not have, a type the app does not know
  expect(check({ tag: "holiday", type: "refund" })).toEqual({});
  // dates that are not dates, and a range the wrong way round
  for (const from of ["2026-02-31", "31/10/2026", "last month", 20261001]) expect(check({ from })).toEqual({});
  expect(check({ from: "2026-11-01", to: "2026-10-01" })).toEqual({});
  expect(check({ from: "2026-02-31", to: "2026-10-01" })).toEqual({ to: "2026-10-01" });
  expect(check({ from: "2026-10-01" })).toEqual({ from: "2026-10-01" });
  // amounts that are not amounts, and a range the wrong way round
  for (const min of [-5, Number.NaN, Number.POSITIVE_INFINITY, "500", 0]) expect(check({ min })).toEqual({});
  expect(check({ min: 2000, max: 500 })).toEqual({});
  expect(check({ max: 0 })).toEqual({ max: 0 });
  expect(check({ min: 499.5 })).toEqual({ min: 499.5 });
  expect(check({ text: "x".repeat(300) }).text).toHaveLength(80);
  // nothing asked for, or not an answer at all: the page falls back to the typed text
  expect(check({ text: "   " })).toEqual({});
  expect(validateSearch(null, ids, [])).toEqual({});
  expect(validateSearch("food", ids, [])).toEqual({});
});
