/**
 * Read models computed from a Snapshot. These are the old Convex queries, rewritten as pure
 * functions so every screen can render from the local replica without a network.
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { Snapshot } from "./ops";
import {
  buildCtx, cardStatus, computeBalances, debitMonthlyUsage, holderOf, kindsOf, nextPaymentDate, type Ctx as LedgerCtx,
} from "./ledger";
import { addDays, addMonths, daysInMonth, make, parts, todayISO } from "./dates";
import { elapsedFraction, periodRange, type Range } from "./period";

export type Tx = Doc<"transactions">;

export function settingsOf(snap: Snapshot): Doc<"settings"> | null {
  return snap.settings[0] ?? null;
}

export function ledgerOf(snap: Snapshot): LedgerCtx {
  const s = settingsOf(snap);
  return buildCtx(snap.accounts, snap.accountGroups, { cardExpenseDisplay: s?.cardExpenseDisplay ?? "atTime" });
}

export function byDateDesc(a: Tx, b: Tx): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  const ta = a.time ?? "";
  const tb = b.time ?? "";
  if (ta !== tb) return tb.localeCompare(ta);
  return b._creationTime - a._creationTime;
}

export function groupsList(snap: Snapshot, includeDeleted = false): Doc<"accountGroups">[] {
  return snap.accountGroups.filter((g) => includeDeleted || !g.deletedAt).sort((a, b) => a.order - b.order);
}

export function categoriesList(snap: Snapshot, includeDeleted = false): Doc<"categories">[] {
  return snap.categories.filter((c) => includeDeleted || !c.deletedAt).sort((a, b) => a.order - b.order);
}

export function currenciesList(snap: Snapshot): Doc<"currencies">[] {
  return [...snap.currencies].sort((a, b) => a.order - b.order);
}

export function repeatsList(snap: Snapshot): Doc<"repeats">[] {
  return [...snap.repeats].sort((a, b) => Number(b.active) - Number(a.active) || a.nextDate.localeCompare(b.nextDate));
}

export function bookmarksList(snap: Snapshot): Doc<"bookmarks">[] {
  return [...snap.bookmarks].sort((a, b) => a.order - b.order);
}

export function budgetsList(snap: Snapshot): Doc<"budgets">[] {
  return snap.budgets;
}

export function notesRange(snap: Snapshot, from: string, to: string): Doc<"notes">[] {
  return snap.notes.filter((n) => n.date >= from && n.date <= to);
}

// ---------- accounts ----------

export type AccountRow = Doc<"accounts"> & {
  kind: string | undefined;
  balance: number;
  payable?: number;
  outstanding?: number;
  nextPayment?: string;
  monthlyUsage?: number;
};
export type AccountGroupRow = { group: Doc<"accountGroups">; accounts: AccountRow[]; total: number; payable: number; outstanding: number };
export type AccountsList = { groups: AccountGroupRow[]; accounts: AccountRow[]; assets: number; liabilities: number; total: number };

export function accountsList(snap: Snapshot, today = todayISO()): AccountsList {
  const ledger = ledgerOf(snap);
  const txs = snap.transactions;
  const balances = computeBalances(txs, ledger);
  const live = snap.accounts.filter((a) => !a.deletedAt).sort((a, b) => a.order - b.order);
  const rows: AccountRow[] = live.map((a) => {
    const kind = ledger.groups.get(a.groupId)?.kind;
    const balance = balances.get(a._id) ?? 0;
    const card = kind === "card" ? cardStatus(a, balance, txs, today) : undefined;
    const monthlyUsage = kind === "debitCard" ? debitMonthlyUsage(a._id, txs, today) : undefined;
    return {
      ...a, kind, balance, payable: card?.payable, outstanding: card?.outstanding,
      nextPayment: kind === "card" && a.paymentDay ? nextPaymentDate(a.paymentDay, today) : undefined, monthlyUsage,
    };
  });
  let assets = 0;
  let liabilities = 0;
  for (const r of rows) {
    if (!r.includeInTotals) continue;
    if (r.kind === "debitCard") continue;
    if (r.balance >= 0) assets += r.balance;
    else liabilities += -r.balance;
  }
  const groups = groupsList(snap)
    .map((g) => {
      const items = rows.filter((r) => r.groupId === g._id);
      const total = items.filter((r) => r.includeInTotals).reduce((s, r) => s + r.balance, 0);
      const payable = items.reduce((s, r) => s + (r.payable ?? 0), 0);
      const outstanding = items.reduce((s, r) => s + (r.outstanding ?? 0), 0);
      return { group: g, accounts: items, total, payable, outstanding };
    })
    .filter((g) => g.accounts.length > 0);
  return { groups, accounts: rows, assets, liabilities, total: assets - liabilities };
}

export function accountsListDeleted(snap: Snapshot) {
  return {
    accounts: snap.accounts.filter((a) => a.deletedAt).map((a) => ({ ...a, groupName: snap.accountGroups.find((g) => g._id === a.groupId)?.name })),
    groups: snap.accountGroups.filter((g) => g.deletedAt),
  };
}

export function accountGet(snap: Snapshot, id: string, granularity: "daily" | "monthly" | "yearly", from: string, to: string) {
  const account = snap.accounts.find((a) => a._id === id);
  if (!account) return null;
  const ledger = ledgerOf(snap);
  const all = snap.transactions;
  const balances = computeBalances(all, ledger);
  const balance = balances.get(id) ?? 0;
  const kind = snap.accountGroups.find((g) => g._id === account.groupId)?.kind;

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

  const expenses = new Map<string, number>();
  const income = new Map<string, number>();
  const transfersIn = new Map<string, number>();
  const transfersOut = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const txs: Tx[] = [];
  for (const tx of all) {
    if (tx.date < from || tx.date > to) continue;
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
    account, kind, balance, card, series,
    expenses: toList(expenses), income: toList(income), transfersIn: toList(transfersIn), transfersOut: toList(transfersOut),
    transactions: txs.sort(byDateDesc),
  };
}

// ---------- transactions ----------

export function txListRange(snap: Snapshot, from: string, to: string): Tx[] {
  return snap.transactions.filter((t) => t.date >= from && t.date <= to).sort(byDateDesc);
}

/** Net income minus expense before `date`, for the carry-over total. */
export function txCarryBefore(snap: Snapshot, date: string): number {
  const ledger = ledgerOf(snap);
  let net = 0;
  for (const t of snap.transactions) {
    if (t.date >= date) continue;
    const k = kindsOf(t, ledger);
    net += k.income - k.expense;
  }
  return net;
}

