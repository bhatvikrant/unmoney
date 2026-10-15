import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { allTransactions, loadLedger, owned, requireUser, transactionsInRange } from "./lib/auth";
import { frequency, txType } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { addMonths, todayISO } from "../shared/dates";
import { nextOccurrence } from "../shared/repeat";
import { kindsOf } from "../shared/ledger";
import { toMinor } from "../shared/money";

const txFields = {
  type: txType,
  date: v.string(),
  time: v.optional(v.string()),
  accountId: v.id("accounts"),
  toAccountId: v.optional(v.id("accounts")),
  categoryId: v.optional(v.id("categories")),
  subcategoryId: v.optional(v.id("categories")),
  amount: v.number(),
  subAmount: v.optional(v.number()),
  subCurrency: v.optional(v.string()),
  exchangeRate: v.optional(v.number()),
  note: v.string(),
  description: v.optional(v.string()),
  tags: v.array(v.string()),
  feeAmount: v.optional(v.number()),
  photoIds: v.array(v.id("_storage")),
};

type TxInput = {
  type: "income" | "expense" | "transfer";
  date: string;
  time?: string;
  accountId: Id<"accounts">;
  toAccountId?: Id<"accounts">;
  categoryId?: Id<"categories">;
  subcategoryId?: Id<"categories">;
  amount: number;
  subAmount?: number;
  subCurrency?: string;
  exchangeRate?: number;
  note: string;
  description?: string;
  tags: string[];
  feeAmount?: number;
  photoIds: Id<"_storage">[];
};

async function validateTx(ctx: Parameters<typeof owned>[0], userId: Id<"users">, t: TxInput): Promise<TxInput> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error("Bad date");
  if (!Number.isInteger(t.amount)) throw new Error("Amount must be a whole number of minor units");
  await owned(ctx, await ctx.db.get(t.accountId), userId);
  const clean: TxInput = { ...t, note: t.note.trim(), tags: [...new Set(t.tags.map((x) => x.trim()).filter(Boolean))] };
  if (clean.photoIds.length > 3) throw new Error("At most 3 photos");
  if (t.type === "transfer") {
    if (!t.toAccountId) throw new Error("Pick an account to transfer to");
    if (t.toAccountId === t.accountId) throw new Error("From and To must differ");
    await owned(ctx, await ctx.db.get(t.toAccountId), userId);
    if (t.amount < 0) throw new Error("Transfer amount must be positive");
    if (t.feeAmount !== undefined && (!Number.isInteger(t.feeAmount) || t.feeAmount < 0)) throw new Error("Bad fee");
    clean.categoryId = undefined;
    clean.subcategoryId = undefined;
  } else {
    if (!t.categoryId) throw new Error("Pick a category");
    const cat = await owned(ctx, await ctx.db.get(t.categoryId), userId);
    if (cat.type !== t.type) throw new Error("Category type does not match");
    if (t.subcategoryId) {
      const sub = await owned(ctx, await ctx.db.get(t.subcategoryId), userId);
      if (sub.parentId !== t.categoryId) throw new Error("Subcategory does not belong to that category");
    }
    clean.toAccountId = undefined;
    clean.feeAmount = undefined;
  }
  return clean;
}

export const listRange = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const userId = await requireUser(ctx);
    const txs = await transactionsInRange(ctx, userId, from, to);
    return txs.sort(byDateDesc);
  },
});

/** Net income minus expense before `date`, for the carry-over total. */
export const carryBefore = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await requireUser(ctx);
    const { ledger } = await loadLedger(ctx, userId);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).lt("date", date))
      .collect();
    let net = 0;
    for (const t of txs) {
      const k = kindsOf(t, ledger);
      net += k.income - k.expense;
    }
    return net;
  },
});

export const get = query({
  args: { id: v.id("transactions") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const tx = await owned(ctx, await ctx.db.get(id), userId);
    const siblings = tx.repeatId
      ? (await ctx.db.query("transactions").withIndex("by_repeat", (q) => q.eq("repeatId", tx.repeatId)).collect()).length
      : 0;
    const repeat = tx.repeatId ? await ctx.db.get(tx.repeatId) : null;
    return { ...tx, siblings, repeat };
  },
});

