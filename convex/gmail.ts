/**
 * Gmail sync (docs/specs/gmail-sync.md). The user connects their Gmail once, through a consent
 * screen separate from sign-in. From then on an hourly check (and "Check now") searches their
 * mailbox for money mail, reads each new mail with the rules in shared/gmail (and Claude for the
 * rest), and writes draft entries. Mail bodies and tokens exist only inside the actions here:
 * the refresh token is stored encrypted, drafts keep ids and the extracted fields, never the mail.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, httpAction, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { FunctionReturnType } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { requireUser } from "./lib/auth";
import { currentRev, deleteSynced, insertSynced, patchSynced } from "./lib/changes";
import { decryptText, encryptText, hasTokenKey, sign, verify } from "./lib/gmailCrypto";
import * as gmailApi from "./lib/gmailApi";
import { GmailAuthError, GmailSetupError, SCOPE } from "./lib/gmailApi";
import { addDays } from "../shared/dates";
import { clean } from "../shared/ops";
import type { Mail } from "../shared/gmail/mail";
import { triage } from "../shared/gmail/triage";
import { parseMail } from "../shared/gmail/rules";
import { latestRates } from "./lib/fxFeed";
import { accountMapKey, noteOf, resolveParsed, type ResolveCtx } from "../shared/gmail/resolve";
import { foldDrafts, laterMatches, matchEntry, samePayment, type DraftCandidate } from "../shared/gmail/dedup";
import { buildQuery, DEFAULT_SENDERS, LOOKBACKS, matchesSender, normaliseSender, readsFromFor, spanMs, windowStart, withNewDefaults, type Lookback } from "../shared/gmail/query";
import { applyMerchantMemory, learnMerchants, mergeMerchants, type MerchantMemory } from "../shared/gmail/learn";
import { PAIRED_NOTE } from "../shared/gmail/dedup";
import { senderAddress } from "../shared/gmail/mail";
import { AI_BATCH, AI_MODEL, AI_MONTHLY_CAP, buildAiInput, lowerConfidence, OUTPUT_SCHEMA, SYSTEM_PROMPT, validateAiResults, type AiRead } from "../shared/gmail/ai";

type Connection = Doc<"gmailConnections">;
/** Mails one check reads; the rest of the window waits for the next one. */
const SYNC_MAX = 300;
/** A check holds the connection at most this long: Convex ends an action after 10 minutes, so an older claim is a run that died. */
const LEASE_MS = 10 * 60 * 1000;
/** How many checks the log keeps, and after how many failures in a row a connection pauses itself. */
const LOG_KEEP = 10;
const PAUSE_AFTER_FAILURES = 3;
/** "Check now" at most this often. */
const MANUAL_EVERY_MS = 60 * 1000;
/** The OAuth state is good for this long. */
const STATE_TTL_MS = 10 * 60 * 1000;
/** Past entries with a mail's merchant as their note that a check looks at: for the category it had last time, and the purchase a refund returns. */
const SAME_NOTE_MAX = 50;
/** Saved drafts this far before a check's window are looked at for the other mail of a payment already saved. */
const SAVED_SLACK_MS = 7 * 24 * 60 * 60 * 1000;
/** gmailSeen rows this far before the start of the next check's window are dropped: past the longest look-back, with room to spare. */
const SEEN_KEEP_MS = 120 * 24 * 60 * 60 * 1000;
const MAX_SENDERS = 100;
/** Mails fetched in parallel, and the least time each such batch takes: 3 per 300 ms is 50 quota units a second. */
const FETCH_AT_ONCE = 3;
const FETCH_BATCH_MS = 300;

const lookbackArg = v.union(...LOOKBACKS.map((d) => v.literal(d)));
const redirectUri = () => `${process.env.CONVEX_SITE_URL}/gmail/callback`;
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
/** Whether a check is running on this connection (claimed, and not so long ago that it must have died). */
const syncing = (c: Pick<Connection, "syncingSince">, now: number) => c.syncingSince !== undefined && now - c.syncingSince < LEASE_MS;

// ---------- what the app sees ----------

/** The connection without its secrets, plus how many drafts wait; null when Gmail is not connected. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const open = await ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open")).collect();
    const month = monthOf(Date.now());
    return {
      connected: !!c,
      configured: hasTokenKey(),
      email: c?.email ?? null,
      status: c?.status ?? null,
      syncing: !!c && syncing(c, Date.now()),
      lastSyncAt: c?.lastSyncAt ?? null,
      lastError: c?.lastError ?? null,
      lookbackDays: (c?.lookbackDays ?? 30) as Lookback,
      readsFrom: c?.readsFrom ?? null,
      syncedUpTo: c?.syncedUpTo ?? null,
      senders: c?.senders ?? DEFAULT_SENDERS,
      muted: c?.muted ?? [],
      scanPurchases: c?.scanPurchases ?? true,
      log: c?.log ?? [],
      aiCalls: c && c.aiMonth === month ? c.aiCalls : 0,
      aiCap: AI_MONTHLY_CAP,
      open: open.length,
      openUnmatched: open.filter((d) => !d.matchedTransactionId).length,
    };
  },
});

// ---------- connecting ----------

/** The signed-in user's address, to pre-fill Google's account chooser. */
export const signInEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => (await ctx.db.get(userId))?.email ?? undefined,
});

/**
 * Where to send the browser to connect Gmail. The state carries who started it and the lookback
 * they chose, signed, so the callback can trust it without a table.
 */
export const connectUrl = action({
  args: { lookbackDays: lookbackArg },
  handler: async (ctx, { lookbackDays }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    if (!hasTokenKey()) throw new ConvexError("Gmail sync isn't set up on this server yet");
    const payload = `${userId}.${lookbackDays}.${Date.now()}`;
    const state = `${payload}.${await sign(payload)}`;
    const loginHint = await ctx.runQuery(internal.gmail.signInEmail, { userId });
    return gmailApi.authUrl({ redirectUri: redirectUri(), state, loginHint: loginHint ?? undefined });
  },
});

