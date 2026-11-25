/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { SEARCH_MAX_QUESTION, SEARCH_MODEL, SEARCH_MONTHLY_CAP } from "../shared/searchAi";

const modules = import.meta.glob("./**/*.ts");

test("photo reading: only for someone who turned it on, counted before Claude is asked, up to the month's limit", async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const asUser = t.withIdentity({ subject: `${userId}|session` });
  const read = () => asUser.action(api.ai.readReceipt, { image: new Uint8Array([1, 2, 3]).buffer, mediaType: "image/webp", type: "expense", today: "2026-11-25" });
  // never turned on: refused before anything is counted or sent
  await expect(read()).rejects.toThrow("turned off");
  expect(await t.run((ctx) => ctx.db.query("aiDaily").collect())).toEqual([]);

  const claim = () => t.mutation(internal.usage.claimAi, { userId, feature: "receipt", cap: 2 });
  expect(await Promise.all([claim(), claim(), claim()])).toEqual([true, true, false]);
  // the answer adds its tokens to the call already counted, not a call of its own
  await t.mutation(internal.usage.recordAi, { userId, feature: "receipt", model: "claude-haiku-5-5", tokens: { input: 2000, output: 100, cacheWrite: 0, cacheRead: 0 }, counted: true });
  const rows = await t.run((ctx) => ctx.db.query("aiDaily").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ feature: "receipt", calls: 2, inputTokens: 2000, outputTokens: 100 });
  // another feature's calls do not use up this one's month
  expect(await t.mutation(internal.usage.claimAi, { userId, feature: "gmail", cap: 2 })).toBe(true);
});

test("search questions: a bad one is refused before anything is counted, only names leave the database, counted up to the month's limit", async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const asUser = t.withIdentity({ subject: `${userId}|session` });
  await asUser.mutation(api.sync.apply, { ops: [{ id: "op1", kind: "settings.completeOnboarding", args: { currency: "INR" }, at: 1 }] });
  const accounts = (await asUser.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const categories = (await asUser.query(api.sync.table, { table: "categories" })) as Doc<"categories">[];
  const food = categories.find((c) => c.type === "expense" && c.name === "Food")!;
  const entry = { type: "expense", accountId: accounts[0]._id, categoryId: food._id, amount: 48500, note: "Secret dinner", date: "2026-11-20", tags: ["trip"], photoIds: [] };
  await asUser.mutation(api.sync.apply, { ops: [{ id: "op2", kind: "transactions.create", args: entry, at: 2 }] });

  const ask = (question: string, today = "2026-11-25") => asUser.action(api.ai.askSearch, { question, today });
  await expect(t.action(api.ai.askSearch, { question: "food last month", today: "2026-11-25" })).rejects.toThrow("Sign in first");
  await expect(ask("x".repeat(SEARCH_MAX_QUESTION + 1))).rejects.toThrow("too long");
  await expect(ask("   ")).rejects.toThrow("can't be read");
  await expect(ask("food last month", "25/11/2026")).rejects.toThrow("can't be read");
  expect(await t.run((ctx) => ctx.db.query("aiDaily").collect())).toEqual([]);

  // what would go with a question: the person's names and tags, and nothing else of the entry
  const { context, ids } = await t.query(internal.ai.prepareSearch, { userId });
  expect(context).toMatchObject({ currency: "INR", monthStartDay: 1, tags: ["trip"] });
  const short = context.expenseCategories.find((c) => c.name === "Food")!.id;
  expect(ids.categories[short]).toBe(food._id);
  expect(context.paymentMethods.map((p) => ids.accounts[p.id])).toContain(accounts[0]._id);
  const sent = JSON.stringify(context);
  for (const secret of ["Secret dinner", "48500", "485", "2026-11-20", food._id]) expect(sent).not.toContain(secret);

  const claim = () => t.mutation(internal.usage.claimAi, { userId, feature: "search", cap: 2 });
  expect(await Promise.all([claim(), claim(), claim()])).toEqual([true, true, false]);
  // the answer adds its tokens, cached ones included, to the call already counted
  await t.mutation(internal.usage.recordAi, { userId, feature: "search", model: SEARCH_MODEL, tokens: { input: 150, output: 200, cacheWrite: 0, cacheRead: 900 }, counted: true });
  const rows = await t.run((ctx) => ctx.db.query("aiDaily").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ feature: "search", calls: 2, inputTokens: 150, outputTokens: 200, cacheReadTokens: 900 });
  expect(rows[0].costUsd).toBeCloseTo((150 * 0.1 + 900 * 0.01 + 200 * 0.5) / 1_000_000, 12);
  // another feature's calls do not use up this one's month
  expect(await t.mutation(internal.usage.claimAi, { userId, feature: "receipt", cap: 2 })).toBe(true);

  // the month used up: the question is refused with a sentence for the person, before Claude is asked (the key here is not a real one)
  await t.run((ctx) => ctx.db.patch(rows[0]._id, { calls: SEARCH_MONTHLY_CAP }));
  vi.stubEnv("ANTHROPIC_API_KEY", "not-a-key");
  try {
    await expect(ask("food last month")).rejects.toThrow(`AI has answered ${SEARCH_MONTHLY_CAP} questions this month`);
  } finally {
    vi.unstubAllEnvs();
  }
  expect((await t.run((ctx) => ctx.db.get(rows[0]._id)))!.calls).toBe(SEARCH_MONTHLY_CAP);
});

test("a tidy-up run is counted before Claude is asked: three a day, and none within a month of one that worked", async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const claim = () => t.mutation(internal.ai.claim, { userId });
  expect(await Promise.all([claim(), claim(), claim(), claim()])).toEqual(["ok", "ok", "ok", "tooMany"]);
  // attempts alone are not a run: the screen still shows "never ran"
  expect(await t.withIdentity({ subject: `${userId}|session` }).query(api.ai.status, {})).toBeNull();

  await t.mutation(internal.ai.record, { userId, lastRunAt: Date.now(), summaryHash: "h", result: [] });
  expect(await claim()).toBe("ran");
});
