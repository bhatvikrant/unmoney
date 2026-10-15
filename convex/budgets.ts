import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { loadLedger, owned, requireUser, transactionsInRange } from "./lib/auth";
import { budgetPeriod } from "./schema";
import { kindsOf } from "../shared/ledger";
import { elapsedFraction, periodRange } from "../shared/period";
import { todayISO } from "../shared/dates";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return ctx.db.query("budgets").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  },
});

export const upsert = mutation({
  args: { id: v.optional(v.id("budgets")), categoryId: v.optional(v.id("categories")), period: budgetPeriod, amount: v.number() },
  handler: async (ctx, { id, categoryId, period, amount }) => {
    const userId = await requireUser(ctx);
    if (!Number.isInteger(amount) || amount < 0) throw new Error("Amount must be positive");
    if (categoryId) {
      const c = await owned(ctx, await ctx.db.get(categoryId), userId);
      if (c.type !== "expense") throw new Error("Budgets are for expense categories");
    }
    if (id) {
      await owned(ctx, await ctx.db.get(id), userId);
      await ctx.db.patch(id, { categoryId, period, amount });
      return id;
    }
    const all = await ctx.db.query("budgets").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const dup = all.find((b) => b.period === period && (b.categoryId ?? null) === (categoryId ?? null));
    if (dup) {
      await ctx.db.patch(dup._id, { amount });
      return dup._id;
    }
    return ctx.db.insert("budgets", { userId, categoryId, period, amount, overrides: {} });
  },
});

export const setOverride = mutation({
  args: { id: v.id("budgets"), key: v.string(), amount: v.union(v.number(), v.null()) },
  handler: async (ctx, { id, key, amount }) => {
    const userId = await requireUser(ctx);
    const b = await owned(ctx, await ctx.db.get(id), userId);
    const overrides = { ...b.overrides };
    if (amount === null) delete overrides[key];
    else overrides[key] = amount;
    await ctx.db.patch(id, { overrides });
  },
});

export const remove = mutation({
  args: { id: v.id("budgets") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.delete(id);
  },
});

/** Spent vs limit for every budget of a period. `key` is the period key (month "2026-07", week start date, or year). */
export const status = query({
  args: { period: budgetPeriod, key: v.string() },
  handler: async (ctx, { period, key }) => {
    const userId = await requireUser(ctx);
    const { settings, ledger } = await loadLedger(ctx, userId);
    const range = periodRange(period, key, settings.monthStartDay, settings.weekStartDay);
    const [budgets, txs, cats] = await Promise.all([
      ctx.db.query("budgets").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      transactionsInRange(ctx, userId, range.from, range.to),
      ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect(),
    ]);
    const parentOf = new Map(cats.map((c) => [c._id, c.parentId ?? c._id]));
    const spentByCat = new Map<string, number>();
    let spentAll = 0;
    for (const t of txs) {
      const k = kindsOf(t, ledger);
      if (!k.expense) continue;
      spentAll += k.expense;
      if (t.categoryId) {
        const main = parentOf.get(t.categoryId) ?? t.categoryId;
        spentByCat.set(main, (spentByCat.get(main) ?? 0) + k.expense);
      }
    }
    const items = budgets
      .filter((b) => b.period === period)
      .map((b) => {
        const limit = b.overrides[key] ?? b.amount;
        const spent = b.categoryId ? spentByCat.get(b.categoryId) ?? 0 : spentAll;
        return { budget: b, limit, spent, remaining: limit - spent, isOverride: b.overrides[key] !== undefined };
      });
    const total = items.find((i) => !i.budget.categoryId);
    const perCategory = items.filter((i) => i.budget.categoryId).sort((a, b) => b.spent / Math.max(1, b.limit) - a.spent / Math.max(1, a.limit));
    return { range, total, perCategory, spentAll, elapsed: elapsedFraction(range, todayISO()) };
  },
});