async function readState(state: string): Promise<{ userId: Id<"users">; lookbackDays: Lookback } | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, lookback, ts, sig] = parts;
  const payload = `${userId}.${lookback}.${ts}`;
  if (!(await verify(payload, sig))) return null;
  if (!Number.isFinite(Number(ts)) || Date.now() - Number(ts) > STATE_TTL_MS) return null;
  const lookbackDays = Number(lookback) as Lookback;
  if (!LOOKBACKS.includes(lookbackDays)) return null;
  return { userId: userId as Id<"users">, lookbackDays };
}

/**
 * GET /gmail/callback?code&state, from Google. Ends on the settings page with ?gmail=connected |
 * denied | error | …, or ?gmail=claim&claim=… for the app to attach a mailbox that isn't the
 * account's own address (claimConnection). The state says
 * which account started connecting, but anyone can be sent that account's Google link: only the
 * signed-in app that started it can claim the grant.
 */
export const callback = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const back = (outcome: string) => new Response(null, { status: 302, headers: { Location: `${process.env.SITE_URL ?? ""}/settings/gmail?gmail=${outcome}` } });
  const state = await readState(url.searchParams.get("state") ?? "");
  if (!state) return new Response("This link has expired. Start again from Settings › Gmail.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  if (!code) return back("error");
  try {
    const tokens = await gmailApi.exchangeCode(code, redirectUri());
    // Google's consent screen lets the user untick Gmail and still continue
    if (tokens.scopes.length && !tokens.scopes.includes(SCOPE)) return back("no-scope");
    if (!tokens.refreshToken) throw new Error("Google returned no refresh token");
    const { email } = await gmailApi.profile(tokens.accessToken);
    const { enc, iv } = await encryptText(tokens.refreshToken);
    // The account's own mailbox can't be someone else's: attach it now, as before (an app still on
    // the previous version only knows ?gmail=connected). Another mailbox waits for this browser's claim.
    const signedInAs = await ctx.runQuery(internal.gmail.signInEmail, { userId: state.userId });
    if (signedInAs && signedInAs.toLowerCase() === email.toLowerCase()) {
      await ctx.runMutation(internal.gmail.saveConnection, { userId: state.userId, email, refreshTokenEnc: enc, iv, lookbackDays: state.lookbackDays });
      await ctx.scheduler.runAfter(0, internal.gmail.syncUser, { userId: state.userId });
      return back("connected");
    }
    const claim = crypto.randomUUID();
    await ctx.runMutation(internal.gmail.holdConnection, { userId: state.userId, claim, email, refreshTokenEnc: enc, iv, lookbackDays: state.lookbackDays });
    return back(`claim&claim=${claim}`);
  } catch (e) {
    console.error("gmail connect failed", e instanceof Error ? e.message : e);
    return back(e instanceof GmailSetupError ? e.kind : "error");
  }
});

/** A grant back from Google, until the app that started connecting claims it (or 10 minutes pass). */
export const holdConnection = internalMutation({
  args: { userId: v.id("users"), claim: v.string(), email: v.string(), refreshTokenEnc: v.string(), iv: v.string(), lookbackDays: lookbackArg },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("gmailPending", args);
    await ctx.scheduler.runAfter(STATE_TTL_MS, internal.gmail.dropPending, { id });
  },
});

export const dropPending = internalMutation({
  args: { id: v.id("gmailPending") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});

/** The app, back from Google: attach the mailbox if this is the account that started connecting. */
export const claimConnection = mutation({
  args: { claim: v.string() },
  handler: async (ctx, { claim }): Promise<"connected" | "expired" | "other-account"> => {
    const userId = await requireUser(ctx);
    const p = await ctx.db.query("gmailPending").withIndex("by_claim", (q) => q.eq("claim", claim)).unique();
    if (!p) return "expired";
    await ctx.db.delete(p._id);
    // someone sent this user a link that another account started: never attach their mail there
    if (p.userId !== userId) return "other-account";
    await saveConnectionFor(ctx, { userId, email: p.email, refreshTokenEnc: p.refreshTokenEnc, iv: p.iv, lookbackDays: p.lookbackDays });
    await ctx.scheduler.runAfter(0, internal.gmail.syncUser, { userId });
    return "connected";
  },
});

/** A new connection, or the existing one's token replaced (a reconnect keeps its senders and what it learned). */
export const saveConnection = internalMutation({
  args: { userId: v.id("users"), email: v.string(), refreshTokenEnc: v.string(), iv: v.string(), lookbackDays: lookbackArg },
  handler: (ctx, args) => saveConnectionFor(ctx, args),
});

async function saveConnectionFor(ctx: MutationCtx, { userId, email, refreshTokenEnc, iv, lookbackDays }: { userId: Id<"users">; email: string; refreshTokenEnc: string; iv: string; lookbackDays: number }) {
  if (!(await ctx.db.get(userId))) return;
  const readsFrom = readsFromFor(lookbackDays, Date.now());
  const old = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (old) {
    // a different mailbox is a fresh start; the same one picks up where it left off
    const same = old.email.toLowerCase() === email.toLowerCase();
    await ctx.db.patch(old._id, {
      email, refreshTokenEnc, iv, lookbackDays, readsFrom, status: "ok", lastError: undefined,
      syncedUpTo: same ? old.syncedUpTo : undefined, accountMap: same ? old.accountMap : {},
    });
    return;
  }
  await ctx.db.insert("gmailConnections", {
    userId, email, refreshTokenEnc, iv, status: "ok", lookbackDays, readsFrom, senders: DEFAULT_SENDERS, scanPurchases: true, accountMap: {},
    aiMonth: monthOf(Date.now()), aiCalls: 0, log: [],
  });
}

export const connectionOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
});

/** Senders, Purchases, lookback and pause, from the settings page. */
export const updateSettings = mutation({
  args: { senders: v.optional(v.array(v.string())), scanPurchases: v.optional(v.boolean()), lookbackDays: v.optional(lookbackArg), paused: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!c) throw new ConvexError("Gmail is not connected");
    const patch: Partial<Connection> = {};
    if (args.senders) patch.senders = [...new Set(args.senders.map(normaliseSender).filter(Boolean))].slice(0, MAX_SENDERS);
    if (args.scanPurchases !== undefined) patch.scanPurchases = args.scanPurchases;
    // a new look-back counts from now: a longer one reaches older mail, "from now on" stops reading it
    if (args.lookbackDays !== undefined) Object.assign(patch, { lookbackDays: args.lookbackDays, readsFrom: readsFromFor(args.lookbackDays, Date.now()) });
    if (args.paused === true && c.status === "ok") patch.status = "paused";
    if (args.paused === false && c.status === "paused") { patch.status = "ok"; patch.lastError = undefined; }
    await ctx.db.patch(c._id, patch);
  },
});

