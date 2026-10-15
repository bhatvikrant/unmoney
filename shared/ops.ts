/**
 * Every write in UnMoney is an "op": a small, serialisable command that is applied to a
 * Snapshot (all of one user's documents) by the pure reducer below. The browser applies ops
 * to its local replica the moment the user acts (so everything works offline), queues them,
 * and sends them to Convex when it can; the server runs the very same reducer on the user's
 * real documents and writes the difference. New documents get deterministic temporary ids
 * (`tmp_<opId>_<n>`) on both sides, so the server can tell the client which real id each
 * one received.
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import { addMonths, todayISO } from "./dates";
import { currencyInfo } from "./currencies";
import { DEFAULT_ACCOUNTS, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_GROUPS, DEFAULT_INCOME_CATEGORIES } from "./defaults";
import { nextOccurrence, type Frequency } from "./repeat";
import { monthKeyForDate, monthRange } from "./period";
import { toMinor } from "./money";

export const TABLES = [
  "settings", "accountGroups", "accounts", "categories", "transactions", "repeats", "bookmarks", "budgets", "notes", "currencies",
] as const;
export type Table = (typeof TABLES)[number];
export type Snapshot = { [T in Table]: Doc<T>[] };

export function emptySnapshot(): Snapshot {
  return { settings: [], accountGroups: [], accounts: [], categories: [], transactions: [], repeats: [], bookmarks: [], budgets: [], notes: [], currencies: [] };
}

export type Op = { id: string; kind: OpKind; args: unknown; at: number };
export type OpCtx = { userId: Id<"users"> };

export const TMP_PREFIX = "tmp_";
export function isTmpId(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(TMP_PREFIX);
}

/** Replace temporary ids anywhere inside a value with their real ids. */
export function rewriteIds<T>(value: T, idMap: Record<string, string>): T {
  if (typeof value === "string") return (idMap[value] ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => rewriteIds(v, idMap)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rewriteIds(v, idMap);
    return out as T;
  }
  return value;
}

/** Temporary ids referenced anywhere inside a value. */
export function tmpIdsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (isTmpId(value)) out.add(value);
  else if (Array.isArray(value)) for (const v of value) tmpIdsIn(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) tmpIdsIn(v, out);
  return out;
}

/** Drop keys whose value is undefined, so documents stay schema-clean and comparable. */
export function clean<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

// ---------- op catalogue ----------

