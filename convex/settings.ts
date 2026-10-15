import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getSettings, requireUser } from "./lib/auth";
import { currencyInfo } from "../shared/currencies";
import {
  DEFAULT_ACCOUNTS, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_GROUPS, DEFAULT_INCOME_CATEGORIES,
} from "../shared/defaults";
import type { Id } from "./_generated/dataModel";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const [settings, user] = await Promise.all([getSettings(ctx, userId), ctx.db.get(userId)]);
    return { settings, user: user ? { name: user.name, email: user.email, image: user.image } : null };
  },
});

export const completeOnboarding = mutation({
  args: { currency: v.string(), symbolPosition: v.optional(v.union(v.literal("before"), v.literal("after"))) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (await getSettings(ctx, userId)) return;
    const info = currencyInfo(args.currency) ?? { code: args.currency, symbol: args.currency, decimals: 2, name: args.currency };
    await ctx.db.insert("settings", {
      userId,
      onboarded: true,
      mainCurrency: info.code,
      symbol: info.symbol,
      symbolPosition: args.symbolPosition ?? info.position ?? "before",
      decimals: info.decimals,
      monthStartDay: 1,
      weekStartDay: 0,
      carryOver: false,
      startScreen: "daily",
      theme: "system",
      accent: "neutral",
      colorSet: "A",
      subcategoryEnabled: true,
      autocompleteEnabled: true,
      timeInputEnabled: false,
      repeatDisplay: "onDate",
      cardExpenseDisplay: "atTime",
      lockAfter: "always",
    });
    const groupIds = new Map<string, Id<"accountGroups">>();
    let order = 0;
    for (const g of DEFAULT_GROUPS) {
      const id = await ctx.db.insert("accountGroups", { userId, name: g.name, kind: g.kind as never, order: order++ });
      groupIds.set(g.kind, id);
    }
    order = 0;
    for (const a of DEFAULT_ACCOUNTS) {
      await ctx.db.insert("accounts", {
        userId,
        groupId: groupIds.get(a.groupKind)!,
        name: a.name,
        initialBalance: 0,
        includeInTotals: true,
        hidden: false,
        order: order++,
        transferAsExpense: false,
      });
    }
    order = 0;
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await ctx.db.insert("categories", { userId, type: "expense", name, order: order++ });
    }
    order = 0;
    for (const name of DEFAULT_INCOME_CATEGORIES) {
      await ctx.db.insert("categories", { userId, type: "income", name, order: order++ });
    }
  },
});

export const update = mutation({
  args: {
    patch: v.object({
      mainCurrency: v.optional(v.string()),
      symbol: v.optional(v.string()),
      symbolPosition: v.optional(v.union(v.literal("before"), v.literal("after"))),
      decimals: v.optional(v.number()),
      monthStartDay: v.optional(v.number()),
      weekStartDay: v.optional(v.number()),
      carryOver: v.optional(v.boolean()),
      startScreen: v.optional(v.union(v.literal("daily"), v.literal("calendar"))),
      theme: v.optional(v.union(v.literal("system"), v.literal("light"), v.literal("dark"))),
      accent: v.optional(v.string()),
      colorSet: v.optional(v.union(v.literal("A"), v.literal("B"))),
      subcategoryEnabled: v.optional(v.boolean()),
      autocompleteEnabled: v.optional(v.boolean()),
      timeInputEnabled: v.optional(v.boolean()),
      repeatDisplay: v.optional(v.union(v.literal("onDate"), v.literal("firstOfMonth"))),
      cardExpenseDisplay: v.optional(v.union(v.literal("atTime"), v.literal("lumpSum"))),
      lockAfter: v.optional(v.union(v.literal("always"), v.literal("5m"), v.literal("1h"))),
    }),
  },
  handler: async (ctx, { patch }) => {
    const userId = await requireUser(ctx);
    const s = await getSettings(ctx, userId);
    if (!s) throw new Error("Finish onboarding first");
    if (patch.monthStartDay !== undefined && (patch.monthStartDay < 1 || patch.monthStartDay > 28)) {
      throw new Error("Month start day must be between 1 and 28");
    }
    if (patch.weekStartDay !== undefined && (patch.weekStartDay < 0 || patch.weekStartDay > 6)) {
      throw new Error("Week start day must be between 0 and 6");
    }
    if (patch.decimals !== undefined && (patch.decimals < 0 || patch.decimals > 8)) {
      throw new Error("Decimals must be between 0 and 8");
    }
    await ctx.db.patch(s._id, patch);
  },
});

/** Change the main currency. Keeps every record; amounts are rescaled if the decimals change. */
export const changeMainCurrency = mutation({
  args: { code: v.string(), keepData: v.boolean() },
  handler: async (ctx, { code, keepData }) => {
    const userId = await requireUser(ctx);
    const s = await getSettings(ctx, userId);
    if (!s) throw new Error("Finish onboarding first");
    const info = currencyInfo(code) ?? { code, symbol: code, decimals: 2, name: code };
    const factor = 10 ** (info.decimals - s.decimals);
    const txs = await ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect();
    if (!keepData) {
      for (const t of txs) await ctx.db.delete(t._id);
    } else if (factor !== 1) {
      for (const t of txs) {
        await ctx.db.patch(t._id, {
          amount: Math.round(t.amount * factor),
          feeAmount: t.feeAmount === undefined ? undefined : Math.round(t.feeAmount * factor),
          installmentTotal: t.installmentTotal === undefined ? undefined : Math.round(t.installmentTotal * factor),
        });
      }
      const accounts = await ctx.db.query("accounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
      for (const a of accounts) await ctx.db.patch(a._id, { initialBalance: Math.round(a.initialBalance * factor) });
      const budgets = await ctx.db.query("budgets").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
      for (const b of budgets) {
        const overrides: Record<string, number> = {};
        for (const [k, val] of Object.entries(b.overrides)) overrides[k] = Math.round(val * factor);
        await ctx.db.patch(b._id, { amount: Math.round(b.amount * factor), overrides });
      }
    }
    await ctx.db.patch(s._id, {
      mainCurrency: info.code,
      symbol: info.symbol,
      decimals: info.decimals,
      symbolPosition: info.position ?? "before",
    });
  },
});

export const setPasscode = mutation({
  args: { hash: v.optional(v.string()), salt: v.optional(v.string()) },
  handler: async (ctx, { hash, salt }) => {
    const userId = await requireUser(ctx);
    const s = await getSettings(ctx, userId);
    if (!s) throw new Error("Finish onboarding first");
    await ctx.db.patch(s._id, { passcodeHash: hash, passcodeSalt: salt });
  },
});