/**
 * "Not money mail from this sender" (the review list), or bringing a sender back (Settings): a muted
 * address is left out of the search and never read. It comes off the allowlist too when it is on it
 * by that exact address. The review page dismisses its open drafts itself, as ops.
 */
export const muteSender = mutation({
  args: { from: v.string(), muted: v.boolean() },
  handler: async (ctx, { from, muted }) => {
    const userId = await requireUser(ctx);
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!c) throw new ConvexError("Gmail is not connected");
    const address = normaliseSender(senderAddress(from));
    if (!address.includes("@")) throw new ConvexError("That isn't a mail address");
    const list = new Set(c.muted ?? []);
    if (muted) list.add(address);
    else list.delete(address);
    await ctx.db.patch(c._id, { muted: [...list].slice(-MAX_SENDERS), ...(muted ? { senders: c.senders.filter((s) => s !== address) } : {}) });
  },
});

/**
 * One-off, after DEFAULT_SENDERS grows: give every existing connection the new defaults, since
 * a connection keeps the list it was made with. It only adds: every default missing from a list is
 * appended (a default the user once removed comes back too), and nothing the user added is touched.
 * Run with `npx convex run gmail:addNewDefaultSenders` (add --prod for production).
 */
export const addNewDefaultSenders = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ connections: number; updated: number }> => {
    const all = await ctx.db.query("gmailConnections").collect();
    let updated = 0;
    for (const c of all) {
      const senders = withNewDefaults(c.senders).slice(0, MAX_SENDERS);
      if (senders.length === c.senders.length) continue;
      await ctx.db.patch(c._id, { senders });
      updated++;
    }
    return { connections: all.length, updated };
  },
});

/** Forget the grant at Google, the connection and every draft still waiting. Saved entries keep their link to the mail. */
export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    const c = await ctx.runQuery(internal.gmail.connectionOf, { userId });
    if (c) {
      try {
        await gmailApi.revoke(await decryptText(c.refreshTokenEnc, c.iv));
      } catch (e) {
        console.warn("gmail revoke skipped", e instanceof Error ? e.message : e);
      }
    }
    await ctx.runMutation(internal.gmail.removeConnection, { userId });
  },
});

export const removeConnection = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    for (const c of await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(c._id);
    for (const d of await ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open")).collect()) await deleteSynced(ctx, userId, "drafts", d._id);
    // a new connection fills this again from the drafts left (seenFilled), so the waiting ones just removed are read again
    await ctx.scheduler.runAfter(0, internal.gmail.forgetAllSeen, { userId, before: Date.now() });
  },
});

/** Revoke a user's grant when they delete their account (account.ts), before the purge removes the row. */
export const revokeForUser = internalAction({
  args: { refreshTokenEnc: v.string(), iv: v.string() },
  handler: async (_ctx, { refreshTokenEnc, iv }) => {
    try {
      await gmailApi.revoke(await decryptText(refreshTokenEnc, iv));
    } catch (e) {
      console.warn("gmail revoke skipped", e instanceof Error ? e.message : e);
    }
  },
});

// ---------- checking the mailbox ----------

/** Hourly cron: every live connection gets its own check, spread over a few minutes. */
export const syncAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("gmailConnections").collect();
    let i = 0;
    for (const c of all) if (c.status === "ok") await ctx.scheduler.runAfter(i++ * 3000, internal.gmail.syncUser, { userId: c.userId });
  },
});

/** "Check now" from the settings page or the app coming to the front. At most once a minute; says whether it ran. */
export const syncNow = action({
  args: {},
  handler: async (ctx): Promise<{ ran: boolean; found?: number; error?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    const c = await ctx.runQuery(internal.gmail.connectionOf, { userId });
    if (!c) throw new ConvexError("Gmail is not connected");
    if (c.status === "reauth") throw new ConvexError("Gmail needs reconnecting");
    if (c.status === "paused") throw new ConvexError("Gmail checks are paused");
    if (c.lastSyncAt && Date.now() - c.lastSyncAt < MANUAL_EVERY_MS) return { ran: false };
    return ctx.runAction(internal.gmail.syncUser, { userId });
  },
});

/**
 * The start of a check claims the connection, so the hourly check, "Check now" and the first check
 * after connecting never run at once; false when another run holds it or the connection is not live.
 */
export const claimSync = internalMutation({
  args: { userId: v.id("users"), startedAt: v.number() },
  handler: async (ctx, { userId, startedAt }): Promise<boolean> => {
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!c || c.status !== "ok" || syncing(c, startedAt)) return false;
    if (!c.seenFilled) {
      // once per connection: what the drafts and the old `processed` list knew, as gmailSeen rows
      const rows: SeenRow[] = (c.processed ?? []).map((p) => ({ messageId: p.id, receivedAt: p.receivedAt, processed: true }));
      for (const d of await ctx.db.query("drafts").withIndex("by_user", (q) => q.eq("userId", userId)).collect()) rows.push(...seenOfDraft(d));
      await markSeen(ctx, userId, rows);
    }
    await ctx.db.patch(c._id, { syncingSince: startedAt, ...(c.seenFilled ? {} : { seenFilled: true, processed: undefined }) });
    return true;
  },
});

type SeenRow = { messageId: string; receivedAt: number; processed?: boolean };

/** A draft's mails: its own and the ones folded into it. */
function seenOfDraft(d: Pick<Doc<"drafts">, "messageId" | "extraMessageIds" | "receivedAt">): SeenRow[] {
  return [d.messageId, ...d.extraMessageIds].map((messageId) => ({ messageId, receivedAt: d.receivedAt }));
}

/** Remember these mails as dealt with; ones already remembered are left as they are. */
async function markSeen(ctx: MutationCtx, userId: Id<"users">, rows: SeenRow[]) {
  const done = new Set<string>();
  for (const r of rows) {
    if (done.has(r.messageId)) continue;
    done.add(r.messageId);
    const had = await ctx.db.query("gmailSeen").withIndex("by_user_message", (q) => q.eq("userId", userId).eq("messageId", r.messageId)).first();
    if (!had) await ctx.db.insert("gmailSeen", { userId, ...r });
  }
}

