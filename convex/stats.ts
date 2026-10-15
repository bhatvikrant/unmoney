import { v } from "convex/values";
import { query } from "./_generated/server";
import { loadLedger, requireUser, transactionsInRange } from "./lib/auth";
import { kindsOf } from "../shared/ledger";

/** Totals per main category for a period, with subcategory breakdown. Transfer-as-expense rows show as "Transfer to X". */
export const byCategory = query({
  args: { from: v.string(), to: v.string(), type: v.union(v.literal("income"), v.literal("expense")) },
  handler: async (ctx, { from, to, type }) => {
    const userId = await requireUser(ctx);
    const { ledger, accounts } = await loadLedger(ctx, userId);
    const [txs, cats] = await Promise.all([
      transactionsInRange(ctx, userId, from, to),
      ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", type)).collect(),
    ]);
    const catById = new Map(cats.map((c) => [c._id, c]));
    const accName = new Map(accounts.map((a) => [a._id, a.name]));
    const main = new Map<string, { id: string; name: string; amount: number; children: Map<string, { id: string; name: string; amount: number }> }>();
    const ensure = (id: string, name: string) => {
      let m = main.get(id);
      if (!m) {
        m = { id, name, amount: 0, children: new Map() };
        main.set(id, m);
      }
      return m;
    };
    let total = 0;
    let other = 0;
    for (const t of txs) {
      const k = kindsOf(t, ledger);
      const amount = type === "income" ? k.income : k.expense;
      if (!amount) continue;
      total += amount;
      if (t.type === "transfer") {
        const name = `Transfer to ${t.toAccountId ? accName.get(t.toAccountId) ?? "account" : "account"}`;
        ensure(`transfer:${t.toAccountId ?? ""}`, name).amount += amount;
        continue;
      }
      if (t.type !== type) { other += amount; continue; }
      const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
      const m = ensure(cat?._id ?? "none", cat?.name ?? "Uncategorised");
      m.amount += amount;
      const sub = t.subcategoryId ? catById.get(t.subcategoryId) : undefined;
      const childKey = sub?._id ?? "none";
      const child = m.children.get(childKey) ?? { id: childKey, name: sub?.name ?? "(no subcategory)", amount: 0 };
      child.amount += amount;
      m.children.set(childKey, child);
    }
    if (other) ensure("fees", "Fees").amount += other;
    const items = [...main.values()]
      .map((m) => ({ ...m, children: [...m.children.values()].sort((a, b) => b.amount - a.amount), pct: total ? m.amount / total : 0 }))
      .sort((a, b) => b.amount - a.amount);
    return { total, items };
  },
});

/** Totals for a category (or everything) over a list of ranges, for trend charts. */
export const trend = query({
  args: {
    type: v.union(v.literal("income"), v.literal("expense")),
    categoryId: v.optional(v.string()),
    ranges: v.array(v.object({ key: v.string(), from: v.string(), to: v.string() })),
  },
  handler: async (ctx, { type, categoryId, ranges }) => {
    const userId = await requireUser(ctx);
    if (!ranges.length) return [];
    const { ledger } = await loadLedger(ctx, userId);
    const cats = await ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", type)).collect();
    const parentOf = new Map(cats.map((c) => [c._id as string, (c.parentId ?? c._id) as string]));
    const from = ranges.reduce((m, r) => (r.from < m ? r.from : m), ranges[0].from);
    const to = ranges.reduce((m, r) => (r.to > m ? r.to : m), ranges[0].to);
    const txs = await transactionsInRange(ctx, userId, from, to);
    return ranges.map((r) => {
      let amount = 0;
      for (const t of txs) {
        if (t.date < r.from || t.date > r.to) continue;
        const k = kindsOf(t, ledger);
        const a = type === "income" ? k.income : k.expense;
        if (!a) continue;
        if (categoryId) {
          if (categoryId.startsWith("transfer:")) {
            if (t.type !== "transfer" || `transfer:${t.toAccountId ?? ""}` !== categoryId) continue;
          } else {
            if (t.type !== type) continue;
            const main = t.categoryId ? parentOf.get(t.categoryId) ?? t.categoryId : "none";
            if (main !== categoryId && t.subcategoryId !== categoryId) continue;
          }
        }
        amount += a;
      }
      return { key: r.key, amount };
    });
  },
});
