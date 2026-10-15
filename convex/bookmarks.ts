import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { owned, requireUser } from "./lib/auth";
import { template } from "./schema";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const all = await ctx.db.query("bookmarks").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return all.sort((a, b) => a.order - b.order);
  },
});

export const create = mutation({
  args: { template },
  handler: async (ctx, { template: t }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(t.accountId), userId);
    const all = await ctx.db.query("bookmarks").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return ctx.db.insert("bookmarks", { userId, order: all.length, template: t });
  },
});

export const update = mutation({
  args: { id: v.id("bookmarks"), template },
  handler: async (ctx, { id, template: t }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.patch(id, { template: t });
  },
});

export const remove = mutation({
  args: { id: v.id("bookmarks") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.delete(id);
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("bookmarks")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUser(ctx);
    for (let i = 0; i < ids.length; i++) {
      await owned(ctx, await ctx.db.get(ids[i]), userId);
      await ctx.db.patch(ids[i], { order: i });
    }
  },
});
