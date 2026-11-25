/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

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
