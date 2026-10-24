import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { currentUserId } from "./lib/auth";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { loadTable, runOps, type OpOutcome } from "./lib/snapshot";
import { currentRev, deleteSynced } from "./lib/changes";
import { TABLES, type Op, type OpKind, type Table } from "../shared/ops";
import type { ChangedDocs, Changes } from "../shared/changes";

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
 * The signed-in user's entries, a page at a time, for a device loading everything (no local copy
 * yet, or one too old for `changes`). It reads them once and from then on follows `changes`.
 */
export const transactionsPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await currentUserId(ctx);
    if (!userId) return { page: [], isDone: true, continueCursor: "" };
    return ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).paginate(paginationOpts);
  },
});

/** The user's change number now: a device loading everything starts following `changes` from here. */
export const head = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    return currentRev(ctx, userId);
  },
});

/** More than this many changed documents and the device is better off loading everything again. */
const CHANGES_MAX = 5000;

/**
 * Every synced document of the signed-in user written after change number `since`, and the ids of
 * those deleted since. A device keeps its own copy and subscribes to this with the number it has
 * seen, so a save sends only what it wrote and opening the app reads nothing when nothing changed.
 * `reset` asks the device to load everything again: it is ahead of the server (the data was
 * replaced), behind the tombstones still kept, or so far behind that a full load is smaller.
 */
export const changes = query({
  args: { since: v.number() },
  handler: async (ctx, { since }): Promise<Changes | null> => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const state = await ctx.db.query("syncState").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const rev = state?.rev ?? 0;
    if (since > rev || since < (state?.prunedRev ?? 0)) return { rev, reset: true };
    if (since === rev) return { rev, docs: {}, deleted: [] };
    const docs: ChangedDocs = {};
    let budget = CHANGES_MAX;
    for (const table of TABLES) {
      const got = await ctx.db.query(table).withIndex("by_user_rev", (q) => q.eq("userId", userId).gt("rev", since)).take(budget + 1);
      if (got.length > budget) return { rev, reset: true };
      budget -= got.length;
      if (got.length) (docs as Record<Table, unknown[]>)[table] = got;
    }
    const gone = await ctx.db.query("tombstones").withIndex("by_user_rev", (q) => q.eq("userId", userId).gt("rev", since)).take(budget + 1);
    if (gone.length > budget) return { rev, reset: true };
    return { rev, docs, deleted: gone.map((t) => ({ table: t.table as Table, id: t.docId })) };
  },
});

const opArg = v.object({ id: v.string(), kind: v.string(), args: v.any(), at: v.number() });

/**
 * Apply a batch of queued ops, in order. Idempotent: an op id that was seen before returns its
 * recorded outcome and is not applied again, so a client may safely resend after losing the
 * reply. Each outcome carries the user's change number after the batch: once `changes` has
 * brought the device that far, what the batch wrote is in its copy.
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
    const rev = await currentRev(ctx, userId);
    return results.map((r) => ({ ...r, rev }));
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
    for (const t of res.page) if (t._creationTime < before) await deleteSynced(ctx, userId, "transactions", t._id);
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
    for (const d of res.page) if (d.status !== "open" && (d.resolvedAt ?? d._creationTime) < cutoff) await deleteSynced(ctx, d.userId, "drafts", d._id);
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.sync.pruneDrafts, { cutoff, cursor: res.continueCursor });
  },
});

/** A device that has not looked for this long loads everything again rather than replaying deletes. */
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** Daily cron: drop old tombstones, a batch at a time, and record per user how far the drops reach. */
export const pruneTombstones = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - TOMBSTONE_TTL_MS;
    const old = await ctx.db.query("tombstones").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(PRUNE_BATCH);
    const reach = new Map<Id<"users">, number>();
    for (const t of old) {
      await ctx.db.delete(t._id);
      reach.set(t.userId, Math.max(reach.get(t.userId) ?? 0, t.rev));
    }
    for (const [userId, rev] of reach) {
      const state = await ctx.db.query("syncState").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
      if (state && rev > (state.prunedRev ?? 0)) await ctx.db.patch(state._id, { prunedRev: rev });
    }
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, internal.sync.pruneTombstones, { cutoff });
  },
});
