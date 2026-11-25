/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { SUPERADMIN_EMAIL } from "../shared/admin";
import { STATEMENT_MAX_LINES, STATEMENT_MODEL } from "../shared/statementAi";

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

test("statement suggestions: only for someone AI is turned on for, a capped number of rows, each call counted first", async () => {
  const t = convexTest({ schema, modules });
  const [admin, userId] = await t.run(async (ctx) => [await ctx.db.insert("users", { email: SUPERADMIN_EMAIL }), await ctx.db.insert("users", { email: "a@example.com" })] as const);
  const asAdmin = t.withIdentity({ subject: `${admin}|s` });
  const asUser = t.withIdentity({ subject: `${userId}|s` });
  const lines = [{ text: "UPI-SWIGGY-8812", kind: "out" as const }];
  await expect(t.action(api.ai.suggestImport, { lines })).rejects.toThrow("Sign in");
  // not turned on: refused before anything is counted or sent
  await expect(asUser.action(api.ai.suggestImport, { lines })).rejects.toThrow("turned on for your account");
  // more rows than one file may ask about, or none, even for someone who may
  await expect(asAdmin.action(api.ai.suggestImport, { lines: Array.from({ length: STATEMENT_MAX_LINES + 1 }, () => lines[0]) })).rejects.toThrow("up to");
  await expect(asAdmin.action(api.ai.suggestImport, { lines: [] })).rejects.toThrow("up to");
  // turned on gets past the switch (no key in tests, so it stops at the next check, still uncounted)
  await asAdmin.mutation(api.admin.setAi, { userIds: [userId], on: true });
  await expect(asUser.action(api.ai.suggestImport, { lines })).rejects.toThrow("set up");
  expect(await t.run((ctx) => ctx.db.query("aiDaily").collect())).toEqual([]);

  // every batch is a call, counted against the month before it is made
  const claim = () => t.mutation(internal.usage.claimAi, { userId, feature: "statement", cap: 2 });
  expect(await Promise.all([claim(), claim(), claim()])).toEqual([true, true, false]);
  await t.mutation(internal.usage.recordAi, { userId, feature: "statement", model: STATEMENT_MODEL, tokens: { input: 900, output: 700, cacheWrite: 0, cacheRead: 2500 }, counted: true });
  expect(await t.run((ctx) => ctx.db.query("aiDaily").collect())).toMatchObject([{ feature: "statement", calls: 2, inputTokens: 900, cacheReadTokens: 2500 }]);
});