export type TxDetail = Tx & { siblings: number; repeat: Doc<"repeats"> | null };

export function txGet(snap: Snapshot, id: string): TxDetail | null {
  const tx = snap.transactions.find((t) => t._id === id);
  if (!tx) return null;
  const siblings = tx.repeatId ? snap.transactions.filter((t) => t.repeatId === tx.repeatId).length : 0;
  const repeat = tx.repeatId ? snap.repeats.find((r) => r._id === tx.repeatId) ?? null : null;
  return { ...tx, siblings, repeat };
}

export type SearchArgs = {
  q?: string; from?: string; to?: string; type?: "income" | "expense" | "transfer";
  accountIds?: string[]; categoryIds?: string[]; tag?: string; limit?: number;
};

export function txSearch(snap: Snapshot, args: SearchArgs): Tx[] {
  const q = args.q?.trim().toLowerCase();
  const acc = args.accountIds && args.accountIds.length ? new Set(args.accountIds) : null;
  const cats = args.categoryIds && args.categoryIds.length ? new Set(args.categoryIds) : null;
  const out = snap.transactions.filter((t) => {
    if (args.from && t.date < args.from) return false;
    if (args.to && t.date > args.to) return false;
    if (args.type && t.type !== args.type) return false;
    if (acc && !acc.has(t.accountId) && !(t.toAccountId && acc.has(t.toAccountId))) return false;
    if (cats && !(t.categoryId && cats.has(t.categoryId)) && !(t.subcategoryId && cats.has(t.subcategoryId))) return false;
    if (args.tag && !t.tags.includes(args.tag)) return false;
    if (q && !(t.note.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.tags.some((x) => x.toLowerCase().includes(q)))) return false;
    return true;
  });
  return out.sort(byDateDesc).slice(0, args.limit ?? 500);
}

export type NoteSuggestion = Pick<Tx, "note" | "type" | "accountId" | "toAccountId" | "categoryId" | "subcategoryId" | "amount">;

/** Distinct notes for autocomplete, most recent first, with the fields last used with each note. */
export function noteSuggestions(snap: Snapshot, q: string, type?: "income" | "expense" | "transfer"): NoteSuggestion[] {
  const recent = [...snap.transactions].sort(byDateDesc).slice(0, 600);
  const lower = q.trim().toLowerCase();
  const seen = new Map<string, Tx>();
  for (const t of recent) {
    if (type && t.type !== type) continue;
    if (!t.note) continue;
    if (lower && !t.note.toLowerCase().includes(lower)) continue;
    const key = t.note.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
    if (seen.size >= 8) break;
  }
  return [...seen.values()].map((t) => ({
    note: t.note, type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId, amount: t.amount,
  }));
}

