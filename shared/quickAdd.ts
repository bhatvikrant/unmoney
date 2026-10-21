/**
 * Quick add (docs/specs/quick-add.md): the entries that can be saved in one tap (top bookmarks,
 * the last entry again) and the `/t/new?…` links that iOS Shortcuts, Back Tap or a home-screen
 * shortcut open. Pure: reads a Snapshot, returns fields for transactions.create.
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { Snapshot, Template, TxFields } from "./ops";
import { parseNumber, toMinor } from "./money";

type TxType = "income" | "expense" | "transfer";

/** How many bookmarks the quick-add sheet offers. */
export const QUICK_BOOKMARKS = 4;

const liveAccount = (snap: Snapshot, id?: string) => {
  const a = id ? snap.accounts.find((x) => x._id === id) : undefined;
  return !!a && !a.deletedAt;
};
const liveCategory = (snap: Snapshot, id?: string) => {
  const c = id ? snap.categories.find((x) => x._id === id) : undefined;
  return !!c && !c.deletedAt;
};

/** A template whose accounts and category still exist, so saving it as is will go through. */
export function templateUsable(snap: Snapshot, t: Template): boolean {
  if (!liveAccount(snap, t.accountId)) return false;
  if (t.type === "transfer") return liveAccount(snap, t.toAccountId) && t.toAccountId !== t.accountId;
  return liveCategory(snap, t.categoryId) && (!t.subcategoryId || liveCategory(snap, t.subcategoryId));
}

/** The entry to save for a template, dated `date`. */
export function fromTemplate(t: Template, date: string): TxFields {
  return {
    type: t.type, date, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId,
    amount: t.amount, note: t.note, description: t.description, tags: t.tags, feeAmount: t.feeAmount, photoIds: [],
  };
}

const templateOfEntry = (t: Doc<"transactions">): Template => ({
  type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId,
  amount: t.amount, note: t.note, description: t.description, tags: t.tags, feeAmount: t.feeAmount,
});

export type QuickItem = { key: string; label: "bookmark" | "last"; template: Template };

/**
 * What the quick-add sheet offers: the first bookmarks in the user's order that can be saved as
 * they are (an amount, accounts and category still there), then the entry added last by hand
 * (not one a schedule made), unless a bookmark offered is the same thing.
 */
export function quickItems(snap: Snapshot): QuickItem[] {
  const out: QuickItem[] = [...snap.bookmarks].sort((a, b) => a.order - b.order)
    .filter((b) => b.template.amount > 0 && templateUsable(snap, b.template))
    .slice(0, QUICK_BOOKMARKS)
    .map((b) => ({ key: b._id, label: "bookmark" as const, template: b.template }));
  let last: Doc<"transactions"> | undefined;
  for (const t of snap.transactions) if (!t.repeatId && !t.installmentIndex && (!last || t._creationTime > last._creationTime)) last = t;
  if (last) {
    const tpl = templateOfEntry(last);
    const same = (x: Template) => x.type === tpl.type && x.accountId === tpl.accountId && x.toAccountId === tpl.toAccountId && x.categoryId === tpl.categoryId
      && x.subcategoryId === tpl.subcategoryId && x.amount === tpl.amount && x.note.trim().toLowerCase() === tpl.note.trim().toLowerCase();
    if (templateUsable(snap, tpl) && !out.some((i) => same(i.template))) out.push({ key: `last:${last._id}`, label: "last", template: tpl });
  }
  return out;
}

/** Entry fields a link names; anything it names that could not be found is listed in `unknown`. */
export type LinkPrefill = {
  type?: TxType;
  amount?: number;
  date?: string;
  accountId?: Id<"accounts">;
  toAccountId?: Id<"accounts">;
  categoryId?: Id<"categories">;
  subcategoryId?: Id<"categories">;
  note?: string;
  tags?: string[];
  unknown: string[];
};

/** The link fields a new-entry URL may carry, besides the editor's own (date, type, bookmark). */
export const LINK_PARAMS = ["amount", "account", "to", "category", "sub", "note", "tags", "save"];

/** Does this URL ask for a prefilled entry? */
export const isEntryLink = (sp: URLSearchParams) => ["amount", "account", "to", "category", "note"].some((k) => sp.has(k));

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();

