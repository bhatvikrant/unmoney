/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function twoUsers() {
  const t = convexTest(schema, modules);
  const [a, b] = await t.run(async (ctx) => [await ctx.db.insert("users", { email: "a@x" }), await ctx.db.insert("users", { email: "b@x" })]);
  const store = () => t.run((ctx) => ctx.storage.store(new Blob(["receipt"], { type: "image/jpeg" })));
  return { t, a, b, asA: t.withIdentity({ subject: `${a}|s` }), asB: t.withIdentity({ subject: `${b}|s` }), store };
}

test("a claimed photo is served to its owner only", async () => {
  const { asA, asB, store } = await twoUsers();
  const id = await store();
  await asA.mutation(api.files.claim, { storageId: id });
  expect((await asA.query(api.files.urls, { ids: [id] }))[id]).toBeTruthy();
  expect((await asB.query(api.files.urls, { ids: [id] }))[id]).toBeNull();
});

test("nobody can claim or delete another user's photo", async () => {
  const { t, asA, asB, store } = await twoUsers();
  const id = await store();
  await asA.mutation(api.files.claim, { storageId: id });
  await expect(asB.mutation(api.files.claim, { storageId: id })).rejects.toThrow(/someone else/);
  await expect(asB.mutation(api.files.remove, { id })).rejects.toThrow();
  expect(await t.run((ctx) => ctx.storage.getUrl(id))).toBeTruthy();
  await asA.mutation(api.files.remove, { id });
  expect(await t.run((ctx) => ctx.storage.getUrl(id))).toBeNull();
});

test("the backfill gives photos from before owners existed to the user whose entry holds them", async () => {
  vi.useFakeTimers();
  const { t, a, asA, asB, store } = await twoUsers();
  const id = await store();
  await t.run(async (ctx) => {
    const groupId = await ctx.db.insert("accountGroups", { userId: a, name: "Cash", kind: "cash", order: 0 });
    const accountId = await ctx.db.insert("accounts", { userId: a, groupId, name: "Cash", initialBalance: 0, includeInTotals: true, hidden: false, order: 0, transferAsExpense: false });
    await ctx.db.insert("transactions", { userId: a, type: "expense", date: "2026-01-01", accountId, amount: 1, note: "", tags: [], photoIds: [id] });
  });
  // no owner yet: still served, so existing receipts keep showing until the backfill runs
  expect((await asB.query(api.files.urls, { ids: [id] }))[id]).toBeTruthy();
  await t.mutation(internal.files.backfillOwners, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await asA.query(api.files.urls, { ids: [id] }))[id]).toBeTruthy();
  expect((await asB.query(api.files.urls, { ids: [id] }))[id]).toBeNull();
  vi.useRealTimers();
});
