/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { SUPERADMIN_EMAIL } from "../shared/admin";
import { SEARCH_MAX_QUESTION, SEARCH_MODEL, SEARCH_MONTHLY_CAP } from "../shared/searchAi";
import { SPLIT_MONTHLY_CAP } from "../shared/billSplit";

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
    // AI is off for this person until the superadmin turns it on: refused before the month's count is looked at
    await expect(ask("food last month")).rejects.toThrow("isn't turned on for your account");
    await t.run((ctx) => ctx.db.patch(userId, { aiEnabled: true }));
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

test("AI is off for everyone but the superadmin until the superadmin turns it on for them", async () => {
  const t = convexTest({ schema, modules });
  const [admin, userId] = await t.run(async (ctx) => {
    const ids = [await ctx.db.insert("users", { email: SUPERADMIN_EMAIL }), await ctx.db.insert("users", { email: "a@example.com" })] as const;
    // both asked for photo reading in Preferences
    for (const userId of ids) await ctx.db.insert("settings", {
      userId, receiptAiEnabled: true, onboarded: true, mainCurrency: "USD", symbol: "$", symbolPosition: "before", decimals: 2, monthStartDay: 1, weekStartDay: 0,
      carryOver: false, startScreen: "daily", theme: "system", accent: "neutral", colorSet: "A", subcategoryEnabled: true, autocompleteEnabled: true,
      timeInputEnabled: false, repeatDisplay: "onDate", cardExpenseDisplay: "atTime", lockAfter: "always",
    } as never);
    return ids;
  });
  const asAdmin = t.withIdentity({ subject: `${admin}|s` });
  const asUser = t.withIdentity({ subject: `${userId}|s` });
  const read = (as: typeof asUser) => as.action(api.ai.readReceipt, { image: new Uint8Array([1, 2, 3]).buffer, mediaType: "image/webp", type: "expense", today: "2026-11-25" });
  const allowed = async (as: typeof asUser) => (await as.query(api.sync.me, {}))?.user?.ai;

  expect(await allowed(asUser)).toBe(false);
  await expect(read(asUser)).rejects.toThrow("turned off");
  await expect(asUser.action(api.ai.suggestCategoryCleanup, { includeNotes: false, today: "2026-11-25" })).rejects.toThrow("turned on for your account");
  // the superadmin gets past the switch (no key in tests, so it stops at the next check)
  expect(await allowed(asAdmin)).toBe(true);
  await expect(read(asAdmin)).rejects.toThrow("set up");

  // nobody else can flip it, themselves included
  await expect(asUser.mutation(api.admin.setAi, { userIds: [userId], on: true })).rejects.toThrow(/Not allowed/);
  await asAdmin.mutation(api.admin.setAi, { userIds: [userId], on: true });
  expect(await allowed(asUser)).toBe(true);
  await expect(read(asUser)).rejects.toThrow("set up");
  expect((await asAdmin.query(api.admin.overview, { from: "2026-11-01", to: "2026-11-30" })).users.find((u) => u.id === userId)?.ai).toBe(true);

  await asAdmin.mutation(api.admin.setAi, { userIds: [userId], on: false });
  await expect(read(asUser)).rejects.toThrow("turned off");
});

test("bill splitting: only with AI allowed and photo reading turned on, and no more than the month's bills", async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const asUser = t.withIdentity({ subject: `${userId}|s` });
  const read = (over: object = {}) => asUser.action(api.ai.readBill, { image: new Uint8Array([1, 2, 3]).buffer, mediaType: "image/webp", amount: 110000, ...over });
  const calls = () => t.run(async (ctx) => (await ctx.db.query("aiDaily").collect()).reduce((n, r) => n + r.calls, 0));

  await expect(t.action(api.ai.readBill, { image: new Uint8Array([1]).buffer, mediaType: "image/webp", amount: 110000 })).rejects.toThrow("Sign in");
  // the superadmin turned AI on for them, but they never asked for photos to be read
  await t.run((ctx) => ctx.db.patch(userId, { aiEnabled: true }));
  await expect(read()).rejects.toThrow("turned off");
  // they asked, and the superadmin has since turned AI off for them
  const settingsId = await t.run((ctx) => ctx.db.insert("settings", {
    userId, receiptAiEnabled: true, onboarded: true, mainCurrency: "INR", symbol: "₹", symbolPosition: "before", decimals: 2, monthStartDay: 1, weekStartDay: 0,
    carryOver: false, startScreen: "daily", theme: "system", accent: "neutral", colorSet: "A", subcategoryEnabled: true, autocompleteEnabled: true,
    timeInputEnabled: false, repeatDisplay: "onDate", cardExpenseDisplay: "atTime", lockAfter: "always",
  } as never));
  await t.run((ctx) => ctx.db.patch(userId, { aiEnabled: false }));
  await expect(read()).rejects.toThrow("turned off");
  await t.run((ctx) => ctx.db.patch(userId, { aiEnabled: true }));
  // an empty photo, or no amount to check the bill against, is refused whoever asks
  await expect(read({ image: new ArrayBuffer(0) })).rejects.toThrow("can't be read");
  await expect(read({ amount: 0 })).rejects.toThrow("can't be read");
  // both switches on, no key in tests: it stops before anything is counted or sent
  await expect(read()).rejects.toThrow("set up");
  expect(await calls()).toBe(0);

  // with a key, a month that is used up refuses before Claude is asked, and counts nothing more
  for (let i = 0; i < SPLIT_MONTHLY_CAP; i++) expect(await t.mutation(internal.usage.claimAi, { userId, feature: "split", cap: SPLIT_MONTHLY_CAP })).toBe(true);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  try {
    await expect(read()).rejects.toThrow(`${SPLIT_MONTHLY_CAP} bills this month`);
  } finally {
    vi.unstubAllEnvs();
  }
  expect(await calls()).toBe(SPLIT_MONTHLY_CAP);
  // bills do not use up the month's photos
  expect(await t.mutation(internal.usage.claimAi, { userId, feature: "receipt", cap: 1 })).toBe(true);
  await t.run((ctx) => ctx.db.patch(settingsId, { receiptAiEnabled: false }));
  await expect(read()).rejects.toThrow("turned off");
});