export function txTags(snap: Snapshot): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of snap.transactions) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

/** Rows exported with names, for CSV. */
export function txExportRows(snap: Snapshot, from?: string, to?: string) {
  const accName = new Map(snap.accounts.map((a) => [a._id, a.name]));
  const catName = new Map(snap.categories.map((c) => [c._id, c.name]));
  const txs = from || to ? txListRange(snap, from ?? "0000-00-00", to ?? "9999-99-99") : [...snap.transactions].sort(byDateDesc);
  return txs.map((t) => ({
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
}

export function backupExport(snap: Snapshot) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settingsOf(snap),
    accountGroups: snap.accountGroups,
    accounts: snap.accounts,
    categories: snap.categories,
    transactions: snap.transactions,
    repeats: snap.repeats,
    bookmarks: snap.bookmarks,
    budgets: snap.budgets,
    notes: snap.notes,
    currencies: snap.currencies,
  };
}

// ---------- stats ----------

export type CategoryStat = { id: string; name: string; amount: number; children: { id: string; name: string; amount: number }[]; pct: number };

/** Totals per main category for a period, with subcategory breakdown. Transfer-as-expense rows show as "Transfer to X". */
export function statsByCategory(snap: Snapshot, from: string, to: string, type: "income" | "expense"): { total: number; items: CategoryStat[] } {
  const ledger = ledgerOf(snap);
  const catById = new Map(snap.categories.filter((c) => c.type === type).map((c) => [c._id, c]));
  const accName = new Map(snap.accounts.map((a) => [a._id, a.name]));
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
  for (const t of snap.transactions) {
    if (t.date < from || t.date > to) continue;
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
}

/** Totals for a category (or everything) over a list of ranges, for trend charts. */
export function statsTrend(snap: Snapshot, type: "income" | "expense", categoryId: string | undefined, ranges: { key: string; from: string; to: string }[]) {
  if (!ranges.length) return [];
  const ledger = ledgerOf(snap);
  const parentOf = new Map(snap.categories.filter((c) => c.type === type).map((c) => [c._id as string, (c.parentId ?? c._id) as string]));
  return ranges.map((r) => {
    let amount = 0;
    for (const t of snap.transactions) {
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
}

// ---------- budgets ----------

export type BudgetStatusItem = { budget: Doc<"budgets">; limit: number; spent: number; remaining: number; isOverride: boolean };
export type BudgetStatus = { range: Range; total: BudgetStatusItem | undefined; perCategory: BudgetStatusItem[]; spentAll: number; elapsed: number };

/** Spent vs limit for every budget of a period. `key` is the period key (month "2026-07", week start date, or year). */
export function budgetStatus(snap: Snapshot, period: Doc<"budgets">["period"], key: string, today = todayISO()): BudgetStatus | null {
  const settings = settingsOf(snap);
  if (!settings) return null;
  const ledger = ledgerOf(snap);
  const range = periodRange(period, key, settings.monthStartDay, settings.weekStartDay);
  const parentOf = new Map(snap.categories.filter((c) => c.type === "expense").map((c) => [c._id, c.parentId ?? c._id]));
  const spentByCat = new Map<string, number>();
  let spentAll = 0;
  for (const t of snap.transactions) {
    if (t.date < range.from || t.date > range.to) continue;
    const k = kindsOf(t, ledger);
    if (!k.expense) continue;
    spentAll += k.expense;
    if (t.categoryId) {
      const main = parentOf.get(t.categoryId) ?? t.categoryId;
      spentByCat.set(main, (spentByCat.get(main) ?? 0) + k.expense);
    }
  }
  const items = snap.budgets
    .filter((b) => b.period === period)
    .map((b) => {
      const limit = b.overrides[key] ?? b.amount;
      const spent = b.categoryId ? spentByCat.get(b.categoryId) ?? 0 : spentAll;
      return { budget: b, limit, spent, remaining: limit - spent, isOverride: b.overrides[key] !== undefined };
    });
  const total = items.find((i) => !i.budget.categoryId);
  const perCategory = items.filter((i) => i.budget.categoryId).sort((a, b) => b.spent / Math.max(1, b.limit) - a.spent / Math.max(1, a.limit));
  return { range, total, perCategory, spentAll, elapsed: elapsedFraction(range, today) };
}

export type { Id };
