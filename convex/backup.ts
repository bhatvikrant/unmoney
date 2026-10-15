import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

export const exportAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const by = <T extends string>(table: T) => ctx.db.query(table as never).withIndex("by_user" as never, ((q: { eq: (f: string, v: unknown) => unknown }) => q.eq("userId", userId)) as never).collect();
    const [settings, accountGroups, accounts, categoriesE, categoriesI, transactions, repeats, bookmarks, budgets, notes, currencies] = await Promise.all([
      ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
      by("accountGroups"),
      by("accounts"),
      ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect(),
      ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "income")).collect(),
      ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect(),
      by("repeats"),
      by("bookmarks"),
      by("budgets"),
      ctx.db.query("notes").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect(),
      by("currencies"),
    ]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      accountGroups,
      accounts,
      categories: [...categoriesE, ...categoriesI],
      transactions,
      repeats,
      bookmarks,
      budgets,
      notes,
      currencies,
    };
  },
});

/** Replace everything with a backup. Ids are remapped; photos are kept only if they still exist in this deployment. */
export const restore = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    const userId = await requireUser(ctx);
    if (!data || data.version !== 1) throw new Error("Not an unmoney backup file");
    const wipe = async (table: "accountGroups" | "accounts" | "repeats" | "bookmarks" | "budgets" | "currencies") => {
      const docs = await ctx.db.query(table).withIndex("by_user", (q) => q.eq("userId", userId)).collect();
      for (const d of docs) await ctx.db.delete(d._id);
    };
    for (const t of await ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(t._id);
    for (const n of await ctx.db.query("notes").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(n._id);
    for (const type of ["expense", "income"] as const) {
      for (const c of await ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", type)).collect()) await ctx.db.delete(c._id);
    }
    await wipe("repeats"); await wipe("bookmarks"); await wipe("budgets"); await wipe("accounts"); await wipe("accountGroups"); await wipe("currencies");

    const strip = (d: Record<string, unknown>) => {
      const { _id, _creationTime, userId: _u, ...rest } = d;
      void _id; void _creationTime; void _u;
      return rest;
    };
    const groupIds = new Map<string, Id<"accountGroups">>();
    for (const g of data.accountGroups ?? []) groupIds.set(g._id, await ctx.db.insert("accountGroups", { userId, ...strip(g) } as never));
    const accountIds = new Map<string, Id<"accounts">>();
    for (const a of data.accounts ?? []) {
      const { billingAccountId, linkedAccountId, ...rest } = strip(a) as Record<string, unknown>;
      void billingAccountId; void linkedAccountId;
      accountIds.set(a._id, await ctx.db.insert("accounts", { userId, ...rest, groupId: groupIds.get(a.groupId) } as never));
    }
    for (const a of data.accounts ?? []) {
      const patch: Record<string, unknown> = {};
      if (a.billingAccountId && accountIds.get(a.billingAccountId)) patch.billingAccountId = accountIds.get(a.billingAccountId);
      if (a.linkedAccountId && accountIds.get(a.linkedAccountId)) patch.linkedAccountId = accountIds.get(a.linkedAccountId);
      if (Object.keys(patch).length) await ctx.db.patch(accountIds.get(a._id)!, patch as never);
    }
    const catIds = new Map<string, Id<"categories">>();
    const cats = (data.categories ?? []) as { _id: string; parentId?: string }[];
    for (const c of cats.filter((x) => !x.parentId)) catIds.set(c._id, await ctx.db.insert("categories", { userId, ...strip(c as never), parentId: undefined } as never));
    for (const c of cats.filter((x) => x.parentId)) catIds.set(c._id, await ctx.db.insert("categories", { userId, ...strip(c as never), parentId: catIds.get(c.parentId!) } as never));
    const mapTemplate = (t: Record<string, unknown>) => ({
      ...t,
      accountId: accountIds.get(t.accountId as string),
      toAccountId: t.toAccountId ? accountIds.get(t.toAccountId as string) : undefined,
      categoryId: t.categoryId ? catIds.get(t.categoryId as string) : undefined,
      subcategoryId: t.subcategoryId ? catIds.get(t.subcategoryId as string) : undefined,
    });
    const repeatIds = new Map<string, Id<"repeats">>();
    for (const r of data.repeats ?? []) {
      const s = strip(r) as Record<string, unknown>;
      repeatIds.set(r._id, await ctx.db.insert("repeats", { userId, ...s, template: mapTemplate(s.template as Record<string, unknown>) } as never));
    }
    for (const t of data.transactions ?? []) {
      const s = strip(t) as Record<string, unknown>;
      const photoIds: Id<"_storage">[] = [];
      for (const p of (s.photoIds as string[] | undefined) ?? []) {
        const meta = await ctx.db.system.get(p as Id<"_storage">).catch(() => null);
        if (meta) photoIds.push(p as Id<"_storage">);
      }
      if (!accountIds.get(s.accountId as string)) continue;
      await ctx.db.insert("transactions", { userId, ...mapTemplate(s), photoIds, repeatId: s.repeatId ? repeatIds.get(s.repeatId as string) : undefined } as never);
    }
    for (const b of data.bookmarks ?? []) {
      const s = strip(b) as Record<string, unknown>;
      await ctx.db.insert("bookmarks", { userId, ...s, template: mapTemplate(s.template as Record<string, unknown>) } as never);
    }
    for (const b of data.budgets ?? []) {
      const s = strip(b) as Record<string, unknown>;
      await ctx.db.insert("budgets", { userId, ...s, categoryId: s.categoryId ? catIds.get(s.categoryId as string) : undefined } as never);
    }
    for (const n of data.notes ?? []) await ctx.db.insert("notes", { userId, ...strip(n) } as never);
    for (const c of data.currencies ?? []) await ctx.db.insert("currencies", { userId, ...strip(c) } as never);
    if (data.settings) {
      const existing = await ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
      const s = strip(data.settings) as Record<string, unknown>;
      if (existing) await ctx.db.patch(existing._id, s as never);
      else await ctx.db.insert("settings", { userId, ...s } as never);
    }
  },
});

/** Delete every record the user owns (used by "Data initialization"). */
export const wipeAll = mutation({
  args: { confirm: v.literal("DELETE") },
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    for (const t of await ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(t._id);
    for (const n of await ctx.db.query("notes").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(n._id);
    for (const table of ["repeats", "bookmarks", "budgets"] as const) {
      for (const d of await ctx.db.query(table).withIndex("by_user", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(d._id);
    }
  },
});
