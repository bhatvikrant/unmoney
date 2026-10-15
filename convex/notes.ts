import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { owned, requireUser } from "./lib/auth";

export const listRange = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const userId = await requireUser(ctx);
    return ctx.db
      .query("notes")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to))
      .collect();
  },
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const userId = await requireUser(ctx);
    const all = await ctx.db.query("notes").withIndex("by_user_date", (s) => s.eq("userId", userId)).order("desc").collect();
    const lower = q.trim().toLowerCase();
    return all.filter((n) => !lower || n.text.toLowerCase().includes(lower)).slice(0, 200);
  },
});

export const upsert = mutation({
  args: { id: v.optional(v.id("notes")), date: v.string(), text: v.string(), color: v.string() },
  handler: async (ctx, { id, date, text, color }) => {
    const userId = await requireUser(ctx);
    if (id) {
      await owned(ctx, await ctx.db.get(id), userId);
      await ctx.db.patch(id, { date, text, color });
      return id;
    }
    return ctx.db.insert("notes", { userId, date, text, color });
  },
});

export const remove = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.delete(id);
  },
});