/** Forget these mails, so the next check reads them again. */
async function forgetSeen(ctx: MutationCtx, userId: Id<"users">, messageIds: string[]) {
  for (const messageId of new Set(messageIds)) {
    for (const r of await ctx.db.query("gmailSeen").withIndex("by_user_message", (q) => q.eq("userId", userId).eq("messageId", messageId)).collect()) await ctx.db.delete(r._id);
  }
}

/**
 * Forget every mail of a user's (or only those that made no draft) remembered before `before`, a
 * page at a time: a user's rows can outgrow one mutation. Rows written after `before` (a new
 * connection filling them again) are kept.
 */
export const forgetAllSeen = internalMutation({
  args: { userId: v.id("users"), before: v.number(), processedOnly: v.optional(v.boolean()), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { userId, before, processedOnly, cursor = null }): Promise<number> => {
    const res = await ctx.db.query("gmailSeen").withIndex("by_user_message", (q) => q.eq("userId", userId)).paginate({ numItems: 1000, cursor });
    let forgotten = 0;
    for (const r of res.page) {
      if (r._creationTime >= before || (processedOnly && !r.processed)) continue;
      await ctx.db.delete(r._id);
      forgotten++;
    }
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.gmail.forgetAllSeen, { userId, before, processedOnly, cursor: res.continueCursor });
    return forgotten;
  },
});

/**
 * What every check needs: the connection, and the drafts saved since the last check learned (with
 * the entries they became) to learn from, by the server's change number rather than the device's
 * clock, so a draft saved offline is not missed. Small on purpose: an hour without new mail reads little else.
 */
export const prepareSync = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const connection = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!connection) return null;
    const written = await ctx.db.query("drafts").withIndex("by_user_rev", (q) => q.eq("userId", userId).gt("rev", connection.learnedRev ?? 0)).collect();
    return { connection, rev: await currentRev(ctx, userId), learnFrom: await withEntries(ctx, written.filter((d) => d.status === "accepted")) };
  },
});

/** Saved drafts with the entry each became (what the user picked when saving). */
async function withEntries(ctx: QueryCtx, drafts: Doc<"drafts">[]): Promise<{ draft: Doc<"drafts">; tx: Doc<"transactions"> }[]> {
  const out: { draft: Doc<"drafts">; tx: Doc<"transactions"> }[] = [];
  for (const d of drafts) {
    const tx = d.transactionId ? await ctx.db.get(d.transactionId) : null;
    if (tx) out.push({ draft: d, tx });
  }
  return out;
}

/**
 * What reading mail needs, only when there is mail to read or something to learn: the user's
 * methods, categories and currencies, the drafts waiting, and the drafts saved since `since` (for
 * the other mail of a payment already saved).
 */
export const prepareRead = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) => {
    const [settings, accounts, categories, currencies, openDrafts, saved] = await Promise.all([
      ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
      ctx.db.query("accounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      Promise.all([
        ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect(),
        ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "income")).collect(),
      ]).then(([e, i]) => [...e, ...i]),
      ctx.db.query("currencies").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open")).collect(),
      ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "accepted").gte("_creationTime", since)).collect(),
    ]);
    return {
      settings: { mainCurrency: settings?.mainCurrency ?? "INR", decimals: settings?.decimals ?? 2 },
      accounts, categories, currencies, openDrafts, saved: await withEntries(ctx, saved),
    };
  },
});

/**
 * The past entries reading these mails looks at, through indexes rather than a year of the
 * ledger: the latest few with each merchant as their note (the category it had last time, the
 * purchase a refund returns), and every entry on these days ("already added?").
 */
export const entriesFor = internalQuery({
  args: { userId: v.id("users"), notes: v.array(v.string()), dates: v.array(v.string()) },
  handler: async (ctx, { userId, notes, dates }) => {
    const found = new Map<string, Doc<"transactions">>();
    for (const date of new Set(dates)) {
      for (const t of await ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).collect()) found.set(t._id, t);
    }
    for (const note of new Set(notes.map((n) => n.trim()).filter(Boolean))) {
      const same = await ctx.db.query("transactions").withSearchIndex("search_note", (q) => q.search("note", note).eq("userId", userId)).take(SAME_NOTE_MAX);
      for (const t of same) found.set(t._id, t);
    }
    return [...found.values()];
  },
});

/** Which of these Gmail message ids a check has dealt with: a draft's (its own or folded in, open or handled), or read and made none. */
export const seenMessageIds = internalQuery({
  args: { userId: v.id("users"), ids: v.array(v.string()) },
  handler: async (ctx, { userId, ids }) => {
    const seen: string[] = [];
    for (const id of ids) {
      if (await ctx.db.query("gmailSeen").withIndex("by_user_message", (q) => q.eq("userId", userId).eq("messageId", id)).first()) seen.push(id);
    }
    return seen;
  },
});

type Prep = NonNullable<FunctionReturnType<typeof internal.gmail.prepareSync>>;

type Collected = {
  scanned: number;
  inserts: (DraftCandidate & { matchedTransactionId?: Id<"transactions"> })[];
  updates: ReturnType<typeof foldDrafts>["updates"];
  /** Open drafts that look like an entry the user typed in since the draft was written. */
  matches: { id: Id<"drafts">; transactionId: Id<"transactions"> }[];
  learned: Record<string, Id<"accounts">>;
  learnedMerchants: Record<string, MerchantMemory>;
  /** Mails read that made no draft, so later checks skip them. */
  processed: { id: string; receivedAt: number }[];
  /** Where the next check may start from: before the oldest mail the AI could not read this time, so it is retried. */
  syncedUpTo: number;
  aiCalls: number;
  aiSkipped: number;
  aiDropped: number;
  notes: string[];
};

function candidateOf(mail: Mail, resolved: ReturnType<typeof resolveParsed>, how: "rule" | "ai", merchant?: string): DraftCandidate {
  return {
    source: "gmail",
    messageId: mail.id,
    ...(merchant ? { merchant: merchant.slice(0, 120) } : {}),
    extraMessageIds: [],
    threadId: mail.threadId,
    receivedAt: mail.receivedAt,
    from: mail.from.slice(0, 200),
    subject: mail.subject.replace(/\s+/g, " ").trim().slice(0, 120),
    proposal: clean(resolved.proposal),
    confidence: resolved.confidence,
    how,
  };
}

