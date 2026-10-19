import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser, type AnyCtx } from "./lib/auth";

async function ownerOf(ctx: AnyCtx, storageId: Id<"_storage">) {
  return ctx.db.query("fileOwners").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
}

/** Record that `userId` uploaded the file; a file someone else already owns is refused. */
export async function setOwner(ctx: MutationCtx, userId: Id<"users">, storageId: Id<"_storage">) {
  const owner = await ownerOf(ctx, storageId);
  if (owner && owner.userId !== userId) throw new Error("That file belongs to someone else");
  if (!owner) await ctx.db.insert("fileOwners", { userId, storageId });
}

export async function forgetOwner(ctx: MutationCtx, storageId: Id<"_storage">) {
  const owner = await ownerOf(ctx, storageId);
  if (owner) await ctx.db.delete(owner._id);
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/** How soon after an upload the uploader must claim it; older owner-less files are not claimable. */
const CLAIM_WINDOW_MS = 60 * 60 * 1000;

/**
 * Called by the app right after an upload, before the file is used anywhere. Only a fresh upload
 * can be claimed, so nobody can take over a file from before owners were recorded (whose id they
 * may know from a backup) and lock its real owner out.
 */
export const claim = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await requireUser(ctx);
    const file = await ctx.db.system.get(storageId);
    if (!file) throw new Error("File not found");
    const owner = await ownerOf(ctx, storageId);
    if (!owner && Date.now() - file._creationTime > CLAIM_WINDOW_MS) throw new Error("That file can no longer be claimed");
    await setOwner(ctx, userId, storageId);
  },
});

/**
 * URLs for the signed-in user's files; null for anyone else's. Files uploaded before owners were
 * recorded have no owner until `backfillOwners` has run, and are still served meanwhile.
 */
export const urls = query({
  args: { ids: v.array(v.id("_storage")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUser(ctx);
    const out: Record<string, string | null> = {};
    for (const id of ids) {
      const owner = await ownerOf(ctx, id);
      out[id] = owner && owner.userId !== userId ? null : await ctx.storage.getUrl(id);
    }
    return out;
  },
});

export const remove = mutation({
  args: { id: v.id("_storage") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const owner = await ownerOf(ctx, id);
    if (owner?.userId !== userId) throw new Error("Not found");
    await ctx.storage.delete(id);
    await ctx.db.delete(owner._id);
  },
});

/**
 * One-off: record owners for files uploaded before `fileOwners` existed, from the entries and
 * import inbox that reference them. Runs a page at a time and reschedules itself:
 * `npx convex run --prod files:backfillOwners`
 */
export const backfillOwners = internalMutation({
  args: { table: v.optional(v.union(v.literal("transactions"), v.literal("pendingImports"))), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { table = "transactions", cursor = null }) => {
    const res = await ctx.db.query(table).paginate({ numItems: 500, cursor });
    for (const doc of res.page) {
      const ids = "photoIds" in doc ? doc.photoIds : [doc.storageId];
      for (const id of ids) if (!(await ownerOf(ctx, id))) await ctx.db.insert("fileOwners", { userId: doc.userId, storageId: id });
    }
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.files.backfillOwners, { table, cursor: res.continueCursor });
    else if (table === "transactions") await ctx.scheduler.runAfter(0, internal.files.backfillOwners, { table: "pendingImports" });
  },
});
