import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { allTransactions, loadLedger, owned, requireUser } from "./lib/auth";
import {
  cardStatus, computeBalances, debitMonthlyUsage, holderOf, kindsOf, nextPaymentDate,
} from "../shared/ledger";
import { todayISO, addDays, addMonths, parts, make, daysInMonth } from "../shared/dates";
import type { Doc, Id } from "./_generated/dataModel";

const accountFields = {
  name: v.string(),
  groupId: v.id("accountGroups"),
  initialBalance: v.number(),
  includeInTotals: v.boolean(),
  hidden: v.boolean(),
  transferAsExpense: v.boolean(),
  description: v.optional(v.string()),
  billingAccountId: v.optional(v.id("accounts")),
  settlementDay: v.optional(v.number()),
  paymentDay: v.optional(v.number()),
  linkedAccountId: v.optional(v.id("accounts")),
};

async function validate(ctx: Parameters<typeof loadLedger>[0], userId: Id<"users">, a: {
  name: string; groupId: Id<"accountGroups">; billingAccountId?: Id<"accounts">; settlementDay?: number;
  paymentDay?: number; linkedAccountId?: Id<"accounts">; initialBalance: number;
}, selfId?: Id<"accounts">) {
  if (!a.name.trim()) throw new Error("Name is required");
  if (!Number.isInteger(a.initialBalance)) throw new Error("Amount must be a whole number of minor units");
  const group = await owned(ctx, await ctx.db.get(a.groupId), userId);
  if (group.kind === "card") {
    if (!a.billingAccountId) throw new Error("A credit card needs a billing account");
    if (a.billingAccountId === selfId) throw new Error("A card cannot bill itself");
    await owned(ctx, await ctx.db.get(a.billingAccountId), userId);
    for (const d of [a.settlementDay, a.paymentDay]) {
      if (d === undefined || d < 1 || d > 31) throw new Error("Settlement and payment days must be between 1 and 31");
    }
  }
  if (group.kind === "debitCard") {
    if (!a.linkedAccountId) throw new Error("A debit card needs a linked bank account");
    if (a.linkedAccountId === selfId) throw new Error("A debit card cannot link to itself");
    await owned(ctx, await ctx.db.get(a.linkedAccountId), userId);
  }
  return group;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const { accounts, groups, ledger } = await loadLedger(ctx, userId);
    const txs = await allTransactions(ctx, userId);
    const balances = computeBalances(txs, ledger);
    const today = todayISO();
    const live = accounts.filter((a) => !a.deletedAt).sort((a, b) => a.order - b.order);
    const rows = live.map((a) => {
      const kind = ledger.groups.get(a.groupId)?.kind;
      const balance = balances.get(a._id) ?? 0;
      const card = kind === "card" ? cardStatus(a, balance, txs, today) : undefined;
      const monthlyUsage = kind === "debitCard" ? debitMonthlyUsage(a._id, txs, today) : undefined;
      return {
        ...a,
        kind,
        balance,
        payable: card?.payable,
        outstanding: card?.outstanding,
        nextPayment: kind === "card" && a.paymentDay ? nextPaymentDate(a.paymentDay, today) : undefined,
        monthlyUsage,
      };
    });
    let assets = 0;
    let liabilities = 0;
    for (const r of rows) {
      if (!r.includeInTotals) continue;
      if (r.kind === "debitCard") continue; // the linked bank account already holds the money
      if (r.balance >= 0) assets += r.balance;
      else liabilities += -r.balance;
    }
    const grouped = groups
      .filter((g) => !g.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((g) => {
        const items = rows.filter((r) => r.groupId === g._id);
        const total = items.filter((r) => r.includeInTotals).reduce((s, r) => s + r.balance, 0);
        const payable = items.reduce((s, r) => s + (r.payable ?? 0), 0);
        const outstanding = items.reduce((s, r) => s + (r.outstanding ?? 0), 0);
        return { group: g, accounts: items, total, payable, outstanding };
      })
      .filter((g) => g.accounts.length > 0);
    return { groups: grouped, accounts: rows, assets, liabilities, total: assets - liabilities };
  },
});

