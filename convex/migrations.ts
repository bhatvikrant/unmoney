/**
 * One-off data migrations. Run on a deployment with e.g. `npx convex run migrations:accountKinds`.
 * Each is safe to run more than once.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const BATCH = 200;

/**
 * Payment methods used to take their type from their group. Copies each group's kind onto every
 * account in it that has no kind yet (an account without a group, or whose group has no kind,
 * becomes "other"), a batch at a time, rescheduling itself until every account is done. The app
 * does the same for the signed-in user on load (the "accounts.adoptKinds" op), so this only
 * speeds things up for people who have not opened it since.
 */
export const accountKinds = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), updated: v.optional(v.number()) },
  handler: async (ctx, { cursor, updated = 0 }): Promise<number> => {
    const page = await ctx.db.query("accounts").paginate({ cursor: cursor ?? null, numItems: BATCH });
    const groups = new Map<Id<"accountGroups">, Doc<"accountGroups"> | null>();
    for (const a of page.page) {
      if (a.kind) continue;
      let group: Doc<"accountGroups"> | null = null;
      if (a.groupId) {
        if (!groups.has(a.groupId)) groups.set(a.groupId, await ctx.db.get(a.groupId));
        group = groups.get(a.groupId) ?? null;
      }
      await ctx.db.patch(a._id, { kind: group?.kind ?? "other" });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.accountKinds, { cursor: page.continueCursor, updated });
    else console.log(`migrations:accountKinds done, ${updated} accounts updated`);
    return updated;
  },
});
