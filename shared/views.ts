/**
 * Read models computed from a Snapshot. These are the old Convex queries, rewritten as pure
 * functions so every screen can render from the local replica without a network.
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import { PASSCODE_FIELDS, type Snapshot } from "./ops";
import {
  buildCtx, cardStatus, computeBalances, cycleTotals, debitMonthlyUsage, drawsFromLinked, holderOf, kindsOf, resolveKind, statementCycles, statementDue, type Ctx as LedgerCtx,
} from "./ledger";
import type { AccountKind } from "./defaults";
import { addDays, addMonths, daysInMonth, diffDays, make, parts, todayISO } from "./dates";
import { elapsedFraction, periodKey, periodRange, type Range } from "./period";
import { laterMatches } from "./gmail/dedup";

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
  // Within a day, the entry added last comes first. The optional time field is left out on purpose:
  // entries without one sorted below every timed entry, so a fresh entry could land mid-list.
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

/**
 * The entry each open draft looks like ("already added?"): the one the check found, or one the
 * user typed in since, before the next check records it.
 */
export function draftMatches(snap: Snapshot): Map<Id<"drafts">, Id<"transactions">> {
  const out = laterMatches(snap.drafts, snap.transactions, snap.accounts);
  for (const d of snap.drafts) if (d.status === "open" && d.matchedTransactionId) out.set(d._id, d.matchedTransactionId);
  return out;
}

/** Open drafts from Gmail dated in the range, for the ledger's faded rows. Ones matched to an entry the user already has are left out. */
export function draftsRange(snap: Snapshot, from: string, to: string): Doc<"drafts">[] {
  const matched = draftMatches(snap);
  return snap.drafts.filter((d) => d.status === "open" && !matched.has(d._id) && d.proposal.date >= from && d.proposal.date <= to).sort(byDraftDesc);
}

/** Newest mail first within a day; days are grouped by the caller. */
export function byDraftDesc(a: Doc<"drafts">, b: Doc<"drafts">): number {
  if (a.proposal.date !== b.proposal.date) return b.proposal.date.localeCompare(a.proposal.date);
  return b.receivedAt - a.receivedAt;
}

/** Every draft still waiting, newest first, for the review page. Matched ones ("already added?") included. */
export function draftsOpen(snap: Snapshot): Doc<"drafts">[] {
  return snap.drafts.filter((d) => d.status === "open").sort(byDraftDesc);
}

export function draftGet(snap: Snapshot, id: string): Doc<"drafts"> | null {
  return snap.drafts.find((d) => d._id === id) ?? null;
}

// ---------- accounts ----------

export type AccountRow = Omit<Doc<"accounts">, "kind"> & {
  kind: AccountKind;
  /** Spending comes out of the linked account (debit cards, linked UPIs): the row shows usage, not a balance. */
  linked: boolean;
  balance: number;
  payable?: number;
  outstanding?: number;
  /** When the payable is due (cards with a payment day): past it with something payable, the card is overdue. */
  nextPayment?: string;
  monthlyUsage?: number;
  /** Net of the entries dated after today: what the balance will move by, not counted in it yet. */
  upcoming: number;
};
/** A section of the payment methods list: a group, or (group null, id "none") the methods outside any group. */
export type AccountGroupRow = { id: string; name: string; group: Doc<"accountGroups"> | null; accounts: AccountRow[]; total: number; payable: number; outstanding: number };
export const NO_GROUP = "none";
export const NO_GROUP_NAME = "No group";
/** `groups` holds the methods in use; archived ones are only in `archived` (and `accounts`), and still count in the totals. */
export type AccountsList = {
  groups: AccountGroupRow[]; archived: AccountRow[]; accounts: AccountRow[]; assets: number; liabilities: number; total: number;
  /** Accounts the app keeps for itself (Balance adjustments): in no list, but their names still show on entries. */
  system: AccountRow[];
};

