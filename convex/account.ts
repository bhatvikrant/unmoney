/**
 * Delete my account: every document, stored file and sign-in record of the user, removed in
 * scheduled batches so even a large ledger stays within Convex's per-function limits.
 */
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";

const BATCH = 500;

async function deleteFile(ctx: MutationCtx, id: Id<"_storage">) {
  try {
    await ctx.storage.delete(id);
  } catch {
    // already gone
  }
}

type Doc = { _id: string; storageId?: Id<"_storage"> };

/** Each step: up to BATCH of the user's documents, and what else to remove with each. */
const STEPS: { name: string; take: (ctx: MutationCtx, userId: Id<"users">) => Promise<Doc[]>; also?: (ctx: MutationCtx, doc: Doc) => Promise<void> }[] = [
  // photos go with fileOwners below: an entry's photoIds may name someone else's file (a backup
  // restored from another account), so only files this user owns are deleted
  { name: "transactions", take: (ctx, u) => ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", u)).take(BATCH) },
  { name: "notes", take: (ctx, u) => ctx.db.query("notes").withIndex("by_user_date", (q) => q.eq("userId", u)).take(BATCH) },
  { name: "categories", take: (ctx, u) => ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", u)).take(BATCH) },
  { name: "syncOps", take: (ctx, u) => ctx.db.query("syncOps").withIndex("by_user_op", (q) => q.eq("userId", u)).take(BATCH) },
  { name: "pendingImports", take: (ctx, u) => ctx.db.query("pendingImports").withIndex("by_user", (q) => q.eq("userId", u)).take(BATCH),
    also: async (ctx, d) => { if (d.storageId) await deleteFile(ctx, d.storageId); } },
  { name: "fileOwners", take: (ctx, u) => ctx.db.query("fileOwners").withIndex("by_user", (q) => q.eq("userId", u)).take(BATCH),
    also: async (ctx, d) => { if (d.storageId) await deleteFile(ctx, d.storageId); } },
  ...(["settings", "accountGroups", "accounts", "repeats", "bookmarks", "budgets", "currencies", "importLinks", "categoryCleanups", "history", "gmailConnections", "drafts"] as const).map((t) => ({
    name: t, take: (ctx: MutationCtx, u: Id<"users">) => ctx.db.query(t).withIndex("by_user", (q) => q.eq("userId", u)).take(BATCH),
  })),
  { name: "authAccounts", take: (ctx, u) => ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", u)).take(BATCH),
    also: async (ctx, d) => {
      for (const c of await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", d._id as Id<"authAccounts">)).collect()) await ctx.db.delete(c._id);
    } },
  { name: "authSessions", take: (ctx, u) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", u)).take(BATCH),
    also: async (ctx, d) => {
      for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", d._id as Id<"authSessions">)).collect()) await ctx.db.delete(t._id);
    } },
];

export const deleteMyAccount = mutation({
  args: { confirm: v.literal("DELETE") },
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    // the Gmail grant is revoked at Google before its row goes
    const gmail = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (gmail) await ctx.scheduler.runAfter(0, internal.gmail.revokeForUser, { refreshTokenEnc: gmail.refreshTokenEnc, iv: gmail.iv });
    // gone at once: from now every call with this user's token is refused (lib/auth currentUserId)
    await ctx.db.delete(userId);
    await ctx.scheduler.runAfter(0, internal.account.purge, { userId, step: 0 });
  },
});

export const purge = internalMutation({
  args: { userId: v.id("users"), step: v.number() },
  handler: async (ctx, { userId, step }) => {
    if (step >= STEPS.length) {
      if (await ctx.db.get(userId)) await ctx.db.delete(userId);
      return;
    }
    const { take, also } = STEPS[step];
    const docs = await take(ctx, userId);
    for (const d of docs) {
      if (also) await also(ctx, d);
      await ctx.db.delete(d._id as Id<"transactions">);
    }
    await ctx.scheduler.runAfter(0, internal.account.purge, { userId, step: docs.length === BATCH ? step : step + 1 });
  },
});
