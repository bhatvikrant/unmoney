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
import { parseNumber, toMinor, type DecimalMark } from "./money";
import { normName, normNote } from "./categoryLint";

export const TABLES = [
  "settings", "accountGroups", "accounts", "categories", "transactions", "repeats", "bookmarks", "budgets", "notes", "currencies", "categoryCleanups",
] as const;
export type Table = (typeof TABLES)[number];
export type Snapshot = { [T in Table]: Doc<T>[] };

export function emptySnapshot(): Snapshot {
  return { settings: [], accountGroups: [], accounts: [], categories: [], transactions: [], repeats: [], bookmarks: [], budgets: [], notes: [], currencies: [], categoryCleanups: [] };
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
  /** Transfer fee, in major units (UnMoney's own CSV/TSV export). */
  fee?: string;
  /** Comma-separated; older UnMoney exports separated them with spaces. */
  tags?: string;
};
export type NewImportAccount = { name: string; groupKind: Doc<"accountGroups">["kind"] };
export type CatType = "income" | "expense";
/** A category in a tidy-up plan: an existing one, or one that a "create" step earlier in the plan makes. */
export type CatRef = { id: Id<"categories"> } | { newKey: string };
/** One change in a tidy-up plan. `label` is the line the undo banner shows when it goes through. */
export type CleanupStep = { label?: string } & (
  | { kind: "create"; key: string; type: CatType; name: string; parent?: CatRef }
  | { kind: "rename"; id: Id<"categories">; name: string }
  | { kind: "nest"; id: Id<"categories">; parent: CatRef }
  | { kind: "merge"; sourceIds: Id<"categories">[]; target: CatRef }
  | { kind: "refile"; fromId: Id<"categories">; notes: string[]; target: CatRef }
  | { kind: "remove"; id: Id<"categories"> }
);
export type CleanupResult = {
  cleanupId?: Id<"categoryCleanups">;
  changedEntries: number;
  /** Indexes of the steps that went through, and of those that did not, with why. */
  applied: number[];
  skipped: { step: number; reason: string }[];
};
/** How long a tidy-up can be undone. */
export const CLEANUP_UNDO_MS = 30 * 24 * 60 * 60 * 1000;
/** Most entries one tidy-up may move, so its undo record stays well under Convex's document size limit. */
export const CLEANUP_MAX_ENTRIES = 10_000;

export interface Ops {
  "settings.completeOnboarding": { args: { currency: string; symbolPosition?: "before" | "after" }; result: void };
  "settings.update": { args: { patch: SettingsPatch }; result: void };
  /** entries: false leaves the entries alone; the app rescales or removes them itself, in chunks (see src/lib/bulk.ts). */
  "settings.changeMainCurrency": { args: { code: string; keepData: boolean; entries?: boolean }; result: void };
  "settings.setPasscode": { args: { hash?: string; salt?: string }; result: void };
  /** Store amounts with this many decimals, rounding them when there are fewer. entries: false as for changeMainCurrency. */
  "settings.changeDecimals": { args: { decimals: number; entries?: boolean }; result: void };
  "settings.setDefaultAccount": { args: { id?: Id<"accounts"> }; result: void };

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
  /** Tidy up: run a plan of category changes, moving every affected entry, and keep a record to undo it. */
  "categories.applyCleanup": { args: { steps: CleanupStep[] }; result: CleanupResult };
  "categories.undoCleanup": { args: { id: Id<"categoryCleanups"> }; result: { restoredEntries: number } };

  "transactions.create": { args: TxFields & { repeat?: { frequency: Frequency; endDate?: string }; installment?: { count: number } }; result: Id<"transactions"> };
  "transactions.update": { args: TxFields & { id: Id<"transactions">; scope?: "one" | "future" }; result: void };
  "transactions.remove": { args: { id: Id<"transactions">; scope?: "one" | "future" | "all" }; result: void };
  "transactions.bulkUpdate": { args: { ids: Id<"transactions">[]; date?: string; note?: string; categoryId?: Id<"categories">; subcategoryId?: Id<"categories">; accountId?: Id<"accounts"> }; result: void };
  "transactions.bulkRemove": { args: { ids: Id<"transactions">[] }; result: void };
  "transactions.importRows": {
    /**
     * createMissing: categories · createAccounts: accounts, in the Others group · skipInvalid: import the good rows, report the rest ·
     * skipDuplicates: leave out rows matching an entry already there (same day, account, type, amount and note), one per existing entry ·
     * rowOffset: numbering of the first row, for chunked imports · format: how the whole file writes dates and numbers
     */
    args: { rows: ImportRow[]; format?: ImportFormat; createMissing?: boolean; createAccounts?: boolean; newAccounts?: NewImportAccount[]; skipInvalid?: boolean; skipDuplicates?: boolean; rowOffset?: number };
    result: { inserted: number; errors: { row: number; reason: string }[]; createdAccounts: string[]; duplicates: number[] };
  };
  /** today: the device's date, so the server (in UTC) puts the copy on the same day. */
  "transactions.copy": { args: { id: Id<"transactions">; useToday: boolean; today?: string }; result: Id<"transactions"> };
  /** Multiply amounts by `factor` (a change of main currency's decimals), a chunk of entries at a time. */
  "transactions.rescale": { args: { ids: Id<"transactions">[]; factor: number }; result: void };
  /** Entries from a backup, with ids already pointing at the restored accounts, categories and schedules (restoreRows). */
  "transactions.restoreRows": { args: { rows: Record<string, unknown>[] }; result: number };

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

  /** entries: false restores everything but the entries and returns the new id of each backup id, for restoreRows. */
  "backup.restore": { args: { data: BackupData; entries?: boolean }; result: RestoreIds };
  "backup.wipeAll": { args: { confirm: "DELETE"; entries?: boolean }; result: void };