export const create = mutation({
  args: {
    ...txFields,
    repeat: v.optional(v.object({ frequency, endDate: v.optional(v.string()) })),
    installment: v.optional(v.object({ count: v.number() })),
  },
  handler: async (ctx, { repeat, installment, ...input }) => {
    const userId = await requireUser(ctx);
    const t = await validateTx(ctx, userId, input);
    const { date, ...rest } = t;
    const template = {
      type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId,
      subcategoryId: t.subcategoryId, amount: t.amount, note: t.note, description: t.description,
      tags: t.tags, feeAmount: t.feeAmount,
    };
    if (installment) {
      const n = Math.floor(installment.count);
      if (n < 2 || n > 60) throw new Error("Installments must be between 2 and 60 months");
      const per = Math.floor(t.amount / n);
      const first = t.amount - per * (n - 1);
      const repeatId = await ctx.db.insert("repeats", {
        userId, kind: "installment", frequency: "monthly", startDate: date, nextDate: addMonths(date, n - 1),
        installmentCount: n, template: { ...template, amount: t.amount }, active: false,
      });
      let firstId: Id<"transactions"> | null = null;
      for (let i = 0; i < n; i++) {
        const id = await ctx.db.insert("transactions", {
          userId, ...rest, date: addMonths(date, i), amount: i === 0 ? first : per, repeatId,
          installmentIndex: i + 1, installmentCount: n, installmentTotal: t.amount, photoIds: i === 0 ? t.photoIds : [],
        });
        if (i === 0) firstId = id;
      }
      return firstId;
    }
    if (repeat) {
      const repeatId = await ctx.db.insert("repeats", {
        userId, kind: "repeat", frequency: repeat.frequency, startDate: date, endDate: repeat.endDate,
        nextDate: nextOccurrence(date, date, repeat.frequency), template, active: true,
      });
      return ctx.db.insert("transactions", { userId, ...rest, date, repeatId });
    }
    return ctx.db.insert("transactions", { userId, ...rest, date });
  },
});

export const update = mutation({
  args: { id: v.id("transactions"), ...txFields, scope: v.optional(v.union(v.literal("one"), v.literal("future"))) },
  handler: async (ctx, { id, scope, ...input }) => {
    const userId = await requireUser(ctx);
    const existing = await owned(ctx, await ctx.db.get(id), userId);
    const t = await validateTx(ctx, userId, input);
    await ctx.db.patch(id, { ...t, subAmount: t.subAmount, subCurrency: t.subCurrency, exchangeRate: t.exchangeRate, time: t.time, description: t.description, feeAmount: t.feeAmount, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId });
    if (scope === "future" && existing.repeatId) {
      const siblings = await ctx.db.query("transactions").withIndex("by_repeat", (q) => q.eq("repeatId", existing.repeatId)).collect();
      for (const s of siblings) {
        if (s._id === id || s.date <= existing.date) continue;
        await ctx.db.patch(s._id, {
          type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId,
          subcategoryId: t.subcategoryId, note: t.note, description: t.description, tags: t.tags, feeAmount: t.feeAmount,
          ...(s.installmentIndex ? {} : { amount: t.amount }),
        });
      }
      const rep = await ctx.db.get(existing.repeatId);
      if (rep && rep.kind === "repeat") {
        await ctx.db.patch(rep._id, {
          template: {
            type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId,
            subcategoryId: t.subcategoryId, amount: t.amount, note: t.note, description: t.description, tags: t.tags, feeAmount: t.feeAmount,
          },
        });
      }
    }
  },
});

export const remove = mutation({
  args: { id: v.id("transactions"), scope: v.optional(v.union(v.literal("one"), v.literal("future"), v.literal("all"))) },
  handler: async (ctx, { id, scope }) => {
    const userId = await requireUser(ctx);
    const existing = await owned(ctx, await ctx.db.get(id), userId);
    if ((scope === "future" || scope === "all") && existing.repeatId) {
      const siblings = await ctx.db.query("transactions").withIndex("by_repeat", (q) => q.eq("repeatId", existing.repeatId)).collect();
      for (const s of siblings) {
        if (scope === "future" && s.date < existing.date) continue;
        await ctx.db.delete(s._id);
      }
      const rep = await ctx.db.get(existing.repeatId);
      if (rep) await ctx.db.patch(rep._id, { active: false });
      return;
    }
    await ctx.db.delete(id);
  },
});

