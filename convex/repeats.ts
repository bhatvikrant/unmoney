import { internalMutation } from "./_generated/server";
import { runOps } from "./lib/snapshot";
import { todayISO } from "../shared/dates";

/** Daily cron: add every due scheduled entry, per user, through the same reducer the app uses. */
export const materialiseAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = todayISO();
    const due = await ctx.db.query("repeats").withIndex("by_active_next", (q) => q.eq("active", true).lte("nextDate", today)).collect();
    const users = [...new Set(due.map((r) => r.userId))];
    for (const userId of users) {
      await runOps(ctx, userId, [{ id: `cron_${today}_${userId}_${Date.now()}`, kind: "repeats.catchUp", args: { today }, at: Date.now() }]);
    }
  },
});