  /** Not a snapshot change: the browser uploads the queued file itself. Listed so queues can hold it. */
  "files.upload": { args: { name: string; type: string; size: number }; result: Id<"_storage"> };
}
export type OpKind = keyof Ops;
export type OpArgs<K extends OpKind> = Ops[K]["args"];
export type OpResult<K extends OpKind> = Ops[K]["result"];

export type RestoreIds = { accounts: Record<string, string>; categories: Record<string, string>; repeats: Record<string, string> };

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
  "settings.changeMainCurrency": ["settings", "transactions", "accounts", "budgets", "repeats", "bookmarks"],
  "settings.setPasscode": ["settings"],
  "settings.changeDecimals": ["settings", "transactions", "accounts", "budgets", "repeats", "bookmarks"],
  "settings.setDefaultAccount": ["settings", "accounts"],
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
  "categories.applyCleanup": ["categories", "transactions", "budgets", "repeats", "bookmarks", "categoryCleanups"],
  "categories.undoCleanup": ["categories", "transactions", "budgets", "repeats", "bookmarks", "categoryCleanups"],
  "transactions.create": ["accounts", "categories", "transactions", "repeats"],
  "transactions.update": ["accounts", "categories", "transactions", "repeats"],
  "transactions.remove": ["transactions", "repeats"],
  "transactions.bulkUpdate": ["accounts", "categories", "transactions"],
  "transactions.bulkRemove": ["transactions"],
  "transactions.importRows": ["settings", "accountGroups", "accounts", "categories", "currencies", "transactions"],
  "transactions.copy": ["transactions"],
  "transactions.rescale": ["transactions"],
  "transactions.restoreRows": ["accounts", "categories", "repeats", "transactions"],
  "repeats.update": ["repeats"],
  "repeats.remove": ["repeats", "transactions"],
  "repeats.catchUp": ["settings", "repeats", "transactions", "accounts", "categories"],
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
  "backup.wipeAll": ["transactions", "notes", "repeats", "bookmarks", "budgets", "categoryCleanups"],
  "files.upload": [],
};

/**
 * Which of the user's entries an op reads or writes, so the server loads just those rather than
 * the whole transactions table (Convex caps what one function may read, and a ledger outgrows
 * that cap). `all` is for the few ops that really rewrite every entry.
 */
export type TxScope = {
  all?: boolean;
  /** Entries by id. */
  ids?: string[];
  /** Every entry in the repeat or installment series of these entries. */
  seriesOf?: string[];
  /** Every entry of these schedules. */
  repeatIds?: string[];
  /** Every entry from or to these accounts. */
  accountIds?: string[];
  /** Every entry on these dates. */
  dates?: string[];
  /** Every entry filed under these categories (as main category or as subcategory). */
  categoryIds?: string[];
  /** The entries these tidy-up records moved, and those of the categories they created. */
  cleanupIds?: string[];
};

export function txScope(op: Op): TxScope {
  const a = op.args as Record<string, unknown>;
  const id = a.id as string;
  switch (op.kind) {
    case "transactions.update": return a.scope === "future" ? { seriesOf: [id] } : { ids: [id] };
    case "transactions.remove": return a.scope === "future" || a.scope === "all" ? { seriesOf: [id] } : { ids: [id] };
    case "transactions.bulkUpdate":
    case "transactions.bulkRemove": return { ids: a.ids as string[] };
    case "transactions.copy": return { ids: [id] };
    case "bookmarks.create": return { ids: a.transactionId ? [a.transactionId as string] : [] };
    case "repeats.remove": return { repeatIds: [id] };
    case "accounts.permanentlyDelete": return { accountIds: [id] };
    // duplicates can only be entries on the same day
    case "transactions.importRows": {
      if (!a.skipDuplicates) return {};
      const order = (a.format as ImportFormat | undefined)?.dateOrder;
      const dates = (a.rows as ImportRow[]).map((r) => parseImportDate(r.date ?? "", order)).filter((d): d is string => d !== null);
      return { dates: [...new Set(dates)] };
    }
    case "transactions.rescale": return { ids: a.ids as string[] };
    // a tidy-up moves the entries of the categories its steps name
    case "categories.applyCleanup": {
      const ref = (r: CatRef | undefined) => (r && "id" in r ? [r.id] : []);
      const ids = (a.steps as CleanupStep[]).flatMap((st) =>
        st.kind === "nest" ? [st.id, ...ref(st.parent)] : st.kind === "merge" ? [...st.sourceIds, ...ref(st.target)]
          : st.kind === "refile" ? [st.fromId, ...ref(st.target)] : st.kind === "remove" ? [st.id] : []);
      return { categoryIds: [...new Set(ids)] };
    }
    case "categories.undoCleanup": return { cleanupIds: [id] };
    case "settings.changeMainCurrency":
    case "settings.changeDecimals":
    case "backup.restore":
    case "backup.wipeAll": return a.entries === false ? {} : { all: true };
    default: return {};
  }
}

/** One scope covering several ops. */
export function mergeTxScopes(scopes: TxScope[]): TxScope {
  const out: TxScope = {};
  const keys = ["ids", "seriesOf", "repeatIds", "accountIds", "dates", "categoryIds", "cleanupIds"] as const;
  for (const s of scopes) {
    if (s.all) out.all = true;
    for (const k of keys) if (s[k]?.length) out[k] = [...new Set([...(out[k] ?? []), ...s[k]!])];
  }
  return out;
}

