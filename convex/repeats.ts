import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getSettings, owned, requireUser } from "./lib/auth";
import { frequency, template } from "./schema";
import { nextOccurrence } from "../shared/repeat";
import { todayISO } from "../shared/dates";
import { monthKeyForDate, monthRange } from "../shared/period";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const all = await ctx.db.query("repeats").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return all.sort((a, b) => Number(b.active) - Number(a.active) || a.nextDate.localeCompare(b.nextDate));
  },
});

export const update = mutation({
  args: {
    id: v.id("repeats"),
    frequency: v.optional(frequency),
    endDate: v.optional(v.union(v.string(), v.null())),
    nextDate: v.optional(v.string()),
    active: v.optional(v.boolean()),
    template: v.optional(template),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    const clean: Partial<Doc<"repeats">> = {};
    if (patch.frequency) clean.frequency = patch.frequency;
    if (patch.endDate !== undefined) clean.endDate = patch.endDate ?? undefined;
    if (patch.nextDate) clean.nextDate = patch.nextDate;
    if (patch.active !== undefined) clean.active = patch.active;
    if (patch.template) clean.template = patch.template;
    await ctx.db.patch(id, clean);
  },
});

/** Deleting a schedule keeps the entries it already created. */
export const remove = mutation({
  args: { id: v.id("repeats") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    const created = await ctx.db.query("transactions").withIndex("by_repeat", (q) => q.eq("repeatId", id)).collect();
    for (const t of created) await ctx.db.patch(t._id, { repeatId: undefined });
    await ctx.db.delete(id);
  },
});

async function materialiseOne(ctx: MutationCtx, rep: Doc<"repeats">, horizon: string): Promise<number> {
  let created = 0;
  let next = rep.nextDate;
  let guard = 0;
  while (next <= horizon && guard++ < 400) {
    if (rep.endDate && next > rep.endDate) {
      await ctx.db.patch(rep._id, { active: false, nextDate: next });
      return created;
    }
    await ctx.db.insert("transactions", {
      userId: rep.userId,
      ...rep.template,
      date: next,
      photoIds: [],
      repeatId: rep._id,
    });
    created++;
    next = nextOccurrence(next, rep.startDate, rep.frequency);
  }
  await ctx.db.patch(rep._id, { nextDate: next });
  return created;
}

async function horizonFor(ctx: MutationCtx, userId: Id<"users">): Promise<string> {
  const today = todayISO();
  const s = await getSettings(ctx, userId);
  if (s?.repeatDisplay === "firstOfMonth") return monthRange(monthKeyForDate(today, s.monthStartDay), s.monthStartDay).to;
  return today;
}

/** Called by the client on load so today's entries appear even before the cron runs. */
export const catchUp = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const horizon = await horizonFor(ctx, userId);
    const reps = await ctx.db.query("repeats").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    let created = 0;
    for (const r of reps) if (r.active && r.nextDate <= horizon) created += await materialiseOne(ctx, r, horizon);
    return created;
  },
});

export const materialiseAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = todayISO();
    const due = await ctx.db.query("repeats").withIndex("by_active_next", (q) => q.eq("active", true).lte("nextDate", today)).collect();
    const horizons = new Map<string, string>();
    for (const r of due) {
      let h = horizons.get(r.userId);
      if (!h) {
        h = await horizonFor(ctx, r.userId);
        horizons.set(r.userId, h);
      }
      await materialiseOne(ctx, r, h);
    }
  },
});