export function accountsList(snap: Snapshot, today = todayISO()): AccountsList {
  const ledger = ledgerOf(snap);
  const txs = snap.transactions;
  const balances = computeBalances(txs, ledger, today);
  const upcoming = computeBalances(txs, ledger, undefined, today);
  const live = snap.accounts.filter((a) => !a.deletedAt && !a.system).sort((a, b) => a.order - b.order);
  const liveGroups = groupsList(snap);
  const row = (a: Doc<"accounts">): AccountRow => {
    const kind = ledger.accounts.get(a._id)!.kind as AccountKind;
    const linked = drawsFromLinked({ kind, linkedAccountId: a.linkedAccountId });
    const balance = balances.get(a._id) ?? 0;
    const card = kind === "card" ? cardStatus(a, balance, txs, today) : undefined;
    const monthlyUsage = linked ? debitMonthlyUsage(a._id, txs, today) : undefined;
    // A method in a group that was deleted shows with the ungrouped ones.
    const groupId = a.groupId && liveGroups.some((g) => g._id === a.groupId) ? a.groupId : undefined;
    return {
      ...a, groupId, kind, linked, balance, upcoming: upcoming.get(a._id) ?? 0, payable: card?.payable, outstanding: card?.outstanding,
      nextPayment: kind === "card" ? statementDue(a, today) : undefined, monthlyUsage,
    };
  };
  const rows = live.map(row);
  let assets = 0;
  let liabilities = 0;
  for (const r of rows) {
    if (!r.includeInTotals) continue;
    if (r.linked) continue;
    if (r.balance >= 0) assets += r.balance;
    else liabilities += -r.balance;
  }
  const section = (id: string, name: string, group: Doc<"accountGroups"> | null, items: AccountRow[]): AccountGroupRow => ({
    id, name, group, accounts: items,
    total: items.filter((r) => r.includeInTotals && !r.linked).reduce((s, r) => s + r.balance, 0),
    payable: items.reduce((s, r) => s + (r.payable ?? 0), 0),
    outstanding: items.reduce((s, r) => s + (r.outstanding ?? 0), 0),
  });
  const inUse = rows.filter((r) => !r.archivedAt);
  const groups = [
    ...liveGroups.map((g) => section(g._id, g.name, g, inUse.filter((r) => r.groupId === g._id))),
    section(NO_GROUP, NO_GROUP_NAME, null, inUse.filter((r) => !r.groupId)),
  ].filter((g) => g.accounts.length > 0);
  const system = snap.accounts.filter((a) => !a.deletedAt && a.system).map(row);
  return { groups, archived: rows.filter((r) => r.archivedAt), accounts: rows, assets, liabilities, total: assets - liabilities, system };
}

/** Days before a card's due date that the ledger starts reminding. */
export const CARD_DUE_SOON_DAYS = 3;

export type CardDue = { account: AccountRow; due: string; payable: number; overdue: boolean; days: number };

/**
 * Credit cards with something payable that is due within the next few days, or overdue: what the
 * ledger's reminder lists, soonest first. Archived and hidden cards are left out.
 */
export function cardsDue(rows: AccountRow[], today: string, within = CARD_DUE_SOON_DAYS): CardDue[] {
  const out: CardDue[] = [];
  for (const a of rows) {
    if (a.kind !== "card" || a.archivedAt || a.hidden || !a.nextPayment || !(a.payable && a.payable > 0)) continue;
    const days = diffDays(today, a.nextPayment);
    if (days > within) continue;
    out.push({ account: a, due: a.nextPayment, payable: a.payable, overdue: days < 0, days });
  }
  return out.sort((x, y) => x.due.localeCompare(y.due));
}

/** A card's last `count` statements, newest (the open cycle) first, with their charges and payments. */
export function cardStatements(snap: Snapshot, id: string, today: string, count = 6) {
  const a = snap.accounts.find((x) => x._id === id);
  if (!a || a.kind !== "card") return [];
  return statementCycles(a, today, count).map((c) => ({ ...c, due: a.noDueTracking ? undefined : c.due, ...cycleTotals(id, snap.transactions, c) }));
}

