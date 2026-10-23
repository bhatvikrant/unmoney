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
import { action, httpAction, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx } from "./_generated/server";
import type { FunctionReturnType } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { requireUser } from "./lib/auth";
import { decryptText, encryptText, hasTokenKey, sign, verify } from "./lib/gmailCrypto";
import * as gmailApi from "./lib/gmailApi";
import { GmailAuthError, GmailSetupError, SCOPE } from "./lib/gmailApi";
import { addDays, todayISO } from "../shared/dates";
import { clean } from "../shared/ops";
import type { Mail } from "../shared/gmail/mail";
import { triage } from "../shared/gmail/triage";
import { parseMail } from "../shared/gmail/rules";
import { latestRates } from "./lib/fxFeed";
import { accountMapKey, resolveParsed, type ResolveCtx } from "../shared/gmail/resolve";
import { foldDrafts, laterMatches, matchEntry, type DraftCandidate } from "../shared/gmail/dedup";
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
/** Entries this far back are read for "already added?" matching and for the category a merchant had last time. */
const HISTORY_DAYS = 365;
const MAX_SENDERS = 60;
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
    for (const d of await ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open")).collect()) await ctx.db.delete(d._id);
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
    await ctx.db.patch(c._id, { syncingSince: startedAt });
    return true;
  },
});

/** Everything one check needs, read in one consistent query. */
export const prepareSync = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const connection = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!connection) return null;
    const since = addDays(todayISO(), -HISTORY_DAYS);
    const [settings, accounts, categories, currencies, transactions, openDrafts, accepted] = await Promise.all([
      ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
      ctx.db.query("accounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      Promise.all([
        ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect(),
        ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "income")).collect(),
      ]).then(([e, i]) => [...e, ...i]),
      ctx.db.query("currencies").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", since)).collect(),
      ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open")).collect(),
      ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "accepted")).order("desc").take(200),
    ]);
    // what the user picked when saving: the learning material for accountMap
    const acceptedWith: { draft: Doc<"drafts">; tx: Doc<"transactions"> }[] = [];
    for (const d of accepted) {
      const tx = d.transactionId ? await ctx.db.get(d.transactionId) : null;
      if (tx) acceptedWith.push({ draft: d, tx });
    }
    return {
      connection,
      settings: { mainCurrency: settings?.mainCurrency ?? "INR", decimals: settings?.decimals ?? 2 },
      accounts, categories, currencies, transactions, openDrafts, accepted: acceptedWith,
    };
  },
});

