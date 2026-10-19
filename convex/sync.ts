import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { currentUserId } from "./lib/auth";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { loadTable, runOps, type OpOutcome } from "./lib/snapshot";
import { TABLES, type Op, type OpKind } from "../shared/ops";

const tableArg = v.union(...TABLES.map((t) => v.literal(t)));

/** Who is signed in, or null. Never throws, so the client can subscribe before auth settles. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    return { userId, user: user ? { name: user.name, email: user.email, image: user.image } : null };
  },
});

/** One table of the signed-in user's documents; null while signed out. Transactions come through `transactionsPage`. */
export const table = query({
  args: { table: tableArg },
  handler: async (ctx, { table }) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    return loadTable(ctx, userId, table);
  },
});

/**
 * The signed-in user's entries, a page at a time. The client loads every page and keeps each one
 * subscribed, so no single query reads more than a page and an edit re-sends only its own page.
 */
export const transactionsPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await currentUserId(ctx);
    if (!userId) return { page: [], isDone: true, continueCursor: "" };
    return ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).paginate(paginationOpts);
  },
});

const opArg = v.object({ id: v.string(), kind: v.string(), args: v.any(), at: v.number() });

/**
 * Apply a batch of queued ops, in order. Idempotent: an op id that was seen before returns its
 * recorded outcome and is not applied again, so a client may safely resend after losing the
 * reply.
 */
export const apply = mutation({
  args: { ops: v.array(opArg) },
  handler: async (ctx, { ops }) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const results: OpOutcome[] = [];
    const fresh: Op[] = [];
    const recorded = new Map<string, OpOutcome>();
    for (const op of ops) {
      const prev = await ctx.db.query("syncOps").withIndex("by_user_op", (q) => q.eq("userId", userId).eq("opId", op.id)).unique();
      if (prev) recorded.set(op.id, prev.status === "applied" ? { id: op.id, status: "applied", idMap: prev.idMap ?? {} } : { id: op.id, status: "rejected", error: prev.error ?? "Rejected" });
      else fresh.push({ id: op.id, kind: op.kind as OpKind, args: op.args, at: op.at });
    }
    const outcomes = fresh.length ? await runOps(ctx, userId, fresh) : [];
    const byId = new Map(outcomes.map((o) => [o.id, o]));
    for (const op of ops) {
      const o = recorded.get(op.id) ?? byId.get(op.id)!;
      results.push(o);
      if (!recorded.has(op.id)) {
        await ctx.db.insert("syncOps", {
          userId, opId: op.id, kind: op.kind, status: o.status,
          error: o.status === "rejected" ? o.error : undefined,
          idMap: o.status === "applied" ? o.idMap : undefined,
        });
      }
    }
    return results;
  },
});

/**
 * After a wipe or restore done in chunks: delete the user's entries created before it that the
 * chunks did not reach (made on another device, or by the repeats job, before the device knew).
 * A page at a time, rescheduling itself.
 */
export const sweepEntries = internalMutation({
  args: { userId: v.id("users"), before: v.number(), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { userId, before, cursor = null }) => {
    const res = await ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).paginate({ numItems: 1000, cursor });
    for (const t of res.page) if (t._creationTime < before) await ctx.db.delete(t._id);
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.sync.sweepEntries, { userId, before, cursor: res.continueCursor });
  },
});

/** A client only resends ops it has not seen acknowledged, so a month of history is plenty. */
const SYNC_OP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 500;

/** Daily cron: delete syncOps rows older than the TTL, a batch at a time, rescheduling until done. */
export const pruneSyncOps = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - SYNC_OP_TTL_MS;
    const old = await ctx.db.query("syncOps").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, internal.sync.pruneSyncOps, { cutoff });
  },
});

/** A saved or dismissed draft is kept this long, so "Open in Gmail" on a fresh entry still works. */
const DRAFT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Daily cron: delete drafts resolved more than the TTL ago. Open drafts stay until the user
 * handles them or disconnects Gmail. Walks the drafts older than the TTL a page at a time (one
 * resolved that long ago is at least that old), rescheduling until done.
 */
export const pruneDrafts = internalMutation({
  args: { cutoff: v.optional(v.number()), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - DRAFT_TTL_MS;
    const res = await ctx.db.query("drafts").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).paginate({ numItems: PRUNE_BATCH, cursor: args.cursor ?? null });
    for (const d of res.page) if (d.status !== "open" && (d.resolvedAt ?? d._creationTime) < cutoff) await ctx.db.delete(d._id);
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.sync.pruneDrafts, { cutoff, cursor: res.continueCursor });
  },
});