type Read = FunctionReturnType<typeof internal.gmail.prepareRead>;

/** What the user picked when saving drafts whose method the mail only hinted at: "domain|last4" → that method. */
function learnAccounts(prep: Prep, read: Read): Record<string, Id<"accounts">> {
  const learned: Record<string, Id<"accounts">> = {};
  for (const { draft, tx } of prep.learnFrom) {
    if (tx.type === "transfer") continue;
    const key = accountMapKey(draft.from, draft.proposal.accountHint?.last4);
    if (!key || prep.connection.accountMap[key] === tx.accountId) continue;
    if (read.accounts.some((a) => a._id === tx.accountId && !a.deletedAt)) learned[key] = tx.accountId;
  }
  return learned;
}

async function askClaude(mails: Mail[], read: Read): Promise<{ reads: AiRead[]; dropped: number }> {
  const { input, ids } = buildAiInput(mails, { categories: read.categories, accounts: read.accounts, mainCurrency: read.settings.mainCurrency });
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });
  console.log("gmail-ai", { mails: mails.length, stop: res.stop_reason, input: res.usage.input_tokens, output: res.usage.output_tokens });
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`model stopped: ${res.stop_reason}`);
  const text = res.content.find((b) => b.type === "text");
  const raw = JSON.parse(text && text.type === "text" ? text.text : "{}").results;
  return validateAiResults(raw, mails, ids, read.categories);
}

/** A day and the days either side: what "already added?" compares a mail's date with. */
const around = (date: string) => [addDays(date, -1), date, addDays(date, 1)];