export const bulkUpdate = mutation({
  args: { ids: v.array(v.id("transactions")), date: v.optional(v.string()), note: v.optional(v.string()), categoryId: v.optional(v.id("categories")), accountId: v.optional(v.id("accounts")) },
  handler: async (ctx, { ids, date, note, categoryId, accountId }) => {
    const userId = await requireUser(ctx);
    if (categoryId) await owned(ctx, await ctx.db.get(categoryId), userId);
    if (accountId) await owned(ctx, await ctx.db.get(accountId), userId);
    for (const id of ids) {
      const tx = await owned(ctx, await ctx.db.get(id), userId);
      const patch: Partial<Doc<"transactions">> = {};
      if (date) patch.date = date;
      if (note !== undefined) patch.note = note;
      if (accountId) patch.accountId = accountId;
      if (categoryId && tx.type !== "transfer") {
        const cat = await ctx.db.get(categoryId);
        if (cat && cat.type === tx.type) {
          patch.categoryId = categoryId;
          patch.subcategoryId = undefined;
        }
      }
      await ctx.db.patch(id, patch);
    }
  },
});

export const bulkRemove = mutation({
  args: { ids: v.array(v.id("transactions")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUser(ctx);
    for (const id of ids) {
      await owned(ctx, await ctx.db.get(id), userId);
      await ctx.db.delete(id);
    }
  },
});

export const search = query({
  args: {
    q: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    type: v.optional(txType),
    accountIds: v.optional(v.array(v.id("accounts"))),
    categoryIds: v.optional(v.array(v.id("categories"))),
    tag: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const q = args.q?.trim();
    let txs: Doc<"transactions">[];
    if (q) {
      txs = await ctx.db
        .query("transactions")
        .withSearchIndex("search_note", (s) => s.search("note", q).eq("userId", userId))
        .take(500);
      // the search index matches whole words; also catch substrings in note / description / tags
      const lower = q.toLowerCase();
      const seen = new Set(txs.map((t) => t._id));
      const all = await allTransactions(ctx, userId);
      for (const t of all) {
        if (seen.has(t._id)) continue;
        if (t.note.toLowerCase().includes(lower) || t.description?.toLowerCase().includes(lower) || t.tags.some((x) => x.toLowerCase().includes(lower))) txs.push(t);
      }
    } else if (args.from || args.to) {
      txs = await transactionsInRange(ctx, userId, args.from ?? "0000-00-00", args.to ?? "9999-99-99");
    } else {
      txs = await allTransactions(ctx, userId);
    }
    const acc = args.accountIds && args.accountIds.length ? new Set(args.accountIds) : null;
    const cats = args.categoryIds && args.categoryIds.length ? new Set(args.categoryIds) : null;
    const out = txs.filter((t) => {
      if (args.from && t.date < args.from) return false;
      if (args.to && t.date > args.to) return false;
      if (args.type && t.type !== args.type) return false;
      if (acc && !acc.has(t.accountId) && !(t.toAccountId && acc.has(t.toAccountId))) return false;
      if (cats && !(t.categoryId && cats.has(t.categoryId)) && !(t.subcategoryId && cats.has(t.subcategoryId))) return false;
      if (args.tag && !t.tags.includes(args.tag)) return false;
      return true;
    });
    return out.sort(byDateDesc).slice(0, args.limit ?? 500);
  },
});

/** Distinct notes for autocomplete, most recent first, with the fields last used with each note. */
export const noteSuggestions = query({
  args: { q: v.string(), type: v.optional(txType) },
  handler: async (ctx, { q, type }) => {
    const userId = await requireUser(ctx);
    const recent = await ctx.db.query("transactions").withIndex("by_user_date", (s) => s.eq("userId", userId)).order("desc").take(600);
    const lower = q.trim().toLowerCase();
    const seen = new Map<string, Doc<"transactions">>();
    for (const t of recent) {
      if (type && t.type !== type) continue;
      if (!t.note) continue;
      if (lower && !t.note.toLowerCase().includes(lower)) continue;
      const key = t.note.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
      if (seen.size >= 8) break;
    }
    return [...seen.values()].map((t) => ({
      note: t.note, type: t.type, accountId: t.accountId, toAccountId: t.toAccountId,
      categoryId: t.categoryId, subcategoryId: t.subcategoryId, amount: t.amount,
    }));
  },
});

export const tags = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const all = await allTransactions(ctx, userId);
    const counts = new Map<string, number>();
    for (const t of all) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  },
});

