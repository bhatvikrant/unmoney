import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { buildCtx, type Ctx as LedgerCtx } from "../../shared/ledger";

export type AnyCtx = QueryCtx | MutationCtx;

export async function requireUser(ctx: AnyCtx): Promise<Id<"users">> {
  const id = await getAuthUserId(ctx);
  if (!id) throw new Error("Not signed in");
  return id;
}

export async function getSettings(ctx: AnyCtx, userId: Id<"users">): Promise<Doc<"settings"> | null> {
  return ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function requireSettings(ctx: AnyCtx, userId: Id<"users">): Promise<Doc<"settings">> {
  const s = await getSettings(ctx, userId);
  if (!s) throw new Error("Finish onboarding first");
  return s;
}

export async function loadLedger(ctx: AnyCtx, userId: Id<"users">) {
  const [settings, accounts, groups] = await Promise.all([
    requireSettings(ctx, userId),
    ctx.db.query("accounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    ctx.db.query("accountGroups").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
  ]);
  const ledger: LedgerCtx = buildCtx(accounts, groups, settings);
  return { settings, accounts, groups, ledger };
}

export async function allTransactions(ctx: AnyCtx, userId: Id<"users">): Promise<Doc<"transactions">[]> {
  return ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect();
}

export async function transactionsInRange(ctx: AnyCtx, userId: Id<"users">, from: string, to: string) {
  return ctx.db
    .query("transactions")
    .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to))
    .collect();
}

export async function owned<T extends { userId: Id<"users"> }>(_ctx: AnyCtx, doc: T | null, userId: Id<"users">): Promise<T> {
  if (!doc || doc.userId !== userId) throw new Error("Not found");
  return doc;
}
