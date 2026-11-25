/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { Op } from "../shared/ops";
import { RECAP_MONTHLY_CAP } from "../shared/recapAi";

const modules = import.meta.glob("./**/*.ts");
// these tests never reach Claude, even on a machine that has a key
vi.stubEnv("ANTHROPIC_API_KEY", "");

/** A user with AI turned on and six expense entries in each of August, September and October 2026: enough for a recap of each. */
async function setup() {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com", aiEnabled: true }));
  const as = t.withIdentity({ subject: `${userId}|session` });
  const op: Op = { id: "op1", kind: "settings.completeOnboarding", args: { currency: "INR" }, at: 1 };
  await as.mutation(api.sync.apply, { ops: [op] });
  const [account] = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const food = ((await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[]).find((c) => c.name === "Food")!;
  await t.run(async (ctx) => {
    for (const m of ["08", "09", "10"]) {
      for (let d = 1; d <= 6; d++) await ctx.db.insert("transactions", { userId, type: "expense", date: `2026-${m}-0${d}`, accountId: account._id, categoryId: food._id, amount: 10_000 * d, note: "Lunch", tags: [], photoIds: [] });
    }
  });
  const calls = () => t.run((ctx) => ctx.db.query("aiDaily").collect());
  return { t, userId, as, food, calls };
}

test("recap insights: only when asked for by someone signed in, for a finished period with a recap, and nothing is counted before that", async () => {
  const { t, userId, as, calls } = await setup();
  await expect(t.action(api.recapAi.ask, { key: "2026-10" })).rejects.toThrow("Sign in first");
  // AI is off until the superadmin turns it on for the person
  await t.run((ctx) => ctx.db.patch(userId, { aiEnabled: false }));
  await expect(as.action(api.recapAi.ask, { key: "2026-10" })).rejects.toThrow("turned on for your account");
  await t.run((ctx) => ctx.db.patch(userId, { aiEnabled: true }));
  await expect(as.action(api.recapAi.ask, { key: "2026-13" })).rejects.toThrow("can't be read");
  // a month with nothing in it, and one that has not ended yet
  await expect(as.action(api.recapAi.ask, { key: "2026-07" })).rejects.toThrow("isn't a recap");
  await expect(as.action(api.recapAi.ask, { key: "2999-01" })).rejects.toThrow("isn't a recap");
  // no key in the test environment: refused before Claude is asked or a call is counted
  await expect(as.action(api.recapAi.ask, { key: "2026-10" })).rejects.toThrow("aren't set up");
  expect(await calls()).toEqual([]);
  expect(await as.query(api.recapAi.get, { key: "2026-10" })).toBeNull();
});

test("recap insights: one stored answer per recap, shown again for free while the facts are the same", async () => {
  const { t, userId, as, food, calls } = await setup();
  const { facts } = await t.query(internal.recapAi.prepare, { userId, key: "2026-10" });
  const answer = { insights: ["Food took {m:210000}."], budgets: [{ categoryId: food._id, amount: 200_000, why: "" }] };
  await t.mutation(internal.recapAi.store, { userId, key: "2026-10", hash: facts!.hash, at: 1, ...answer });
  // the same facts: the stored answer comes back without a key, a call or a count
  expect(await as.action(api.recapAi.ask, { key: "2026-10" })).toEqual({ ...answer, hash: facts!.hash, at: 1 });
  expect(await as.query(api.recapAi.get, { key: "2026-10" })).toEqual({ ...answer, hash: facts!.hash, at: 1 });
  expect(await calls()).toEqual([]);
  // another recap of theirs has no answer yet, and nobody else sees this one
  expect(await as.query(api.recapAi.get, { key: "2026-09" })).toBeNull();
  expect(await t.query(api.recapAi.get, { key: "2026-10" })).toBeNull();

  // an entry in the month changes the facts: the stored answer no longer stands in for a new run
  const [account] = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  await t.run((ctx) => ctx.db.insert("transactions", { userId, type: "expense", date: "2026-10-20", accountId: account._id, categoryId: food._id, amount: 5_000, note: "Tea", tags: [], photoIds: [] }));
  await expect(as.action(api.recapAi.ask, { key: "2026-10" })).rejects.toThrow("aren't set up");

  // a new run replaces the row: still one per recap
  await t.mutation(internal.recapAi.store, { userId, key: "2026-10", hash: "new", at: 2, insights: ["Later."], budgets: [] });
  const rows = await t.run((ctx) => ctx.db.query("recapInsights").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ key: "2026-10", hash: "new", insights: ["Later."] });

  // the name Claude gave the month and its cards, each with the chart the code made, come back as stored
  const card = { type: "spike", headline: "Food ran past a usual month", text: "{m:210000} this month.", chart: { kind: "bars" as const, unit: "money" as const, bars: [{ label: "Oct", value: 210_000, on: true }] }, drill: "top:3" };
  await t.mutation(internal.recapAi.store, { userId, key: "2026-10", hash: "cards", at: 3, insights: [], budgets: [], title: "A hungry October", cards: [card] });
  expect(await as.query(api.recapAi.get, { key: "2026-10" })).toEqual({ insights: [], budgets: [], hash: "cards", at: 3, title: "A hungry October", cards: [card] });
});

test("recap insights: counted before Claude is asked, up to the month's limit, apart from the other AI features", async () => {
  const { t, userId, calls } = await setup();
  const claim = () => t.mutation(internal.usage.claimAi, { userId, feature: "recap", cap: RECAP_MONTHLY_CAP });
  const claims = [];
  for (let i = 0; i <= RECAP_MONTHLY_CAP; i++) claims.push(await claim());
  expect(claims).toEqual([...Array.from({ length: RECAP_MONTHLY_CAP }, () => true), false]);
  await t.mutation(internal.usage.recordAi, { userId, feature: "recap", model: "claude-haiku-5-5", tokens: { input: 1500, output: 900, cacheWrite: 0, cacheRead: 0 }, counted: true });
  const rows = await calls();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ feature: "recap", calls: RECAP_MONTHLY_CAP, inputTokens: 1500, outputTokens: 900 });
  expect(await t.mutation(internal.usage.claimAi, { userId, feature: "receipt", cap: 1 })).toBe(true);
});