/** Search, fetch, triage, parse, dedup: everything a check does short of writing. Shared by the check and the dry run. */
async function collect(ctx: ActionCtx, prep: Prep, startedAt: number): Promise<Collected> {
  const c = prep.connection;
  const token = await gmailApi.accessToken(await decryptText(c.refreshTokenEnc, c.iv));
  const afterMs = windowStart(c, startedAt);
  const muted = c.muted ?? [];
  const q = buildQuery({ senders: c.senders, scanPurchases: c.scanPurchases, afterSeconds: afterMs / 1000, muted });
  // The whole window, a page at a time, less what already has a draft or was read and made none:
  // a check reaches past the mail it has handled to what it has not. The newest SYNC_MAX of those
  // are read now; the rest wait, and the window is held so the next check carries on from there.
  const unread: string[] = [];
  let scanned = 0;
  for await (const page of gmailApi.listMessageIds(token, q)) {
    scanned += page.length;
    const seen = new Set(await ctx.runQuery(internal.gmail.seenMessageIds, { userId: c.userId, ids: page }));
    unread.push(...page.filter((id) => !seen.has(id)));
  }
  // nothing new and nothing saved to learn from (most hours): nothing more to read
  if (!unread.length && !prep.learnFrom.length) {
    return { scanned, inserts: [], updates: [], matches: [], learned: {}, learnedMerchants: {}, processed: [], syncedUpTo: startedAt, aiCalls: 0, aiSkipped: 0, aiDropped: 0, notes: [] };
  }
  const read = await ctx.runQuery(internal.gmail.prepareRead, { userId: c.userId, since: afterMs - SAVED_SLACK_MS });
  const fresh = unread.slice(0, SYNC_MAX);
  const waiting = unread.length - fresh.length;
  const mails: Mail[] = [];
  // Paced to about half of Gmail's per-user quota (6,000 units a minute, 5 per mail), so even a
  // first check of 300 mails never trips it; a call that is still refused backs off on its own.
  for (let i = 0; i < fresh.length; i += FETCH_AT_ONCE) {
    const started = Date.now();
    const got = await Promise.allSettled(fresh.slice(i, i + FETCH_AT_ONCE).map((id) => gmailApi.getMail(token, id)));
    const failed = got.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
    for (const r of got) if (r.status === "fulfilled") mails.push(r.value);
    const wait = FETCH_BATCH_MS - (Date.now() - started);
    if (wait > 0 && i + FETCH_AT_ONCE < fresh.length) await new Promise((r) => setTimeout(r, wait));
  }

  const forAi: Mail[] = [];
  const notes: string[] = [];
  const processed: { id: string; receivedAt: number }[] = [];
  const retry: Mail[] = [];
  /** Each mail read, by a rule or by the model (with the method and category it suggested). */
  const reads: { mail: Mail; parsed: NonNullable<ReturnType<typeof parseMail>>; ai?: AiRead }[] = [];
  for (const mail of mails) {
    if (!triage(mail).keep || matchesSender(mail.from, muted)) { processed.push({ id: mail.id, receivedAt: mail.receivedAt }); continue; }
    const parsed = parseMail(mail);
    if (parsed) reads.push({ mail, parsed });
    else forAi.push(mail);
  }

  let aiCalls = 0, aiSkipped = 0, aiDropped = 0;
  if (forAi.length && !process.env.ANTHROPIC_API_KEY) {
    aiSkipped = forAi.length;
    // say how many, so a mail no rule knows does not just vanish
    notes.push(`${forAi.length} ${forAi.length === 1 ? "mail looked like money but no rule could read it" : "mails looked like money but no rule could read them"} (AI reading is not set up)`);
  } else if (forAi.length) {
    const used = c.aiMonth === monthOf(startedAt) ? c.aiCalls : 0;
    for (let i = 0; i < forAi.length; i += AI_BATCH) {
      const batch = forAi.slice(i, i + AI_BATCH);
      if (used + aiCalls >= AI_MONTHLY_CAP) { aiSkipped += batch.length; retry.push(...batch); continue; }
      aiCalls++;
      try {
        const { reads: answers, dropped } = await askClaude(batch, read);
        aiDropped += dropped;
        const byId = new Map(batch.map((m) => [m.id, m]));
        // not a payment, or an answer that failed validation: asking again next hour would say the same
        const answered = new Set(answers.map((r) => r.mailId));
        for (const m of batch) if (!answered.has(m.id)) processed.push({ id: m.id, receivedAt: m.receivedAt });
        for (const r of answers) reads.push({ mail: byId.get(r.mailId)!, parsed: r.parsed, ai: r });
      } catch (e) {
        console.error("gmail-ai failed", e instanceof Error ? e.message : e);
        aiSkipped += batch.length;
        retry.push(...batch);
        notes.push("AI reading failed for some mail; it will be retried");
      }
    }
    if (aiSkipped && used + aiCalls >= AI_MONTHLY_CAP) notes.push(`monthly AI limit reached, ${aiSkipped} mails waiting`);
  }

  // The past entries resolving looks at: the merchant's own (its category last time, the purchase
  // a refund returns) and those around each mail's day (already added?).
  const dates = reads.flatMap((r) => around(r.parsed.date));
  const transactions = reads.length ? await ctx.runQuery(internal.gmail.entriesFor, { userId: c.userId, notes: reads.map((r) => noteOf(r.parsed)), dates }) : [];
  const rctx: ResolveCtx = { accounts: read.accounts, categories: read.categories, transactions, settings: read.settings, currencies: read.currencies, accountMap: c.accountMap };
  // a currency with no saved rate is converted at today's rate from the public feed, fetched once per check
  const main = read.settings.mainCurrency.toUpperCase();
  const saved = new Set(read.currencies.filter((x) => x.rate > 0).map((x) => x.code.toUpperCase()));
  if (reads.some((r) => r.parsed.currency.toUpperCase() !== main && !saved.has(r.parsed.currency.toUpperCase()))) rctx.liveRates = (await latestRates(main)) ?? undefined;
  // what the user taught about a merchant wins over the rules' and the model's guesses; the merchant as read is kept to learn under
  const remember = (mail: Mail, resolved: ReturnType<typeof resolveParsed>, how: "rule" | "ai") =>
    candidateOf(mail, { ...resolved, proposal: applyMerchantMemory(resolved.proposal, resolved.proposal.note, c.merchantMap, read.categories) }, how, resolved.proposal.note);
  const candidates: DraftCandidate[] = [];
  for (const { mail, parsed, ai } of reads) {
    const resolved = resolveParsed(parsed, mail, rctx);
    if (!ai) { candidates.push(remember(mail, resolved, "rule")); continue; }
    const p = resolved.proposal;
    if (!p.accountId && ai.accountId && p.type !== "transfer") p.accountId = ai.accountId;
    if (!p.categoryId && ai.categoryId && p.type !== "transfer") p.categoryId = ai.categoryId;
    candidates.push(remember(mail, { proposal: p, confidence: lowerConfidence(resolved.confidence, ai.confidence) }, "ai"));
  }

  // no amount means a currency no rate could be found for: no ₹0 draft; the mail stays unread, so the next check tries again
  const waitingRate = candidates.filter((d) => d.proposal.amount === 0);
  if (waitingRate.length) notes.push(`${waitingRate.length} ${waitingRate.length === 1 ? "mail waits" : "mails wait"} for an exchange rate`);
  if (waiting) notes.push(`${waiting} older ${waiting === 1 ? "mail" : "mails"} waiting`);
  const { inserts: folded, updates } = foldDrafts(candidates.filter((d) => d.proposal.amount !== 0), read.openDrafts, read.accounts.filter((a) => !a.deletedAt));
  // The other mail of a purchase whose first mail was already saved (the shop's receipt arriving after
  // the bank's alert was accepted): the entry exists, so this is nothing new. Remembered as read.
  const inserts = folded.filter((d) => {
    if (!read.saved.some(({ draft }) => samePayment(draft, d))) return true;
    for (const id of [d.messageId, ...d.extraMessageIds]) processed.push({ id, receivedAt: d.receivedAt });
    return false;
  });
  // waiting drafts are matched only where every day around them was read; the app matches the rest itself (shared/views draftMatches)
  const covered = new Set(dates);
  const matchable = read.openDrafts.filter((d) => d.matchedTransactionId || around(d.proposal.date).every((x) => covered.has(x)));
  return {
    scanned,
    inserts: inserts.map((d) => ({ ...d, matchedTransactionId: matchEntry(d, transactions, read.accounts) })),
    updates,
    matches: [...laterMatches(matchable, transactions, read.accounts)].map(([id, transactionId]) => ({ id, transactionId })),
    learned: learnAccounts(prep, read),
    learnedMerchants: learnMerchants(prep.learnFrom, c.merchantMap ?? {}, read.categories),
    aiCalls, aiSkipped, aiDropped, notes, processed,
    // a check starts the look-back before syncedUpTo: hold it back so the mail skipped this time is in
    // the next window (where this one started, when older mail still waits)
    syncedUpTo: Math.min(startedAt, ...retry.map((m) => m.receivedAt + spanMs(c.lookbackDays)), ...(waiting ? [afterMs + spanMs(c.lookbackDays)] : [])),
  };
}

/** One user's check, if none is running. Failures are recorded on the connection and never throw out of the cron. */
export const syncUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ ran: boolean; found?: number; error?: string }> => {
    const startedAt = Date.now();
    if (!(await ctx.runMutation(internal.gmail.claimSync, { userId, startedAt }))) return { ran: false };
    try {
      const prep = await ctx.runQuery(internal.gmail.prepareSync, { userId });
      // disconnected since the claim: nothing left to clear
      if (!prep) return { ran: false };
      const got = await collect(ctx, prep, startedAt);
      await ctx.runMutation(internal.gmail.writeSync, {
        userId, startedAt,
        inserts: got.inserts, updates: got.updates, matches: got.matches, learned: got.learned, learnedMerchants: got.learnedMerchants,
        aiCalls: got.aiCalls, scanned: got.scanned, note: got.notes.join(" · ") || undefined,
        processed: got.processed, syncedUpTo: got.syncedUpTo, learnedRev: prep.rev,
      });
      return { ran: true, found: got.inserts.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Check failed";
      console.error("gmail sync failed", { userId, message });
      await ctx.runMutation(internal.gmail.failSync, { userId, startedAt, error: message, reauth: e instanceof GmailAuthError });
      return { ran: true, error: message };
    }
  },
});

/**
 * One-off, after the folding rules change: let the next check read again the mails folded into a
 * user's open drafts. Receipts fold straight back into their alert; alerts that were wrongly
 * merged come back as drafts of their own. Open drafts with no amount (a currency with no rate)
 * are removed, so their mail is read again and converted. Drafts the user saved or dismissed are left alone.
 * `npx convex run gmail:releaseFolded '{"userId":"…"}'` (add --prod for production).
 */
