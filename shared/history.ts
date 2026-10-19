/**
 * The change history the Payment methods and Categories pages show: one plain sentence per change
 * ("Merged HIBD Travel into Card (23 entries moved)"). Each sentence is worked out from the op and
 * the data just before and after it, by the same reducer on the device and on the server, so the
 * history works offline and syncs like everything else.
 */
import type { Doc } from "../convex/_generated/dataModel";
import type { OpKind, Snapshot } from "./ops";
import { kindLabel } from "./defaults";
import { formatMoney } from "./money";
import { resolveKind } from "./ledger";

export type HistoryScope = "accounts" | "categories";
export type HistoryLine = { scope: HistoryScope; text: string };

/** At most this many lines are kept per user; older ones are dropped. */
export const HISTORY_MAX = 300;
/** The same line again within this long (tapping the reorder arrows) updates the last one instead of adding another. */
export const HISTORY_COALESCE_MS = 10 * 60 * 1000;

type Args = Record<string, unknown>;
type Describe = (a: Args, before: Snapshot, after: Snapshot, result: unknown) => HistoryLine[];

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const ordinal = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
const pm = (text: string): HistoryLine[] => [{ scope: "accounts", text }];
const cat = (text: string): HistoryLine[] => [{ scope: "categories", text }];

function names(snap: Snapshot) {
  const account = (id: unknown) => snap.accounts.find((a) => a._id === id);
  const group = (id: unknown) => snap.accountGroups.find((g) => g._id === id);
  const category = (id: unknown) => snap.categories.find((c) => c._id === id);
  return {
    account,
    accountName: (id: unknown) => account(id)?.name ?? "a payment method",
    groupName: (id: unknown) => (id ? group(id)?.name ?? "a group" : "No group"),
    category,
    categoryName: (id: unknown) => category(id)?.name ?? "a category",
  };
}

function money(snap: Snapshot, minor: number): string {
  const s = snap.settings[0];
  return s ? formatMoney(minor, { symbol: s.symbol, symbolPosition: s.symbolPosition, decimals: s.decimals }) : String(minor);
}

/** What changed on a payment method, as short phrases. */
function accountChanges(before: Snapshot, after: Snapshot, was: Doc<"accounts">, now: Doc<"accounts">): string[] {
  const b = names(before);
  const a = names(after);
  const out: string[] = [];
  if (now.name !== was.name) out.push(`renamed to ${now.name}`);
  const k0 = resolveKind(was, before.accountGroups);
  const k1 = resolveKind(now, after.accountGroups);
  if (k0 !== k1) out.push(`type ${kindLabel(k0)} → ${kindLabel(k1)}`);
  if ((now.groupId ?? null) !== (was.groupId ?? null)) out.push(now.groupId ? `moved to ${a.groupName(now.groupId)}` : "moved out of its group");
  if (now.initialBalance !== was.initialBalance) out.push(`opening balance ${money(after, was.initialBalance)} → ${money(after, now.initialBalance)}`);
  if (now.includeInTotals !== was.includeInTotals) out.push(now.includeInTotals ? "counted in totals" : "left out of totals");
  if (now.hidden !== was.hidden) out.push(now.hidden ? "hidden from lists" : "shown in lists");
  if (now.transferAsExpense !== was.transferAsExpense) out.push(now.transferAsExpense ? "transfers into it count as expenses" : "transfers into it no longer count as expenses");
  if (now.billingAccountId !== was.billingAccountId) out.push(now.billingAccountId ? `billed to ${a.accountName(now.billingAccountId)}` : "no billing account");
  if (now.settlementDay !== was.settlementDay && now.settlementDay) out.push(`settles on the ${ordinal(now.settlementDay)}`);
  if (now.paymentDay !== was.paymentDay && now.paymentDay) out.push(`due on the ${ordinal(now.paymentDay)}`);
  if (now.linkedAccountId !== was.linkedAccountId) out.push(now.linkedAccountId ? `draws from ${a.accountName(now.linkedAccountId)}` : `no longer draws from ${b.accountName(was.linkedAccountId)}`);
  if (now.bankName !== was.bankName) out.push(now.bankName ? `bank ${now.bankName}` : "bank name removed");
  if (now.last4 !== was.last4) out.push(now.last4 ? `last 4 digits ${now.last4}` : "last 4 digits removed");
  if (now.color !== was.color) out.push("card colour changed");
  if ((now.description ?? "") !== (was.description ?? "")) out.push(now.description ? "description changed" : "description removed");
  return out;
}

