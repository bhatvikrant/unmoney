/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { SUPERADMIN_EMAIL } from "../shared/admin";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const [admin, user] = await t.run(async (ctx) => [
    await ctx.db.insert("users", { email: SUPERADMIN_EMAIL }),
    await ctx.db.insert("users", { email: "someone@example.com" }),
  ]);
  return { t, admin, user, asAdmin: t.withIdentity({ subject: `${admin}|s` }), asUser: t.withIdentity({ subject: `${user}|s` }) };
}

const ping = (over: Partial<{ sessionId: string; totals: Record<string, number>; screens: Record<string, number> }> = {}) => ({
  sessionId: "s1", deviceId: "d1", day: "2026-11-02", hour: 21, startedAt: Date.now() - 60_000, tzOffset: 330,
  os: "iOS", browser: "Safari", formFactor: "phone" as const, standalone: true, appVersion: "2026.11.02-10:00",
  totals: { activeMs: 0, bytesDown: 0, bytesUp: 0, photoFetches: 0, opsSent: 0, ...over.totals },
  screens: over.screens ?? {},
  ...(over.sessionId ? { sessionId: over.sessionId } : {}),
});

test("only the superadmin can read the dashboard or ask for a refresh", async () => {
  const { asAdmin, asUser, t } = await setup();
  await expect(asUser.query(api.admin.overview, { from: "2026-01-01", to: "2026-12-31" })).rejects.toThrow(/Not allowed/);
  await expect(asUser.mutation(api.admin.refresh, {})).rejects.toThrow(/Not allowed/);
  await expect(t.query(api.admin.overview, { from: "2026-01-01", to: "2026-12-31" })).rejects.toThrow(/Not allowed/);
  const o = await asAdmin.query(api.admin.overview, { from: "2026-01-01", to: "2026-12-31" });
  expect(o.users).toHaveLength(2);
});

test("pings add only what grew, so a repeated ping counts nothing twice", async () => {
  const { asUser, asAdmin } = await setup();
  await asUser.mutation(api.usage.ping, ping({ totals: { activeMs: 5_000, bytesDown: 1000 }, screens: { ledger: 1 } }));
  await asUser.mutation(api.usage.ping, ping({ totals: { activeMs: 5_000, bytesDown: 1000 }, screens: { ledger: 1 } }));
  await asUser.mutation(api.usage.ping, ping({ totals: { activeMs: 45_000, bytesDown: 3000, opsSent: 2 }, screens: { ledger: 1, stats: 2 } }));
  // a second session on the same device and day
  await asUser.mutation(api.usage.ping, ping({ sessionId: "s2", totals: { activeMs: 2_000 } }));
  const o = await asAdmin.query(api.admin.overview, { from: "2026-11-01", to: "2026-11-30" });
  expect(o.daily).toHaveLength(1);
  const d = o.daily[0];
  expect(d).toMatchObject({ opens: 2, activeMs: 47_000, bytesDown: 3000, opsSent: 2, screens: { ledger: 1, stats: 2 }, hours: { h21: 2 } });
  // s1 moved from "< 10s" to "30s–1m"; s2 is "< 10s"
  expect(d.lengths).toEqual({ lt10s: 1, lt1m: 1 });
  expect(o.devices).toMatchObject([{ deviceId: "d1", sessions: 2, os: "iOS", standalone: true }]);
});

test("someone else's session id is ignored", async () => {
  const { asUser, asAdmin } = await setup();
  await asUser.mutation(api.usage.ping, ping({ totals: { bytesDown: 10 } }));
  await asAdmin.mutation(api.usage.ping, ping({ totals: { bytesDown: 99_999 } }));
  const o = await asAdmin.query(api.admin.overview, { from: "2026-11-01", to: "2026-11-30" });
  expect(o.daily.map((r) => r.bytesDown)).toEqual([10]);
});

test("the stats job counts each user's documents and files, not their contents", async () => {
  const { t, user, asAdmin } = await setup();
  await t.run(async (ctx) => {
    const groupId = await ctx.db.insert("accountGroups", { userId: user, name: "Cash", order: 0 });
    const accountId = await ctx.db.insert("accounts", { userId: user, groupId, kind: "card", name: "Visa", initialBalance: 0, includeInTotals: true, hidden: false, order: 0, transferAsExpense: false });
    const photo = await ctx.storage.store(new Blob(["12345"], { type: "image/jpeg" }));
    await ctx.db.insert("fileOwners", { userId: user, storageId: photo });
    const tx = { userId: user, type: "expense" as const, date: "2026-10-01", accountId, amount: 100, note: "Coffee", tags: [], photoIds: [] };
    await ctx.db.insert("transactions", tx);
    await ctx.db.insert("transactions", { ...tx, date: "2024-01-05", photoIds: [photo] });
    await ctx.db.insert("transactions", { ...tx, importId: "imp1" });
  });
  await t.action(internal.admin.refreshStats, {});
  const o = await asAdmin.query(api.admin.overview, { from: "2026-11-01", to: "2026-11-30" });
  const s = o.stats.find((r) => r.userId === user)!;
  expect(s.tables.transactions.count).toBe(3);
  expect(s.tables.transactions.bytes).toBeGreaterThan(0);
  expect(s.files).toEqual({ count: 1, bytes: 5 });
  expect(s.entries).toMatchObject({ manual: 2, imported: 1, withPhotos: 1 });
  expect(s.firstEntryDate).toBe("2024-01-05");
  expect(s.accountKinds).toEqual({ card: 1 });
  expect(s.features).toMatchObject({ photos: true, imports: true, budgets: false });
  expect(JSON.stringify(s)).not.toContain("Coffee");
});

test("deleting an account removes its usage rows", async () => {
  vi.useFakeTimers();
  const { t, user, asUser } = await setup();
  await asUser.mutation(api.usage.ping, ping());
  await t.action(internal.admin.refreshStats, {});
  await asUser.mutation(api.account.deleteMyAccount, { confirm: "DELETE" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const left = await t.run(async (ctx) => ({
    sessions: await ctx.db.query("usageSessions").collect(),
    daily: await ctx.db.query("usageDaily").collect(),
    devices: await ctx.db.query("usageDevices").collect(),
    stats: (await ctx.db.query("adminStats").collect()).filter((r) => r.userId === user),
  }));
  expect(left).toEqual({ sessions: [], daily: [], devices: [], stats: [] });
  vi.useRealTimers();
});
