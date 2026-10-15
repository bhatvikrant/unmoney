import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { owned, requireUser } from "./lib/auth";

export const list = query({
  args: { includeDeleted: v.optional(v.boolean()) },
  handler: async (ctx, { includeDeleted }) => {
    const userId = await requireUser(ctx);
    const [e, i] = await Promise.all([
      ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect(),
      ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "income")).collect(),
    ]);
    return [...e, ...i].filter((c) => includeDeleted || !c.deletedAt).sort((a, b) => a.order - b.order);
  },
});

export const create = mutation({
  args: { type: v.union(v.literal("income"), v.literal("expense")), name: v.string(), parentId: v.optional(v.id("categories")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!args.name.trim()) throw new Error("Name is required");
    if (args.parentId) {
      const parent = await owned(ctx, await ctx.db.get(args.parentId), userId);
      if (parent.parentId) throw new Error("Only one level of subcategories");
      if (parent.type !== args.type) throw new Error("Parent type mismatch");
    }
    const siblings = await ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", args.type)).collect();
    const order = Math.max(-1, ...siblings.map((c) => c.order)) + 1;
    return ctx.db.insert("categories", { userId, type: args.type, name: args.name.trim(), parentId: args.parentId, order });
  },
});

export const update = mutation({
  args: { id: v.id("categories"), name: v.optional(v.string()), parentId: v.optional(v.union(v.id("categories"), v.null())) },
  handler: async (ctx, { id, name, parentId }) => {
    const userId = await requireUser(ctx);
    const cat = await owned(ctx, await ctx.db.get(id), userId);
    const patch: { name?: string; parentId?: undefined | typeof cat.parentId } = {};
    if (name !== undefined) {
      if (!name.trim()) throw new Error("Name is required");
      patch.name = name.trim();
    }
    if (parentId !== undefined) {
      if (parentId === null) patch.parentId = undefined;
      else {
        if (parentId === id) throw new Error("A category cannot be its own parent");
        const parent = await owned(ctx, await ctx.db.get(parentId), userId);
        if (parent.parentId) throw new Error("Only one level of subcategories");
        const children = await ctx.db.query("categories").withIndex("by_parent", (q) => q.eq("parentId", id)).collect();
        if (children.some((c) => !c.deletedAt)) throw new Error("Move its subcategories first");
        patch.parentId = parentId;
      }
    }
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("categories") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    const children = await ctx.db.query("categories").withIndex("by_parent", (q) => q.eq("parentId", id)).collect();
    for (const c of children) await ctx.db.patch(c._id, { deletedAt: Date.now() });
    await ctx.db.patch(id, { deletedAt: Date.now() });
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("categories")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUser(ctx);
    for (let i = 0; i < ids.length; i++) {
      await owned(ctx, await ctx.db.get(ids[i]), userId);
      await ctx.db.patch(ids[i], { order: i });
    }
  },
});