/** By id, else by name: exact first, then the only one starting with it. Archived ones only by an exact match. */
function byName<T extends { _id: string; name: string; deletedAt?: number; archivedAt?: number }>(docs: T[], raw: string): T | undefined {
  const live = docs.filter((d) => !d.deletedAt);
  const byId = live.find((d) => d._id === raw);
  if (byId) return byId;
  const q = norm(raw);
  const exact = live.filter((d) => norm(d.name) === q);
  if (exact.length) return exact.find((d) => !d.archivedAt) ?? exact[0];
  const starts = live.filter((d) => !d.archivedAt && norm(d.name).startsWith(q));
  return starts.length === 1 ? starts[0] : undefined;
}

/**
 * Read a new-entry link: `/t/new?amount=120&category=Food/Coffee&account=HDFC&note=Chai&tags=office`.
 * Names or ids both work for account, to and category; "Food/Coffee" or `sub=Coffee` names a
 * subcategory. The amount is in major units, with a dot or a comma for decimals. Without a type,
 * a category decides it (an income category means income), and a `to` account means a transfer.
 */
export function parseEntryLink(sp: URLSearchParams, snap: Snapshot): LinkPrefill {
  const out: LinkPrefill = { unknown: [] };
  const decimals = snap.settings[0]?.decimals ?? 2;
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  const t = get("type")?.toLowerCase();
  if (t) out.type = t.startsWith("in") ? "income" : t.startsWith("tr") ? "transfer" : "expense";
  const rawAmount = get("amount");
  if (rawAmount) {
    // a Shortcut may write the device's own decimal comma ("1,50"); a comma with exactly 3 digits after is a thousands mark
    const decimal = /,\d{1,2}$/.test(rawAmount) && !rawAmount.includes(".") ? "," : ".";
    const n = parseNumber(rawAmount, decimal);
    if (n === null || !Number.isFinite(n)) out.unknown.push(`amount "${rawAmount}"`);
    else out.amount = toMinor(Math.abs(n), decimals);
  }
  const date = get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  for (const [key, field] of [["account", "accountId"], ["to", "toAccountId"]] as const) {
    const raw = get(key);
    if (!raw) continue;
    const a = byName(snap.accounts, raw);
    if (a) out[field] = a._id;
    else out.unknown.push(`payment method "${raw}"`);
  }
  if (out.toAccountId && !out.type) out.type = "transfer";
  const rawCat = get("category");
  if (rawCat && out.type !== "transfer") {
    const [mainName, subFromPath] = rawCat.includes("/") ? rawCat.split("/", 2).map((s) => s.trim()) : [rawCat, undefined];
    const mains = snap.categories.filter((c) => !c.parentId && (!out.type || c.type === out.type));
    // an income and an expense category can share a name: without a type, expense wins
    const main = byName(mains.filter((c) => c.type === "expense"), mainName) ?? byName(mains.filter((c) => c.type === "income"), mainName);
    if (!main) out.unknown.push(`category "${mainName}"`);
    else {
      out.categoryId = main._id;
      out.type ??= main.type;
      const subName = subFromPath || get("sub");
      if (subName) {
        const sub = byName(snap.categories.filter((c) => c.parentId === main._id), subName);
        if (sub) out.subcategoryId = sub._id;
        else out.unknown.push(`subcategory "${subName}"`);
      }
    }
  }
  const note = get("note");
  if (note) out.note = note.slice(0, 200);
  const tags = get("tags");
  if (tags) out.tags = [...new Set(tags.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean))];
  return out;
}

/**
 * The entry a link saves straight away (`save=1`), or why it can't: it needs an amount, a payment
 * method (the default one counts) and a category, or for a transfer the other account.
 */
export function linkEntry(p: LinkPrefill, fallbackAccount: Id<"accounts"> | undefined, today: string): { fields: TxFields } | { missing: string } {
  if (p.unknown.length) return { missing: `Couldn't find ${p.unknown.join(", ")}` };
  const type = p.type ?? "expense";
  const accountId = p.accountId ?? fallbackAccount;
  if (!p.amount) return { missing: "No amount" };
  if (!accountId) return { missing: "No payment method" };
  if (type === "transfer" ? !p.toAccountId : !p.categoryId) return { missing: type === "transfer" ? "No account to transfer to" : "No category" };
  return {
    fields: {
      type, date: p.date ?? today, accountId, toAccountId: type === "transfer" ? p.toAccountId : undefined, categoryId: type === "transfer" ? undefined : p.categoryId,
      subcategoryId: type === "transfer" ? undefined : p.subcategoryId, amount: p.amount, note: p.note ?? "", tags: p.tags ?? [], photoIds: [],
    },
  };
}