/** What a card can still be charged: its limit less what it owes, future charges (later installments) included. */
export function creditAvailable(a: Pick<AccountRow, "creditLimit" | "balance" | "upcoming">): number | undefined {
  if (a.creditLimit === undefined) return undefined;
  return a.creditLimit - Math.max(0, -(a.balance + Math.min(0, a.upcoming)));
}

export function accountsListDeleted(snap: Snapshot) {
  return {
    accounts: snap.accounts.filter((a) => a.deletedAt).map((a) => ({ ...a, groupName: snap.accountGroups.find((g) => g._id === a.groupId)?.name })),
    groups: snap.accountGroups.filter((g) => g.deletedAt),
  };
}

export function accountGet(snap: Snapshot, id: string, granularity: "daily" | "monthly" | "yearly", from: string, to: string, today = todayISO()) {
  const account = snap.accounts.find((a) => a._id === id);
  if (!account) return null;
  const ledger = ledgerOf(snap);
  const all = snap.transactions;
  const balance = computeBalances(all, ledger, today).get(id) ?? 0;
  const upcoming = computeBalances(all, ledger, undefined, today).get(id) ?? 0;
  const kind = resolveKind(account, snap.accountGroups);

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
  const card = kind === "card" ? { ...cardStatus(account, balance, all, today), due: statementDue(account, today) } : undefined;
  return {
    account, kind, balance, upcoming, card, series,
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
  accountIds?: string[]; categoryIds?: string[]; tag?: string;
};

export function txSearch(snap: Snapshot, args: SearchArgs): Tx[] {
  const q = args.q?.trim().toLowerCase();
  const acc = args.accountIds && args.accountIds.length ? new Set(args.accountIds) : null;
  const cats = args.categoryIds && args.categoryIds.length ? new Set(args.categoryIds) : null;
  // a search for "groceries" or "visa" also finds entries by their category or account name
  const named = (docs: { _id: string; name: string }[]) => (q ? new Set(docs.filter((d) => d.name.toLowerCase().includes(q)).map((d) => d._id)) : new Set<string>());
  const qCats = named(snap.categories);
  const qAccs = named(snap.accounts);
  // "499" or "1,299.50" also finds the entry of that amount (to within one minor unit)
  const decimals = settingsOf(snap)?.decimals ?? 2;
  const qAmount = q && /^[\d,]*\.?\d+$/.test(q) ? Math.round(Number(q.replace(/,/g, "")) * 10 ** decimals) : null;
  const out = snap.transactions.filter((t) => {
    if (args.from && t.date < args.from) return false;
    if (args.to && t.date > args.to) return false;
    if (args.type && t.type !== args.type) return false;
    if (acc && !acc.has(t.accountId) && !(t.toAccountId && acc.has(t.toAccountId))) return false;
    if (cats && !(t.categoryId && cats.has(t.categoryId)) && !(t.subcategoryId && cats.has(t.subcategoryId))) return false;
    if (args.tag && !t.tags.includes(args.tag)) return false;
    if (q && !(t.note.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.tags.some((x) => x.toLowerCase().includes(q))
      || qCats.has(t.categoryId ?? "") || qCats.has(t.subcategoryId ?? "") || qAccs.has(t.accountId) || qAccs.has(t.toAccountId ?? "")
      || (qAmount !== null && Math.abs(t.amount - qAmount) <= 1))) return false;
    return true;
  });
  return out.sort(byDateDesc);
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

/** The categories of the latest entries of a type, newest first and each once, for the editor's quick picks. Archived and deleted ones are left out. */
export function recentCategories(snap: Snapshot, type: "income" | "expense", n = 5): Pick<Tx, "categoryId" | "subcategoryId">[] {
  const live = new Set(snap.categories.filter((c) => !c.deletedAt && !c.archivedAt).map((c) => c._id as string));
  const seen = new Map<string, Pick<Tx, "categoryId" | "subcategoryId">>();
  for (const t of [...snap.transactions].sort(byDateDesc)) {
    if (t.type !== type || !t.categoryId || !live.has(t.categoryId)) continue;
    const sub = t.subcategoryId && live.has(t.subcategoryId) ? t.subcategoryId : undefined;
    const key = `${t.categoryId}|${sub ?? ""}`;
    if (!seen.has(key)) seen.set(key, { categoryId: t.categoryId, subcategoryId: sub });
    if (seen.size >= n) break;
  }
  return [...seen.values()];
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
    // a refund (an expense below zero) says so, so importing the file back keeps it a refund
    type: t.type === "income" ? "Income" : t.type === "expense" ? (t.amount < 0 ? "Refund" : "Expenses") : "Transfer-Out",
    description: t.description ?? "",
    subAmount: t.subAmount ?? "",
    subCurrency: t.subCurrency ?? "",
    fee: t.feeAmount ?? "",
    tags: t.tags.join(", "),
  }));
}

