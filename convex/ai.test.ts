/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

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