export type TxType = "income" | "expense" | "transfer";
export type Template = Doc<"bookmarks">["template"];
export type TxFields = {
  type: TxType;
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
export type AccountFields = {
  name: string;
  groupId: Id<"accountGroups">;
  initialBalance: number;
  includeInTotals: boolean;
  hidden: boolean;
  transferAsExpense: boolean;
  description?: string;
  billingAccountId?: Id<"accounts">;
  settlementDay?: number;
  paymentDay?: number;
  linkedAccountId?: Id<"accounts">;
};
export type SettingsPatch = Partial<Pick<Doc<"settings">,
  "mainCurrency" | "symbol" | "symbolPosition" | "decimals" | "monthStartDay" | "weekStartDay" | "carryOver" | "startScreen" | "theme" | "accent" |
  "colorSet" | "subcategoryEnabled" | "autocompleteEnabled" | "timeInputEnabled" | "repeatDisplay" | "cardExpenseDisplay" | "lockAfter">>;
export type ImportRow = {
  date: string; account: string; category: string; subcategory?: string; note?: string; amount: string; type: string;
  description?: string; subAmount?: string; subCurrency?: string;
  /** HH:MM, when the source has times (Money Manager's Excel export does). */
  time?: string;
};

export interface Ops {
  "settings.completeOnboarding": { args: { currency: string; symbolPosition?: "before" | "after" }; result: void };
  "settings.update": { args: { patch: SettingsPatch }; result: void };
  "settings.changeMainCurrency": { args: { code: string; keepData: boolean }; result: void };
  "settings.setPasscode": { args: { hash?: string; salt?: string }; result: void };

  "accountGroups.create": { args: { name: string; kind: Doc<"accountGroups">["kind"] }; result: Id<"accountGroups"> };
  "accountGroups.update": { args: { id: Id<"accountGroups">; name?: string; kind?: Doc<"accountGroups">["kind"] }; result: void };
  "accountGroups.remove": { args: { id: Id<"accountGroups"> }; result: void };
  "accountGroups.restore": { args: { id: Id<"accountGroups"> }; result: void };
  "accountGroups.reorder": { args: { ids: Id<"accountGroups">[] }; result: void };

  "accounts.create": { args: AccountFields; result: Id<"accounts"> };
  "accounts.update": { args: AccountFields & { id: Id<"accounts"> }; result: void };
  "accounts.setHidden": { args: { id: Id<"accounts">; hidden: boolean }; result: void };
  "accounts.remove": { args: { id: Id<"accounts"> }; result: void };
  "accounts.restore": { args: { id: Id<"accounts"> }; result: void };
  "accounts.permanentlyDelete": { args: { id: Id<"accounts"> }; result: void };
  "accounts.reorder": { args: { items: { id: Id<"accounts">; groupId: Id<"accountGroups"> }[] }; result: void };
  "accounts.payCard": { args: { id: Id<"accounts">; amount: number; date: string; fromAccountId?: Id<"accounts"> }; result: Id<"transactions"> };

  "categories.create": { args: { type: "income" | "expense"; name: string; parentId?: Id<"categories"> }; result: Id<"categories"> };
  "categories.update": { args: { id: Id<"categories">; name?: string; parentId?: Id<"categories"> | null }; result: void };
  "categories.remove": { args: { id: Id<"categories"> }; result: void };
  "categories.reorder": { args: { ids: Id<"categories">[] }; result: void };

  "transactions.create": { args: TxFields & { repeat?: { frequency: Frequency; endDate?: string }; installment?: { count: number } }; result: Id<"transactions"> };
  "transactions.update": { args: TxFields & { id: Id<"transactions">; scope?: "one" | "future" }; result: void };
  "transactions.remove": { args: { id: Id<"transactions">; scope?: "one" | "future" | "all" }; result: void };
  "transactions.bulkUpdate": { args: { ids: Id<"transactions">[]; date?: string; note?: string; categoryId?: Id<"categories">; accountId?: Id<"accounts"> }; result: void };
  "transactions.bulkRemove": { args: { ids: Id<"transactions">[] }; result: void };
  "transactions.importRows": {
    /**
     * createMissing: categories · createAccounts: accounts, in the Others group · skipInvalid: import the good rows, report the rest ·
     * skipDuplicates: leave out rows matching an entry already there (same day, account, type, amount and note), one per existing entry ·
     * rowOffset: numbering of the first row, for chunked imports
     */
    args: { rows: ImportRow[]; createMissing?: boolean; createAccounts?: boolean; skipInvalid?: boolean; skipDuplicates?: boolean; rowOffset?: number };
    result: { inserted: number; errors: { row: number; reason: string }[]; createdAccounts: string[]; duplicates: number[] };
  };
  "transactions.copy": { args: { id: Id<"transactions">; useToday: boolean }; result: Id<"transactions"> };

  "repeats.update": { args: { id: Id<"repeats">; frequency?: Frequency; endDate?: string | null; nextDate?: string; active?: boolean; template?: Template }; result: void };
  "repeats.remove": { args: { id: Id<"repeats"> }; result: void };
  "repeats.catchUp": { args: { today: string }; result: number };

  "bookmarks.create": { args: { template: Template; transactionId?: Id<"transactions"> }; result: Id<"bookmarks"> };
  "bookmarks.update": { args: { id: Id<"bookmarks">; template: Template }; result: void };
  "bookmarks.remove": { args: { id: Id<"bookmarks"> }; result: void };
  "bookmarks.reorder": { args: { ids: Id<"bookmarks">[] }; result: void };

  "budgets.upsert": { args: { id?: Id<"budgets">; categoryId?: Id<"categories">; period: Doc<"budgets">["period"]; amount: number }; result: Id<"budgets"> };
  "budgets.setOverride": { args: { id: Id<"budgets">; key: string; amount: number | null }; result: void };
  "budgets.remove": { args: { id: Id<"budgets"> }; result: void };

  "notes.upsert": { args: { id?: Id<"notes">; date: string; text: string; color: string }; result: Id<"notes"> };
  "notes.remove": { args: { id: Id<"notes"> }; result: void };

  "currencies.add": { args: Omit<Doc<"currencies">, "_id" | "_creationTime" | "userId" | "order">; result: Id<"currencies"> };
  "currencies.update": { args: { id: Id<"currencies">; rate?: number; decimals?: number; symbolPosition?: "before" | "after"; symbol?: string; name?: string }; result: void };
  "currencies.remove": { args: { id: Id<"currencies"> }; result: void };
  "currencies.reorder": { args: { ids: Id<"currencies">[] }; result: void };
  "currencies.setRates": { args: { rates: { id: Id<"currencies">; rate: number }[] }; result: void };

  "backup.restore": { args: { data: BackupData }; result: void };
  "backup.wipeAll": { args: { confirm: "DELETE" }; result: void };

  /** Not a snapshot change: the browser uploads the queued file itself. Listed so queues can hold it. */
  "files.upload": { args: { name: string; type: string; size: number }; result: Id<"_storage"> };
}
export type OpKind = keyof Ops;
export type OpArgs<K extends OpKind> = Ops[K]["args"];
export type OpResult<K extends OpKind> = Ops[K]["result"];

export type BackupData = {
  version: number;
  settings?: Record<string, unknown> | null;
  accountGroups?: Record<string, unknown>[];
  accounts?: Record<string, unknown>[];
  categories?: Record<string, unknown>[];
  transactions?: Record<string, unknown>[];
  repeats?: Record<string, unknown>[];
  bookmarks?: Record<string, unknown>[];
  budgets?: Record<string, unknown>[];
  notes?: Record<string, unknown>[];
  currencies?: Record<string, unknown>[];
};

/** Tables an op reads or writes. The server loads only these before running the reducer. */
const ALL: Table[] = [...TABLES];
export const OP_TABLES: Record<OpKind, Table[]> = {
  "settings.completeOnboarding": ["settings", "accountGroups", "accounts", "categories"],
  "settings.update": ["settings"],
  "settings.changeMainCurrency": ["settings", "transactions", "accounts", "budgets"],
  "settings.setPasscode": ["settings"],
  "accountGroups.create": ["accountGroups"],
  "accountGroups.update": ["accountGroups"],
  "accountGroups.remove": ["accountGroups", "accounts"],
  "accountGroups.restore": ["accountGroups"],
  "accountGroups.reorder": ["accountGroups"],
  "accounts.create": ["accountGroups", "accounts"],
  "accounts.update": ["accountGroups", "accounts"],
  "accounts.setHidden": ["accounts"],
  "accounts.remove": ["accounts"],
  "accounts.restore": ["accountGroups", "accounts"],
  "accounts.permanentlyDelete": ["accounts", "transactions"],
  "accounts.reorder": ["accountGroups", "accounts"],
  "accounts.payCard": ["accounts", "transactions"],
  "categories.create": ["categories"],
  "categories.update": ["categories"],
  "categories.remove": ["categories"],
  "categories.reorder": ["categories"],
  "transactions.create": ["accounts", "categories", "transactions", "repeats"],
  "transactions.update": ["accounts", "categories", "transactions", "repeats"],
  "transactions.remove": ["transactions", "repeats"],
  "transactions.bulkUpdate": ["accounts", "categories", "transactions"],
  "transactions.bulkRemove": ["transactions"],
  "transactions.importRows": ["settings", "accountGroups", "accounts", "categories", "currencies", "transactions"],
  "transactions.copy": ["transactions"],
  "repeats.update": ["repeats"],
  "repeats.remove": ["repeats", "transactions"],
  "repeats.catchUp": ["settings", "repeats", "transactions"],
  "bookmarks.create": ["accounts", "transactions", "bookmarks"],
  "bookmarks.update": ["bookmarks"],
  "bookmarks.remove": ["bookmarks"],
  "bookmarks.reorder": ["bookmarks"],
  "budgets.upsert": ["categories", "budgets"],
  "budgets.setOverride": ["budgets"],
  "budgets.remove": ["budgets"],
  "notes.upsert": ["notes"],
  "notes.remove": ["notes"],
  "currencies.add": ["currencies"],
  "currencies.update": ["currencies"],
  "currencies.remove": ["currencies"],
  "currencies.reorder": ["currencies"],
  "currencies.setRates": ["currencies"],
  "backup.restore": ALL,
  "backup.wipeAll": ["transactions", "notes", "repeats", "bookmarks", "budgets"],
  "files.upload": [],
};

// ---------- working copy ----------

type Insertable<T extends Table> = Omit<Doc<T>, "_id" | "_creationTime" | "userId">;

class Work {
  snap: Snapshot;
  private copied = new Set<Table>();
  private n = 0;
  private op: Op;
  private ctx: OpCtx;
  constructor(base: Snapshot, op: Op, ctx: OpCtx) {
    this.snap = { ...base };
    this.op = op;
    this.ctx = ctx;
  }
  /** The table as a private array this op may mutate (the base snapshot is never touched). */
  t<T extends Table>(table: T): Doc<T>[] {
    if (!this.copied.has(table)) {
      this.snap[table] = [...this.snap[table]] as Snapshot[T];
      this.copied.add(table);
    }
    return this.snap[table];
  }
  get<T extends Table>(table: T, id: string | undefined): Doc<T> | undefined {
    return id === undefined ? undefined : this.snap[table].find((d) => d._id === id);
  }
  must<T extends Table>(table: T, id: string | undefined, msg = "Not found"): Doc<T> {
    const d = this.get(table, id);
    if (!d) throw new Error(msg);
    return d;
  }
  insert<T extends Table>(table: T, doc: Insertable<T>): Id<T> {
    this.n++;
    const _id = `${TMP_PREFIX}${this.op.id}_${this.n}` as Id<T>;
    this.t(table).push(clean({ ...doc, _id, _creationTime: this.op.at + this.n, userId: this.ctx.userId } as unknown as Doc<T>));
    return _id;
  }
  patch<T extends Table>(table: T, id: Id<T>, patch: Partial<Doc<T>>): void {
    const arr = this.t(table);
    const i = arr.findIndex((d) => d._id === id);
    if (i < 0) throw new Error("Not found");
    arr[i] = clean({ ...arr[i], ...patch });
  }
  delete<T extends Table>(table: T, id: Id<T>): void {
    const arr = this.t(table);
    const i = arr.findIndex((d) => d._id === id);
    if (i >= 0) arr.splice(i, 1);
  }
  clear(table: Table): void {
    this.t(table).length = 0;
  }
  settings(): Doc<"settings"> | null {
    return this.snap.settings[0] ?? null;
  }
  requireSettings(): Doc<"settings"> {
    const s = this.settings();
    if (!s) throw new Error("Finish onboarding first");
    return s;
  }
}

// ---------- reducer ----------

export function applyOp(base: Snapshot, op: Op, ctx: OpCtx): { snap: Snapshot; result: unknown } {
  const w = new Work(base, op, ctx);
  const result = run(w, op.kind, op.args as never);
  return { snap: w.snap, result };
}

function run<K extends OpKind>(w: Work, kind: K, a: OpArgs<K>): OpResult<K> {
  const h = handlers[kind] as (w: Work, a: OpArgs<K>) => OpResult<K>;
  if (!h) throw new Error(`Unknown op ${kind}`);
  return h(w, a);
}

type Handlers = { [K in OpKind]: (w: Work, a: OpArgs<K>) => OpResult<K> };

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const nextOrder = (docs: { order: number }[]) => Math.max(-1, ...docs.map((d) => d.order)) + 1;

function validateTx(w: Work, t: TxFields): TxFields {
  if (!isDate(t.date)) throw new Error("Bad date");
  if (!Number.isInteger(t.amount)) throw new Error("Amount must be a whole number of minor units");
  w.must("accounts", t.accountId, "Pick an account");
  const tags = [...new Set((t.tags ?? []).map((x) => x.trim()).filter(Boolean))];
  const c: TxFields = { ...t, note: (t.note ?? "").trim(), tags, photoIds: t.photoIds ?? [] };
  if (c.photoIds.length > 3) throw new Error("At most 3 photos");
  if (t.type === "transfer") {
    if (!t.toAccountId) throw new Error("Pick an account to transfer to");
    if (t.toAccountId === t.accountId) throw new Error("From and To must differ");
    w.must("accounts", t.toAccountId, "Pick an account to transfer to");
    if (t.amount < 0) throw new Error("Transfer amount must be positive");
    if (t.feeAmount !== undefined && (!Number.isInteger(t.feeAmount) || t.feeAmount < 0)) throw new Error("Bad fee");
    c.categoryId = undefined;
    c.subcategoryId = undefined;
  } else {
    if (!t.categoryId) throw new Error("Pick a category");
    const cat = w.must("categories", t.categoryId, "Pick a category");
    if (cat.type !== t.type) throw new Error("Category type does not match");
    if (t.subcategoryId) {
      const sub = w.must("categories", t.subcategoryId, "Pick a category");
      if (sub.parentId !== t.categoryId) throw new Error("Subcategory does not belong to that category");
    }
    c.toAccountId = undefined;
    c.feeAmount = undefined;
  }
  return c;
}

function validateAccount(w: Work, a: AccountFields, selfId?: Id<"accounts">): Doc<"accountGroups"> {
  if (!a.name.trim()) throw new Error("Name is required");
  if (!Number.isInteger(a.initialBalance)) throw new Error("Amount must be a whole number of minor units");
  const group = w.must("accountGroups", a.groupId, "Pick a group");
  if (group.kind === "card") {
    if (!a.billingAccountId) throw new Error("A credit card needs a billing account");
    if (a.billingAccountId === selfId) throw new Error("A card cannot bill itself");
    w.must("accounts", a.billingAccountId, "Billing account not found");
    for (const d of [a.settlementDay, a.paymentDay]) {
      if (d === undefined || d < 1 || d > 31) throw new Error("Settlement and payment days must be between 1 and 31");
    }
  }
  if (group.kind === "debitCard") {
    if (!a.linkedAccountId) throw new Error("A debit card needs a linked bank account");
    if (a.linkedAccountId === selfId) throw new Error("A debit card cannot link to itself");
    w.must("accounts", a.linkedAccountId, "Linked account not found");
  }
  return group;
}

const templateOf = (t: TxFields): Template => ({
  type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId,
  amount: t.amount, note: t.note, description: t.description, tags: t.tags, feeAmount: t.feeAmount,
});

function horizonFor(s: Doc<"settings"> | null, today: string): string {
  if (s?.repeatDisplay === "firstOfMonth") return monthRange(monthKeyForDate(today, s.monthStartDay), s.monthStartDay).to;
  return today;
}

/** Active schedules that have entries due on or before the horizon for `today`. */
export function dueRepeats(snap: Snapshot, today: string): Doc<"repeats">[] {
  const h = horizonFor(snap.settings[0] ?? null, today);
  return snap.repeats.filter((r) => r.active && r.nextDate <= h);
}

const strip = (d: Record<string, unknown>) => {
  const { _id, _creationTime, userId, ...rest } = d;
  void _id; void _creationTime; void userId;
  return rest;
};

const handlers: Handlers = {
  "settings.completeOnboarding": (w, { currency, symbolPosition }) => {
    if (w.settings()) return;
    const info = currencyInfo(currency) ?? { code: currency, symbol: currency, decimals: 2, name: currency };
    w.insert("settings", {
      onboarded: true, mainCurrency: info.code, symbol: info.symbol, symbolPosition: symbolPosition ?? info.position ?? "before", decimals: info.decimals,
      monthStartDay: 1, weekStartDay: 0, carryOver: false, startScreen: "daily", theme: "system", accent: "neutral", colorSet: "A",
      subcategoryEnabled: true, autocompleteEnabled: true, timeInputEnabled: false, repeatDisplay: "onDate", cardExpenseDisplay: "atTime", lockAfter: "always",
    });
    const groupIds = new Map<string, Id<"accountGroups">>();
    let order = 0;
    for (const g of DEFAULT_GROUPS) groupIds.set(g.kind, w.insert("accountGroups", { name: g.name, kind: g.kind as Doc<"accountGroups">["kind"], order: order++ }));
    order = 0;
    for (const a of DEFAULT_ACCOUNTS) {
      w.insert("accounts", { groupId: groupIds.get(a.groupKind)!, name: a.name, initialBalance: 0, includeInTotals: true, hidden: false, order: order++, transferAsExpense: false });
    }
    order = 0;
    for (const name of DEFAULT_EXPENSE_CATEGORIES) w.insert("categories", { type: "expense", name, order: order++ });
    order = 0;
    for (const name of DEFAULT_INCOME_CATEGORIES) w.insert("categories", { type: "income", name, order: order++ });
  },

  "settings.update": (w, { patch }) => {
    const s = w.requireSettings();
    if (patch.monthStartDay !== undefined && (patch.monthStartDay < 1 || patch.monthStartDay > 28)) throw new Error("Month start day must be between 1 and 28");
    if (patch.weekStartDay !== undefined && (patch.weekStartDay < 0 || patch.weekStartDay > 6)) throw new Error("Week start day must be between 0 and 6");
    if (patch.decimals !== undefined && (patch.decimals < 0 || patch.decimals > 8)) throw new Error("Decimals must be between 0 and 8");
    w.patch("settings", s._id, clean(patch));
  },

  "settings.changeMainCurrency": (w, { code, keepData }) => {
    const s = w.requireSettings();
    const info = currencyInfo(code) ?? { code, symbol: code, decimals: 2, name: code };
    const factor = 10 ** (info.decimals - s.decimals);
    if (!keepData) {
      w.clear("transactions");
    } else if (factor !== 1) {
      for (const t of [...w.snap.transactions]) {
        w.patch("transactions", t._id, {
          amount: Math.round(t.amount * factor),
          feeAmount: t.feeAmount === undefined ? undefined : Math.round(t.feeAmount * factor),
          installmentTotal: t.installmentTotal === undefined ? undefined : Math.round(t.installmentTotal * factor),
        });
      }
      for (const a of [...w.snap.accounts]) w.patch("accounts", a._id, { initialBalance: Math.round(a.initialBalance * factor) });
      for (const b of [...w.snap.budgets]) {
        const overrides: Record<string, number> = {};
        for (const [k, val] of Object.entries(b.overrides)) overrides[k] = Math.round(val * factor);
        w.patch("budgets", b._id, { amount: Math.round(b.amount * factor), overrides });
      }
    }
    w.patch("settings", s._id, { mainCurrency: info.code, symbol: info.symbol, decimals: info.decimals, symbolPosition: info.position ?? "before" });
  },

  "settings.setPasscode": (w, { hash, salt }) => {
    const s = w.requireSettings();
    w.patch("settings", s._id, { passcodeHash: hash, passcodeSalt: salt });
  },

  "accountGroups.create": (w, { name, kind }) => {
    if (!name.trim()) throw new Error("Name is required");
    return w.insert("accountGroups", { name: name.trim(), kind, order: nextOrder(w.snap.accountGroups) });
  },
  "accountGroups.update": (w, { id, name, kind }) => {
    w.must("accountGroups", id);
    w.patch("accountGroups", id, { ...(name !== undefined ? { name: name.trim() } : {}), ...(kind ? { kind } : {}) });
  },
  "accountGroups.remove": (w, { id }) => {
    w.must("accountGroups", id);
    if (w.snap.accounts.some((a) => a.groupId === id && !a.deletedAt)) throw new Error("Move or delete the accounts in this group first");
    w.patch("accountGroups", id, { deletedAt: Date.now() });
  },
  "accountGroups.restore": (w, { id }) => {
    w.must("accountGroups", id);
    w.patch("accountGroups", id, { deletedAt: undefined });
  },
  "accountGroups.reorder": (w, { ids }) => {
    ids.forEach((id, i) => { w.must("accountGroups", id); w.patch("accountGroups", id, { order: i }); });
  },

  "accounts.create": (w, a) => {
    validateAccount(w, a);
    return w.insert("accounts", { ...a, name: a.name.trim(), order: nextOrder(w.snap.accounts) });
  },
  "accounts.update": (w, { id, ...a }) => {
    w.must("accounts", id);
    const group = validateAccount(w, a, id);
    w.patch("accounts", id, {
      ...a,
      name: a.name.trim(),
      billingAccountId: group.kind === "card" ? a.billingAccountId : undefined,
      settlementDay: group.kind === "card" ? a.settlementDay : undefined,
      paymentDay: group.kind === "card" ? a.paymentDay : undefined,
      linkedAccountId: group.kind === "debitCard" ? a.linkedAccountId : undefined,
    });
  },
  "accounts.setHidden": (w, { id, hidden }) => {
    w.must("accounts", id);
    w.patch("accounts", id, { hidden });
  },
  "accounts.remove": (w, { id }) => {
    w.must("accounts", id);
    w.patch("accounts", id, { deletedAt: Date.now() });
  },
  "accounts.restore": (w, { id }) => {
    const a = w.must("accounts", id);
    const g = w.get("accountGroups", a.groupId);
    if (g?.deletedAt) w.patch("accountGroups", g._id, { deletedAt: undefined });
    w.patch("accounts", id, { deletedAt: undefined });
  },
  "accounts.permanentlyDelete": (w, { id }) => {
    w.must("accounts", id);
    for (const t of [...w.snap.transactions]) if (t.accountId === id || t.toAccountId === id) w.delete("transactions", t._id);
    w.delete("accounts", id);
  },
  "accounts.reorder": (w, { items }) => {
    items.forEach((it, i) => {
      w.must("accounts", it.id);
      w.must("accountGroups", it.groupId);
      w.patch("accounts", it.id, { order: i, groupId: it.groupId });
    });
  },
  "accounts.payCard": (w, { id, amount, date, fromAccountId }) => {
    const card = w.must("accounts", id);
    const from = fromAccountId ?? card.billingAccountId;
    if (!from) throw new Error("No billing account set on this card");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Amount must be positive");
    if (!isDate(date)) throw new Error("Bad date");
    w.must("accounts", from);
    return w.insert("transactions", { type: "transfer", date, accountId: from, toAccountId: id, amount, note: `${card.name} payment`, tags: [], photoIds: [] });
  },

  "categories.create": (w, { type, name, parentId }) => {
    if (!name.trim()) throw new Error("Name is required");
    if (parentId) {
      const parent = w.must("categories", parentId, "Parent not found");
      if (parent.parentId) throw new Error("Only one level of subcategories");
      if (parent.type !== type) throw new Error("Parent type mismatch");
    }
    const order = nextOrder(w.snap.categories.filter((c) => c.type === type));
    return w.insert("categories", { type, name: name.trim(), parentId, order });
  },
  "categories.update": (w, { id, name, parentId }) => {
    w.must("categories", id);
    const patch: Partial<Doc<"categories">> = {};
    if (name !== undefined) {
      if (!name.trim()) throw new Error("Name is required");
      patch.name = name.trim();
    }
    if (parentId !== undefined) {
      if (parentId === null) patch.parentId = undefined;
      else {
        if (parentId === id) throw new Error("A category cannot be its own parent");
        const parent = w.must("categories", parentId, "Parent not found");
        if (parent.parentId) throw new Error("Only one level of subcategories");
        if (w.snap.categories.some((c) => c.parentId === id && !c.deletedAt)) throw new Error("Move its subcategories first");
        patch.parentId = parentId;
      }
    }
    w.patch("categories", id, patch);
  },
  "categories.remove": (w, { id }) => {
    w.must("categories", id);
    const now = Date.now();
    for (const c of [...w.snap.categories]) if (c.parentId === id) w.patch("categories", c._id, { deletedAt: now });
    w.patch("categories", id, { deletedAt: now });
  },
  "categories.reorder": (w, { ids }) => {
    ids.forEach((id, i) => { w.must("categories", id); w.patch("categories", id, { order: i }); });
  },

  "transactions.create": (w, { repeat, installment, ...input }) => {
    const t = validateTx(w, input);
    const { date, ...rest } = t;
    const template = templateOf(t);
    if (installment) {
      const n = Math.floor(installment.count);
      if (n < 2 || n > 60) throw new Error("Installments must be between 2 and 60 months");
      const per = Math.floor(t.amount / n);
      const first = t.amount - per * (n - 1);
      const repeatId = w.insert("repeats", {
        kind: "installment", frequency: "monthly", startDate: date, nextDate: addMonths(date, n - 1), installmentCount: n, template: { ...template, amount: t.amount }, active: false,
      });
      let firstId: Id<"transactions"> | null = null;
      for (let i = 0; i < n; i++) {
        const id = w.insert("transactions", {
          ...rest, date: addMonths(date, i), amount: i === 0 ? first : per, repeatId, installmentIndex: i + 1, installmentCount: n, installmentTotal: t.amount, photoIds: i === 0 ? t.photoIds : [],
        });
        if (i === 0) firstId = id;
      }
      return firstId!;
    }
    if (repeat) {
      const repeatId = w.insert("repeats", {
        kind: "repeat", frequency: repeat.frequency, startDate: date, endDate: repeat.endDate || undefined, nextDate: nextOccurrence(date, date, repeat.frequency), template, active: true,
      });
      return w.insert("transactions", { ...rest, date, repeatId });
    }
    return w.insert("transactions", { ...rest, date });
  },

  "transactions.update": (w, { id, scope, ...input }) => {
    const existing = w.must("transactions", id);
    const t = validateTx(w, input);
    w.patch("transactions", id, { ...t });
    if (scope === "future" && existing.repeatId) {
      for (const s of [...w.snap.transactions]) {
        if (s.repeatId !== existing.repeatId || s._id === id || s.date <= existing.date) continue;
        w.patch("transactions", s._id, {
          type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId,
          note: t.note, description: t.description, tags: t.tags, feeAmount: t.feeAmount, ...(s.installmentIndex ? {} : { amount: t.amount }),
        });
      }
      const rep = w.get("repeats", existing.repeatId);
      if (rep && rep.kind === "repeat") w.patch("repeats", rep._id, { template: templateOf(t) });
    }
  },

  "transactions.remove": (w, { id, scope }) => {
    const existing = w.must("transactions", id);
    if ((scope === "future" || scope === "all") && existing.repeatId) {
      for (const s of [...w.snap.transactions]) {
        if (s.repeatId !== existing.repeatId) continue;
        if (scope === "future" && s.date < existing.date) continue;
        w.delete("transactions", s._id);
      }
      const rep = w.get("repeats", existing.repeatId);
      if (rep) w.patch("repeats", rep._id, { active: false });
      return;
    }
    w.delete("transactions", id);
  },

  "transactions.bulkUpdate": (w, { ids, date, note, categoryId, accountId }) => {
    if (categoryId) w.must("categories", categoryId);
    if (accountId) w.must("accounts", accountId);
    if (date !== undefined && !isDate(date)) throw new Error("Bad date");
    for (const id of ids) {
      const tx = w.must("transactions", id);
      const patch: Partial<Doc<"transactions">> = {};
      if (date) patch.date = date;
      if (note !== undefined) patch.note = note;
      if (accountId) patch.accountId = accountId;
      if (categoryId && tx.type !== "transfer") {
        const cat = w.get("categories", categoryId);
        if (cat && cat.type === tx.type) {
          patch.categoryId = categoryId;
          patch.subcategoryId = undefined;
        }
      }
      w.patch("transactions", id, patch);
    }
  },

  "transactions.bulkRemove": (w, { ids }) => {
    for (const id of ids) {
      w.must("transactions", id);
      w.delete("transactions", id);
    }
  },

  "transactions.importRows": (w, { rows, createMissing, createAccounts, skipInvalid, skipDuplicates, rowOffset = 0 }) => {
    const settings = w.requireSettings();
    const accByName = new Map(w.snap.accounts.filter((a) => !a.deletedAt).map((a) => [a.name.trim().toLowerCase(), a]));
    const catKey = (type: string, name: string, parent?: string) => `${type}:${parent ?? ""}:${name.toLowerCase()}`;
    const catByKey = new Map(w.snap.categories.filter((c) => !c.deletedAt).map((c) => [catKey(c.type, c.name, c.parentId), c]));
    const errors: { row: number; reason: string }[] = [];
    type Prepared = Omit<TxFields, "accountId"> & { _row: number; _acc: string; _to?: string; _catName?: string; _subName?: string };
    const prepared: Prepared[] = [];
    const toCreateCats: { type: "income" | "expense"; name: string; parentName?: string }[] = [];
    const toCreateAccs = new Map<string, string>();
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
    /** Name of an existing or to-be-created account, or null if unknown and creating is off. */
    const accountName = (raw: string | undefined): string | null => {
      const name = (raw ?? "").trim();
      if (!name) return null;
      if (accByName.has(name.toLowerCase())) return name;
      if (!createAccounts) return null;
      if (!toCreateAccs.has(name.toLowerCase())) toCreateAccs.set(name.toLowerCase(), name);
      return name;
    };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = rowOffset + i + 1;
      const date = parseDate(r.date ?? "");
      if (!date) { errors.push({ row: rowNo, reason: `Bad date "${r.date}"` }); continue; }
      const tRaw = (r.type ?? "").trim().toLowerCase();
      const type = tRaw.startsWith("in") ? "income" : tRaw.startsWith("exp") ? "expense" : tRaw.startsWith("trans") ? "transfer" : null;
      if (!type) { errors.push({ row: rowNo, reason: `Unknown type "${r.type}" (Income, Expenses or Transfer-Out)` }); continue; }
      const acc = accountName(r.account);
      if (!acc) { errors.push({ row: rowNo, reason: `Unknown account "${r.account}"` }); continue; }
      const amountMajor = Math.abs(Number((r.amount ?? "").replace(/[^0-9.-]/g, "")));
      if (!(r.amount ?? "").trim() || !Number.isFinite(amountMajor)) { errors.push({ row: rowNo, reason: `Bad amount "${r.amount}"` }); continue; }
      const time = r.time?.match(/^(\d{1,2}):(\d{2})/);
      const base: Prepared = {
        _row: rowNo, type, date, _acc: acc, amount: toMinor(amountMajor, settings.decimals), note: (r.note ?? "").trim(),
        description: r.description?.trim() || undefined, tags: [], photoIds: [],
        time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
      };
      if (r.subAmount && r.subCurrency) {
        const cur = w.snap.currencies.find((c) => c.code.toLowerCase() === r.subCurrency!.trim().toLowerCase());
        if (cur && cur.code !== settings.mainCurrency) {
          base.subCurrency = cur.code;
          base.subAmount = toMinor(Math.abs(Number(r.subAmount.replace(/[^0-9.-]/g, ""))), cur.decimals);
          base.exchangeRate = cur.rate;
        }
      }
      if (type === "transfer") {
        const to = accountName(r.category);
        if (!to) { errors.push({ row: rowNo, reason: `Unknown destination account "${r.category}"` }); continue; }
        if (to.toLowerCase() === acc.toLowerCase()) { errors.push({ row: rowNo, reason: "From and To are the same" }); continue; }
        base._to = to;
      } else {
        const name = (r.category ?? "").trim();
        if (!name) { errors.push({ row: rowNo, reason: "Category is required" }); continue; }
        const cat = catByKey.get(catKey(type, name));
        if (!cat) {
          if (!createMissing) { errors.push({ row: rowNo, reason: `Unknown ${type} category "${name}"` }); continue; }
          toCreateCats.push({ type, name });
        }
        const subName = r.subcategory?.trim();
        if (subName) {
          const sub = cat ? catByKey.get(catKey(type, subName, cat._id)) : undefined;
          if (!sub) {
            if (!createMissing) { errors.push({ row: rowNo, reason: `Unknown subcategory "${subName}" under "${name}"` }); continue; }
            toCreateCats.push({ type, name: subName, parentName: name });
          }
        }
        base._catName = name;
        base._subName = subName || undefined;
      }
      prepared.push(base);
    }
    if (errors.length && !skipInvalid) return { inserted: 0, errors, createdAccounts: [], duplicates: [] };
    // Entries already there, counted so that two identical coffees on one day both match.
    const dupKey = (t: { type: string; date: string; accountId: string; toAccountId?: string; amount: number; note: string }) =>
      [t.type, t.date, t.accountId, t.toAccountId ?? "", t.amount, t.note.trim().toLowerCase()].join("|");
    const existing = new Map<string, number>();
    if (skipDuplicates) for (const t of w.snap.transactions) existing.set(dupKey(t), (existing.get(dupKey(t)) ?? 0) + 1);
    const duplicates: number[] = [];
    const fresh = prepared.filter((p) => {
      if (!skipDuplicates) return true;
      const acc = accByName.get(p._acc.toLowerCase());
      const to = p._to ? accByName.get(p._to.toLowerCase()) : undefined;
      if (!acc || (p._to && !to)) return true; // a new account has no entries yet
      const key = dupKey({ ...p, accountId: acc._id, toAccountId: to?._id });
      const n = existing.get(key) ?? 0;
      if (!n) return true;
      existing.set(key, n - 1);
      duplicates.push(p._row);
      return false;
    });
    // Only create accounts some imported row still uses.
    const used = new Set(fresh.flatMap((p) => [p._acc.toLowerCase(), ...(p._to ? [p._to.toLowerCase()] : [])]));
    const createdAccounts: string[] = [];
    if ([...toCreateAccs.keys()].some((k) => used.has(k))) {
      let group = w.snap.accountGroups.find((g) => !g.deletedAt && g.kind === "other");
      if (!group) group = w.get("accountGroups", w.insert("accountGroups", { name: "Others", kind: "other", order: nextOrder(w.snap.accountGroups) }))!;
      for (const [key, name] of toCreateAccs) {
        if (!used.has(key) || accByName.has(key)) continue;
        const id = w.insert("accounts", { groupId: group._id, name, initialBalance: 0, includeInTotals: true, hidden: false, order: nextOrder(w.snap.accounts), transferAsExpense: false });
        accByName.set(key, w.get("accounts", id)!);
        createdAccounts.push(name);
      }
    }
    // Only create categories some imported row still uses.
    const usedCats = new Set(fresh.flatMap((p) => (p._catName ? [`${p.type}:${p._catName.toLowerCase()}`, `${p.type}:${p._catName.toLowerCase()}:${(p._subName ?? "").toLowerCase()}`] : [])));
    for (const c of toCreateCats) {
      if (c.parentName || !usedCats.has(`${c.type}:${c.name.toLowerCase()}`)) continue;
      const key = catKey(c.type, c.name);
      if (catByKey.has(key)) continue;
      const order = nextOrder(w.snap.categories.filter((x) => x.type === c.type));
      const id = w.insert("categories", { type: c.type, name: c.name, order });
      catByKey.set(key, w.get("categories", id)!);
    }
    for (const c of toCreateCats) {
      if (!c.parentName || !usedCats.has(`${c.type}:${c.parentName.toLowerCase()}:${c.name.toLowerCase()}`)) continue;
      const parent = catByKey.get(catKey(c.type, c.parentName))!;
      const key = catKey(c.type, c.name, parent._id);
      if (catByKey.has(key)) continue;
      const order = nextOrder(w.snap.categories.filter((x) => x.type === c.type));
      const id = w.insert("categories", { type: c.type, name: c.name, parentId: parent._id, order });
      catByKey.set(key, w.get("categories", id)!);
    }
    let inserted = 0;
    for (const p of fresh) {
      const { _row, _acc, _to, _catName, _subName, ...rest } = p;
      void _row;
      const fields: TxFields = { ...rest, accountId: accByName.get(_acc.toLowerCase())!._id };
      if (_to) fields.toAccountId = accByName.get(_to.toLowerCase())!._id;
      if (fields.type !== "transfer") {
        const cat = catByKey.get(catKey(fields.type, _catName!))!;
        fields.categoryId = cat._id;
        fields.subcategoryId = _subName ? catByKey.get(catKey(fields.type, _subName, cat._id))?._id : undefined;
      }
      w.insert("transactions", clean(fields));
      inserted++;
    }
    return { inserted, errors, createdAccounts, duplicates };
  },

  "transactions.copy": (w, { id, useToday }) => {
    const t = w.must("transactions", id);
    const { _id, _creationTime, userId, repeatId, installmentIndex, installmentCount, installmentTotal, ...rest } = t;
    void _id; void _creationTime; void userId; void repeatId; void installmentIndex; void installmentCount; void installmentTotal;
    return w.insert("transactions", { ...rest, date: useToday ? todayISO() : t.date });
  },

  "repeats.update": (w, { id, ...patch }) => {
    w.must("repeats", id);
    const c: Partial<Doc<"repeats">> = {};
    if (patch.frequency) c.frequency = patch.frequency;
    if (patch.endDate !== undefined) c.endDate = patch.endDate ?? undefined;
    if (patch.nextDate) c.nextDate = patch.nextDate;
    if (patch.active !== undefined) c.active = patch.active;
    if (patch.template) c.template = patch.template;
    w.patch("repeats", id, c);
  },
  "repeats.remove": (w, { id }) => {
    w.must("repeats", id);
    for (const t of [...w.snap.transactions]) if (t.repeatId === id) w.patch("transactions", t._id, { repeatId: undefined });
    w.delete("repeats", id);
  },
  "repeats.catchUp": (w, { today }) => {
    if (!isDate(today)) throw new Error("Bad date");
    const horizon = horizonFor(w.settings(), today);
    let created = 0;
    for (const rep of [...w.snap.repeats]) {
      if (!rep.active || rep.nextDate > horizon) continue;
      let next = rep.nextDate;
      let guard = 0;
      let stopped = false;
      while (next <= horizon && guard++ < 400) {
        if (rep.endDate && next > rep.endDate) {
          w.patch("repeats", rep._id, { active: false, nextDate: next });
          stopped = true;
          break;
        }
        w.insert("transactions", { ...rep.template, date: next, photoIds: [], repeatId: rep._id });
        created++;
        next = nextOccurrence(next, rep.startDate, rep.frequency);
      }
      if (!stopped) w.patch("repeats", rep._id, { nextDate: next });
    }
    return created;
  },

  "bookmarks.create": (w, { template, transactionId }) => {
    w.must("accounts", template.accountId, "Pick an account");
    // the entry may have been deleted meanwhile: keep the bookmark, drop the link
    const linked = transactionId && w.get("transactions", transactionId) ? transactionId : undefined;
    return w.insert("bookmarks", { order: w.snap.bookmarks.length, template, transactionId: linked });
  },
  "bookmarks.update": (w, { id, template }) => {
    w.must("bookmarks", id);
    w.patch("bookmarks", id, { template });
  },
  "bookmarks.remove": (w, { id }) => {
    w.must("bookmarks", id);
    w.delete("bookmarks", id);
  },
  "bookmarks.reorder": (w, { ids }) => {
    ids.forEach((id, i) => { w.must("bookmarks", id); w.patch("bookmarks", id, { order: i }); });
  },

  "budgets.upsert": (w, { id, categoryId, period, amount }) => {
    if (!Number.isInteger(amount) || amount < 0) throw new Error("Amount must be positive");
    if (categoryId) {
      const c = w.must("categories", categoryId, "Pick a category");
      if (c.type !== "expense") throw new Error("Budgets are for expense categories");
    }
    if (id) {
      w.must("budgets", id);
      w.patch("budgets", id, { categoryId, period, amount });
      return id;
    }
    const dup = w.snap.budgets.find((b) => b.period === period && (b.categoryId ?? null) === (categoryId ?? null));
    if (dup) {
      w.patch("budgets", dup._id, { amount });
      return dup._id;
    }
    return w.insert("budgets", { categoryId, period, amount, overrides: {} });
  },
  "budgets.setOverride": (w, { id, key, amount }) => {
    const b = w.must("budgets", id);
    const overrides = { ...b.overrides };
    if (amount === null) delete overrides[key];
    else overrides[key] = amount;
    w.patch("budgets", id, { overrides });
  },
  "budgets.remove": (w, { id }) => {
    w.must("budgets", id);
    w.delete("budgets", id);
  },

  "notes.upsert": (w, { id, date, text, color }) => {
    if (!isDate(date)) throw new Error("Bad date");
    if (id) {
      w.must("notes", id);
      w.patch("notes", id, { date, text, color });
      return id;
    }
    return w.insert("notes", { date, text, color });
  },
  "notes.remove": (w, { id }) => {
    w.must("notes", id);
    w.delete("notes", id);
  },

  "currencies.add": (w, a) => {
    if (!a.code.trim()) throw new Error("Code is required");
    if (!(a.rate > 0)) throw new Error("Rate must be positive");
    if (w.snap.currencies.some((c) => c.code.toLowerCase() === a.code.trim().toLowerCase())) throw new Error("Already added");
    return w.insert("currencies", { ...a, order: w.snap.currencies.length, code: a.code.trim().toUpperCase() });
  },
  "currencies.update": (w, { id, ...patch }) => {
    w.must("currencies", id);
    if (patch.rate !== undefined && !(patch.rate > 0)) throw new Error("Rate must be positive");
    w.patch("currencies", id, clean(patch));
  },
  "currencies.remove": (w, { id }) => {
    w.must("currencies", id);
    w.delete("currencies", id);
  },
  "currencies.reorder": (w, { ids }) => {
    ids.forEach((id, i) => { w.must("currencies", id); w.patch("currencies", id, { order: i }); });
  },
  "currencies.setRates": (w, { rates }) => {
    for (const r of rates) {
      w.must("currencies", r.id);
      if (r.rate > 0) w.patch("currencies", r.id, { rate: r.rate });
    }
  },

  "backup.restore": (w, { data }) => {
    if (!data || data.version !== 1) throw new Error("Not an UnMoney backup file");
    for (const t of ["transactions", "notes", "categories", "repeats", "bookmarks", "budgets", "accounts", "accountGroups", "currencies"] as const) w.clear(t);
    const groupIds = new Map<string, Id<"accountGroups">>();
    for (const g of data.accountGroups ?? []) groupIds.set(g._id as string, w.insert("accountGroups", strip(g) as never));
    const accountIds = new Map<string, Id<"accounts">>();
    for (const a of data.accounts ?? []) {
      const { billingAccountId, linkedAccountId, ...rest } = strip(a);
      void billingAccountId; void linkedAccountId;
      const groupId = groupIds.get(a.groupId as string);
      if (!groupId) continue;
      accountIds.set(a._id as string, w.insert("accounts", { ...rest, groupId } as never));
    }
    for (const a of data.accounts ?? []) {
      const self = accountIds.get(a._id as string);
      if (!self) continue;
      const patch: Partial<Doc<"accounts">> = {};
      if (a.billingAccountId && accountIds.get(a.billingAccountId as string)) patch.billingAccountId = accountIds.get(a.billingAccountId as string);
      if (a.linkedAccountId && accountIds.get(a.linkedAccountId as string)) patch.linkedAccountId = accountIds.get(a.linkedAccountId as string);
      if (Object.keys(patch).length) w.patch("accounts", self, patch);
    }
    const catIds = new Map<string, Id<"categories">>();
    const cats = data.categories ?? [];
    for (const c of cats.filter((x) => !x.parentId)) catIds.set(c._id as string, w.insert("categories", { ...strip(c), parentId: undefined } as never));
    for (const c of cats.filter((x) => x.parentId)) {
      const parentId = catIds.get(c.parentId as string);
      if (!parentId) continue;
      catIds.set(c._id as string, w.insert("categories", { ...strip(c), parentId } as never));
    }
    const mapTemplate = (t: Record<string, unknown>): Record<string, unknown> => ({
      ...t,
      accountId: accountIds.get(t.accountId as string),
      toAccountId: t.toAccountId ? accountIds.get(t.toAccountId as string) : undefined,
      categoryId: t.categoryId ? catIds.get(t.categoryId as string) : undefined,
      subcategoryId: t.subcategoryId ? catIds.get(t.subcategoryId as string) : undefined,
    });
    const repeatIds = new Map<string, Id<"repeats">>();
    for (const r of data.repeats ?? []) {
      const s = strip(r);
      const template = mapTemplate(s.template as Record<string, unknown>);
      if (!template.accountId) continue;
      repeatIds.set(r._id as string, w.insert("repeats", { ...s, template } as never));
    }
    const txIds = new Map<string, Id<"transactions">>();
    for (const t of data.transactions ?? []) {
      const s = mapTemplate(strip(t));
      if (!s.accountId) continue;
      txIds.set(t._id as string, w.insert("transactions", { ...s, photoIds: (s.photoIds as string[] | undefined) ?? [], tags: (s.tags as string[] | undefined) ?? [], repeatId: s.repeatId ? repeatIds.get(s.repeatId as string) : undefined } as never));
    }
    for (const b of data.bookmarks ?? []) {
      const s = strip(b);
      const template = mapTemplate(s.template as Record<string, unknown>);
      if (!template.accountId) continue;
      w.insert("bookmarks", { ...s, template, transactionId: s.transactionId ? txIds.get(s.transactionId as string) : undefined } as never);
    }
    for (const b of data.budgets ?? []) {
      const s = strip(b);
      w.insert("budgets", { ...s, categoryId: s.categoryId ? catIds.get(s.categoryId as string) : undefined } as never);
    }
    for (const n of data.notes ?? []) w.insert("notes", strip(n) as never);
    for (const c of data.currencies ?? []) w.insert("currencies", strip(c) as never);
    if (data.settings) {
      const existing = w.settings();
      const s = strip(data.settings);
      if (existing) w.patch("settings", existing._id, s as never);
      else w.insert("settings", s as never);
    }
  },

  "backup.wipeAll": (w, { confirm }) => {
    if (confirm !== "DELETE") throw new Error("Not confirmed");
    for (const t of ["transactions", "notes", "repeats", "bookmarks", "budgets"] as const) w.clear(t);
  },

  "files.upload": () => {
    throw new Error("Uploads are handled by the browser, not the reducer");
  },
};
