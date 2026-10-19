/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Op } from "../shared/ops";

const modules = import.meta.glob("./**/*.ts");

test("deleting an account removes every document, file and sign-in of that user, and nothing of anyone else's", async () => {
  vi.useFakeTimers();
  const t = convexTest({ schema, modules, transactionLimits: true });
  const makeUser = async (email: string, entries: number) => {
    const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
    const as = t.withIdentity({ subject: `${userId}|s` });
    const op = (kind: Op["kind"], args: unknown): Op => ({ id: `${email}-${kind}-${Math.random()}`, kind, args, at: 1 });
    await as.mutation(api.sync.apply, { ops: [op("settings.completeOnboarding", { currency: "USD" })] });
    const [account] = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
    const photo = await t.run((ctx) => ctx.storage.store(new Blob(["jpg"])));
    await as.mutation(api.files.claim, { storageId: photo });
    await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 });
      await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: Date.now() + 1e9 });
      await ctx.db.insert("authAccounts", { userId, provider: "google", providerAccountId: email });
      for (let i = 0; i < entries; i++) await ctx.db.insert("transactions", { userId, type: "expense", date: "2026-01-01", accountId: account._id, amount: 1, note: "", tags: [], photoIds: i === 0 ? [photo] : [] });
      await ctx.db.insert("notes", { userId, date: "2026-01-01", text: "x", color: "#000" });
    });
    return { userId, as, photo };
  };
  const me = await makeUser("me@x", 1_200);
  const other = await makeUser("other@x", 3);

  await me.as.mutation(api.account.deleteMyAccount, { confirm: "DELETE" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const left = await t.run(async (ctx) => {
    const count = async (userId: Id<"users">) => {
      const n: Record<string, number> = {};
      for (const table of ["transactions", "notes", "accounts", "categories", "settings", "fileOwners", "syncOps", "authSessions"] as const) {
        const rows = (await ctx.db.query(table).collect()) as { userId?: Id<"users"> }[];
        n[table] = rows.filter((r) => r.userId === userId).length;
      }
      return n;
    };
    return {
      mine: await count(me.userId), theirs: await count(other.userId),
      user: await ctx.db.get(me.userId), refreshTokens: (await ctx.db.query("authRefreshTokens").collect()).length,
      authAccounts: (await ctx.db.query("authAccounts").collect()).map((a) => a.providerAccountId),
      myPhoto: await ctx.storage.getUrl(me.photo), theirPhoto: await ctx.storage.getUrl(other.photo),
    };
  });
  expect(Object.values(left.mine).every((n) => n === 0)).toBe(true);
  expect(left.user).toBeNull();
  expect(left.myPhoto).toBeNull();
  expect(left.theirs.transactions).toBe(3);
  expect(left.theirs.accounts).toBeGreaterThan(0);
  expect(left.theirPhoto).toBeTruthy();
  expect(left.authAccounts).toEqual(["other@x"]);
  expect(left.refreshTokens).toBe(1);
  vi.useRealTimers();
}, 120_000);