/**
 * Entries as CSV/TSV records, amounts in major units (a sub-currency amount in its own decimals).
 * The columns are the ones the importer reads back, fees and tags included.
 */
export function txCsvRows(snap: Snapshot, from?: string, to?: string): Record<string, string | number>[] {
  const decimals = snap.settings[0]?.decimals ?? 2;
  const curDecimals = new Map(snap.currencies.map((c) => [c.code, c.decimals]));
  const major = (minor: number | string, d: number) => (minor === "" ? "" : Number(minor) / 10 ** d);
  return txExportRows(snap, from, to).map((r) => ({
    Date: r.time ? `${r.date} ${r.time}` : r.date, Account: r.account, Category: r.category, Subcategory: r.subcategory, Note: r.note,
    Amount: major(r.amount, decimals), "Income/Expense": r.type, Description: r.description,
    "Amount Sub": major(r.subAmount, curDecimals.get(r.subCurrency) ?? 2), Currency: r.subCurrency, Fee: major(r.fee, decimals), Tags: r.tags,
  }));
}

const omit = <T extends object, K extends string>(o: T, keys: readonly K[]): Omit<T, K> => {
  const out = { ...o };
  for (const k of keys) delete (out as Record<string, unknown>)[k];
  return out;
};

export function backupExport(snap: Snapshot) {
  const settings = settingsOf(snap);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings && omit(settings, PASSCODE_FIELDS),
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

/**
 * Every entry the Stats tab counts for a period, with the amount it counts and its bucket: a main
 * category id, "none" (uncategorised), "transfer:<account>" or "fees". The category screen lists
 * a bucket's entries from this, so its list always adds up to the figure on the Stats tab.
 */
export function statsEntries(snap: Snapshot, from: string, to: string, type: "income" | "expense") {
  const ledger = ledgerOf(snap);
  const catIds = new Set(snap.categories.filter((c) => c.type === type).map((c) => c._id as string));
  const out: { t: Doc<"transactions">; amount: number; bucket: string }[] = [];
  for (const t of snap.transactions) {
    if (t.date < from || t.date > to) continue;
    const k = kindsOf(t, ledger);
    const amount = type === "income" ? k.income : k.expense;
    if (!amount) continue;
    for (const b of entryBuckets(t, amount, catIds)) out.push({ t, ...b });
  }
  return out;
}

/**
 * Splits what an entry counts into its Stats buckets. A transfer counts its amount (when the target
 * counts as spending) under "transfer:<account>" and its fee under "fees", so one transfer can be two.
 */
function entryBuckets(t: Doc<"transactions">, amount: number, catIds: Set<string>): { bucket: string; amount: number }[] {
  if (t.type !== "transfer") return [{ bucket: t.categoryId && catIds.has(t.categoryId) ? t.categoryId : "none", amount }];
  const fee = Math.min(t.feeAmount ?? 0, amount);
  const out: { bucket: string; amount: number }[] = [];
  if (amount - fee) out.push({ bucket: `transfer:${t.toAccountId ?? ""}`, amount: amount - fee });
  if (fee) out.push({ bucket: "fees", amount: fee });
  return out;
}

/** Totals per main category for a period, with subcategory breakdown. Transfer-as-expense rows show as "Transfer to X". */
export function statsByCategory(snap: Snapshot, from: string, to: string, type: "income" | "expense"): { total: number; items: CategoryStat[] } {
  const catById = new Map<string, Doc<"categories">>(snap.categories.filter((c) => c.type === type).map((c) => [c._id, c]));
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
  for (const { t, amount, bucket } of statsEntries(snap, from, to, type)) {
    total += amount;
    if (bucket.startsWith("transfer:")) {
      ensure(bucket, `Transfer to ${t.toAccountId ? accName.get(t.toAccountId) ?? "account" : "account"}`).amount += amount;
      continue;
    }
    if (bucket === "fees") { ensure("fees", "Fees").amount += amount; continue; }
    const cat = catById.get(bucket);
    const m = ensure(bucket, cat?.name ?? "Uncategorised");
    m.amount += amount;
    const sub = t.subcategoryId ? catById.get(t.subcategoryId) : undefined;
    const childKey = sub?._id ?? "none";
    const child = m.children.get(childKey) ?? { id: childKey, name: sub?.name ?? "(no subcategory)", amount: 0 };
    child.amount += amount;
    m.children.set(childKey, child);
  }
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
  const catIds = new Set(parentOf.keys());
  return ranges.map((r) => {
    let amount = 0;
    for (const t of snap.transactions) {
      if (t.date < r.from || t.date > r.to) continue;
      const k = kindsOf(t, ledger);
      let a = type === "income" ? k.income : k.expense;
      if (!a) continue;
      if (categoryId) {
        if (t.type === "transfer") {
          // only the part of the transfer in this bucket: the amount, or the fee for "fees"
          a = entryBuckets(t, a, catIds).reduce((s, b) => s + (b.bucket === categoryId ? b.amount : 0), 0);
          if (!a) continue;
        } else {
          if (t.type !== type || categoryId.startsWith("transfer:") || categoryId === "fees") continue;
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

export type BudgetStatusItem = {
  budget: Doc<"budgets">;
  /** What can be spent this period: the period's amount plus `carry`. */
  limit: number;
  spent: number;
  remaining: number;
  isOverride: boolean;
  /** Left over (or, below zero, overspent) in the earlier periods since carrying over was turned on. */
  carry: number;
};
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
  const budgets = snap.budgets.filter((b) => b.period === period);
  const carried = carryOver(snap, budgets, period, key);
  const items = budgets
    .map((b) => {
      const carry = carried.get(b._id) ?? 0;
      const limit = (b.overrides[key] ?? b.amount) + carry;
      const spent = b.categoryId ? spentByCat.get(b.categoryId) ?? 0 : spentAll;
      return { budget: b, limit, spent, remaining: limit - spent, isOverride: b.overrides[key] !== undefined, carry };
    });
  const total = items.find((i) => !i.budget.categoryId);
  const perCategory = items.filter((i) => i.budget.categoryId).sort((a, b) => b.spent / Math.max(1, b.limit) - a.spent / Math.max(1, a.limit));
  return { range, total, perCategory, spentAll, elapsed: elapsedFraction(range, today) };
}

/** The period after `key`. */
function nextPeriodKey(period: Doc<"budgets">["period"], key: string, monthStartDay: number, weekStartDay: number): string {
  return periodKey(period, addDays(periodRange(period, key, monthStartDay, weekStartDay).to, 1), monthStartDay, weekStartDay);
}

/**
 * What each rollover budget brings into `key`: the sum of (amount − spent) over every period from
 * the one carrying over was turned on in (`rolloverFrom`) up to, not including, `key`. Unspent
 * money adds to the next period, overspending takes from it. One pass over the entries.
 */
function carryOver(snap: Snapshot, budgets: Doc<"budgets">[], period: Doc<"budgets">["period"], key: string): Map<string, number> {
  const out = new Map<string, number>();
  const rolling = budgets.filter((b) => b.rolloverFrom && b.rolloverFrom < key);
  const settings = settingsOf(snap);
  if (!rolling.length || !settings) return out;
  const { monthStartDay: msd, weekStartDay: wsd } = settings;
  const earliest = rolling.reduce((m, b) => (b.rolloverFrom! < m ? b.rolloverFrom! : m), key);
  const from = periodRange(period, earliest, msd, wsd).from;
  const to = periodRange(period, key, msd, wsd).from;
  const ledger = ledgerOf(snap);
  const parentOf = new Map(snap.categories.filter((c) => c.type === "expense").map((c) => [c._id as string, (c.parentId ?? c._id) as string]));
  // spent per period key, per main category and in all ("")
  const spent = new Map<string, Map<string, number>>();
  const add = (k: string, cat: string, n: number) => {
    let m = spent.get(k);
    if (!m) spent.set(k, (m = new Map()));
    m.set(cat, (m.get(cat) ?? 0) + n);
  };
  for (const t of snap.transactions) {
    if (t.date < from || t.date >= to) continue;
    const e = kindsOf(t, ledger).expense;
    if (!e) continue;
    const k = periodKey(period, t.date, msd, wsd);
    add(k, "", e);
    if (t.categoryId) add(k, parentOf.get(t.categoryId) ?? t.categoryId, e);
  }
  for (const b of rolling) {
    let carry = 0;
    let k = b.rolloverFrom!;
    for (let guard = 0; k < key && guard < 2000; guard++) {
      carry += (b.overrides[k] ?? b.amount) - (spent.get(k)?.get(b.categoryId ?? "") ?? 0);
      k = nextPeriodKey(period, k, msd, wsd);
    }
    out.set(b._id, carry);
  }
  return out;
}

/** How far a budget is through its limit: 0 under 80%, 1 from 80%, 2 at or past it. */
export type BudgetLevel = 0 | 1 | 2;
export const BUDGET_WARN = 0.8;
export type BudgetAlertItem = BudgetStatusItem & { level: BudgetLevel; range: Range; period: Doc<"budgets">["period"] };

export function budgetLevel(item: Pick<BudgetStatusItem, "limit" | "spent">): BudgetLevel {
  if (item.spent <= 0) return 0;
  if (item.spent >= item.limit) return 2;
  return item.spent >= item.limit * BUDGET_WARN ? 1 : 0;
}

/** Every budget in the period that holds `today`, with how far through it is: what the alerts and the Stats tab's dot read. */
export function currentBudgetLevels(snap: Snapshot, today: string): BudgetAlertItem[] {
  const settings = settingsOf(snap);
  if (!settings) return [];
  const out: BudgetAlertItem[] = [];
  for (const period of ["weekly", "monthly", "yearly"] as const) {
    if (!snap.budgets.some((b) => b.period === period)) continue;
    const status = budgetStatus(snap, period, periodKey(period, today, settings.monthStartDay, settings.weekStartDay), today);
    if (!status) continue;
    for (const it of [...(status.total ? [status.total] : []), ...status.perCategory]) out.push({ ...it, level: budgetLevel(it), range: status.range, period });
  }
  return out;
}

/**
 * Budgets that went up a level between two readings (an entry pushed Food past 80%, or over):
 * what deserves a toast. A budget that wasn't in the earlier reading (just made) never alerts.
 */
export function budgetCrossings(before: BudgetAlertItem[], after: BudgetAlertItem[]): BudgetAlertItem[] {
  const was = new Map(before.map((i) => [`${i.budget._id}|${i.range.from}`, i.level]));
  return after.filter((i) => {
    const w = was.get(`${i.budget._id}|${i.range.from}`);
    return w !== undefined && i.level > w;
  });
}

export type { Id };
