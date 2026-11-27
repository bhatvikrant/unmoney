/**
 * The Unfuel link: how a fuel fill-up logged in Unfuel (github.com/bhatvikrant/unfuel) becomes an
 * expense here without anyone typing it twice. The two apps share nothing but the user's Google
 * account, so the user makes a link in More › Unfuel and pastes it into Unfuel, whose server then
 * posts each fill-up to POST /unfuel/<token> on the Convex site. Only the hash of the token is kept;
 * one link per user, and making a new one turns the old one off.
 *
 * The link says where the entries go (a payment method and an expense category, picked when it is
 * made), because a post carries an amount and a date and nothing about this ledger. Each fill-up is
 * added through the same reducer the app uses (lib/snapshot.ts runOps), so every device sees it like
 * any other entry. Unfuel sends each fill-up's id as `ref`; a `ref` seen before adds nothing, so a
 * retry on its side cannot make a second entry. A leaked link can only add expenses to that one
 * payment method and category; it reads nothing.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, httpAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { runOps } from "./lib/snapshot";
import { parseNumber } from "../shared/money";

/** A fill-up as JSON is a few hundred bytes. */
const MAX_BYTES = 10_000;
const MAX_NOTE = 60;
const MAX_DESCRIPTION = 200;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const target = { accountId: v.id("accounts"), categoryId: v.id("categories"), subcategoryId: v.optional(v.id("categories")) };
type Target = { accountId: Id<"accounts">; categoryId: Id<"categories">; subcategoryId?: Id<"categories"> };

/** Where the entries go must be the user's own, in use, and an expense category (with its own subcategory, if any). */
async function checkTarget(ctx: QueryCtx | MutationCtx, userId: Id<"users">, t: Target) {
  const account = await ctx.db.get(t.accountId);
  if (!account || account.userId !== userId || account.deletedAt) throw new Error("Pick a payment method");
  const category = await ctx.db.get(t.categoryId);
  if (!category || category.userId !== userId || category.deletedAt || category.type !== "expense" || category.parentId) throw new Error("Pick an expense category");
  if (t.subcategoryId) {
    const sub = await ctx.db.get(t.subcategoryId);
    if (!sub || sub.userId !== userId || sub.deletedAt || sub.parentId !== t.categoryId) throw new Error("Pick an expense category");
  }
}

/** Makes a fresh Unfuel link for the signed-in user and returns it. The token is shown only now. */
export const createLink = action({
  args: target,
  handler: async (ctx, args): Promise<{ url: string; createdAt: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const token = newToken();
    const createdAt = Date.now();
    await ctx.runMutation(internal.unfuel.storeLink, { userId, tokenHash: await sha256(token), createdAt, ...args });
    return { url: `${process.env.CONVEX_SITE_URL}/unfuel/${token}`, createdAt };
  },
});

export const storeLink = internalMutation({
  args: { userId: v.id("users"), tokenHash: v.string(), createdAt: v.number(), ...target },
  handler: async (ctx, { userId, tokenHash, createdAt, ...where }) => {
    // an action's token outlives a deleted account: no link for one that is gone
    if (!(await ctx.db.get(userId))) throw new Error("Not signed in");
    await checkTarget(ctx, userId, where);
    const old = await ctx.db.query("unfuelLinks").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    for (const o of old) await ctx.db.delete(o._id);
    await ctx.db.insert("unfuelLinks", { userId, tokenHash, createdAt, ...where, received: 0 });
  },
});

/** The current link: when it was made, where its entries go, and how many have come through. Null if there is none. */
export const linkStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const link = await ctx.db.query("unfuelLinks").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    if (!link) return null;
    return { createdAt: link.createdAt, accountId: link.accountId, categoryId: link.categoryId, subcategoryId: link.subcategoryId, received: link.received, lastReceivedAt: link.lastReceivedAt };
  },
});

/** Change where the link's entries go, without making a new link (Unfuel keeps the one it has). */
export const setTarget = mutation({
  args: target,
  handler: async (ctx, where) => {
    const userId = await requireUser(ctx);
    const link = await ctx.db.query("unfuelLinks").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    if (!link) throw new Error("Make a link first");
    await checkTarget(ctx, userId, where);
    await ctx.db.patch(link._id, { accountId: where.accountId, categoryId: where.categoryId, subcategoryId: where.subcategoryId });
  },
});

export const revokeLink = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const links = await ctx.db.query("unfuelLinks").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    for (const l of links) await ctx.db.delete(l._id);
  },
});

export const linkForToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const link = await ctx.db.query("unfuelLinks").withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    return link?._id ?? null;
  },
});

