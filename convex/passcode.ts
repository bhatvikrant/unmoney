/**
 * Forgetting the passcode. The passcode is only a screen lock, but removing it must still take a
 * real Google sign-in: the request is recorded here, and the passcode goes only for a session that
 * began after it. Signing out offline and reopening the app keeps the old session, so it does not.
 */
import { mutation } from "./_generated/server";
import { getAuthSessionId } from "@convex-dev/auth/server";
import { requireUser } from "./lib/auth";

async function settingsOf(ctx: Parameters<typeof requireUser>[0], userId: Awaited<ReturnType<typeof requireUser>>) {
  return ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

/** From the lock screen, before signing out. Needs a connection. */
export const requestReset = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const s = await settingsOf(ctx, userId);
    if (s?.passcodeHash) await ctx.db.patch(s._id, { passcodeResetRequestedAt: Date.now() });
  },
});

/** After signing back in: removes the passcode if this session began after the request. */
export const resetAfterSignIn = mutation({
  args: {},
  handler: async (ctx): Promise<"reset" | "not-yet" | "nothing"> => {
    const userId = await requireUser(ctx);
    const s = await settingsOf(ctx, userId);
    if (!s?.passcodeResetRequestedAt) return "nothing";
    const sessionId = await getAuthSessionId(ctx);
    const session = sessionId ? await ctx.db.get(sessionId) : null;
    if (!session || session._creationTime <= s.passcodeResetRequestedAt) return "not-yet";
    await ctx.db.patch(s._id, { passcodeHash: undefined, passcodeSalt: undefined, passcodeResetRequestedAt: undefined });
    return "reset";
  },
});

/** The passcode was remembered after all (unlocked normally): forget the request. */
export const cancelReset = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const s = await settingsOf(ctx, userId);
    if (s?.passcodeResetRequestedAt) await ctx.db.patch(s._id, { passcodeResetRequestedAt: undefined });
  },
});
