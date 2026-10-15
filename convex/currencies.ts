import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { owned, requireUser } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const all = await ctx.db.query("currencies").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return all.sort((a, b) => a.order - b.order);
  },
});

const fields = {
  code: v.string(),
  name: v.string(),
  symbol: v.string(),
  rate: v.number(),
  decimals: v.number(),
  symbolPosition: v.union(v.literal("before"), v.literal("after")),
  isCustom: v.boolean(),
};

export const add = mutation({
  args: fields,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!args.code.trim()) throw new Error("Code is required");
    if (!(args.rate > 0)) throw new Error("Rate must be positive");
    const all = await ctx.db.query("currencies").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    if (all.some((c) => c.code.toLowerCase() === args.code.trim().toLowerCase())) throw new Error("Already added");
    return ctx.db.insert("currencies", { userId, order: all.length, ...args, code: args.code.trim().toUpperCase() });
  },
});

export const update = mutation({
  args: { id: v.id("currencies"), rate: v.optional(v.number()), decimals: v.optional(v.number()), symbolPosition: v.optional(v.union(v.literal("before"), v.literal("after"))), symbol: v.optional(v.string()), name: v.optional(v.string()) },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    if (patch.rate !== undefined && !(patch.rate > 0)) throw new Error("Rate must be positive");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("currencies") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.delete(id);
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("currencies")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUser(ctx);
    for (let i = 0; i < ids.length; i++) {
      await owned(ctx, await ctx.db.get(ids[i]), userId);
      await ctx.db.patch(ids[i], { order: i });
    }
  },
});

/** Apply a batch of rates (the client fetches them from a public rates API). */
export const setRates = mutation({
  args: { rates: v.array(v.object({ id: v.id("currencies"), rate: v.number() })) },
  handler: async (ctx, { rates }) => {
    const userId = await requireUser(ctx);
    for (const r of rates) {
      await owned(ctx, await ctx.db.get(r.id), userId);
      if (r.rate > 0) await ctx.db.patch(r.id, { rate: r.rate });
    }
  },
});