export const releaseFolded = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ drafts: number; mails: number; unpriced: number }> => {
    const open = await ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open")).collect();
    let drafts = 0, mails = 0, unpriced = 0;
    for (const d of open) {
      if (d.proposal.amount === 0) {
        await deleteSynced(ctx, userId, "drafts", d._id);
        await forgetSeen(ctx, userId, [d.messageId, ...d.extraMessageIds]);
        unpriced++;
        continue;
      }
      // a paired transfer's other side is folded in on purpose, and pairs again the same way: leave it
      if (!d.extraMessageIds.length || d.proposal.description?.includes(PAIRED_NOTE)) continue;
      mails += d.extraMessageIds.length;
      drafts++;
      await patchSynced(ctx, userId, d._id, { extraMessageIds: [] });
      await forgetSeen(ctx, userId, d.extraMessageIds);
    }
    return { drafts, mails, unpriced };
  },
});

/**
 * One-off, after the reading rules change: rebuild a user's waiting drafts under the current
 * rules. Open drafts are removed (except ones the user said are new) and the list of mails read
 * as "not money" is cleared, so the next check reads them all again. Saved and dismissed drafts,
 * and the entries made from them, are left alone, so nothing is offered twice.
 * `npx convex run gmail:rebuildOpenDrafts '{"userId":"…"}'` (add --prod for production).
 */
export const rebuildOpenDrafts = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ removed: number; forgotten: number }> => {
    const open = await ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open")).collect();
    let removed = 0;
    for (const d of open) {
      if (d.keptNew) continue;
      await deleteSynced(ctx, userId, "drafts", d._id);
      await forgetSeen(ctx, userId, [d.messageId, ...d.extraMessageIds]);
      removed++;
    }
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    let forgotten = c?.processed?.length ?? 0;
    if (c?.processed) await ctx.db.patch(c._id, { processed: undefined });
    // the first page here (its count is what is reported), any more scheduled
    const firstPage = await ctx.db.query("gmailSeen").withIndex("by_user_message", (q) => q.eq("userId", userId)).paginate({ numItems: 1000, cursor: null });
    for (const r of firstPage.page) {
      if (!r.processed) continue;
      await ctx.db.delete(r._id);
      forgotten++;
    }
    if (!firstPage.isDone) await ctx.scheduler.runAfter(0, internal.gmail.forgetAllSeen, { userId, before: Date.now(), processedOnly: true, cursor: firstPage.continueCursor });
    return { removed, forgotten };
  },
});

/**
 * One-off, after rebuildOpenDrafts: a check reads back one look-back from where the last one
 * ended, so mail between the look-back's start and that is never read again. This moves the end
 * back so the next check reads the whole look-back; what already has a draft is skipped as usual.
 * `npx convex run gmail:rereadLookback '{"userId":"…"}'` (add --prod for production).
 */
export const rereadLookback = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!c?.syncedUpTo || c.readsFrom === undefined) return { moved: false };
    const syncedUpTo = Math.min(c.syncedUpTo, c.readsFrom + spanMs(c.lookbackDays));
    await ctx.db.patch(c._id, { syncedUpTo });
    return { moved: syncedUpTo !== c.syncedUpTo };
  },
});

/**
 * Dev: the text UnMoney reads from one of a user's mails and what the rules make of it, for
 * fixing a rule. `npx convex run gmail:readMail '{"userId":"…","messageId":"…"}'`
 */
export const readMail = internalAction({
  args: { userId: v.id("users"), messageId: v.string() },
  handler: async (ctx, { userId, messageId }) => {
    const prep = await ctx.runQuery(internal.gmail.prepareSync, { userId });
    if (!prep) return { error: "not connected" };
    const token = await gmailApi.accessToken(await decryptText(prep.connection.refreshTokenEnc, prep.connection.iv));
    const mail = await gmailApi.getMail(token, messageId);
    return { from: mail.from, subject: mail.subject, text: mail.text, triage: triage(mail), parsed: parseMail(mail) };
  },
});

/**
 * Dev: every mail a Gmail search finds and what triage and the rules make of each, for finding
 * the money mail no rule reads. The text comes back only for mail kept but not read, and the
 * start of it for mail dropped. `npx convex run gmail:auditMail '{"userId":"…","q":"newer_than:30d (debited OR credited)"}'`
 */
export const auditMail = internalAction({
  args: { userId: v.id("users"), q: v.string(), max: v.optional(v.number()) },
  handler: async (ctx, { userId, q, max = 500 }) => {
    const prep = await ctx.runQuery(internal.gmail.prepareSync, { userId });
    if (!prep) return { error: "not connected" };
    const token = await gmailApi.accessToken(await decryptText(prep.connection.refreshTokenEnc, prep.connection.iv));
    const ids: string[] = [];
    for await (const page of gmailApi.listMessageIds(token, q)) {
      ids.push(...page);
      if (ids.length >= max) break;
    }
    const out = [];
    for (let i = 0; i < Math.min(ids.length, max); i += FETCH_AT_ONCE) {
      const started = Date.now();
      for (const mail of await Promise.all(ids.slice(i, i + FETCH_AT_ONCE).map((id) => gmailApi.getMail(token, id)))) {
        const verdict = triage(mail);
        const parsed = verdict.keep ? parseMail(mail) : null;
        out.push({
          id: mail.id, from: mail.from, subject: mail.subject, receivedAt: mail.receivedAt, triage: verdict.keep ? "keep" : verdict.reason,
          parsed: parsed && { rule: parsed.rule, type: parsed.type, amount: parsed.amount, currency: parsed.currency, merchant: parsed.merchantRaw },
          text: !verdict.keep ? mail.text.slice(0, 300) : parsed ? undefined : mail.text.slice(0, 1500),
        });
      }
      const wait = FETCH_BATCH_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    return out;
  },
});

/** Dev: what a check would create for a user, without writing anything. `npx convex run gmail:dryRun '{"userId":"…"}'` */
export const dryRun = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const prep = await ctx.runQuery(internal.gmail.prepareSync, { userId });
    if (!prep) return { error: "not connected" };
    const got = await collect(ctx, prep, Date.now());
    return { ...got, inserts: got.inserts.map((d) => ({ from: d.from, subject: d.subject, how: d.how, confidence: d.confidence, matched: !!d.matchedTransactionId, proposal: d.proposal })) };
  },
});

