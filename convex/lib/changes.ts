/**
 * Change numbers, so a device downloads only what changed since it last looked (sync.changes)
 * instead of re-reading whole tables. Every write to a synced table goes through these helpers:
 * the first one in a mutation adds one to the user's syncState.rev, and everything that mutation
 * writes carries that number; a delete leaves a tombstone with it. Mutations are serialised on the
 * syncState document, so a number is never handed out twice and a device that has seen number n
 * has seen every write up to it.
 */
import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Table } from "../../shared/ops";

const bumped = new WeakMap<object, Map<string, Promise<number>>>();

/** The change number of this mutation's writes for the user: the first call adds one, later calls get the same. */
export function revFor(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
  let byUser = bumped.get(ctx.db);
  if (!byUser) bumped.set(ctx.db, (byUser = new Map()));
  let rev = byUser.get(userId);
  if (!rev) {
    rev = bump(ctx, userId);
    byUser.set(userId, rev);
  }
  return rev;
}

/** The user's change number as of this point in the mutation or query (0 before their first write). */
export async function currentRev(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<number> {
  const mine = bumped.get(ctx.db)?.get(userId);
  if (mine) return mine;
  return (await ctx.db.query("syncState").withIndex("by_user", (q) => q.eq("userId", userId)).unique())?.rev ?? 0;
}

async function bump(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
  const state = await ctx.db.query("syncState").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (!state) {
    await ctx.db.insert("syncState", { userId, rev: 1 });
    return 1;
  }
  await ctx.db.patch(state._id, { rev: state.rev + 1 });
  return state.rev + 1;
}

export async function insertSynced<T extends Table>(ctx: MutationCtx, userId: Id<"users">, table: T, value: Record<string, unknown>): Promise<Id<T>> {
  const rev = await revFor(ctx, userId);
  return (await ctx.db.insert(table as never, { ...value, userId, rev } as never)) as Id<T>;
}

export async function patchSynced(ctx: MutationCtx, userId: Id<"users">, id: Id<Table>, value: Record<string, unknown>): Promise<void> {
  const rev = await revFor(ctx, userId);
  await ctx.db.patch(id, { ...value, rev } as never);
}

export async function replaceSynced(ctx: MutationCtx, userId: Id<"users">, id: Id<Table>, value: Record<string, unknown>): Promise<void> {
  const rev = await revFor(ctx, userId);
  await ctx.db.replace(id, { ...value, userId, rev } as never);
}

export async function deleteSynced(ctx: MutationCtx, userId: Id<"users">, table: Table, id: Id<TableNames>): Promise<void> {
  const rev = await revFor(ctx, userId);
  await ctx.db.delete(id);
  await ctx.db.insert("tombstones", { userId, table, docId: id, rev });
}
