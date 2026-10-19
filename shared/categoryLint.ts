/**
 * Quick fixes for Tidy up: exact rules, run on the device, that spot categories worth merging or
 * removing. They need no network and cost nothing. Each one becomes a card on the review page
 * and, if accepted, steps of a `categories.applyCleanup` plan.
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { CatType, Snapshot } from "./ops";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "./defaults";

/** A name reduced to what makes it distinct: "Food & Drinks" and "food and drink" compare equal. */
export function normName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

/** A note as matched by refile: case and spacing don't matter. */
export function normNote(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export type Usage = { entries: number; total: number };

/** Entries and their total per category. A main category counts its subcategories' entries too. */
export function categoryUsage(snap: Snapshot): Map<string, Usage> {
  const out = new Map<string, Usage>();
  const add = (id: string | undefined, amount: number) => {
    if (!id) return;
    const u = out.get(id) ?? { entries: 0, total: 0 };
    u.entries++;
    u.total += amount;
    out.set(id, u);
  };
  for (const t of snap.transactions) {
    if (t.type === "transfer") continue;
    add(t.categoryId, t.amount);
    if (t.subcategoryId !== t.categoryId) add(t.subcategoryId, t.amount);
  }
  return out;
}

export type QuickFix = {
  /** Stable across renders, for remembering what the user ticked. */
  key: string;
  type: CatType;
  /**
   * merge: fold `ids` into one of them (`targetId` by default) ·
   * orphan: a deleted category whose entries need a new home the user picks ·
   * remove: an unused category
   */
  kind: "merge" | "orphan" | "remove";
  ids: Id<"categories">[];
  targetId?: Id<"categories">;
  /** The parent the merged categories share, when they are subcategories. */
  parentId?: Id<"categories">;
  reason: string;
};

const NEW_DEFAULT_MS = 30 * 24 * 60 * 60 * 1000;

/** Every quick fix for both types. A category appears in at most one of them. */
export function lintCategories(snap: Snapshot, now = Date.now()): QuickFix[] {
  const usage = categoryUsage(snap);
  const entriesOf = (id: string) => usage.get(id)?.entries ?? 0;
  const out: QuickFix[] = [];
  for (const type of ["expense", "income"] as const) {
    const cats = snap.categories.filter((c) => c.type === type);
    const live = cats.filter((c) => !c.deletedAt);
    const taken = new Set<string>();
    // Where a category ends up once the duplicate merges above it go through.
    const finalOf = new Map<string, Id<"categories">>();

    // Same name written differently, under the same parent. The starter category keeps its name
    // ("Food" over a user's "food"); otherwise the most-used one does.
    const defaults = new Set<string>(type === "expense" ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES);
    const isDefault = (c: Doc<"categories">) => !c.parentId && defaults.has(c.name);
    const groups = new Map<string, Doc<"categories">[]>();
    for (const c of live) {
      const key = `${c.parentId ?? ""}|${normName(c.name)}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => Number(isDefault(b)) - Number(isDefault(a)) || entriesOf(b._id) - entriesOf(a._id) || a.order - b.order);
      const target = g[0];
      for (const c of g) { taken.add(c._id); finalOf.set(c._id, target._id); }
      out.push({ key: `merge:${g.map((c) => c._id).sort().join(",")}`, type, kind: "merge", ids: g.map((c) => c._id), targetId: target._id, parentId: target.parentId, reason: "Same name written differently." });
    }

    // Deleted, but entries still use it. Subcategories of a deleted category go along with it.
    for (const c of cats) {
      if (!c.deletedAt || !entriesOf(c._id)) continue;
      const parent = c.parentId ? cats.find((x) => x._id === c.parentId) : undefined;
      if (parent?.deletedAt) continue;
      const n = entriesOf(c._id);
      const reason = `Deleted, but ${n} ${n === 1 ? "entry still uses" : "entries still use"} it.`;
      const twin = live.find((x) => x.parentId === c.parentId && normName(x.name) === normName(c.name));
      if (twin) {
        const target = finalOf.get(twin._id) ?? twin._id;
        out.push({ key: `revive:${c._id}`, type, kind: "merge", ids: [c._id, target], targetId: target, parentId: c.parentId, reason });
      } else {
        out.push({ key: `orphan:${c._id}`, type, kind: "orphan", ids: [c._id], reason });
      }
    }

    // Unused: no entries, budgets, repeats or bookmarks. Starter categories get a month's grace.
    const refs = (x: { categoryId?: string; subcategoryId?: string }, id: string) => x.categoryId === id || x.subcategoryId === id;
    for (const c of live) {
      if (taken.has(c._id) || entriesOf(c._id) || live.some((x) => x.parentId === c._id)) continue;
      if (defaults.has(c.name) && now - c._creationTime < NEW_DEFAULT_MS) continue;
      if (snap.budgets.some((b) => b.categoryId === c._id) || snap.repeats.some((r) => refs(r.template, c._id)) || snap.bookmarks.some((b) => refs(b.template, c._id))) continue;
      if (snap.transactions.some((t) => refs(t, c._id))) continue;
      out.push({ key: `remove:${c._id}`, type, kind: "remove", ids: [c._id], reason: "No entries, budgets or repeats use it." });
    }
  }
  return out;
}