const draftFields = schema.tables.drafts.validator.fields;
const insertArg = v.object({
  source: draftFields.source, messageId: draftFields.messageId, extraMessageIds: draftFields.extraMessageIds, threadId: draftFields.threadId,
  receivedAt: draftFields.receivedAt, from: draftFields.from, subject: draftFields.subject, proposal: draftFields.proposal, merchant: draftFields.merchant,
  confidence: draftFields.confidence, how: draftFields.how, matchedTransactionId: v.optional(v.id("transactions")),
});
const matchArg = v.object({ id: v.id("drafts"), transactionId: v.id("transactions") });
const updateArg = v.object({
  id: v.id("drafts"), extraMessageIds: v.array(v.string()), note: v.optional(v.string()), categoryId: v.optional(v.id("categories")), subcategoryId: v.optional(v.id("categories")),
  transfer: v.optional(v.object({ accountId: v.id("accounts"), toAccountId: v.id("accounts") })),
});
const merchantArg = schema.tables.gmailConnections.validator.fields.merchantMap;

/**
 * The outcome of a check: new drafts (once each), folded mails, open drafts that now match an
 * entry, what was learned, and the connection's bookkeeping.
 */
export const writeSync = internalMutation({
  args: {
    userId: v.id("users"), startedAt: v.number(), inserts: v.array(insertArg), updates: v.array(updateArg), matches: v.array(matchArg),
    learned: v.record(v.string(), v.id("accounts")), learnedMerchants: merchantArg, aiCalls: v.number(), scanned: v.number(), note: v.optional(v.string()),
    processed: v.optional(v.array(v.object({ id: v.string(), receivedAt: v.number() }))),
    /** Defaults to startedAt; earlier when some mail is to be retried. */
    syncedUpTo: v.optional(v.number()),
    /** The change number the check learned up to (prepareSync). */
    learnedRev: v.optional(v.number()),
  },
  handler: async (ctx, { userId, startedAt, inserts, updates, matches, learned, learnedMerchants = {}, aiCalls, scanned, note, processed = [], syncedUpTo = startedAt, learnedRev }) => {
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!c) return;
    let found = 0;
    const seen: SeenRow[] = processed.map((p) => ({ messageId: p.id, receivedAt: p.receivedAt, processed: true }));
    for (const d of inserts) {
      const dup = await ctx.db.query("drafts").withIndex("by_user_message", (q) => q.eq("userId", userId).eq("messageId", d.messageId)).first();
      if (dup) continue;
      await insertSynced(ctx, userId, "drafts", { ...d, status: "open" });
      seen.push(...seenOfDraft(d));
      found++;
    }
    for (const u of updates) {
      const d = await ctx.db.get(u.id);
      if (!d || d.userId !== userId || d.status !== "open") continue;
      const proposal = { ...d.proposal };
      if (u.note) proposal.note = u.note;
      if (u.categoryId) { proposal.categoryId = u.categoryId; proposal.subcategoryId = u.subcategoryId; }
      // the other side of a move between the user's own methods arrived: the draft is that transfer now
      if (u.transfer) {
        Object.assign(proposal, { type: "transfer" as const, accountId: u.transfer.accountId, toAccountId: u.transfer.toAccountId, categoryId: undefined, subcategoryId: undefined });
        if (!proposal.description?.includes(PAIRED_NOTE)) proposal.description = [proposal.description, PAIRED_NOTE].filter(Boolean).join(" · ");
      }
      await patchSynced(ctx, userId, u.id, { extraMessageIds: [...new Set([...d.extraMessageIds, ...u.extraMessageIds])], proposal });
      seen.push(...u.extraMessageIds.map((messageId) => ({ messageId, receivedAt: d.receivedAt })));
    }
    // the user may have saved, linked or said "it's new" while the check ran
    for (const m of matches) {
      const d = await ctx.db.get(m.id);
      if (!d || d.userId !== userId || d.status !== "open" || d.matchedTransactionId || d.keptNew) continue;
      const tx = await ctx.db.get(m.transactionId);
      if (!tx || tx.userId !== userId || tx.source) continue;
      await patchSynced(ctx, userId, m.id, { matchedTransactionId: m.transactionId });
    }
    await markSeen(ctx, userId, seen);
    // rows no window can reach any more: well before where the next one starts, even when held back
    const reach = Math.min(startedAt, windowStart({ ...c, syncedUpTo }, startedAt)) - SEEN_KEEP_MS;
    for (const r of await ctx.db.query("gmailSeen").withIndex("by_user_received", (q) => q.eq("userId", userId).lt("receivedAt", reach)).take(200)) await ctx.db.delete(r._id);
    const month = monthOf(startedAt);
    const entry = { at: startedAt, scanned, found, ...(note ? { note } : {}) };
    await ctx.db.patch(c._id, {
      lastSyncAt: startedAt, lastError: undefined, syncedUpTo, syncingSince: undefined, ...(learnedRev !== undefined ? { learnedRev } : {}),
      aiMonth: month, aiCalls: (c.aiMonth === month ? c.aiCalls : 0) + aiCalls,
      accountMap: { ...c.accountMap, ...learned },
      ...(Object.keys(learnedMerchants).length ? { merchantMap: mergeMerchants(c.merchantMap ?? {}, learnedMerchants) } : {}),
      log: [entry, ...c.log].slice(0, LOG_KEEP),
    });
  },
});

/** A failed check: logged, and after a few in a row the connection pauses itself (or asks to reconnect when the grant is dead). */
export const failSync = internalMutation({
  args: { userId: v.id("users"), startedAt: v.number(), error: v.string(), reauth: v.boolean() },
  handler: async (ctx, { userId, startedAt, error, reauth }) => {
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!c) return;
    const log = [{ at: startedAt, scanned: 0, found: 0, error }, ...c.log].slice(0, LOG_KEEP);
    let streak = 0;
    for (const l of log) { if (!l.error) break; streak++; }
    const status = reauth ? "reauth" : streak >= PAUSE_AFTER_FAILURES ? "paused" : c.status;
    await ctx.db.patch(c._id, { lastSyncAt: startedAt, lastError: error, status, log, syncingSince: undefined });
  },
});