export const listDeleted = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const accounts = await ctx.db.query("accounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const groups = await ctx.db.query("accountGroups").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return {
      accounts: accounts.filter((a) => a.deletedAt).map((a) => ({ ...a, groupName: groups.find((g) => g._id === a.groupId)?.name })),
      groups: groups.filter((g) => g.deletedAt),
    };
  },
});

export const get = query({
  args: {
    id: v.id("accounts"),
    granularity: v.union(v.literal("daily"), v.literal("monthly"), v.literal("yearly")),
    from: v.string(),
    to: v.string(),
  },
  handler: async (ctx, { id, granularity, from, to }) => {
    const userId = await requireUser(ctx);
    const account = await owned(ctx, await ctx.db.get(id), userId);
    const { ledger, groups } = await loadLedger(ctx, userId);
    const all = await allTransactions(ctx, userId);
    const balances = computeBalances(all, ledger);
    const balance = balances.get(id) ?? 0;
    const kind = groups.find((g) => g._id === account.groupId)?.kind;

    // Running balance per date for this account.
    const deltas = new Map<string, number>();
    const bump = (d: string, n: number) => deltas.set(d, (deltas.get(d) ?? 0) + n);
    for (const tx of all) {
      const holder = holderOf(ledger, tx.accountId);
      if (tx.type === "income" && holder === id) bump(tx.date, tx.amount);
      else if (tx.type === "expense" && holder === id) bump(tx.date, -tx.amount);
      else if (tx.type === "transfer") {
        if (holder === id) bump(tx.date, -tx.amount - (tx.feeAmount ?? 0));
        if (tx.toAccountId && holderOf(ledger, tx.toAccountId) === id) bump(tx.date, tx.amount);
      }
    }
    const sortedDates = [...deltas.keys()].sort();
    const balanceAt = (date: string) => {
      let b = account.initialBalance;
      for (const d of sortedDates) {
        if (d > date) break;
        b += deltas.get(d)!;
      }
      return b;
    };
    const series: { label: string; date: string; balance: number }[] = [];
    if (granularity === "daily") {
      for (let d = from; d <= to; d = addDays(d, 1)) series.push({ label: String(parts(d).d), date: d, balance: balanceAt(d) });
    } else if (granularity === "monthly") {
      const { y, m } = parts(to);
      for (let i = 11; i >= 0; i--) {
        const first = addMonths(make(y, m, 1), -i);
        const p = parts(first);
        const end = make(p.y, p.m, daysInMonth(p.y, p.m));
        series.push({ label: `${p.y}-${String(p.m).padStart(2, "0")}`, date: end, balance: balanceAt(end) });
      }
    } else {
      const { y } = parts(to);
      for (let i = 5; i >= 0; i--) {
        const end = make(y - i, 12, 31);
        series.push({ label: String(y - i), date: end, balance: balanceAt(end) });
      }
    }

    const inRange = all.filter((t) => t.date >= from && t.date <= to);
    const expenses = new Map<string, number>();
    const income = new Map<string, number>();
    const transfersIn = new Map<string, number>();
    const transfersOut = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
    const txs: Doc<"transactions">[] = [];
    for (const tx of inRange) {
      const touches = tx.accountId === id || tx.toAccountId === id || holderOf(ledger, tx.accountId) === id ||
        (tx.toAccountId !== undefined && holderOf(ledger, tx.toAccountId) === id);
      if (!touches) continue;
      txs.push(tx);
      const k = kindsOf(tx, ledger);
      if (tx.type === "expense" && (tx.accountId === id || holderOf(ledger, tx.accountId) === id)) add(expenses, tx.categoryId ?? "none", k.expense);
      if (tx.type === "income" && (tx.accountId === id || holderOf(ledger, tx.accountId) === id)) add(income, tx.categoryId ?? "none", k.income);
      if (tx.type === "transfer") {
        if (tx.accountId === id || holderOf(ledger, tx.accountId) === id) add(transfersOut, tx.toAccountId ?? "none", tx.amount + (tx.feeAmount ?? 0));
        if (tx.toAccountId === id || (tx.toAccountId && holderOf(ledger, tx.toAccountId) === id)) add(transfersIn, tx.accountId, tx.amount);
      }
    }
    const toList = (m: Map<string, number>) => [...m.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount);
    const card = kind === "card" ? cardStatus(account, balance, all) : undefined;
    return {
      account,
      kind,
      balance,
      card,
      series,
      expenses: toList(expenses),
      income: toList(income),
      transfersIn: toList(transfersIn),
      transfersOut: toList(transfersOut),
      transactions: txs.sort((a, b) => (a.date === b.date ? (b.time ?? "").localeCompare(a.time ?? "") : b.date.localeCompare(a.date))),
    };
  },
});

