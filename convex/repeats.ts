import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { runOps } from "./lib/snapshot";
import { toISO } from "../shared/dates";

/**
 * The date nowhere has reached yet: today in the last time zone to start it (UTC-12). The job
 * never adds an entry before its day has begun for the user, wherever they are; the app adds due
 * entries on open in the user's own time zone, so the job is only the fallback.
 */
function earliestToday(): string {
  return toISO(new Date(Date.now() - 12 * 60 * 60 * 1000));
}

const PAGE = 500;

/**
 * Hourly cron: find users with due schedules, a page at a time, and hand each one to its own
 * mutation, so one user's large ledger never holds up (or fails) the run for everyone else.
 */
export const materialiseAll = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), today: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const today = args.today ?? earliestToday();
    const res = await ctx.db.query("repeats").withIndex("by_active_next", (q) => q.eq("active", true).lte("nextDate", today))
      .paginate({ numItems: PAGE, cursor: args.cursor ?? null });
    for (const userId of new Set(res.page.map((r) => r.userId))) {
      await ctx.scheduler.runAfter(0, internal.repeats.materialiseUser, { userId, today });
    }
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.repeats.materialiseAll, { cursor: res.continueCursor, today });
  },
});

/** Add one user's due scheduled entries through the same reducer the app uses. */
export const materialiseUser = internalMutation({
  args: { userId: v.id("users"), today: v.string() },
  handler: async (ctx, { userId, today }) => {
    const [outcome] = await runOps(ctx, userId, [{ id: `cron_${today}_${userId}_${Date.now()}`, kind: "repeats.catchUp", args: { today }, at: Date.now() }]);
    if (outcome.status === "rejected") console.error(`repeats.catchUp failed for ${userId}: ${outcome.error}`);
  },
});
