/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
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

afterEach(() => { vi.useRealTimers(); });

type Listing = { messages?: { id: string }[]; nextPageToken?: string };
/**
 * Google as a check sees it: a token for the stored grant, then the mailbox's pages and its mails
 * (each a one-line note that is not about money). `calls` records every request's host and path.
 */
function fakeGoogle(list: (url: URL) => Listing | Promise<Listing>, receivedAt = 1) {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    calls.push(u.host + u.pathname + u.search);
    if (u.host === "oauth2.googleapis.com") return Response.json({ access_token: "at" });
    if (u.pathname.endsWith("/messages")) return Response.json(await list(u));
    const id = u.pathname.split("/").pop()!;
    return Response.json({ id, threadId: "t", internalDate: String(receivedAt), payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Someone <hi@example.com>" }, { name: "Subject", value: "Hello" }], body: { data: btoa("See you tomorrow") } } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

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
    t.mutation(internal.gmail.writeSync, { userId, startedAt: at, inserts, updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 12, ...extra });
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
  await t.mutation(internal.gmail.writeSync, { userId, startedAt: at, inserts: [], updates: [], matches: [], learned: { "hdfcbank.net|4521": accounts[0]._id }, aiCalls: 0, scanned: 0 });
  expect((await t.run((ctx) => ctx.db.get(cid)))!.accountMap).toEqual({ "hdfcbank.net|4521": accounts[0]._id });
});

test("a receipt folded into a draft stays seen once that draft is handled", async () => {
  const { t, userId, connect, insert } = await setup();
  await connect();
  const at = Date.parse("2026-10-20T10:00:00Z");
  await t.mutation(internal.gmail.writeSync, { userId, startedAt: at, inserts: [insert("alert", { extraMessageIds: ["receipt"] })], updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 2 });
  const seen = () => t.query(internal.gmail.seenMessageIds, { userId, ids: ["alert", "receipt", "new"] });
  expect(await seen()).toEqual(["alert", "receipt"]);
  for (const status of ["accepted", "dismissed"] as const) {
    await t.run(async (ctx) => { for (const d of await ctx.db.query("drafts").collect()) await ctx.db.patch(d._id, { status }); });
    expect(await seen()).toEqual(["alert", "receipt"]);
  }
});

test("mail that made no draft is not read again, and mail the AI skipped holds the window back", async () => {
  const { t, userId, connect } = await setup();
  const cid = await connect();
  const at = Date.parse("2026-10-20T10:00:00Z");
  const hour = 60 * 60 * 1000;
  const write = (startedAt: number, processed: { id: string; receivedAt: number }[], syncedUpTo?: number) =>
    t.mutation(internal.gmail.writeSync, { userId, startedAt, inserts: [], updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 0, processed, syncedUpTo });
  // "shipped" was not a payment; a mail the AI could not get to (the cap) arrived 35 days ago, so the
  // check holds syncedUpTo where the next window (it starts 30 days before) still reaches it
  const held = at - 35 * 24 * hour + 30 * 24 * hour;
  await write(at, [{ id: "shipped", receivedAt: at - hour }], held);
  let c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect(c.syncedUpTo).toBe(held);
  expect(await t.query(internal.gmail.seenMessageIds, { userId, ids: ["shipped", "other"] })).toEqual(["shipped"]);
  // 31 days on, no window reaches it: forgotten
  await write(at + 31 * 24 * hour, []);
  c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect([c.syncedUpTo, c.processed]).toEqual([at + 31 * 24 * hour, []]);
});

test("a check matches open drafts to entries typed in since, but never undoes \"no, it's new\"", async () => {
  const { t, userId, accounts, connect, insert } = await setup();
  await connect();
  const typed = (extra: Partial<Doc<"transactions">> = {}) => t.run((ctx) => ctx.db.insert("transactions", { userId, type: "expense", date: "2026-10-18", accountId: accounts[0]._id, amount: 48500, note: "Swiggy", tags: [], photoIds: [], ...extra }));
  const write = (matches: { id: Id<"drafts">; transactionId: Id<"transactions"> }[], inserts: ReturnType<typeof insert>[] = []) =>
    t.mutation(internal.gmail.writeSync, { userId, startedAt: 5, inserts, updates: [], matches, learned: {}, aiCalls: 0, scanned: 0 });
  await write([], [insert("m1"), insert("m2"), insert("m3"), insert("m4")]);
  const [m1, m2, m3, m4] = await t.run((ctx) => ctx.db.query("drafts").collect());
  const tx = await typed();
  const fromMail = await typed({ source: { app: "gmail", messageId: "x" } });
  // while the check ran: m2 was kept as new, m3 was saved
  await t.run(async (ctx) => {
    await ctx.db.patch(m2._id, { keptNew: true });
    await ctx.db.patch(m3._id, { status: "accepted" });
  });
  await write([{ id: m1._id, transactionId: tx }, { id: m2._id, transactionId: tx }, { id: m3._id, transactionId: tx }, { id: m4._id, transactionId: fromMail }]);
  const after = await t.run((ctx) => ctx.db.query("drafts").collect());
  expect(after.map((d) => [d.messageId, d.matchedTransactionId])).toEqual([["m1", tx], ["m2", undefined], ["m3", undefined], ["m4", undefined]]);
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

test("a new look-back counts from when it was chosen, and senders can be cleared", async () => {
  const { t, as, connect } = await setup();
  const cid = await connect();
  const before = Date.now();
  await as.mutation(api.gmail.updateSettings, { lookbackDays: 90, senders: [] });
  let c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect(c.lookbackDays).toBe(90);
  expect(c.readsFrom! - (before - 90 * 24 * 60 * 60 * 1000)).toBeGreaterThanOrEqual(0);
  expect(c.senders).toEqual([]);
  // "from now on" stops reading what is already in the inbox
  await as.mutation(api.gmail.updateSettings, { lookbackDays: 0 });
  c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect(c.readsFrom!).toBeGreaterThanOrEqual(before);
});

test("status shows the app a safe projection, and disconnecting removes the connection and the waiting drafts only", async () => {
  const { t, as, userId, accounts, connect, insert } = await setup();
  expect((await as.query(api.gmail.status))?.connected).toBe(false);
  await connect();
  const txId = await t.run((ctx) => ctx.db.insert("transactions", { userId, type: "expense", date: "2026-10-18", accountId: accounts[0]._id, amount: 48500, note: "Swiggy", tags: [], photoIds: [] }));
  await t.mutation(internal.gmail.writeSync, { userId, startedAt: 5, inserts: [insert("m1"), insert("m2", { matchedTransactionId: txId })], updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 2 });
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

test("one check at a time: a run while another holds the connection is a no-op, and a failed or dead run frees it", async () => {
  const { t, as, userId, connect } = await setup();
  process.env.AUTH_GOOGLE_ID = "id";
  process.env.AUTH_GOOGLE_SECRET = "secret";
  const { enc, iv } = await encryptText("1//refresh-token");
  const cid = await connect({ refreshTokenEnc: enc, iv });
  const connection = () => t.run((ctx) => ctx.db.get(cid)).then((c) => c!);
  const run = () => t.action(internal.gmail.syncUser, { userId });

  // the first run is at Gmail's door when a second one (the cron, say) comes along
  let atGmail!: () => void, release!: () => void;
  const reached = new Promise<void>((r) => { atGmail = r; });
  const gate = new Promise<void>((r) => { release = r; });
  const g = fakeGoogle(async () => { atGmail(); await gate; return { messages: [] }; });
  try {
    const first = run();
    await reached;
    expect((await connection()).syncingSince).toBeDefined();
    expect((await as.query(api.gmail.status))!.syncing).toBe(true);
    const before = g.calls.length;
    expect(await run()).toEqual({ ran: false });
    expect(g.calls.length).toBe(before);
    release();
    expect(await first).toEqual({ ran: true, found: 0 });
  } finally { g.restore(); }
  let c = await connection();
  expect([c.syncingSince, c.log.length]).toEqual([undefined, 1]);
  expect((await as.query(api.gmail.status))!.syncing).toBe(false);

  // a claim older than the longest a run can live is a run that died: the next one takes over
  await t.run((ctx) => ctx.db.patch(cid, { syncingSince: Date.now() - 9 * 60 * 1000 }));
  expect(await run()).toEqual({ ran: false });
  await t.run((ctx) => ctx.db.patch(cid, { syncingSince: Date.now() - 11 * 60 * 1000 }));
  const g2 = fakeGoogle(() => { throw new Error("boom"); });
  try {
    // and a run that fails lets go as well
    expect(await run()).toEqual({ ran: true, error: "boom" });
  } finally { g2.restore(); }
  c = await connection();
  expect([c.syncingSince, c.status, c.lastError]).toEqual([undefined, "ok", "boom"]);
  const g3 = fakeGoogle(() => ({ messages: [] }));
  try {
    expect(await run()).toEqual({ ran: true, found: 0 });
  } finally { g3.restore(); }
  // paused connections are never claimed
  await t.run((ctx) => ctx.db.patch(cid, { status: "paused" }));
  expect(await run()).toEqual({ ran: false });
  expect((await connection()).syncingSince).toBeUndefined();
});

test("a check pages past the mail it has seen, reads the newest 300 of the rest, and holds the window for the others", async () => {
  const { t, userId, connect, insert } = await setup();
  process.env.AUTH_GOOGLE_ID = "id";
  process.env.AUTH_GOOGLE_SECRET = "secret";
  const { enc, iv } = await encryptText("1//refresh-token");
  const hour = 60 * 60 * 1000;
  const now = Date.now();
  const cid = await connect({ refreshTokenEnc: enc, iv, syncedUpTo: now - 2 * hour });
  // seen already: two drafts (one with a receipt folded in) and a mail read as not money
  await t.mutation(internal.gmail.writeSync, {
    userId, startedAt: now - 2 * hour, inserts: [insert("d1", { extraMessageIds: ["x1"] }), insert("d2")], updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 3,
    processed: [{ id: "p1", receivedAt: now - 3 * hour }], syncedUpTo: now - 2 * hour,
  });
  const fresh = Array.from({ length: 305 }, (_, i) => `f${i + 1}`);
  const pages: Record<string, Listing> = {
    "": { messages: ["d1", "x1", "p1", ...fresh.slice(0, 150)].map((id) => ({ id })), nextPageToken: "pg2" },
    pg2: { messages: ["d2", ...fresh.slice(150)].map((id) => ({ id })) },
  };
  const g = fakeGoogle((u) => pages[u.searchParams.get("pageToken") ?? ""], now - hour);
  // the fetches are paced with real waits; fake time runs them in an instant
  vi.useFakeTimers({ now });
  try {
    let settled = false;
    const run = t.action(internal.gmail.syncUser, { userId }).finally(() => { settled = true; });
    while (!settled) await vi.advanceTimersByTimeAsync(1000);
    expect(await run).toEqual({ ran: true, found: 0 });
  } finally { vi.useRealTimers(); g.restore(); }
  expect(g.calls.filter((c) => c.includes("/messages?")).map((c) => new URL(`https://${c}`).searchParams.get("pageToken"))).toEqual([null, "pg2"]);
  // the seen ones on either page were not fetched; the 5 oldest unread wait for the next check
  expect(g.calls.flatMap((c) => c.match(/\/messages\/([^?]+)/)?.[1] ?? [])).toEqual(fresh.slice(0, 300));
  const c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect(c.log[0]).toMatchObject({ scanned: 309, found: 0, note: "5 older mails waiting" });
  // the window stays where this check's started (not moved up to now), so the next one reaches them
  expect(c.syncedUpTo).toBe(now - 2 * hour);
  expect(c.syncingSince).toBeUndefined();
  // what was read and made no draft is not read again
  expect(await t.query(internal.gmail.seenMessageIds, { userId, ids: ["f1", "f300", "f301", "p1"] })).toEqual(["f1", "f300", "p1"]);
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

test("connecting records where reading may start: now for \"from now on\", the look-back before it otherwise", async () => {
  const { t, userId } = await setup();
  const before = Date.now();
  await t.mutation(internal.gmail.saveConnection, { userId, email: "me@gmail.com", refreshTokenEnc: "e", iv: "i", lookbackDays: 0 });
  const c = (await t.run((ctx) => ctx.db.query("gmailConnections").unique()))!;
  expect(c.lookbackDays).toBe(0);
  expect(c.readsFrom).toBeGreaterThanOrEqual(before);
  // reconnecting the same mailbox with a look-back moves the start back with it
  await t.mutation(internal.gmail.saveConnection, { userId, email: "me@gmail.com", refreshTokenEnc: "e2", iv: "i2", lookbackDays: 7 });
  const again = (await t.run((ctx) => ctx.db.get(c._id)))!;
  expect(again.readsFrom).toBeLessThanOrEqual(Date.now() - 7 * 24 * 60 * 60 * 1000);
});

test("a callback whose Gmail call is refused for setup reasons says which, instead of a bare error", async () => {
  const { t, userId } = await setup();
  process.env.AUTH_GOOGLE_ID = "id";
  process.env.AUTH_GOOGLE_SECRET = "secret";
  const payload = `${userId}.30.${Date.now()}`;
  const state = `${payload}.${await sign(payload)}`;
  const real = globalThis.fetch;
  const answer = (scope: string, gmail: Response) => async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at", refresh_token: "rt", scope });
    if (u.startsWith("https://gmail.googleapis.com/")) return gmail;
    return real(input as RequestInfo);
  };
  const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";
  const run = async (fake: typeof fetch) => {
    globalThis.fetch = fake;
    try { return (await t.fetch(`/gmail/callback?code=c&state=${state}`)).headers.get("Location"); } finally { globalThis.fetch = real; }
  };
  // the Gmail API is switched off in the Cloud project
  expect(await run(answer(`openid ${gmailScope}`, Response.json({ error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "accessNotConfigured" }] } }, { status: 403 })) as typeof fetch))
    .toBe("https://app.test/settings/gmail?gmail=api-off");
  // the user left Gmail unticked on the consent screen
  expect(await run(answer("openid email", Response.json({}, { status: 403 })) as typeof fetch)).toBe("https://app.test/settings/gmail?gmail=no-scope");
  expect(await t.run((ctx) => ctx.db.query("gmailConnections").collect())).toEqual([]);
});

test("a grant from Google attaches only to the account that started connecting, once", async () => {
  const { t, userId } = await setup();
  process.env.AUTH_GOOGLE_ID = "id";
  process.env.AUTH_GOOGLE_SECRET = "secret";
  const attacker = await t.run((ctx) => ctx.db.insert("users", { email: "attacker@example.com" }));
  const real = globalThis.fetch;
  const google = (async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at", refresh_token: "rt", scope: "https://www.googleapis.com/auth/gmail.readonly" });
    if (u.startsWith("https://gmail.googleapis.com/")) return Response.json({ emailAddress: "victim@gmail.com" });
    return real(input as RequestInfo);
  }) as typeof fetch;
  /** The victim's browser coming back from Google with a link the given account started. */
  const consent = async (startedBy: Id<"users">) => {
    const payload = `${startedBy}.30.${Date.now()}`;
    globalThis.fetch = google;
    try {
      const location = (await t.fetch(`/gmail/callback?code=c&state=${payload}.${await sign(payload)}`)).headers.get("Location")!;
      expect(location).toMatch(/^https:\/\/app\.test\/settings\/gmail\?gmail=claim&claim=/);
      return new URL(location).searchParams.get("claim")!;
    } finally { globalThis.fetch = real; }
  };
  const victim = t.withIdentity({ subject: `${userId}|session` });
  const connections = () => t.run((ctx) => ctx.db.query("gmailConnections").collect());

  // the attacker sent the victim their own connect link: the victim's mailbox lands nowhere
  expect(await victim.mutation(api.gmail.claimConnection, { claim: await consent(attacker) })).toBe("other-account");
  expect(await connections()).toEqual([]);
  // nor can the attacker claim it: the claim went to the victim's browser, and it is used up
  expect(await t.run((ctx) => ctx.db.query("gmailPending").collect())).toEqual([]);

  const claim = await consent(userId);
  expect(await victim.mutation(api.gmail.claimConnection, { claim })).toBe("connected");
  expect((await connections()).map((c) => [c.userId, c.email])).toEqual([[userId, "victim@gmail.com"]]);
  expect(await victim.mutation(api.gmail.claimConnection, { claim })).toBe("expired");

  // the account's own mailbox (same address as its sign-in) attaches straight away, as before
  await t.run(async (ctx) => { for (const c of await ctx.db.query("gmailConnections").collect()) await ctx.db.delete(c._id); });
  await t.run((ctx) => ctx.db.patch(userId, { email: "Victim@gmail.com" }));
  const payload = `${userId}.30.${Date.now()}`;
  globalThis.fetch = google;
  try {
    expect((await t.fetch(`/gmail/callback?code=c&state=${payload}.${await sign(payload)}`)).headers.get("Location")).toBe("https://app.test/settings/gmail?gmail=connected");
  } finally { globalThis.fetch = real; }
  expect((await connections()).map((c) => [c.userId, c.email])).toEqual([[userId, "victim@gmail.com"]]);
  expect(await t.run((ctx) => ctx.db.query("gmailPending").collect())).toEqual([]);
});

test("a check can turn a draft into the transfer its other side shows, and keeps what it learned about merchants", async () => {
  const { t, as, userId, accounts, connect, insert } = await setup();
  const cid = await connect();
  const [cash, bank] = accounts;
  const at = Date.parse("2026-10-20T10:00:00Z");
  await t.mutation(internal.gmail.writeSync, { userId, startedAt: at, inserts: [insert("m1", { merchant: "NEFT ICICI" })], updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 1 });
  const [d] = await t.run((ctx) => ctx.db.query("drafts").collect());
  expect(d.merchant).toBe("NEFT ICICI");
  const food = ((await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[]).find((c) => c.name === "Food")!._id;
  await t.mutation(internal.gmail.writeSync, {
    userId, startedAt: at, inserts: [], matches: [], learned: {}, aiCalls: 0, scanned: 1,
    updates: [{ id: d._id, extraMessageIds: ["m2"], transfer: { accountId: cash._id, toAccountId: bank._id } }],
    learnedMerchants: { paytmqr2812: { note: "Chai stall", categoryId: food } },
  });
  const after = (await t.run((ctx) => ctx.db.get(d._id)))!;
  expect([after.proposal.type, after.proposal.accountId, after.proposal.toAccountId, after.proposal.categoryId, after.extraMessageIds]).toEqual(["transfer", cash._id, bank._id, undefined, ["m2"]]);
  expect(after.proposal.description).toContain("paired with the other side's mail");
  expect((await t.run((ctx) => ctx.db.get(cid)))!.merchantMap).toEqual({ paytmqr2812: { note: "Chai stall", categoryId: food } });
});

test("muting a sender takes it off the allowlist and shows in status; unmuting brings it back to the search only", async () => {
  const { t, as, connect } = await setup();
  const cid = await connect({ senders: ["hdfcbank.net", "offers@swiggy.in"] });
  await as.mutation(api.gmail.muteSender, { from: "Swiggy Offers <Offers@Swiggy.in>", muted: true });
  let c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect([c.muted, c.senders]).toEqual([["offers@swiggy.in"], ["hdfcbank.net"]]);
  expect((await as.query(api.gmail.status))!.muted).toEqual(["offers@swiggy.in"]);
  await as.mutation(api.gmail.muteSender, { from: "offers@swiggy.in", muted: false });
  c = (await t.run((ctx) => ctx.db.get(cid)))!;
  expect([c.muted, c.senders]).toEqual([[], ["hdfcbank.net"]]);
  await expect(as.mutation(api.gmail.muteSender, { from: "swiggy.in", muted: true })).rejects.toThrow(/mail address/);
});

test("releasing folded mail frees what open drafts absorbed, but not paired transfers or handled drafts", async () => {
  const { t, userId, connect, insert } = await setup();
  await connect();
  await t.mutation(internal.gmail.writeSync, {
    userId, startedAt: 1, updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 3,
    inserts: [
      insert("a", { extraMessageIds: ["a2", "a3"] }),
      insert("b", { extraMessageIds: ["b2"], proposal: { type: "transfer" as const, date: "2026-10-18", amount: 100, note: "", description: "paired with the other side's mail" } }),
      insert("c", { extraMessageIds: ["c2"] }),
      insert("z", { extraMessageIds: ["z2"], proposal: { type: "expense" as const, date: "2026-10-03", amount: 0, note: "Ijooz", subAmount: 250, subCurrency: "SGD" } }),
    ],
  });
  const c = (await t.run((ctx) => ctx.db.query("drafts").collect())).find((d) => d.messageId === "c")!;
  await t.run((ctx) => ctx.db.patch(c._id, { status: "accepted" }));
  expect(await t.mutation(internal.gmail.releaseFolded, { userId })).toEqual({ drafts: 1, mails: 2, unpriced: 1 });
  // the ₹0 draft is gone, so its mails are read again
  expect(await t.query(internal.gmail.seenMessageIds, { userId, ids: ["a2", "a3", "b2", "c2", "z", "z2"] })).toEqual(["b2", "c2"]);
});

test("rebuilding removes waiting drafts and forgets \"not money\" mail, keeping handled drafts and \"it's new\" ones", async () => {
  const { t, userId, connect, insert } = await setup();
  await connect();
  await t.mutation(internal.gmail.writeSync, {
    userId, startedAt: 1, updates: [], matches: [], learned: {}, aiCalls: 0, scanned: 4, processed: [{ id: "otp", receivedAt: 1 }],
    inserts: [insert("a"), insert("b"), insert("c")],
  });
  const all = await t.run((ctx) => ctx.db.query("drafts").collect());
  await t.run(async (ctx) => {
    await ctx.db.patch(all.find((d) => d.messageId === "b")!._id, { status: "accepted" });
    await ctx.db.patch(all.find((d) => d.messageId === "c")!._id, { keptNew: true });
  });
  expect(await t.mutation(internal.gmail.rebuildOpenDrafts, { userId })).toEqual({ removed: 1, forgotten: 1 });
  expect(await t.query(internal.gmail.seenMessageIds, { userId, ids: ["a", "b", "c", "otp"] })).toEqual(["b", "c"]);
});