const describers: Partial<Record<OpKind, Describe>> = {
  // ---- payment methods ----
  "accounts.create": (_a, _b, after, id) => {
    const acc = names(after).account(id);
    if (!acc) return [];
    const where = acc.groupId ? ` in ${names(after).groupName(acc.groupId)}` : "";
    return pm(`Added ${acc.name} (${kindLabel(resolveKind(acc, after.accountGroups))})${where}`);
  },
  "accounts.update": (a, before, after) => {
    const was = names(before).account(a.id);
    const now = names(after).account(a.id);
    if (!was || !now) return [];
    const changes = accountChanges(before, after, was, now);
    return changes.length ? pm(`Edited ${was.name}: ${changes.join(", ")}`) : [];
  },
  "accounts.setHidden": (a, before) => pm(`${a.hidden ? "Hid" : "Showed"} ${names(before).accountName(a.id)}`),
  "accounts.remove": (a, before) => pm(`Deleted ${names(before).accountName(a.id)}`),
  "accounts.restore": (a, before) => pm(`Restored ${names(before).accountName(a.id)}`),
  "accounts.permanentlyDelete": (a, before) => {
    const n = before.transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).length;
    return pm(`Permanently deleted ${names(before).accountName(a.id)}${n ? ` and its ${n} ${n === 1 ? "entry" : "entries"}` : ""}`);
  },
  "accounts.reorder": (a, before, after) => {
    const items = a.items as { id: string }[];
    const moved = items.filter((it) => (names(before).account(it.id)?.groupId ?? null) !== (names(after).account(it.id)?.groupId ?? null));
    if (!moved.length) return pm("Reordered payment methods");
    return moved.map((it) => ({ scope: "accounts" as const, text: `Moved ${names(after).accountName(it.id)} to ${names(after).groupName(names(after).account(it.id)?.groupId)}` }));
  },
  "accounts.move": (a, before, after) => {
    const ids = (a.ids as string[]).filter((id) => (names(before).account(id)?.groupId ?? null) !== (names(after).account(id)?.groupId ?? null));
    if (!ids.length) return [];
    const who = list(ids.map((id) => names(after).accountName(id)));
    return pm(a.groupId ? `Moved ${who} to ${names(after).groupName(a.groupId)}` : `Moved ${who} out of their group`);
  },
  "accounts.setArchived": (a, before) => {
    const ids = (a.ids as string[]).filter((id) => !!names(before).account(id)?.archivedAt !== a.archived);
    return ids.length ? pm(`${a.archived ? "Archived" : "Unarchived"} ${list(ids.map((id) => names(before).accountName(id)))}`) : [];
  },
  "accounts.merge": (a, before, _after, result) => {
    const r = result as { moved: number; droppedTransfers: number };
    const from = list((a.sourceIds as string[]).filter((id) => id !== a.targetId).map((id) => names(before).accountName(id)));
    const extra = [`${r.moved} ${r.moved === 1 ? "entry" : "entries"} moved`];
    if (r.droppedTransfers) extra.push(`${r.droppedTransfers} ${r.droppedTransfers === 1 ? "transfer" : "transfers"} between them removed`);
    return pm(`Merged ${from} into ${names(before).accountName(a.targetId)} (${extra.join(", ")})`);
  },
  "settings.setDefaultAccount": (a, before) => pm(a.id ? `Made ${names(before).accountName(a.id)} the default payment method` : "New entries start on the first payment method again"),

  // ---- groups (shown with payment methods) ----
  "accountGroups.create": (a) => pm(`Created group ${String(a.name).trim()}`),
  "accountGroups.update": (a, before, after) => {
    const was = before.accountGroups.find((g) => g._id === a.id)?.name;
    const now = after.accountGroups.find((g) => g._id === a.id)?.name;
    return was && now && was !== now ? pm(`Renamed group ${was} to ${now}`) : [];
  },
  "accountGroups.remove": (a, before) => {
    const out = before.accounts.filter((x) => x.groupId === a.id && !x.deletedAt).map((x) => x.name);
    return pm(`Deleted group ${names(before).groupName(a.id)}${out.length ? `; ${list(out)} moved to No group` : ""}`);
  },
  "accountGroups.restore": (a, before) => pm(`Restored group ${names(before).groupName(a.id)}`),
  "accountGroups.reorder": () => pm("Reordered groups"),

  // ---- categories ----
  "categories.create": (_a, before, after, id) => {
    const c = names(after).category(id);
    if (!c) return [];
    return cat(c.parentId ? `Added subcategory ${c.name} under ${names(before).categoryName(c.parentId)}` : `Added ${c.type} category ${c.name}`);
  },
  "categories.update": (a, before, after) => {
    const was = names(before).category(a.id);
    const now = names(after).category(a.id);
    if (!was || !now) return [];
    const out: string[] = [];
    if (now.name !== was.name) out.push(`Renamed ${was.name} to ${now.name}`);
    if ((now.parentId ?? null) !== (was.parentId ?? null)) out.push(now.parentId ? `Moved ${now.name} under ${names(after).categoryName(now.parentId)}` : `Made ${now.name} a main category`);
    return out.map((text) => ({ scope: "categories", text }));
  },
  "categories.remove": (a, before) => {
    const subs = before.categories.filter((c) => c.parentId === a.id && !c.deletedAt).map((c) => c.name);
    return cat(`Deleted ${names(before).categoryName(a.id)}${subs.length ? ` and its subcategories ${list(subs)}` : ""}`);
  },
  "categories.reorder": (a, before) => {
    const first = names(before).category((a.ids as string[])[0]);
    return cat(`Reordered ${first?.parentId ? `subcategories of ${names(before).categoryName(first.parentId)}` : `${first?.type ?? ""} categories`.trim()}`);
  },
  "categories.setArchived": (a, before) => {
    const ids = (a.ids as string[]).filter((id) => !!names(before).category(id)?.archivedAt !== a.archived);
    if (!ids.length) return [];
    const withSubs = ids.some((id) => before.categories.some((c) => c.parentId === id && !c.deletedAt));
    return cat(`${a.archived ? "Archived" : "Unarchived"} ${list(ids.map((id) => names(before).categoryName(id)))}${a.archived && withSubs ? " with subcategories" : ""}`);
  },
  "categories.applyCleanup": (_a, before, after) => {
    const rec = after.categoryCleanups.find((r) => !before.categoryCleanups.some((x) => x._id === r._id));
    return rec?.label.length ? cat(`Tidied up: ${rec.label.join("; ")}`) : [];
  },
  "categories.undoCleanup": (_a, _b, _after, result) => {
    const n = (result as { restoredEntries: number }).restoredEntries;
    return cat(`Undid the last tidy-up${n ? ` (${n} ${n === 1 ? "entry" : "entries"} moved back)` : ""}`);
  },

  // ---- things that change both ----
  "transactions.importRows": (_a, before, after) => {
    const accs = after.accounts.filter((x) => !before.accounts.some((y) => y._id === x._id)).map((x) => x.name);
    const cats = after.categories.filter((x) => !before.categories.some((y) => y._id === x._id)).map((x) => x.name);
    return [
      ...(accs.length ? pm(`Import added ${list(accs)}`) : []),
      ...(cats.length ? cat(`Import added ${list(cats)}`) : []),
    ];
  },
  "backup.restore": () => [...pm("Restored everything from a backup"), ...cat("Restored everything from a backup")],
};

/** Op kinds that write history, so they also load (and save) the history table. */
export const HISTORY_KINDS = Object.keys(describers) as OpKind[];

export function describeOp(kind: OpKind, args: unknown, before: Snapshot, after: Snapshot, result: unknown): HistoryLine[] {
  const d = describers[kind];
  if (!d) return [];
  try {
    return d((args ?? {}) as Args, before, after, result).filter((l) => l.text.trim());
  } catch {
    return []; // a sentence that cannot be worked out must never fail the change itself
  }
}
