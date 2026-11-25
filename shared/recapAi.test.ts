import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { statsByCategory } from "./views";
import { monthRecap } from "./recap";
import { OUTPUT_SCHEMA, buildRecapFacts, fillMoney, recapRequest, storyCards, validateRecap } from "./recapAi";

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

  // nothing that identifies a document, no dates, and of single entries only the note behind a finding
  const sent = JSON.stringify(input);
  expect(sent).not.toContain(f.cat("Food"));
  expect(sent).not.toMatch(/2026-\d\d-\d\d|Rent|Fuel/);
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

/** The ledger with an October that stands out: a gift far past the usual, coffee nearly every other day, and the gym gone. */
function eventful() {
  const f = ledger();
  for (const m of ["07", "08", "09"]) { f.expense(`2026-${m}-10`, 100_000, "Social Life", "Drinks"); f.expense(`2026-${m}-03`, 150_000, "Health", "Gym"); }
  f.expense("2026-10-10", 900_000, "Social Life", "Wedding gift");
  for (const d of ["18", "21", "24", "27", "30"]) f.expense(`2026-10-${d}`, 20_000, "Food", "Coffee");
  return f;
}

test("what stands out is found by the code, most telling first, each with its figures and the chart the recap draws", () => {
  // the plain ledger: food rose four months running, and one entry was most of it
  const plain = ledger();
  const base = buildRecapFacts(plain.snap, "2026-10")!;
  expect(base.findings.map((x) => x.type)).toEqual(["climb", "drivers"]);
  expect(base.findings[0]).toMatchObject({
    subject: "Food", drill: `c:${plain.cat("Food")}`,
    figures: { now: { v: 660_000, u: "money" }, start: { v: 360_000, u: "money" }, months: { v: 4, u: "count" } },
    chart: { kind: "bars", unit: "money", bars: [{ label: "Jul", value: 360_000, on: true }, { label: "Aug", value: 460_000, on: true }, { label: "Sep", value: 560_000, on: true }, { label: "Oct", value: 660_000, on: true }] },
  });
  expect(base.findings[1]).toMatchObject({ subject: "Food", names: ["Groceries"], figures: { share: { v: 91, u: "pct" }, biggest: { v: 1, u: "count" }, entries: { v: 4, u: "count" } }, chart: { kind: "split", part: 600_000, total: 660_000, items: [{ label: "Groceries", amount: 600_000 }] } });

  const f = eventful();
  const facts = buildRecapFacts(f.snap, "2026-10")!;
  expect(facts.findings.map((x) => x.type)).toEqual(["spike", "without", "climb", "habit", "missing"]);
  const [spike, without, , habit, missing] = facts.findings;
  // the one-off set aside (rent is as large, but it comes every month) leaves about a usual month
  expect(without).toMatchObject({ names: ["Wedding gift"], figures: { total: { v: 3_810_000 }, top: { v: 900_000 }, rest: { v: 2_910_000 }, usual: { v: 2_860_000 }, share: { v: 24 }, entries: { v: 1 } } });
  expect(spike).toMatchObject({ subject: "Social Life", figures: { now: { v: 900_000 }, usual: { v: 100_000 }, times: { v: 9 } } });
  expect(habit).toMatchObject({ subject: "Coffee", drill: "n:Coffee", figures: { count: { v: 8 }, amount: { v: 160_000 }, each: { v: 20_000 }, usualCount: { v: 3 }, usualEach: { v: 20_000 } }, chart: { unit: "count", bars: [{ value: 3 }, { value: 3 }, { value: 3 }, { label: "Oct", value: 8, on: true }] } });
  expect(missing).toMatchObject({ subject: "Gym", figures: { usual: { v: 150_000 }, months: { v: 3 } }, chart: { bars: [{ value: 150_000 }, { value: 150_000 }, { value: 150_000 }, { label: "Oct", value: 0, on: true }] } });

  // Claude sees them by short id, in whole units, and can name each figure by its path
  expect(facts.input.findings![0]).toEqual({ id: "f1", type: "spike", about: "Social Life", now: 9000, usual: 1000, times: 9 });
  expect(facts.figures["f1.now"]).toEqual({ v: 900_000, u: "money" });
  // two months are not enough to say what is usual
  expect(buildRecapFacts(f.snap, "2026-08")!.findings).toEqual([]);
});

