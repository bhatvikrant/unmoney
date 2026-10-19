/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const settings = (userId: string) => ({
  userId, onboarded: true, mainCurrency: "USD", symbol: "$", symbolPosition: "before", decimals: 2, monthStartDay: 1, weekStartDay: 0, carryOver: false,
  startScreen: "daily", theme: "system", accent: "neutral", colorSet: "A", subcategoryEnabled: true, autocompleteEnabled: true, timeInputEnabled: false,
  repeatDisplay: "onDate", cardExpenseDisplay: "atTime", lockAfter: "always",
});

test("forgetting the passcode removes it only for a session begun after the request", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@x" }));
  const oldSession = await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 }));
  const before = t.withIdentity({ subject: `${userId}|${oldSession}` });
  await t.run((ctx) => ctx.db.insert("settings", { ...settings(userId), passcodeHash: "h", passcodeSalt: "s" } as never));
  const pin = () => t.run(async (ctx) => (await ctx.db.query("settings").first())!.passcodeHash);

  await before.mutation(api.passcode.requestReset, {});
  // signing out failed offline and the app reopened on the same session: no reset
  expect(await before.mutation(api.passcode.resetAfterSignIn, {})).toBe("not-yet");
  expect(await pin()).toBe("h");

  await new Promise((r) => setTimeout(r, 5));
  const newSession = await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 }));
  const after = t.withIdentity({ subject: `${userId}|${newSession}` });
  expect(await after.mutation(api.passcode.resetAfterSignIn, {})).toBe("reset");
  expect(await pin()).toBeFalsy();
});

test("unlocking normally cancels a pending request", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@x" }));
  const session = await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 }));
  const as = t.withIdentity({ subject: `${userId}|${session}` });
  await t.run((ctx) => ctx.db.insert("settings", { ...settings(userId), passcodeHash: "h", passcodeSalt: "s", passcodeResetRequestedAt: 1 } as never));
  await as.mutation(api.passcode.cancelReset, {});
  expect(await t.run(async (ctx) => (await ctx.db.query("settings").first())!.passcodeResetRequestedAt)).toBeFalsy();
});