export const create = mutation({
  args: accountFields,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await validate(ctx, userId, args);
    const all = await ctx.db.query("accounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const order = Math.max(-1, ...all.map((a) => a.order)) + 1;
    return ctx.db.insert("accounts", { userId, order, ...args, name: args.name.trim() });
  },
});

export const update = mutation({
  args: { id: v.id("accounts"), ...accountFields },
  handler: async (ctx, { id, ...args }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    const group = await validate(ctx, userId, args, id);
    const clean = {
      ...args,
      name: args.name.trim(),
      billingAccountId: group.kind === "card" ? args.billingAccountId : undefined,
      settlementDay: group.kind === "card" ? args.settlementDay : undefined,
      paymentDay: group.kind === "card" ? args.paymentDay : undefined,
      linkedAccountId: group.kind === "debitCard" ? args.linkedAccountId : undefined,
    };
    await ctx.db.patch(id, clean);
  },
});

export const setHidden = mutation({
  args: { id: v.id("accounts"), hidden: v.boolean() },
  handler: async (ctx, { id, hidden }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.patch(id, { hidden });
  },
});

export const remove = mutation({
  args: { id: v.id("accounts") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    await ctx.db.patch(id, { deletedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { id: v.id("accounts") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const a = await owned(ctx, await ctx.db.get(id), userId);
    const group = await ctx.db.get(a.groupId);
    if (group?.deletedAt) await ctx.db.patch(group._id, { deletedAt: undefined });
    await ctx.db.patch(id, { deletedAt: undefined });
  },
});

export const permanentlyDelete = mutation({
  args: { id: v.id("accounts") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await owned(ctx, await ctx.db.get(id), userId);
    const txs = await ctx.db.query("transactions").withIndex("by_user_account", (q) => q.eq("userId", userId).eq("accountId", id)).collect();
    for (const t of txs) await ctx.db.delete(t._id);
    const all = await allTransactions(ctx, userId);
    for (const t of all) if (t.toAccountId === id) await ctx.db.delete(t._id);
    await ctx.db.delete(id);
  },
});

export const reorder = mutation({
  args: { items: v.array(v.object({ id: v.id("accounts"), groupId: v.id("accountGroups") })) },
  handler: async (ctx, { items }) => {
    const userId = await requireUser(ctx);
    for (let i = 0; i < items.length; i++) {
      await owned(ctx, await ctx.db.get(items[i].id), userId);
      await owned(ctx, await ctx.db.get(items[i].groupId), userId);
      await ctx.db.patch(items[i].id, { order: i, groupId: items[i].groupId });
    }
  },
});

/** Pay a credit card: a transfer from its billing account to the card. */
export const payCard = mutation({
  args: { id: v.id("accounts"), amount: v.number(), date: v.string(), fromAccountId: v.optional(v.id("accounts")) },
  handler: async (ctx, { id, amount, date, fromAccountId }) => {
    const userId = await requireUser(ctx);
    const card = await owned(ctx, await ctx.db.get(id), userId);
    const from = fromAccountId ?? card.billingAccountId;
    if (!from) throw new Error("No billing account set on this card");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Amount must be positive");
    await owned(ctx, await ctx.db.get(from), userId);
    return ctx.db.insert("transactions", {
      userId,
      type: "transfer",
      date,
      accountId: from,
      toAccountId: id,
      amount,
      note: `${card.name} payment`,
      tags: [],
      photoIds: [],
    });
  },
});