test("a year is looked at across its own months, the ones it has entries in: one big month, a habit that grew, a category that changed between the halves", () => {
  const f = eventful();
  const facts = buildRecapFacts(f.snap, "2026")!;
  expect(facts.findings.map((x) => x.type)).toEqual(["peak", "growing", "shift"]);
  const [peak, growing, shift] = facts.findings;
  // July to October: the months before the ledger began and after its last entry are not zeros to compare with
  expect(peak).toMatchObject({
    subject: "Social Life", when: "October", drill: `c:${f.cat("Social Life")}`, figures: { now: { v: 900_000 }, total: { v: 1_200_000 }, share: { v: 75 } },
    chart: { kind: "bars", unit: "money", bars: [{ label: "Jul", value: 100_000, on: false }, { label: "Aug", value: 100_000, on: false }, { label: "Sep", value: 100_000, on: false }, { label: "Oct", value: 900_000, on: true }] },
  });
  expect(growing).toMatchObject({ subject: "Coffee", drill: "n:Coffee", figures: { count: { v: 17 }, amount: { v: 340_000 }, early: { v: 6 }, late: { v: 11 }, months: { v: 2 }, eachEarly: { v: 20_000 }, eachLate: { v: 20_000 } }, chart: { unit: "count", bars: [{ value: 3 }, { value: 3 }, { value: 3, on: true }, { value: 8, on: true }] } });
  expect(shift).toMatchObject({ subject: "Food", figures: { start: { v: 820_000 }, now: { v: 1_320_000 }, months: { v: 2 } } });
  expect(facts.input.findings![0]).toEqual({ id: "f1", type: "peak", about: "Social Life", month: "October", now: 9000, total: 12000, share: 75 });
  // a card for one of them passes the same checks as a month's
  expect(validateRecap({ title: "", cards: [{ finding: "f1", headline: "October was the Social Life month", text: "{f1.now} of the year's {f1.total} went out in October." }], insights: [], budgets: [] }, facts).cards)
    .toEqual([{ type: "peak", headline: "October was the Social Life month", text: "{m:900000} of the year's {m:1200000} went out in October.", chart: peak.chart, drill: `c:${f.cat("Social Life")}` }]);

  // one-offs are the largest entries whose note came once, and a note that ran for months and then stopped is named with its last month
  for (const m of ["03", "04", "05", "06"]) f.expense(`2026-${m}-07`, 250_000, "Health", "Physio");
  f.expense("2026-06-15", 4_000_000, "Household", "Sofa");
  const more = buildRecapFacts(f.snap, "2026")!.findings;
  expect(more.find((x) => x.type === "oneoffs")).toMatchObject({ names: ["Sofa", "Wedding gift"], figures: { top: { v: 4_900_000 }, entries: { v: 2 } }, chart: { kind: "split", part: 4_900_000, items: [{ label: "Sofa", amount: 4_000_000 }, { label: "Wedding gift", amount: 900_000 }] } });
  expect(more.find((x) => x.type === "stopped")).toMatchObject({ subject: "Physio", when: "June", figures: { usual: { v: 250_000 }, months: { v: 4 } } });
});

test("a card is a finding the code made, once, in words that pass the same checks; the story shows them before the closing card", () => {
  const f = eventful();
  const facts = buildRecapFacts(f.snap, "2026-10")!;
  const good = { finding: "f1", headline: "Social Life ran far past a usual month", text: "{f1.now} against a usual {f1.usual}: {f1.times} times as much." };
  const out = validateRecap({
    title: "The month of the wedding",
    cards: [
      good,
      { ...good, headline: "The same finding twice" },
      { finding: "f9", headline: "Not a finding", text: "Nothing here." },
      { finding: "f4", headline: "Coffee 8 times", text: "A number of its own." },
      { finding: "f4", headline: "Coffee became a habit", text: "It cost {f4.total} in all." },
      { finding: "constructor", headline: "No", text: "No." },
      null,
    ],
    insights: [],
    budgets: [],
  }, facts);
  expect(out).toEqual({
    insights: [], budgets: [], title: "The month of the wedding",
    cards: [{ type: "spike", headline: good.headline, text: "{m:900000} against a usual {m:100000}: 9 times as much.", chart: facts.findings[0].chart, drill: `c:${f.cat("Social Life")}` }],
  });
  // a name with a figure in it is not a name
  expect(validateRecap({ title: "A {spent.p0} month", cards: [], insights: [], budgets: [] }, facts).title).toBeUndefined();

  const recap = monthRecap(f.snap, "2026-10")!;
  const budgets = [{ categoryId: f.cat("Food"), amount: 500_000, why: "" }];
  const story = storyCards(recap.cards, { ...out, budgets });
  expect(story.map((c) => c.kind)).toEqual([...recap.cards.slice(0, -1).map((c) => c.kind), "insight", "ideas", "closer"]);
  expect(story[0]).toMatchObject({ kind: "cover", title: "The month of the wedding", count: recap.cards.length + 2 });
  // nothing from Claude, or nothing left of it to show, leaves the recap's own cards
  expect(storyCards(recap.cards, null)).toBe(recap.cards);
  expect(storyCards(recap.cards, { insights: ["x"], budgets }, [])).toBe(recap.cards);
});