function splitTags(raw: string | undefined): string[] {
  const t = (raw ?? "").trim();
  if (!t) return [];
  return [...new Set(t.split(t.includes(",") ? "," : /\s+/).map((x) => x.trim().replace(/^#/, "")).filter(Boolean))];
}

/** How a file writes dates and numbers; decided once for the whole file (`detectImportFormat`). */
export type ImportFormat = { dateOrder: "dmy" | "mdy"; decimal: DecimalMark };

const SLASH_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/;

/**
 * A date from an imported row: YYYY-MM-DD (or with / or .), DD.MM.YYYY, and DD/MM/YYYY or
 * MM/DD/YYYY as the file's `dateOrder` says. Null when unreadable or not a real date.
 */
export function parseImportDate(s: string, dateOrder: ImportFormat["dateOrder"] = "mdy"): string | null {
  const t = s.trim();
  let y: string, mo: string, d: string;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = t.match(SLASH_DATE))) [y, mo, d] = dateOrder === "dmy" ? [m[3], m[2], m[1]] : [m[3], m[1], m[2]];
  else if ((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) [y, mo, d] = [m[3], m[2], m[1]];
  else return null;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  // 2026-02-30 and 2026-25-03 do not round-trip through a calendar date
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

/**
 * Read the file's own conventions from all of its rows: any day above 12 settles DD/MM against
 * MM/DD, and any amount ending in a comma and one or two digits means a decimal comma. Where the
 * file cannot tell, the user's locale (`fallback`) decides.
 */
export function detectImportFormat(rows: Pick<ImportRow, "date" | "amount">[], fallback: ImportFormat): ImportFormat {
  let dmy = 0, mdy = 0, comma = 0, dot = 0;
  for (const r of rows) {
    const m = (r.date ?? "").trim().match(SLASH_DATE);
    if (m && Number(m[1]) > 12) dmy++;
    if (m && Number(m[2]) > 12) mdy++;
    const a = (r.amount ?? "").trim();
    if (/\d,\d{1,2}\)?$/.test(a)) comma++;
    if (/\d\.\d{1,2}\)?$/.test(a)) dot++;
  }
  return {
    dateOrder: dmy && !mdy ? "dmy" : mdy && !dmy ? "mdy" : fallback.dateOrder,
    decimal: comma && !dot ? "," : dot && !comma ? "." : fallback.decimal,
  };
}

// ---------- working copy ----------

type Insertable<T extends Table> = Omit<Doc<T>, "_id" | "_creationTime" | "userId">;

class Work {
  snap: Snapshot;
  private copied = new Set<Table>();
  /** Position of each document in its (copied) table, so bulk patches don't scan the table each time. */
  private idx = new Map<Table, Map<string, number>>();
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
  /** When the op was made; use it instead of Date.now() so client and server agree. */
  get at(): number {
    return this.op.at;
  }
  private index(table: Table): Map<string, number> {
    let m = this.idx.get(table);
    if (!m) {
      m = new Map(this.t(table).map((d, i) => [d._id as string, i]));
      this.idx.set(table, m);
    }
    return m;
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
    const arr = this.t(table);
    arr.push(clean({ ...doc, _id, _creationTime: this.op.at + this.n, userId: this.ctx.userId } as unknown as Doc<T>));
    this.idx.get(table)?.set(_id, arr.length - 1);
    return _id;
  }
  patch<T extends Table>(table: T, id: Id<T>, patch: Partial<Doc<T>>): void {
    const arr = this.t(table);
    const i = this.index(table).get(id) ?? -1;
    if (i < 0) throw new Error("Not found");
    arr[i] = clean({ ...arr[i], ...patch });
  }
  delete<T extends Table>(table: T, id: Id<T>): void {
    const arr = this.t(table);
    const i = arr.findIndex((d) => d._id === id);
    if (i >= 0) arr.splice(i, 1);
    this.idx.delete(table);
  }
  clear(table: Table): void {
    this.t(table).length = 0;
    this.idx.delete(table);
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

/** Large enough for any real amount, small enough that thousands of them still add up exactly in JavaScript. */
export const MAX_AMOUNT = 1e13;
const checkAmount = (n: number | undefined) => {
  if (n === undefined) return;
  if (!Number.isInteger(n)) throw new Error("Amount must be a whole number of minor units");
  if (Math.abs(n) > MAX_AMOUNT) throw new Error("That amount is too large");
};

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const nextOrder = (docs: { order: number }[]) => Math.max(-1, ...docs.map((d) => d.order)) + 1;

/**
 * `was`: the entry being edited. Its own account and category may have been deleted since; any
 * other deleted account or category is refused, so nothing new lands where the user cannot see it.
 */
function validateTx(w: Work, t: TxFields, was?: Doc<"transactions">): TxFields {
  if (!isDate(t.date)) throw new Error("Bad date");
  const kept = new Set([was?.accountId, was?.toAccountId, was?.categoryId, was?.subcategoryId].filter(Boolean));
  for (const [table, id, what] of [["accounts", t.accountId, "account"], ["accounts", t.type === "transfer" ? t.toAccountId : undefined, "account"],
    ["categories", t.type === "transfer" ? undefined : t.categoryId, "category"], ["categories", t.type === "transfer" ? undefined : t.subcategoryId, "category"]] as const) {
    if (id && !kept.has(id) && w.get(table, id)?.deletedAt) throw new Error(`That ${what} has been deleted`);
  }
  checkAmount(t.amount);
  checkAmount(t.feeAmount);
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
  checkAmount(a.initialBalance);
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

// ---------- tidy-up ----------

type CatId = Id<"categories">;
type Pair = [CatId | undefined, CatId | undefined];
type StoredPair = (CatId | null)[];
type HasCats = { categoryId?: CatId; subcategoryId?: CatId };
const pairOf = (x: HasCats): Pair => [x.categoryId, x.subcategoryId];
const samePair = (a: Pair, b: Pair) => a[0] === b[0] && a[1] === b[1];
const storePair = (p: Pair): StoredPair => [p[0] ?? null, p[1] ?? null];
const loadPair = (p: StoredPair): Pair => [p[0] ?? undefined, p[1] ?? undefined];
/** Where an entry filed under `c` points: a main category alone, or a subcategory with its parent. */
const placeOf = (c: Doc<"categories">): Pair => (c.parentId ? [c.parentId, c._id] : [c._id, undefined]);
const MAX_NAME = 40;

function liveSubs(w: Work, id: string): Doc<"categories">[] {
  return w.snap.categories.filter((c) => c.parentId === id && !c.deletedAt);
}

/** Anything still points at the category: an entry, a budget, a repeat or a bookmark. */
function categoryInUse(w: Work, id: string): boolean {
  const refs = (x: HasCats) => x.categoryId === id || x.subcategoryId === id;
  return w.snap.transactions.some(refs) || w.snap.budgets.some((b) => b.categoryId === id)
    || w.snap.repeats.some((r) => refs(r.template)) || w.snap.bookmarks.some((b) => refs(b.template));
}

function applyCleanup(w: Work, steps: CleanupStep[]): CleanupResult {
  const at = w.at;
  type Rec = Doc<"categoryCleanups">;
  const catsBefore = new Map<string, Rec["categoriesBefore"][number]>();
  const budgetsBefore = new Map<string, Rec["budgetsBefore"][number]>();
  const entryFrom = new Map<string, Pair>();
  const tplFrom = new Map<string, { table: "repeats" | "bookmarks"; id: string; from: Pair }>();
  const created: CatId[] = [];
  const keys = new Map<string, CatId>();
  const labels: string[] = [];
  const applied: number[] = [];
  const skipped: CleanupResult["skipped"] = [];

  const live = (id: string | undefined) => {
    const c = w.get("categories", id);
    return c && !c.deletedAt ? c : undefined;
  };
  const resolve = (ref: CatRef | undefined) => (!ref ? undefined : "id" in ref ? live(ref.id) : live(keys.get(ref.newKey)));
  const patchCat = (id: CatId, patch: Partial<Doc<"categories">>) => {
    const c = w.must("categories", id);
    if (!catsBefore.has(id) && !created.includes(id)) catsBefore.set(id, clean({ id, name: c.name, parentId: c.parentId, deletedAt: c.deletedAt, order: c.order }));
    w.patch("categories", id, patch);
  };
  const rememberBudget = (b: Doc<"budgets">) => {
    if (!budgetsBefore.has(b._id)) budgetsBefore.set(b._id, clean({ id: b._id, categoryId: b.categoryId, period: b.period, amount: b.amount, overrides: b.overrides }));
  };
  /** Re-file every entry (and, unless told otherwise, every repeat and bookmark) of `type` that `fn` maps somewhere new. */
  const remap = (type: CatType, fn: (p: Pair, note: string) => Pair | null, templates = true) => {
    for (const tx of w.snap.transactions) {
      if (tx.type !== type) continue;
      const cur = pairOf(tx);
      const next = fn(cur, tx.note);
      if (!next || samePair(cur, next)) continue;
      if (!entryFrom.has(tx._id)) entryFrom.set(tx._id, cur);
      w.patch("transactions", tx._id, { categoryId: next[0], subcategoryId: next[1] });
    }
    if (!templates) return;
    for (const table of ["repeats", "bookmarks"] as const) {
      for (const d of w.snap[table]) {
        if (d.template.type !== type) continue;
        const cur = pairOf(d.template);
        const next = fn(cur, d.template.note);
        if (!next || samePair(cur, next)) continue;
        const key = `${table}:${d._id}`;
        if (!tplFrom.has(key)) tplFrom.set(key, { table, id: d._id, from: cur });
        w.patch(table, d._id as never, { template: clean({ ...d.template, categoryId: next[0], subcategoryId: next[1] }) } as never);
      }
    }
  };
  /** A category's budgets follow it into `toId`: summed into a budget of the same period there, dropped if `toId` already budgets another period. */
  const moveBudgets = (fromId: CatId, toId: CatId) => {
    for (const b of w.snap.budgets.filter((x) => x.categoryId === fromId)) {
      rememberBudget(b);
      const twin = w.snap.budgets.find((x) => x.categoryId === toId && x.period === b.period);
      if (twin) {
        rememberBudget(twin);
        const overrides = { ...twin.overrides };
        for (const [k, v] of Object.entries(b.overrides)) overrides[k] = (overrides[k] ?? twin.amount) + v;
        for (const k of Object.keys(twin.overrides)) if (!(k in b.overrides)) overrides[k] = twin.overrides[k] + b.amount;
        w.patch("budgets", twin._id, { amount: twin.amount + b.amount, overrides });
        w.delete("budgets", b._id);
      } else if (w.snap.budgets.some((x) => x.categoryId === toId)) {
        w.delete("budgets", b._id);
      } else {
        w.patch("budgets", b._id, { categoryId: toId });
      }
    }
  };
  const mergeInto = (s: Doc<"categories">, t: Doc<"categories">) => {
    if (!s.parentId) {
      // A main category: its subcategories move under the target, joining a same-named one there.
      const subMap = new Map<string, CatId>();
      if (!t.parentId) {
        for (const sub of liveSubs(w, s._id)) {
          const twin = liveSubs(w, t._id).find((x) => normName(x.name) === normName(sub.name));
          if (twin) {
            subMap.set(sub._id, twin._id);
            moveBudgets(sub._id, twin._id);
            patchCat(sub._id, { deletedAt: at });
          } else {
            subMap.set(sub._id, sub._id);
            patchCat(sub._id, { parentId: t._id });
          }
        }
      }
      remap(s.type, ([c, sc]) => {
        if (c !== s._id) return null;
        if (t.parentId) return [t.parentId, t._id];
        // a subcategory that did not come along (it was deleted) is dropped
        return [t._id, sc ? subMap.get(sc) : undefined];
      });
    } else {
      remap(s.type, ([, sc]) => (sc === s._id ? placeOf(t) : null));
    }
    moveBudgets(s._id, t._id);
    if (!s.deletedAt) patchCat(s._id, { deletedAt: at });
  };
  const nameTaken = (type: CatType, parentId: string | undefined, name: string, selfId?: string) =>
    w.snap.categories.some((c) => !c.deletedAt && c.type === type && c.parentId === parentId && c._id !== selfId && c.name.trim().toLowerCase() === name.toLowerCase());

  /** Runs one step: checks everything first and returns why it cannot go through, or changes things and returns nothing. */
  const run = (step: CleanupStep): string | void => {
    switch (step.kind) {
      case "create": {
        const name = step.name.trim();
        if (!name || name.length > MAX_NAME) return "Name must be 1 to 40 characters";
        const parent = resolve(step.parent);
        if (step.parent && !parent) return "Its parent category is gone";
        if (parent && (parent.type !== step.type || parent.parentId)) return "Cannot go under that category";
        const existing = w.snap.categories.find((c) => !c.deletedAt && c.type === step.type && c.parentId === parent?._id && c.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) { keys.set(step.key, existing._id); return; }
        const id = w.insert("categories", { type: step.type, name, parentId: parent?._id, order: nextOrder(w.snap.categories.filter((c) => c.type === step.type)) });
        created.push(id);
        keys.set(step.key, id);
        return;
      }
      case "rename": {
        const c = live(step.id);
        const name = step.name.trim();
        if (!c) return "The category is gone";
        if (!name || name.length > MAX_NAME) return "Name must be 1 to 40 characters";
        if (nameTaken(c.type, c.parentId, name, c._id)) return `There is already a category called "${name}"`;
        patchCat(c._id, { name });
        return;
      }
      case "nest": {
        const c = live(step.id);
        const p = resolve(step.parent);
        if (!c || !p) return "The category is gone";
        if (c.type !== p.type) return "Mixes income and expense";
        if (c._id === p._id || c.parentId || p.parentId) return "Only one level of subcategories";
        if (liveSubs(w, c._id).length) return "It has subcategories of its own";
        if (nameTaken(c.type, p._id, c.name)) return `${p.name} already has a subcategory called "${c.name}"`;
        patchCat(c._id, { parentId: p._id });
        remap(c.type, ([cc]) => (cc === c._id ? [p._id, c._id] : null));
        return;
      }
      case "merge": {
        const t = resolve(step.target);
        if (!t) return "The category to merge into is gone";
        const sources = [...new Set(step.sourceIds)].filter((id) => id !== t._id).map((id) => w.get("categories", id));
        if (!sources.length) return "Nothing to merge";
        if (sources.some((x) => !x)) return "A category in it is gone";
        const list = sources as Doc<"categories">[];
        if (list.some((x) => x.type !== t.type)) return "Mixes income and expense";
        if (t.parentId && list.some((x) => !x.parentId && liveSubs(w, x._id).length)) return "Has subcategories, so it cannot become one";
        if (t.parentId && list.some((x) => x._id === t.parentId)) return "Cannot merge a category into its own subcategory";
        for (const x of list) mergeInto(x, t);
        return;
      }
      case "refile": {
        const from = w.get("categories", step.fromId);
        const t = resolve(step.target);
        if (!from || !t) return "The category is gone";
        if (from.type !== t.type) return "Mixes income and expense";
        const notes = new Set(step.notes.map(normNote).filter(Boolean));
        if (!notes.size) return "No notes to match";
        const dest = placeOf(t);
        remap(t.type, ([c, sc], note) => ((from.parentId ? sc === from._id : c === from._id) && notes.has(normNote(note)) ? dest : null), false);
        return;
      }
      case "remove": {
        const c = live(step.id);
        if (!c) return "It is already gone";
        if (liveSubs(w, c._id).length) return "It has subcategories";
        if (categoryInUse(w, c._id)) return "It is in use now";
        patchCat(c._id, { deletedAt: at });
        return;
      }
    }
  };

  steps.forEach((step, i) => {
    const reason = run(step);
    if (reason) skipped.push({ step: i, reason });
    else {
      applied.push(i);
      if (step.label) labels.push(step.label);
    }
  });
  if (!applied.some((i) => steps[i].kind !== "create")) throw new Error(skipped[0] ? `Nothing could be changed: ${skipped[0].reason}` : "Nothing to change");

  const txById = new Map(w.snap.transactions.map((t) => [t._id as string, t]));
  const entries = [...entryFrom].flatMap(([id, from]) => {
    const to = pairOf(txById.get(id)!);
    return samePair(from, to) ? [] : [{ id: id as Id<"transactions">, from: storePair(from), to: storePair(to) }];
  });
  if (entries.length > CLEANUP_MAX_ENTRIES) throw new Error(`Too many entries for one tidy-up (${entries.length}). Apply fewer changes at a time.`);
  const templates = [...tplFrom.values()].flatMap(({ table, id, from }) => {
    const d = w.get(table, id)!;
    const to = pairOf(d.template);
    return samePair(from, to) ? [] : [{ table, id, from: storePair(from), to: storePair(to) }];
  });
  // Only the latest tidy-up can be undone, so older records go.
  for (const r of [...w.snap.categoryCleanups]) w.delete("categoryCleanups", r._id);
  const cleanupId = w.insert("categoryCleanups", {
    at, label: labels, createdCategoryIds: created,
    categoriesBefore: [...catsBefore.values()], budgetsBefore: [...budgetsBefore.values()], entries, templates,
  });
  return { cleanupId, changedEntries: entries.length, applied, skipped };
}

function undoCleanup(w: Work, id: Id<"categoryCleanups">): { restoredEntries: number } {
  const r = w.must("categoryCleanups", id, "Nothing to undo");
  if (r.undoneAt) throw new Error("This tidy-up was already undone");
  if (w.at - r.at > CLEANUP_UNDO_MS) throw new Error("This tidy-up is too old to undo");
  for (const c of r.categoriesBefore) {
    if (w.get("categories", c.id)) w.patch("categories", c.id, { name: c.name, parentId: c.parentId, deletedAt: c.deletedAt, order: c.order });
  }
  // Entries edited by hand since keep the edit: only those still where the tidy-up put them go back.
  const txById = new Map(w.snap.transactions.map((t) => [t._id as string, t]));
  let restoredEntries = 0;
  for (const e of r.entries) {
    const tx = txById.get(e.id);
    if (!tx || !samePair(pairOf(tx), loadPair(e.to))) continue;
    const [categoryId, subcategoryId] = loadPair(e.from);
    w.patch("transactions", e.id, { categoryId, subcategoryId });
    restoredEntries++;
  }
  for (const t of r.templates) {
    const d = w.get(t.table, t.id);
    if (!d || !samePair(pairOf(d.template), loadPair(t.to))) continue;
    const [categoryId, subcategoryId] = loadPair(t.from);
    w.patch(t.table, d._id as never, { template: clean({ ...d.template, categoryId, subcategoryId }) } as never);
  }
  for (const { id: budgetId, ...fields } of r.budgetsBefore) {
    if (w.get("budgets", budgetId)) w.patch("budgets", budgetId, { categoryId: undefined, ...fields });
    else w.insert("budgets", fields);
  }
  for (const cid of r.createdCategoryIds) {
    const c = w.get("categories", cid);
    if (c && !c.deletedAt && !liveSubs(w, cid).length && !categoryInUse(w, cid)) w.patch("categories", cid, { deletedAt: w.at });
  }
  w.patch("categoryCleanups", id, { undoneAt: w.at });
  return { restoredEntries };
}

const strip = (d: Record<string, unknown>) => {
  const { _id, _creationTime, userId, ...rest } = d;
  void _id; void _creationTime; void userId;
  return rest;
};

function rescale(w: Work, ids: Id<"transactions">[], factor: number) {
  const scale = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * factor));
  for (const id of ids) {
    const t = w.must("transactions", id);
    w.patch("transactions", id, { amount: scale(t.amount)!, feeAmount: scale(t.feeAmount), installmentTotal: scale(t.installmentTotal) });
  }
}

/** Opening balances, budgets and what repeats and bookmarks will enter, when amounts change scale. */
function rescaleOtherAmounts(w: Work, factor: number) {
  const scale = (n: number) => Math.round(n * factor);
  for (const a of [...w.snap.accounts]) w.patch("accounts", a._id, { initialBalance: scale(a.initialBalance) });
  for (const b of [...w.snap.budgets]) {
    const overrides: Record<string, number> = {};
    for (const [k, val] of Object.entries(b.overrides)) overrides[k] = scale(val);
    w.patch("budgets", b._id, { amount: scale(b.amount), overrides });
  }
  const template = (t: Template): Template => ({ ...t, amount: scale(t.amount), feeAmount: t.feeAmount === undefined ? undefined : scale(t.feeAmount) });
  for (const r of [...w.snap.repeats]) w.patch("repeats", r._id, { template: template(r.template) });
  for (const b of [...w.snap.bookmarks]) w.patch("bookmarks", b._id, { template: template(b.template) });
}

/** A backup's entries with their account, category and schedule ids moved to the restored copies, for restoreRows. */
export function restoreRowsFrom(data: BackupData, ids: RestoreIds): Record<string, unknown>[] {
  const map = (table: Record<string, string>, v: unknown) => (typeof v === "string" ? table[v] : undefined);
  return (data.transactions ?? []).flatMap((t) => {
    const accountId = map(ids.accounts, t.accountId);
    if (!accountId) return [];
    const s = strip(t);
    return [{
      ...s, accountId,
      toAccountId: t.toAccountId ? map(ids.accounts, t.toAccountId) : undefined,
      categoryId: t.categoryId ? map(ids.categories, t.categoryId) : undefined,
      subcategoryId: t.subcategoryId ? map(ids.categories, t.subcategoryId) : undefined,
      repeatId: t.repeatId ? map(ids.repeats, t.repeatId) : undefined,
    }];
  });
}

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

  "settings.changeMainCurrency": (w, { code, keepData, entries = true }) => {
    const s = w.requireSettings();
    const info = currencyInfo(code) ?? { code, symbol: code, decimals: 2, name: code };
    const factor = 10 ** (info.decimals - s.decimals);
    if (!keepData) {
      if (entries) w.clear("transactions");
    } else if (factor !== 1) {
      if (entries) rescale(w, w.snap.transactions.map((t) => t._id), factor);
      rescaleOtherAmounts(w, factor);
    }
    w.patch("settings", s._id, { mainCurrency: info.code, symbol: info.symbol, decimals: info.decimals, symbolPosition: info.position ?? "before" });
  },

  "settings.changeDecimals": (w, { decimals, entries = true }) => {
    const s = w.requireSettings();
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) throw new Error("Decimals must be between 0 and 4");
    const factor = 10 ** (decimals - s.decimals);
    if (factor !== 1) {
      if (entries) rescale(w, w.snap.transactions.map((t) => t._id), factor);
      rescaleOtherAmounts(w, factor);
    }
    w.patch("settings", s._id, { decimals });
  },

  "settings.setPasscode": (w, { hash, salt }) => {
    const s = w.requireSettings();
    w.patch("settings", s._id, { passcodeHash: hash, passcodeSalt: salt });
  },
  "settings.setDefaultAccount": (w, { id }) => {
    const s = w.requireSettings();
    if (id && w.must("accounts", id).deletedAt) throw new Error("That account is deleted");
    w.patch("settings", s._id, { defaultAccountId: id });
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
  "categories.applyCleanup": (w, { steps }) => applyCleanup(w, steps),
  "categories.undoCleanup": (w, { id }) => undoCleanup(w, id),

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
    const t = validateTx(w, input, existing);
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

  "transactions.bulkUpdate": (w, { ids, date, note, categoryId, subcategoryId, accountId }) => {
    if (categoryId) w.must("categories", categoryId);
    if (accountId) w.must("accounts", accountId);
    if (subcategoryId) {
      const sub = w.must("categories", subcategoryId);
      if (sub.parentId !== categoryId) throw new Error("Subcategory does not belong to that category");
    }
    if (date !== undefined && !isDate(date)) throw new Error("Bad date");
    for (const id of ids) {
      const tx = w.must("transactions", id);
      const patch: Partial<Doc<"transactions">> = {};
      if (date) patch.date = date;
      if (note !== undefined) patch.note = note;
      // a transfer cannot end up going from an account to itself
      if (accountId && !(tx.type === "transfer" && tx.toAccountId === accountId)) patch.accountId = accountId;
      if (categoryId && tx.type !== "transfer") {
        const cat = w.get("categories", categoryId);
        if (cat && cat.type === tx.type) {
          patch.categoryId = categoryId;
          patch.subcategoryId = subcategoryId;
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

  "transactions.importRows": (w, { rows, format, createMissing, createAccounts, newAccounts, skipInvalid, skipDuplicates, rowOffset = 0 }) => {
    const settings = w.requireSettings();
    const accByName = new Map(w.snap.accounts.filter((a) => !a.deletedAt).map((a) => [a.name.trim().toLowerCase(), a]));
    // Accounts the import should create first. Cards need a bank to bill / link to, so non-card kinds go first.
    const wanted = (newAccounts ?? []).filter((a) => a.name.trim() && !accByName.has(a.name.trim().toLowerCase()));
    wanted.sort((a, b) => Number(a.groupKind === "card" || a.groupKind === "debitCard") - Number(b.groupKind === "card" || b.groupKind === "debitCard"));
    const groupFor = (kind: Doc<"accountGroups">["kind"]): Id<"accountGroups"> => {
      const g = w.snap.accountGroups.find((x) => x.kind === kind && !x.deletedAt);
      if (g) return g._id;
      const def = DEFAULT_GROUPS.find((x) => x.kind === kind);
      return w.insert("accountGroups", { name: def?.name ?? kind, kind, order: nextOrder(w.snap.accountGroups) });
    };
    const createdBanks: Doc<"accounts">[] = [];
    const createdTyped: string[] = [];
    for (const a of wanted) {
      const kind = a.groupKind;
      const bank = createdBanks[0] ?? [...accByName.values()].find((x) => w.get("accountGroups", x.groupId)?.kind === "bank")
        ?? [...accByName.values()].find((x) => !["card", "debitCard"].includes(w.get("accountGroups", x.groupId)?.kind ?? ""));
      if ((kind === "card" || kind === "debitCard") && !bank) throw new Error(`"${a.name}" is a card but there is no bank account for it to bill. Add a bank account first.`);
      const id = w.insert("accounts", {
        groupId: groupFor(kind), name: a.name.trim(), initialBalance: 0, includeInTotals: true, hidden: false,
        order: nextOrder(w.snap.accounts), transferAsExpense: false,
        ...(kind === "card" ? { billingAccountId: bank!._id, settlementDay: 1, paymentDay: 15 } : {}),
        ...(kind === "debitCard" ? { linkedAccountId: bank!._id } : {}),
      });
      const created = w.get("accounts", id)!;
      accByName.set(a.name.trim().toLowerCase(), created);
      createdTyped.push(created.name);
      if (kind === "bank") createdBanks.push(created);
    }
    const catKey = (type: string, name: string, parent?: string) => `${type}:${parent ?? ""}:${name.toLowerCase()}`;
    const catByKey = new Map(w.snap.categories.filter((c) => !c.deletedAt).map((c) => [catKey(c.type, c.name, c.parentId), c]));
    const errors: { row: number; reason: string }[] = [];
    type Prepared = Omit<TxFields, "accountId"> & { _row: number; _acc: string; _to?: string; _catName?: string; _subName?: string };
    const prepared: Prepared[] = [];
    const toCreateCats: { type: "income" | "expense"; name: string; parentName?: string }[] = [];
    const toCreateAccs = new Map<string, string>();
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
      const date = parseImportDate(r.date ?? "", format?.dateOrder);
      if (!date) { errors.push({ row: rowNo, reason: `Bad date "${r.date}"` }); continue; }
      const tRaw = (r.type ?? "").trim().toLowerCase();
      const type = tRaw.startsWith("in") ? "income" : tRaw.startsWith("exp") ? "expense" : tRaw.startsWith("trans") ? "transfer" : null;
      if (!type) { errors.push({ row: rowNo, reason: `Unknown type "${r.type}" (Income, Expenses or Transfer-Out)` }); continue; }
      const acc = accountName(r.account);
      if (!acc) { errors.push({ row: rowNo, reason: `Unknown account "${r.account}"` }); continue; }
      // The Type column says income or expense; a sign on the amount is only the file's convention.
      const parsed = parseNumber(r.amount ?? "", format?.decimal);
      if (parsed === null) { errors.push({ row: rowNo, reason: `Bad amount "${r.amount}"` }); continue; }
      const amountMajor = Math.abs(parsed);
      if (toMinor(amountMajor, settings.decimals) > MAX_AMOUNT) { errors.push({ row: rowNo, reason: `Amount too large "${r.amount}"` }); continue; }
      const time = r.time?.match(/^(\d{1,2}):(\d{2})/);
      const base: Prepared = {
        _row: rowNo, type, date, _acc: acc, amount: toMinor(amountMajor, settings.decimals), note: (r.note ?? "").trim(),
        description: r.description?.trim() || undefined, tags: splitTags(r.tags), photoIds: [],
        time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
      };
      if (r.subAmount && r.subCurrency && r.subCurrency.trim().toLowerCase() !== settings.mainCurrency.toLowerCase()) {
        const cur = w.snap.currencies.find((c) => c.code.toLowerCase() === r.subCurrency!.trim().toLowerCase());
        if (cur && cur.code !== settings.mainCurrency) {
          base.subCurrency = cur.code;
          base.subAmount = toMinor(Math.abs(parseNumber(r.subAmount, format?.decimal) ?? 0), cur.decimals);
          base.exchangeRate = cur.rate;
        }
      }
      if (type === "transfer") {
        const to = accountName(r.category);
        if (!to) { errors.push({ row: rowNo, reason: `Unknown destination account "${r.category}"` }); continue; }
        if (to.toLowerCase() === acc.toLowerCase()) { errors.push({ row: rowNo, reason: "From and To are the same" }); continue; }
        base._to = to;
        const fee = r.fee?.trim() ? parseNumber(r.fee, format?.decimal) : null;
        if (fee) base.feeAmount = toMinor(Math.abs(fee), settings.decimals);
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
    const createdAccounts: string[] = [...createdTyped];
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

  "transactions.rescale": (w, { ids, factor }) => {
    if (!(factor > 0)) throw new Error("Bad factor");
    rescale(w, ids, factor);
  },

  "transactions.restoreRows": (w, { rows }) => {
    let inserted = 0;
    for (const r of rows) {
      const s = strip(r);
      if (!w.get("accounts", s.accountId as string)) continue;
      if (s.type === "transfer" ? !w.get("accounts", s.toAccountId as string) : s.toAccountId !== undefined) continue;
      for (const k of ["categoryId", "subcategoryId"] as const) if (s[k] && !w.get("categories", s[k] as string)) s[k] = undefined;
      if (s.repeatId && !w.get("repeats", s.repeatId as string)) s.repeatId = undefined;
      w.insert("transactions", clean({ ...s, photoIds: (s.photoIds as string[] | undefined) ?? [], tags: (s.tags as string[] | undefined) ?? [] }) as never);
      inserted++;
    }
    return inserted;
  },

  "transactions.copy": (w, { id, useToday, today }) => {
    const t = w.must("transactions", id);
    const { _id, _creationTime, userId, repeatId, installmentIndex, installmentCount, installmentTotal, ...rest } = t;
    void _id; void _creationTime; void userId; void repeatId; void installmentIndex; void installmentCount; void installmentTotal;
    return w.insert("transactions", { ...rest, date: useToday ? (today && isDate(today) ? today : todayISO()) : t.date });
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
      // a schedule whose account or category was deleted stops instead of filling a hidden account
      const tpl = rep.template;
      const gone = [w.get("accounts", tpl.accountId), tpl.toAccountId ? w.get("accounts", tpl.toAccountId) : null, tpl.categoryId ? w.get("categories", tpl.categoryId) : null]
        .some((d) => d === undefined || d?.deletedAt);
      if (gone) { w.patch("repeats", rep._id, { active: false }); continue; }
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

  "backup.restore": (w, { data, entries = true }) => {
    if (!data || data.version !== 1) throw new Error("Not an UnMoney backup file");
    for (const t of ["notes", "categories", "repeats", "bookmarks", "budgets", "accounts", "accountGroups", "currencies"] as const) w.clear(t);
    if (entries) w.clear("transactions");
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
    if (entries) {
      for (const t of data.transactions ?? []) {
        const s = mapTemplate(strip(t));
        if (!s.accountId) continue;
        txIds.set(t._id as string, w.insert("transactions", { ...s, photoIds: (s.photoIds as string[] | undefined) ?? [], tags: (s.tags as string[] | undefined) ?? [], repeatId: s.repeatId ? repeatIds.get(s.repeatId as string) : undefined } as never));
      }
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
      // Account ids were reissued above; point the default at the restored copy, or drop it.
      s.defaultAccountId = s.defaultAccountId ? accountIds.get(s.defaultAccountId as string) : undefined;
      if (existing) w.patch("settings", existing._id, s as never);
      else w.insert("settings", s as never);
    }
    return { accounts: Object.fromEntries(accountIds), categories: Object.fromEntries(catIds), repeats: Object.fromEntries(repeatIds) };
  },

  "backup.wipeAll": (w, { confirm, entries = true }) => {
    if (confirm !== "DELETE") throw new Error("Not confirmed");
    for (const t of ["notes", "repeats", "bookmarks", "budgets", "categoryCleanups"] as const) w.clear(t);
    if (entries) w.clear("transactions");
  },

  "files.upload": () => {
    throw new Error("Uploads are handled by the browser, not the reducer");
  },
};