/** Rows exported with names, for CSV. */
export const exportAll = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { from, to }) => {
    const userId = await requireUser(ctx);
    const { accounts } = await loadLedger(ctx, userId);
    const cats = await ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId)).collect();
    const accName = new Map(accounts.map((a) => [a._id, a.name]));
    const catName = new Map(cats.map((c) => [c._id, c.name]));
    const txs = from || to ? await transactionsInRange(ctx, userId, from ?? "0000-00-00", to ?? "9999-99-99") : await allTransactions(ctx, userId);
    return txs.sort(byDateDesc).map((t) => ({
      date: t.date,
      time: t.time ?? "",
      account: accName.get(t.accountId) ?? "",
      category: t.type === "transfer" ? (t.toAccountId ? accName.get(t.toAccountId) ?? "" : "") : (t.categoryId ? catName.get(t.categoryId) ?? "" : ""),
      subcategory: t.subcategoryId ? catName.get(t.subcategoryId) ?? "" : "",
      note: t.note,
      amount: t.amount,
      type: t.type === "income" ? "Income" : t.type === "expense" ? "Expenses" : "Transfer-Out",
      description: t.description ?? "",
      subAmount: t.subAmount ?? "",
      subCurrency: t.subCurrency ?? "",
      fee: t.feeAmount ?? "",
      tags: t.tags.join(" "),
    }));
  },
});

