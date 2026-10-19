import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type AnyCtx = QueryCtx | MutationCtx;

/**
 * The signed-in user, or null. A token outlives its user for up to its expiry, so a user deleted
 * (Delete account) counts as signed out at once: nothing written during the purge is left behind.
 */
export async function currentUserId(ctx: AnyCtx): Promise<Id<"users"> | null> {
  const id = await getAuthUserId(ctx);
  return id && (await ctx.db.get(id)) ? id : null;
}

export async function requireUser(ctx: AnyCtx): Promise<Id<"users">> {
  const id = await currentUserId(ctx);
  if (!id) throw new Error("Not signed in");
  return id;
}