/** Which of these Gmail message ids already have a draft (open or resolved, or folded into one), or were read and made none. */
export const seenMessageIds = internalQuery({
  args: { userId: v.id("users"), ids: v.array(v.string()) },
  handler: async (ctx, { userId, ids }) => {
    const seen: string[] = [];
    for (const id of ids) {
      const d = await ctx.db.query("drafts").withIndex("by_user_message", (q) => q.eq("userId", userId).eq("messageId", id)).first();
      if (d) seen.push(id);
    }
    const connection = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const folded = new Set((connection?.processed ?? []).map((p) => p.id));
    // A receipt folded into an alert is not its own draft: check the extras of every draft, the
    // handled ones too, or it comes back as a new draft once the alert's draft is saved or dismissed.
    // (Handled drafts are pruned after 90 days, long after the receipt left the check's window.)
    for (const d of await ctx.db.query("drafts").withIndex("by_user_status", (q) => q.eq("userId", userId)).collect()) for (const x of d.extraMessageIds) folded.add(x);
    for (const id of ids) if (folded.has(id) && !seen.includes(id)) seen.push(id);
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

/** What the user picked when saving drafts whose method the mail only hinted at: "domain|last4" → that method. */
function learnAccounts(prep: Prep): Record<string, Id<"accounts">> {
  const learned: Record<string, Id<"accounts">> = {};
  for (const { draft, tx } of prep.accepted) {
    if (tx.type === "transfer") continue;
    const key = accountMapKey(draft.from, draft.proposal.accountHint?.last4);
    if (!key || prep.connection.accountMap[key] === tx.accountId) continue;
    if (prep.accounts.some((a) => a._id === tx.accountId && !a.deletedAt)) learned[key] = tx.accountId;
  }
  return learned;
}

async function askClaude(mails: Mail[], prep: Prep): Promise<{ reads: AiRead[]; dropped: number }> {
  const { input, ids } = buildAiInput(mails, { categories: prep.categories, accounts: prep.accounts, mainCurrency: prep.settings.mainCurrency });
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
  return validateAiResults(raw, mails, ids, prep.categories);
}

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

  const rctx: ResolveCtx = { accounts: prep.accounts, categories: prep.categories, transactions: prep.transactions, settings: prep.settings, currencies: prep.currencies, accountMap: c.accountMap };
  const candidates: DraftCandidate[] = [];
  const forAi: Mail[] = [];
  const notes: string[] = [];
  const processed: { id: string; receivedAt: number }[] = [];
  const retry: Mail[] = [];
  // what the user taught about a merchant wins over the rules' and the model's guesses; the merchant as read is kept to learn under
  const remember = (mail: Mail, resolved: ReturnType<typeof resolveParsed>, how: "rule" | "ai") =>
    candidateOf(mail, { ...resolved, proposal: applyMerchantMemory(resolved.proposal, resolved.proposal.note, c.merchantMap, prep.categories) }, how, resolved.proposal.note);
  // a currency with no saved rate is converted at today's rate from the public feed, fetched once per check
  const main = prep.settings.mainCurrency.toUpperCase();
  const saved = new Set(prep.currencies.filter((x) => x.rate > 0).map((x) => x.code.toUpperCase()));
  let fetchedRates = false;
  const ratesFor = async (currencies: string[]) => {
    if (fetchedRates || !currencies.some((x) => x.toUpperCase() !== main && !saved.has(x.toUpperCase()))) return;
    fetchedRates = true;
    rctx.liveRates = (await latestRates(main)) ?? undefined;
  };
  const read: { mail: Mail; parsed: NonNullable<ReturnType<typeof parseMail>> }[] = [];
  for (const mail of mails) {
    if (!triage(mail).keep || matchesSender(mail.from, muted)) { processed.push({ id: mail.id, receivedAt: mail.receivedAt }); continue; }
    const parsed = parseMail(mail);
    if (parsed) read.push({ mail, parsed });
    else forAi.push(mail);
  }
  await ratesFor(read.map((r) => r.parsed.currency));
  for (const { mail, parsed } of read) candidates.push(remember(mail, resolveParsed(parsed, mail, rctx), "rule"));

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
        const { reads, dropped } = await askClaude(batch, prep);
        aiDropped += dropped;
        const byId = new Map(batch.map((m) => [m.id, m]));
        // not a payment, or an answer that failed validation: asking again next hour would say the same
        const answered = new Set(reads.map((r) => r.mailId));
        for (const m of batch) if (!answered.has(m.id)) processed.push({ id: m.id, receivedAt: m.receivedAt });
        await ratesFor(reads.map((r) => r.parsed.currency));
        for (const r of reads) {
          const mail = byId.get(r.mailId)!;
          const resolved = resolveParsed(r.parsed, mail, rctx);
          const p = resolved.proposal;
          if (!p.accountId && r.accountId && p.type !== "transfer") p.accountId = r.accountId;
          if (!p.categoryId && r.categoryId && p.type !== "transfer") p.categoryId = r.categoryId;
          candidates.push(remember(mail, { proposal: p, confidence: lowerConfidence(resolved.confidence, r.confidence) }, "ai"));
        }
      } catch (e) {
        console.error("gmail-ai failed", e instanceof Error ? e.message : e);
        aiSkipped += batch.length;
        retry.push(...batch);
        notes.push("AI reading failed for some mail; it will be retried");
      }
    }
    if (aiSkipped && used + aiCalls >= AI_MONTHLY_CAP) notes.push(`monthly AI limit reached, ${aiSkipped} mails waiting`);
  }

  // no amount means a currency no rate could be found for: no ₹0 draft; the mail stays unread, so the next check tries again
  const waitingRate = candidates.filter((d) => d.proposal.amount === 0);
  if (waitingRate.length) notes.push(`${waitingRate.length} ${waitingRate.length === 1 ? "mail waits" : "mails wait"} for an exchange rate`);
  if (waiting) notes.push(`${waiting} older ${waiting === 1 ? "mail" : "mails"} waiting`);
  const { inserts, updates } = foldDrafts(candidates.filter((d) => d.proposal.amount !== 0), prep.openDrafts, prep.accounts.filter((a) => !a.deletedAt));
  return {
    scanned,
    inserts: inserts.map((d) => ({ ...d, matchedTransactionId: matchEntry(d, prep.transactions, prep.accounts) })),
    updates,
    matches: [...laterMatches(prep.openDrafts, prep.transactions, prep.accounts)].map(([id, transactionId]) => ({ id, transactionId })),
    learned: learnAccounts(prep),
    learnedMerchants: learnMerchants(prep.accepted, c.merchantMap ?? {}, prep.categories),
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
        processed: got.processed, syncedUpTo: got.syncedUpTo,
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
      if (d.proposal.amount === 0) { await ctx.db.delete(d._id); unpriced++; continue; }
      // a paired transfer's other side is folded in on purpose, and pairs again the same way: leave it
      if (!d.extraMessageIds.length || d.proposal.description?.includes(PAIRED_NOTE)) continue;
      mails += d.extraMessageIds.length;
      drafts++;
      await ctx.db.patch(d._id, { extraMessageIds: [] });
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
      await ctx.db.delete(d._id);
      removed++;
    }
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const forgotten = c?.processed?.length ?? 0;
    if (c) await ctx.db.patch(c._id, { processed: [] });
    return { removed, forgotten };
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
  },
  handler: async (ctx, { userId, startedAt, inserts, updates, matches, learned, learnedMerchants = {}, aiCalls, scanned, note, processed = [], syncedUpTo = startedAt }) => {
    const c = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!c) return;
    let found = 0;
    for (const d of inserts) {
      const dup = await ctx.db.query("drafts").withIndex("by_user_message", (q) => q.eq("userId", userId).eq("messageId", d.messageId)).first();
      if (dup) continue;
      await ctx.db.insert("drafts", { userId, ...d, status: "open" });
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
      await ctx.db.patch(u.id, { extraMessageIds: [...new Set([...d.extraMessageIds, ...u.extraMessageIds])], proposal });
    }
    // the user may have saved, linked or said "it's new" while the check ran
    for (const m of matches) {
      const d = await ctx.db.get(m.id);
      if (!d || d.userId !== userId || d.status !== "open" || d.matchedTransactionId || d.keptNew) continue;
      const tx = await ctx.db.get(m.transactionId);
      if (!tx || tx.userId !== userId || tx.source) continue;
      await ctx.db.patch(m.id, { matchedTransactionId: m.transactionId });
    }
    const month = monthOf(startedAt);
    const entry = { at: startedAt, scanned, found, ...(note ? { note } : {}) };
    // what the next window can no longer reach is forgotten
    const reach = syncedUpTo - spanMs(c.lookbackDays);
    const known = new Set(processed.map((p) => p.id));
    await ctx.db.patch(c._id, {
      lastSyncAt: startedAt, lastError: undefined, syncedUpTo, syncingSince: undefined,
      processed: [...(c.processed ?? []).filter((p) => !known.has(p.id)), ...processed].filter((p) => p.receivedAt >= reach),
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
