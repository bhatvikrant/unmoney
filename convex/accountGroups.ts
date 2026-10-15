import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { owned, requireUser } from "./lib/auth";
import { groupKind } from "./schema";

export const list = query({
  args: { includeDeleted: v.optional(v.boolean()) },
  handler: async (ctx, { includeDeleted }) => {
    const userId = await requireUser(ctx);
    const all = await ctx.db.query("accountGroups").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return all.filter((g) => includeDeleted || !g.deletedAt).sort((a, b) => a.order - b.order);
  },
});

export const create = mutation({
  args: { name: v.string(), kind: groupKind },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const all = await ctx.db.query("accountGroups").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const order = Math.max(-1, ...all.map((g) => g.order)) + 1;
    return ctx.db.insert("accountGroups", { userId, name: args.name.trim(), kind: args.kind, order });
  },
});

export const update = mutation({
  args: { id: v.id("accountGroups"), name: v.optional(v.string()), kind: v.optional(groupKind) },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.patch(id, { ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.kind ? { kind: patch.kind } : {}) });
  },
});

export const remove = mutation({
  args: { id: v.id("accountGroups") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    const accounts = await ctx.db.query("accounts").withIndex("by_group", (q) => q.eq("groupId", id)).collect();
    if (accounts.some((a) => !a.deletedAt)) throw new Error("Move or delete the accounts in this group first");
    await ctx.db.patch(id, { deletedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { id: v.id("accountGroups") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.patch(id, { deletedAt: undefined });
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("accountGroups")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUser(ctx);
    for (let i = 0; i < ids.length; i++) {
      await owned(ctx, await ctx.db.get(ids[i]), userId);
      await ctx.db.patch(ids[i], { order: i });
    }
  },
});
