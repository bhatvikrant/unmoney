import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { statsByCategory } from "./views";
import { OUTPUT_SCHEMA, buildRecapFacts, fillMoney, recapRequest, validateRecap } from "./recapAi";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;

/** A ledger from July to October 2026: rent, food that climbs each month, a coffee habit, and a Food budget that October broke. */
function ledger(monthStartDay = 1) {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" });
  if (monthStartDay !== 1) s = run(s, "settings.update", { patch: { monthStartDay } });
  const cat = (name: string) => s.categories.find((c) => c.name === name)!._id;
  const expense = (date: string, amount: number, category: string, note = "") => {
    s = run(s, "transactions.create", { accountId: s.accounts[0]._id, tags: [], photoIds: [], type: "expense", categoryId: cat(category), amount, note, date });
  };
  ["07", "08", "09", "10"].forEach((m, i) => {
    expense(`2026-${m}-02`, 2_000_000, "Household", "Rent");
    expense(`2026-${m}-05`, 300_000 + i * 100_000, "Food", "Groceries");
    for (const d of ["08", "12", "16"]) expense(`2026-${m}-${d}`, 20_000, "Food", "Coffee");
    expense(`2026-${m}-20`, 150_000, "Transport", "Fuel");
    s = run(s, "transactions.create", { accountId: s.accounts[0]._id, tags: [], photoIds: [], type: "income", categoryId: cat("Salary"), amount: 5_000_000, note: "Pay", date: `2026-${m}-01` });
  });
  s = run(s, "budgets.upsert", { categoryId: cat("Food"), period: "monthly", amount: 500_000 });
  return { get snap() { return s; }, set snap(v: Snapshot) { s = v; }, cat, expense };
}

test("the facts are the recap's own figures: totals per period, the largest categories, budgets and repeats, with short ids only", () => {
  const f = ledger();
  const facts = buildRecapFacts(f.snap, "2026-10")!;
  const { input } = facts;
  expect(input.kind).toBe("month");
  expect(input.periods).toEqual({ p0: "October 2026", p1: "September 2026", p2: "August 2026", p3: "July 2026" });
  // whole units of the currency, and exactly what Stats shows for the month
  const october = statsByCategory(f.snap, "2026-10-01", "2026-10-31", "expense");
  expect(input.spent.p0).toBe(october.total / 100);
  expect(facts.figures["spent.p0"]).toEqual({ v: october.total, u: "money" });
  expect(input.income).toEqual({ p0: 50000, p1: 50000, p2: 50000, p3: 50000 });
  expect(input.kept).toBe(Math.round(((5_000_000 - october.total) / 5_000_000) * 100));

  const food = input.categories.find((c) => c.name === "Food")!;
  // 6,600 in October against 5,600 in September and a 4,600 average before: over a 5,000 budget by 1,600
  expect(food).toMatchObject({ p0: 6600, p1: 5600, p3: 3600, change: 1000, avg: 4600, vsAvg: 2000, limit: 5000, over: 1600 });
  expect(facts.figures[`${food.id}.over`]).toEqual({ v: 160_000, u: "money" });
  expect(input.repeats![0]).toMatchObject({ id: "r1", note: "Coffee", count: 3, amount: 600 });
  // a budget may be suggested between half the average and the dearest month, and the current one is known
  expect(facts.bounds[food.id as string]).toEqual({ id: f.cat("Food"), lo: 255_000, hi: 660_000, now: 500_000 });

  // nothing that identifies a document, and nothing about single entries
  const sent = JSON.stringify(input);
  expect(sent).not.toContain(f.cat("Food"));
  expect(sent).not.toMatch(/2026-\d\d-\d\d|Groceries|Rent|Fuel/);
  expect(sent.length).toBeLessThan(1500);
  const req = recapRequest(input);
  expect(req.messages[0].content).toBe(sent);
  expect(req.output_config?.format).toMatchObject({ type: "json_schema", schema: OUTPUT_SCHEMA });
});

test("the fingerprint holds while the periods sent are the same, and moves when one of them changes", () => {
  const f = ledger();
  const before = buildRecapFacts(f.snap, "2026-10")!.hash;
  // November is not part of October's recap
  f.expense("2026-11-03", 90_000, "Food", "Dinner");
  expect(buildRecapFacts(f.snap, "2026-10")!.hash).toBe(before);
  f.expense("2026-09-28", 90_000, "Food", "Dinner");
  expect(buildRecapFacts(f.snap, "2026-10")!.hash).not.toBe(before);
});

test("periods follow the month start day, stop at the first entry, and a thin month has no facts", () => {
  const f = ledger(25);
  // with months starting on the 25th, "2026-09" runs Sep 25 to Oct 24 and holds October's entries up to the 20th
  const facts = buildRecapFacts(f.snap, "2026-09")!;
  expect(facts.input.spent.p0).toBe(statsByCategory(f.snap, "2026-09-25", "2026-10-24", "expense").total / 100);
  // the ledger starts on Jul 1, inside logical June: nothing earlier is sent
  expect(Object.keys(facts.input.periods)).toEqual(["p0", "p1", "p2", "p3"]);
  expect(buildRecapFacts(f.snap, "2026-01")).toBeNull();
  expect(buildRecapFacts(emptySnapshot(), "2026-10")).toBeNull();
});

