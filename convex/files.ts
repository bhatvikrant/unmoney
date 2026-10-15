import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const urls = query({
  args: { ids: v.array(v.id("_storage")) },
  handler: async (ctx, { ids }) => {
    await requireUser(ctx);
    const out: Record<string, string | null> = {};
    for (const id of ids) out[id] = await ctx.storage.getUrl(id);
    return out;
  },
});

export const remove = mutation({
  args: { id: v.id("_storage") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.storage.delete(id);
  },
});
