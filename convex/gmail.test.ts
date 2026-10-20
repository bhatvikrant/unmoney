/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { decryptText, encryptText, sign, verify } from "./lib/gmailCrypto";

const modules = import.meta.glob("./**/*.ts");

beforeAll(() => {
  // 32 zero bytes, base64: fine for tests, never for a deployment
  process.env.GMAIL_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.SITE_URL = "https://app.test";
  process.env.CONVEX_SITE_URL = "https://deployment.convex.site";
});

async function setup() {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const as = t.withIdentity({ subject: `${userId}|session` });
  await as.mutation(api.sync.apply, { ops: [{ id: "op1", kind: "settings.completeOnboarding", args: { currency: "INR" }, at: 1 }] });
  const accounts = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const connect = (extra: Partial<Doc<"gmailConnections">> = {}) => t.run((ctx) => ctx.db.insert("gmailConnections", {
    userId, email: "me@gmail.com", refreshTokenEnc: "enc", iv: "iv", status: "ok", lookbackDays: 30, senders: ["hdfcbank.net"], scanPurchases: true, accountMap: {},
    aiMonth: "2026-09", aiCalls: 5, log: [], ...extra,
  }));
  const insert = (messageId: string, extra: Record<string, unknown> = {}) => ({
    source: "gmail" as const, messageId, extraMessageIds: [], threadId: "t", receivedAt: 1, from: "HDFC <alerts@hdfcbank.net>", subject: "Alert",
    proposal: { type: "expense" as const, date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: accounts[0]._id }, confidence: "high" as const, how: "rule" as const, ...extra,
  });
  return { t, as, userId, accounts, connect, insert };
}