test("more out than in is told as the share of income spent, never as a negative share kept", () => {
  const f = ledger();
  f.expense("2026-10-25", 6_000_000, "Household", "Deposit");
  const facts = buildRecapFacts(f.snap, "2026-10")!;
  expect(facts.input.kept).toBeUndefined();
  expect(facts.input.spentOfIncome).toBe(176);
  expect(validateRecap({ insights: ["You spent {spentOfIncome} of what came in.", "You kept {kept}."], budgets: [] }, facts).insights).toEqual(["You spent 176% of what came in."]);
});

test("a month the person called a one-off is left out of what is usual for that category from then on, and its own recap stays as it was", () => {
  const f = eventful();
  // November, after the wedding: an ordinary month, with a little more out on Social Life than before October
  f.expense("2026-11-02", 2_000_000, "Household", "Rent");
  f.expense("2026-11-05", 600_000, "Food", "Groceries");
  for (const d of ["08", "12", "16"]) f.expense(`2026-11-${d}`, 20_000, "Food", "Coffee");
  f.expense("2026-11-20", 150_000, "Transport", "Fuel");
  f.expense("2026-11-10", 250_000, "Social Life", "Drinks");
  const social = (facts: NonNullable<ReturnType<typeof buildRecapFacts>>) => facts.input.categories.find((c) => c.name === "Social Life")!;
  const answer = (yes: boolean) => { f.snap = run(f.snap, "settings.update", { patch: { recapOneOffs: [{ categoryId: f.cat("Social Life"), month: "2026-10", yes }] } }); };

  // October's 9,000 is in the average, so November's 2,500 looks like a quiet month and a budget may go as high as 9,000
  const before = buildRecapFacts(f.snap, "2026-11")!;
  expect(social(before)).toMatchObject({ p0: 2500, p1: 9000, avg: 3000, vsAvg: -500 });
  expect(social(before).oneOff).toBeUndefined();
  expect(before.findings.some((x) => x.type === "spike" && x.subject === "Social Life")).toBe(false);
  expect(before.bounds[social(before).id as string]).toMatchObject({ lo: 145_000, hi: 900_000 });
  const october = buildRecapFacts(f.snap, "2026-10")!.hash;

  // "Yes, a one-off": October is named as one and left out, November is seen for the jump it is, and budgets fit the other months
  answer(true);
  const after = buildRecapFacts(f.snap, "2026-11")!;
  expect(social(after)).toMatchObject({ p0: 2500, p1: 9000, oneOff: "p1", avg: 1000, vsAvg: 1500 });
  expect(after.findings.find((x) => x.type === "spike")).toMatchObject({ subject: "Social Life", figures: { now: { v: 250_000 }, usual: { v: 100_000 }, times: { v: 2 } } });
  expect(after.bounds[social(after).id as string]).toMatchObject({ lo: 68_750, hi: 250_000 });
  // the recap the answer was given on has the same facts: it is not sent again
  expect(buildRecapFacts(f.snap, "2026-10")!.hash).toBe(october);

  // "No": kept, so the card shows it was answered, and nothing is left out
  answer(false);
  expect(f.snap.settings[0].recapOneOffs).toEqual([{ categoryId: f.cat("Social Life"), month: "2026-10", yes: false }]);
  expect(buildRecapFacts(f.snap, "2026-11")!.hash).toBe(before.hash);
});