/** Bulk import. Validates every row first; nothing is written if any row fails. */
export const importRows = mutation({
  args: {
    rows: v.array(v.object({
      date: v.string(),
      account: v.string(),
      category: v.string(),
      subcategory: v.optional(v.string()),
      note: v.optional(v.string()),
      amount: v.string(),
      type: v.string(),
      description: v.optional(v.string()),
      subAmount: v.optional(v.string()),
      subCurrency: v.optional(v.string()),
    })),
    createMissing: v.optional(v.boolean()),
  },
  handler: async (ctx, { rows, createMissing }) => {
    const userId = await requireUser(ctx);
    const { settings, accounts } = await loadLedger(ctx, userId);
    const cats = await ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId)).collect();
    const currencies = await ctx.db.query("currencies").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const accByName = new Map(accounts.filter((a) => !a.deletedAt).map((a) => [a.name.toLowerCase(), a]));
    const catKey = (type: string, name: string, parent?: Id<"categories">) => `${type}:${parent ?? ""}:${name.toLowerCase()}`;
    const catByKey = new Map(cats.filter((c) => !c.deletedAt).map((c) => [catKey(c.type, c.name, c.parentId), c]));
    const errors: { row: number; reason: string }[] = [];
    const prepared: TxInput[] = [];
    const toCreateCats: { type: "income" | "expense"; name: string; parentName?: string }[] = [];
    const parseDate = (s: string): string | null => {
      const t = s.trim();
      let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      return null;
    };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDate(r.date);
      if (!date) { errors.push({ row: i + 1, reason: `Bad date "${r.date}"` }); continue; }
      const tRaw = r.type.trim().toLowerCase();
      const type = tRaw.startsWith("in") ? "income" : tRaw.startsWith("exp") ? "expense" : tRaw.startsWith("trans") ? "transfer" : null;
      if (!type) { errors.push({ row: i + 1, reason: `Unknown type "${r.type}" (Income, Expenses or Transfer-Out)` }); continue; }
      const account = accByName.get(r.account.trim().toLowerCase());
      if (!account) { errors.push({ row: i + 1, reason: `Unknown account "${r.account}"` }); continue; }
      const amountMajor = Number(r.amount.replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(amountMajor)) { errors.push({ row: i + 1, reason: `Bad amount "${r.amount}"` }); continue; }
      const amount = toMinor(amountMajor, settings.decimals);
      const base: TxInput = {
        type, date, accountId: account._id, amount, note: (r.note ?? "").trim(), description: r.description?.trim() || undefined,
        tags: [], photoIds: [],
      };
      if (r.subAmount && r.subCurrency) {
        const cur = currencies.find((c) => c.code.toLowerCase() === r.subCurrency!.trim().toLowerCase());
        if (cur) {
          base.subCurrency = cur.code;
          base.subAmount = toMinor(Number(r.subAmount.replace(/[^0-9.-]/g, "")), cur.decimals);
          base.exchangeRate = cur.rate;
        }
      }
      if (type === "transfer") {
        const to = accByName.get(r.category.trim().toLowerCase());
        if (!to) { errors.push({ row: i + 1, reason: `Unknown destination account "${r.category}"` }); continue; }
        if (to._id === account._id) { errors.push({ row: i + 1, reason: "From and To are the same" }); continue; }
        base.toAccountId = to._id;
      } else {
        const name = r.category.trim();
        if (!name) { errors.push({ row: i + 1, reason: "Category is required" }); continue; }
        let cat = catByKey.get(catKey(type, name));
        if (!cat) {
          if (!createMissing) { errors.push({ row: i + 1, reason: `Unknown ${type} category "${name}"` }); continue; }
          toCreateCats.push({ type, name });
        }
        const subName = r.subcategory?.trim();
        if (subName) {
          const sub = cat ? catByKey.get(catKey(type, subName, cat._id)) : undefined;
          if (!sub) {
            if (!createMissing) { errors.push({ row: i + 1, reason: `Unknown subcategory "${subName}" under "${name}"` }); continue; }
            toCreateCats.push({ type, name: subName, parentName: name });
          }
          base.subcategoryId = sub?._id;
        }
        base.categoryId = cat?._id;
        (base as TxInput & { _catName?: string; _subName?: string })._catName = name;
        (base as TxInput & { _catName?: string; _subName?: string })._subName = subName || undefined;
      }
      prepared.push(base);
    }
    if (errors.length) return { inserted: 0, errors };
    // create missing categories (deduplicated), then resolve
    for (const c of toCreateCats) {
      if (c.parentName) continue;
      const key = catKey(c.type, c.name);
      if (catByKey.has(key)) continue;
      const siblings = cats.filter((x) => x.type === c.type);
      const id = await ctx.db.insert("categories", { userId, type: c.type, name: c.name, order: siblings.length + catByKey.size });
      const doc = (await ctx.db.get(id))!;
      catByKey.set(key, doc);
    }
    for (const c of toCreateCats) {
      if (!c.parentName) continue;
      const parent = catByKey.get(catKey(c.type, c.parentName))!;
      const key = catKey(c.type, c.name, parent._id);
      if (catByKey.has(key)) continue;
      const id = await ctx.db.insert("categories", { userId, type: c.type, name: c.name, parentId: parent._id, order: catByKey.size });
      catByKey.set(key, (await ctx.db.get(id))!);
    }
    let inserted = 0;
    for (const p of prepared) {
      const extra = p as TxInput & { _catName?: string; _subName?: string };
      if (p.type !== "transfer") {
        const cat = catByKey.get(catKey(p.type, extra._catName!))!;
        p.categoryId = cat._id;
        p.subcategoryId = extra._subName ? catByKey.get(catKey(p.type, extra._subName, cat._id))?._id : undefined;
      }
      delete extra._catName;
      delete extra._subName;
      await ctx.db.insert("transactions", { userId, ...p });
      inserted++;
    }
    return { inserted, errors: [] };
  },
});

export const copy = mutation({
  args: { id: v.id("transactions"), useToday: v.boolean() },
  handler: async (ctx, { id, useToday }) => {
    const userId = await requireUser(ctx);
    const t = await owned(ctx, await ctx.db.get(id), userId);
    const { _id, _creationTime, repeatId, installmentIndex, installmentCount, installmentTotal, ...rest } = t;
    void _id; void _creationTime; void repeatId; void installmentIndex; void installmentCount; void installmentTotal;
    return ctx.db.insert("transactions", { ...rest, date: useToday ? todayISO() : t.date });
  },
});

function byDateDesc(a: Doc<"transactions">, b: Doc<"transactions">): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  const ta = a.time ?? "";
  const tb = b.time ?? "";
  if (ta !== tb) return tb.localeCompare(ta);
  return b._creationTime - a._creationTime;
}