type Added = { ok: true; again: boolean } | { ok: false; status: number; error: string };

/**
 * One fill-up from Unfuel, added as an expense. Idempotent by `ref`: the op's id is made from it and
 * recorded in syncOps like any op a device sends, so the same fill-up posted again adds nothing.
 * A refusal is not recorded: once the user has fixed what was wrong (a deleted payment method), the
 * same fill-up can go through.
 */
export const addEntry = internalMutation({
  args: {
    linkId: v.id("unfuelLinks"), ref: v.string(), amount: v.string(), currency: v.string(), date: v.string(), time: v.optional(v.string()),
    note: v.string(), description: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<Added> => {
    const link = await ctx.db.get(a.linkId);
    if (!link || !(await ctx.db.get(link.userId))) return { ok: false, status: 401, error: "This link no longer works." };
    const userId = link.userId;
    const opId = `unfuel_${a.ref}`;
    const prev = await ctx.db.query("syncOps").withIndex("by_user_op", (q) => q.eq("userId", userId).eq("opId", opId)).unique();
    if (prev?.status === "applied") return { ok: true, again: true };

    const settings = await ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    if (!settings) return { ok: false, status: 422, error: "Finish setting up UnMoney first." };
    // an amount in another currency would need a rate nobody gave: refused, not guessed
    if (a.currency !== settings.mainCurrency) return { ok: false, status: 422, error: `This fill-up is in ${a.currency} and your UnMoney is in ${settings.mainCurrency}.` };
    const major = parseNumber(a.amount);
    const amount = major === null ? 0 : Math.round(major * 10 ** settings.decimals);
    if (amount <= 0) return { ok: false, status: 400, error: "That amount does not look right." };

    const [outcome] = await runOps(ctx, userId, [{
      id: opId, kind: "transactions.create", at: Date.now(),
      args: {
        type: "expense", date: a.date, time: a.time, accountId: link.accountId, categoryId: link.categoryId, subcategoryId: link.subcategoryId,
        amount, note: a.note, description: a.description, tags: [], photoIds: [],
      },
    }]);
    // the payment method or category the link names is gone: said in words, for Unfuel to show
    if (outcome.status === "rejected") return { ok: false, status: 422, error: `UnMoney could not add it: ${outcome.error}. Check where Unfuel's entries go, under More › Unfuel.` };
    await ctx.db.insert("syncOps", { userId, opId, kind: "transactions.create", status: "applied", idMap: outcome.idMap });
    await ctx.db.patch(link._id, { received: link.received + 1, lastReceivedAt: Date.now() });
    return { ok: true, again: false };
  },
});

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const cut = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** "2026-02-31" parses to March: a date that does not print back the same is not a date. */
function isRealDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/**
 * POST /unfuel/<token>, from Unfuel's server. The body is JSON:
 * `{ v: 1, source: "unfuel", ref, amount: "1000.00", currency: "INR", date: "YYYY-MM-DD", time: "HH:mm" | null, note, description }`.
 * The reply is plain text, one sentence Unfuel can show: 200 added (or already there), 400 a body that
 * is not a fill-up, 401 a link that no longer works, 422 a fill-up this ledger cannot take.
 */
export const receive = httpAction(async (ctx, req) => {
  const token = new URL(req.url).pathname.split("/").filter(Boolean)[1] ?? "";
  const linkId = token ? await ctx.runQuery(internal.unfuel.linkForToken, { tokenHash: await sha256(token) }) : null;
  if (!linkId) return text("This UnMoney link no longer works. In UnMoney, open More › Unfuel and copy a new link.", 401);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return text("That is too much for one fill-up.", 413);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return text("That is too much for one fill-up.", 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return text("That is not a fill-up.", 400);
  }
  const ref = typeof body.ref === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.ref) ? body.ref : "";
  const amount = typeof body.amount === "string" && /^\d{1,12}(\.\d{1,3})?$/.test(body.amount) ? body.amount : "";
  const currency = typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : "";
  const date = typeof body.date === "string" && isRealDate(body.date) ? body.date : "";
  const time = typeof body.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : undefined;
  if (body.v !== 1 || body.source !== "unfuel" || !ref || !amount || !currency || !date) return text("That is not a fill-up.", 400);

  const added: Added = await ctx.runMutation(internal.unfuel.addEntry, {
    linkId, ref, amount, currency, date, time, note: cut(body.note, MAX_NOTE) || "Fuel", description: cut(body.description, MAX_DESCRIPTION) || undefined,
  });
  if (!added.ok) return text(added.error, added.status);
  return text(added.again ? "Already in UnMoney." : "Added to UnMoney.");
});