test("tokens round-trip through the cipher and signatures only verify untouched", async () => {
  const { enc, iv } = await encryptText("1//refresh-token");
  expect(enc).not.toContain("refresh");
  expect(await decryptText(enc, iv)).toBe("1//refresh-token");
  const sig = await sign("user.30.123");
  expect(await verify("user.30.123", sig)).toBe(true);
  expect(await verify("user.90.123", sig)).toBe(false);
  expect(await verify("user.30.123", sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"))).toBe(false);
});

test("a check's drafts are written once each, folds reach open drafts, and the connection keeps the books", async () => {
  const { t, userId, accounts, connect, insert } = await setup();
  const cid = await connect();
  const at = Date.parse("2026-10-20T10:00:00Z");
  const write = (inserts: ReturnType<typeof insert>[], extra: Partial<{ updates: { id: Id<"drafts">; extraMessageIds: string[]; note?: string }[]; aiCalls: number; note: string }> = {}) =>
    t.mutation(internal.gmail.writeSync, { userId, startedAt: at, inserts, updates: [], learned: {}, aiCalls: 0, scanned: 12, ...extra });
  await write([insert("m1"), insert("m2", { matchedTransactionId: undefined })], { aiCalls: 2 });
  let drafts = await t.run((ctx) => ctx.db.query("drafts").collect());
  expect(drafts.map((d) => [d.messageId, d.status])).toEqual([["m1", "open"], ["m2", "open"]]);
  // the same mail again (an overlapping window) is not a second draft; a receipt folds into the alert
  await write([insert("m1"), insert("m3")], { updates: [{ id: drafts[0]._id, extraMessageIds: ["r1"], note: "Zomato" }], aiCalls: 1, note: "monthly AI limit reached" });
  drafts = await t.run((ctx) => ctx.db.query("drafts").collect());
  expect(drafts.map((d) => d.messageId)).toEqual(["m1", "m2", "m3"]);
  expect(drafts[0].extraMessageIds).toEqual(["r1"]);
  expect(drafts[0].proposal.note).toBe("Zomato");
  const c = (await t.run((ctx) => ctx.db.get(cid)))!;
  // a new month starts the AI count over: 2 then +1
  expect([c.aiMonth, c.aiCalls]).toEqual(["2026-10", 3]);
  expect(c.lastSyncAt).toBe(at);
  expect(c.syncedUpTo).toBe(at);
  expect(c.log.map((l) => [l.scanned, l.found, l.note])).toEqual([[12, 1, "monthly AI limit reached"], [12, 2, undefined]]);
  // what the user picked is learned
  await t.mutation(internal.gmail.writeSync, { userId, startedAt: at, inserts: [], updates: [], learned: { "hdfcbank.net|4521": accounts[0]._id }, aiCalls: 0, scanned: 0 });
  expect((await t.run((ctx) => ctx.db.get(cid)))!.accountMap).toEqual({ "hdfcbank.net|4521": accounts[0]._id });
});

test("failures are logged; three in a row pause the connection, a dead grant asks to reconnect", async () => {
  const { t, userId, connect } = await setup();
  const cid = await connect();
  const fail = (n: number, reauth = false) => t.mutation(internal.gmail.failSync, { userId, startedAt: n, error: `boom ${n}`, reauth });
  await fail(1);
  await fail(2);
  expect((await t.run((ctx) => ctx.db.get(cid)))!.status).toBe("ok");
  await fail(3);
  const c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect([c.status, c.lastError, c.log.length]).toEqual(["paused", "boom 3", 3]);
  await t.run((ctx) => ctx.db.patch(cid, { status: "ok", log: [] }));
  await fail(4, true);
  expect((await t.run((ctx) => ctx.db.get(cid)))!.status).toBe("reauth");
});

test("settings are normalised and pausing is reversible", async () => {
  const { t, as, connect } = await setup();
  const cid = await connect();
  await as.mutation(api.gmail.updateSettings, { senders: [" Alerts@HDFCBank.net ", "amazon.in", "amazon.in", ""], scanPurchases: false, paused: true });
  let c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect([c.senders, c.scanPurchases, c.status]).toEqual([["alerts@hdfcbank.net", "amazon.in"], false, "paused"]);
  await as.mutation(api.gmail.updateSettings, { paused: false });
  c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect(c.status).toBe("ok");
  // the pause switch never clears a reconnect
  await t.run((ctx) => ctx.db.patch(cid, { status: "reauth" }));
  await as.mutation(api.gmail.updateSettings, { paused: false });
  expect((await t.run((ctx) => ctx.db.get(cid)))!.status).toBe("reauth");
});

test("status shows the app a safe projection, and disconnecting removes the connection and the waiting drafts only", async () => {
  const { t, as, userId, accounts, connect, insert } = await setup();
  expect((await as.query(api.gmail.status))?.connected).toBe(false);
  await connect();
  const txId = await t.run((ctx) => ctx.db.insert("transactions", { userId, type: "expense", date: "2026-10-18", accountId: accounts[0]._id, amount: 48500, note: "Swiggy", tags: [], photoIds: [] }));
  await t.mutation(internal.gmail.writeSync, { userId, startedAt: 5, inserts: [insert("m1"), insert("m2", { matchedTransactionId: txId })], updates: [], learned: {}, aiCalls: 0, scanned: 2 });
  const [m1] = await t.run((ctx) => ctx.db.query("drafts").collect());
  await t.run((ctx) => ctx.db.patch(m1._id, { status: "accepted" }));
  const s = (await as.query(api.gmail.status))!;
  expect(s).toMatchObject({ connected: true, email: "me@gmail.com", status: "ok", open: 1, openUnmatched: 0, lastSyncAt: 5 });
  expect(JSON.stringify(s)).not.toContain("enc");
  await t.mutation(internal.gmail.removeConnection, { userId });
  expect(await t.run((ctx) => ctx.db.query("gmailConnections").collect())).toEqual([]);
  expect((await t.run((ctx) => ctx.db.query("drafts").collect())).map((d) => d.status)).toEqual(["accepted"]);
  expect((await as.query(api.gmail.status))?.connected).toBe(false);
});

test("the callback refuses a forged or stale state and sends a refusal back to Settings", async () => {
  const { t, userId } = await setup();
  const bad = await t.fetch("/gmail/callback?code=x&state=forged.30.1.sig");
  expect(bad.status).toBe(400);
  const payload = `${userId}.30.${Date.now()}`;
  const denied = await t.fetch(`/gmail/callback?error=access_denied&state=${payload}.${await sign(payload)}`);
  expect(denied.status).toBe(302);
  expect(denied.headers.get("Location")).toBe("https://app.test/settings/gmail?gmail=denied");
  const stale = `${userId}.30.${Date.now() - 11 * 60 * 1000}`;
  expect((await t.fetch(`/gmail/callback?code=x&state=${stale}.${await sign(stale)}`)).status).toBe(400);
});

test("the hourly check schedules one run per live connection", async () => {
  const { t, userId, connect } = await setup();
  await connect();
  const other = await t.run((ctx) => ctx.db.insert("users", { email: "b@example.com" }));
  await t.run((ctx) => ctx.db.insert("gmailConnections", { userId: other, email: "b@gmail.com", refreshTokenEnc: "e", iv: "i", status: "paused", lookbackDays: 7, senders: [], scanPurchases: true, accountMap: {}, aiMonth: "2026-10", aiCalls: 0, log: [] }));
  await t.mutation(internal.gmail.syncAll, {});
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.map((s) => [s.name, (s.args[0] as { userId: string }).userId])).toEqual([["gmail:syncUser", userId]]);
});