test("a year sends years, its dearest and lightest month, and has no budgets to suggest", () => {
  const f = ledger();
  const facts = buildRecapFacts(f.snap, "2026")!;
  expect(facts.input.kind).toBe("year");
  expect(facts.input.periods).toEqual({ p0: "2026" });
  expect(facts.input.high).toEqual({ month: "October", amount: 28100 });
  expect(facts.input.low).toEqual({ month: "July", amount: 25100 });
  expect(facts.bounds).toEqual({});
  expect(validateRecap({ insights: ["You spent {spent.p0} in 2026."], budgets: [{ category: "c1", amount: 100, why: "" }] }, facts)).toEqual({ insights: ["You spent {m:10640000} in 2026."], budgets: [] });
});

test("a sentence keeps only figures the code computed: placeholders are filled in, a number of the model's own drops it", () => {
  const f = ledger();
  const facts = buildRecapFacts(f.snap, "2026-10")!;
  const food = facts.input.categories.find((c) => c.name === "Food")!.id;
  const out = validateRecap({
    insights: [
      `Food went over its {${food}.limit} budget by {${food}.over}, up {${food}.change} on September.`,
      "You kept {kept}% of what came in during October 2026.",
      "Coffee came up {r1.count} times.",
      "Food is up 18% on last month.",
      "Transport cost {c9.p0} this month.",
      "Rent was {m:1} this month.",
      `Food went over its {${food}.limit} budget by {${food}.over}, up {${food}.change} on September.`,
      "x".repeat(400),
      42,
    ],
    budgets: [],
  }, facts);
  expect(out.insights).toEqual([
    "Food went over its {m:500000} budget by {m:160000}, up {m:100000} on September.",
    // the percent sign is not doubled, and the year in the period's own name is not a figure
    `You kept ${facts.input.kept}% of what came in during October 2026.`,
    "Coffee came up 3 times.",
  ]);
  expect(fillMoney(out.insights[0], (m) => `₹${m / 100}`)).toBe("Food went over its ₹5000 budget by ₹1600, up ₹1000 on September.");
  expect(validateRecap(null, facts)).toEqual({ insights: [], budgets: [] });
  expect(validateRecap({ insights: "no" }, facts)).toEqual({ insights: [], budgets: [] });
});

test("at most five insights and four budgets are kept", () => {
  const f = ledger();
  for (const c of ["Social Life", "Health", "Apparel", "Education"]) for (const m of ["07", "08", "09", "10"]) f.expense(`2026-${m}-22`, 100_000, c);
  const facts = buildRecapFacts(f.snap, "2026-10")!;
  const out = validateRecap({
    insights: ["a", "b", "c", "d", "e", "f"].map((x) => `Point ${x}: {spent.p0}.`),
    budgets: Object.keys(facts.bounds).map((category) => ({ category, amount: 1200, why: "" })),
  }, facts);
  expect(Object.keys(facts.bounds).length).toBeGreaterThan(4);
  expect(out.insights).toHaveLength(5);
  expect(out.budgets).toHaveLength(4);
});

test("a suggested budget is for a live category of theirs, held to their own months and rounded to a whole unit", () => {
  const f = ledger();
  // a category deleted since still shows in the totals, but cannot be given a budget
  f.snap = run(f.snap, "categories.remove", { id: f.cat("Transport") });
  const facts = buildRecapFacts(f.snap, "2026-10")!;
  const id = (name: string) => facts.input.categories.find((c) => c.name === name)!.id as string;
  expect(facts.bounds[id("Transport")]).toBeUndefined();
  const budgets = (list: unknown[]) => validateRecap({ insights: [], budgets: list }, facts).budgets;

  expect(budgets([{ category: id("Household"), amount: 20000, why: `Rent is {${id("Household")}.p0} every month.` }]))
    .toEqual([{ categoryId: f.cat("Household"), amount: 2_000_000, why: "Rent is {m:2000000} every month." }]);
  // far too low and far too high are pulled to half the average and to the dearest month
  expect(budgets([{ category: id("Food"), amount: 1, why: "" }])[0].amount).toBe(255_000);
  expect(budgets([{ category: id("Food"), amount: 1e12, why: "" }])[0].amount).toBe(660_000);
  expect(budgets([{ category: id("Food"), amount: 5999.6, why: "Cut it by 10%." }])).toEqual([{ categoryId: f.cat("Food"), amount: 600_000, why: "" }]);
  // the budget they already have, a category that is not theirs or cannot have one, and nonsense amounts say nothing
  expect(budgets([
    { category: id("Food"), amount: 5000, why: "" },
    { category: id("Transport"), amount: 1500, why: "" },
    { category: "c99", amount: 1500, why: "" },
    { category: "constructor", amount: 1500, why: "" },
    { category: id("Household"), amount: -5, why: "" },
    { category: id("Household"), amount: "20000", why: "" },
    null,
  ])).toEqual([]);
  // one per category
  expect(budgets([{ category: id("Food"), amount: 4000, why: "" }, { category: id("Food"), amount: 4500, why: "" }])).toHaveLength(1);
});
