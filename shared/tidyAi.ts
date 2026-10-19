/**
 * The AI half of Tidy up: who may run it, the summary of categories sent to Claude, the shape of
 * its answer, and the checks that answer must pass before the user sees it. Pure functions, so
 * the Convex action and the browser use the same rules.
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { CatType, Snapshot } from "./ops";
import { addDays, todayISO } from "./dates";
import { categoryUsage, normNote } from "./categoryLint";

export const AI_MODEL = "claude-haiku-5-5";
/** The AI part unlocks once there is enough to go on. */
export const AI_MIN_CATEGORIES = 8;
export const AI_MIN_ENTRIES = 100;
export const AI_MIN_HISTORY_DAYS = 30;
/** One AI run per user in this window. */
export const AI_RUN_EVERY_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CATEGORIES = 150;
const MAX_NOTES = 20;
const MAX_NOTE_LEN = 40;
const MAX_SUGGESTIONS = 12;
const MAX_NAME = 40;

export type Confidence = "high" | "medium" | "low";
/**
 * One AI suggestion, checked and with real ids.
 * merge: fold `ids` together into `targetId`, or into a new category `newName` (under `parentId` when they are subcategories) ·
 * rename: `ids[0]` becomes `newName` · nest: `ids[0]` moves under `parentId`
 */
export type AiSuggestion = {
  kind: "merge" | "rename" | "nest";
  type: CatType;
  ids: Id<"categories">[];
  targetId?: Id<"categories">;
  newName?: string;
  parentId?: Id<"categories">;
  reason: string;
  confidence: Confidence;
};

export type Eligibility = { ok: true } | { ok: false; reason: string };

/** Whether there is enough data for AI suggestions to be worth a run. */
export function aiEligibility(snap: Snapshot, today = todayISO()): Eligibility {
  const categories = snap.categories.filter((c) => !c.deletedAt).length;
  if (categories < AI_MIN_CATEGORIES) return { ok: false, reason: `AI suggestions unlock at ${AI_MIN_CATEGORIES} categories (you have ${categories})` };
  const entries = snap.transactions.filter((t) => t.type !== "transfer");
  if (entries.length < AI_MIN_ENTRIES) return { ok: false, reason: `AI suggestions unlock at ${AI_MIN_ENTRIES} entries (you have ${entries.length})` };
  const first = entries.reduce((m, t) => (t.date < m ? t.date : m), today);
  if (first > addDays(today, -AI_MIN_HISTORY_DAYS)) return { ok: false, reason: `AI suggestions unlock after ${AI_MIN_HISTORY_DAYS} days of entries` };
  return { ok: true };
}

type SummaryCategory = { id: string; name: string; parent: string | null; deleted: boolean; entries: number; total: number; notes?: [string, number][] };
export type Summary = { currency: string; subcategoriesEnabled: boolean; expense: SummaryCategory[]; income: SummaryCategory[] };

/**
 * What Claude sees: per category its name, place, entry count, total and (if allowed) its most
 * common notes. Ids are short ("e3", "i1") to save tokens; `idMap` turns them back into real ones.
 */
export function buildSummary(snap: Snapshot, includeNotes: boolean): { summary: Summary; idMap: Record<string, Id<"categories">> } {
  const settings = snap.settings[0];
  const scale = 10 ** (settings?.decimals ?? 2);
  const stats = new Map<string, { entries: number; total: number; notes: Map<string, { text: string; n: number }> }>();
  const bump = (id: string | undefined, amount: number, note: string) => {
    if (!id) return;
    const s = stats.get(id) ?? { entries: 0, total: 0, notes: new Map() };
    s.entries++;
    s.total += amount;
    const key = normNote(note);
    if (key) {
      const e = s.notes.get(key) ?? { text: note.trim().slice(0, MAX_NOTE_LEN), n: 0 };
      e.n++;
      s.notes.set(key, e);
    }
    stats.set(id, s);
  };
  for (const t of snap.transactions) {
    if (t.type === "transfer") continue;
    bump(t.categoryId, t.amount, t.note);
    if (t.subcategoryId && t.subcategoryId !== t.categoryId) bump(t.subcategoryId, t.amount, t.note);
  }
  const wanted = snap.categories
    .filter((c) => !c.deletedAt || (stats.get(c._id)?.entries ?? 0) > 0)
    .sort((a, b) => (stats.get(b._id)?.entries ?? 0) - (stats.get(a._id)?.entries ?? 0) || a.order - b.order)
    .slice(0, MAX_CATEGORIES)
    .sort((a, b) => a.order - b.order);
  const idMap: Record<string, Id<"categories">> = {};
  const shortOf = new Map<string, string>();
  const counters = { expense: 0, income: 0 };
  for (const c of wanted) {
    const short = `${c.type === "expense" ? "e" : "i"}${++counters[c.type]}`;
    idMap[short] = c._id;
    shortOf.set(c._id, short);
  }
  const row = (c: Doc<"categories">): SummaryCategory => {
    const s = stats.get(c._id);
    const out: SummaryCategory = {
      id: shortOf.get(c._id)!, name: c.name, parent: c.parentId ? shortOf.get(c.parentId) ?? null : null, deleted: !!c.deletedAt,
      entries: s?.entries ?? 0, total: Math.round((s?.total ?? 0) / scale),
    };
    if (includeNotes && s?.notes.size) out.notes = [...s.notes.values()].sort((a, b) => b.n - a.n).slice(0, MAX_NOTES).map((e) => [e.text, e.n]);
    return out;
  };
  return {
    summary: {
      currency: settings?.mainCurrency ?? "",
      subcategoriesEnabled: settings?.subcategoryEnabled ?? true,
      expense: wanted.filter((c) => c.type === "expense").map(row),
      income: wanted.filter((c) => c.type === "income").map(row),
    },
    idMap,
  };
}

/** A stable fingerprint of a summary, so an unchanged one can reuse the last answer. */
export function summaryHash(summary: Summary): string {
  const s = JSON.stringify(summary);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${s.length}`;
}

export const SYSTEM_PROMPT = `You tidy up one person's personal finance categories. You get their expense and income categories as JSON: id, name, parent (id of the main category, or null), deleted, number of entries, total in their currency, and sometimes their most common entry notes with counts.

Suggest at most ${MAX_SUGGESTIONS} changes, fewer if the list is already tidy, and none at all if nothing is worth changing. Each change is one of:
- "merge": categories that mean the same kind of spending or income. "ids" lists every category to fold together (at least 2). Set "target" to the id of the one to keep, or set "target" to null and "newName" to a better name when every existing name is worse.
- "rename": one vague or misleading category ("Misc2", "Stuff") gets a clearer name that fits its notes. "ids" has that one id; set "newName".
- "nest": a main category that belongs under another main category as a subcategory (e.g. Groceries under Food). "ids" has the category to move; set "parent" to the main category's id. Only when subcategoriesEnabled is true.

Rules:
- Be conservative. Keep distinctions people make on purpose: Groceries vs Eating out, Rent vs Utilities, Gifts vs Donations, Salary vs Bonus.
- Never mix expense and income categories in one change.
- Prefer keeping an existing name. New names are 1 to 3 words, Title Case, in the same language and style as the existing names, at most ${MAX_NAME} characters, no emoji unless the person already uses them.
- A deleted category with entries can be merged into a live one that means the same.
- Only one level of subcategories: never nest a category that has subcategories, or under a subcategory.
- Use each category in at most one change. Every id must come from the input.
- "reason" is one plain sentence for the person, under 90 characters. "confidence" is high, medium or low.
- Set unused fields to null.`;

/** JSON schema for Claude's answer (structured outputs: every object closed, every field required). */
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "ids", "target", "newName", "parent", "reason", "confidence"],
        properties: {
          kind: { type: "string", enum: ["merge", "rename", "nest"] },
          ids: { type: "array", items: { type: "string" } },
          target: { anyOf: [{ type: "string" }, { type: "null" }] },
          newName: { anyOf: [{ type: "string" }, { type: "null" }] },
          parent: { anyOf: [{ type: "string" }, { type: "null" }] },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
} as const;

type Raw = { kind?: unknown; ids?: unknown; target?: unknown; newName?: unknown; parent?: unknown; reason?: unknown; confidence?: unknown };

/**
 * Keep only suggestions that make sense against the person's actual categories: known ids of one
 * type, valid names, one level of subcategories, each category used once. Anything else is
 * dropped quietly; the worst a bad answer can do is suggest less.
 */
export function validateSuggestions(raw: unknown, categories: Doc<"categories">[], idMap: Record<string, Id<"categories">>, subcategoriesEnabled: boolean): AiSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(categories.map((c) => [c._id as string, c]));
  const get = (short: unknown) => (typeof short === "string" && idMap[short] ? byId.get(idMap[short]) : undefined);
  const live = (c: Doc<"categories"> | undefined) => (c && !c.deletedAt ? c : undefined);
  const subsOf = (id: string) => categories.filter((c) => c.parentId === id && !c.deletedAt);
  const taken = new Set<string>();
  const nameOk = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && s.trim().length <= MAX_NAME;
  const clash = (type: CatType, parentId: string | undefined, name: string, except: string[] = []) =>
    categories.some((c) => !c.deletedAt && c.type === type && c.parentId === parentId && !except.includes(c._id) && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const out: AiSuggestion[] = [];

  for (const r of raw as Raw[]) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (!r || typeof r !== "object") continue;
    const confidence: Confidence = r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";
    const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 120) : "";
    const ids = Array.isArray(r.ids) ? [...new Set(r.ids)].map(get) : [];
    if (!ids.length || ids.some((c) => !c)) continue;
    const cats = ids as Doc<"categories">[];
    const type = cats[0].type;
    if (cats.some((c) => c.type !== type)) continue;
    let s: AiSuggestion | null = null;

    if (r.kind === "merge") {
      let target = r.target === null || r.target === undefined ? undefined : live(get(r.target));
      if (r.target != null && !target) continue;
      if (target && target.type !== type) continue;
      let newName: string | undefined;
      if (!target) {
        if (!nameOk(r.newName)) continue;
        newName = r.newName.trim();
        // a "new" name that is one of the merged categories' own names just keeps that one
        const same = cats.find((c) => !c.deletedAt && c.name.trim().toLowerCase() === newName!.toLowerCase());
        if (same) { target = same; newName = undefined; }
      }
      const all = target && !cats.includes(target) ? [...cats, target] : cats;
      if (all.length < 2) continue;
      if (target) {
        if (target.parentId && all.some((c) => c !== target && !c.parentId && subsOf(c._id).length)) continue;
        if (target.parentId && all.some((c) => c._id === target!.parentId)) continue;
        s = { kind: "merge", type, ids: all.map((c) => c._id), targetId: target._id, reason, confidence };
      } else {
        // a new category sits where the merged ones sit: under their shared parent, or at the top level
        const parents = new Set(all.map((c) => c.parentId ?? ""));
        const parentId = parents.size === 1 && all[0].parentId ? all[0].parentId : undefined;
        if (parentId && !live(byId.get(parentId))) continue;
        if (clash(type, parentId, newName!, all.map((c) => c._id))) continue;
        s = { kind: "merge", type, ids: all.map((c) => c._id), newName, parentId, reason, confidence };
      }
    } else if (r.kind === "rename") {
      const c = live(cats[0]);
      if (!c || cats.length !== 1 || !nameOk(r.newName)) continue;
      const newName = r.newName.trim();
      if (newName === c.name.trim() || clash(type, c.parentId, newName, [c._id])) continue;
      s = { kind: "rename", type, ids: [c._id], newName, reason, confidence };
    } else if (r.kind === "nest") {
      const c = live(cats[0]);
      const p = live(get(r.parent));
      if (!subcategoriesEnabled || !c || !p || cats.length !== 1) continue;
      if (p.type !== type || c._id === p._id || c.parentId || p.parentId || subsOf(c._id).length) continue;
      if (clash(type, p._id, c.name)) continue;
      s = { kind: "nest", type, ids: [c._id], parentId: p._id, reason, confidence };
    }
    if (!s) continue;
    const involved = [...s.ids, ...(s.targetId ? [s.targetId] : []), ...(s.parentId ? [s.parentId] : [])];
    if (involved.some((id) => taken.has(id))) continue;
    involved.forEach((id) => taken.add(id));
    out.push(s);
  }
  return out;
}

/**
 * The last run's suggestions that still apply to the data as it is now: none of their categories
 * gone, renames and moves not already done, and a merge still having something to fold in.
 */
export function stillRelevant(list: AiSuggestion[], snap: Snapshot): AiSuggestion[] {
  const byId = new Map(snap.categories.map((c) => [c._id as string, c]));
  const usage = categoryUsage(snap);
  return list.filter((s) => {
    if (s.ids.some((id) => !byId.has(id))) return false;
    const first = byId.get(s.ids[0])!;
    if (s.kind === "rename") return !first.deletedAt && first.name !== s.newName;
    if (s.kind === "nest") return !first.deletedAt && !first.parentId && !byId.get(s.parentId!)?.deletedAt;
    if (s.targetId && byId.get(s.targetId)?.deletedAt) return false;
    return s.ids.some((id) => id !== s.targetId && (!byId.get(id)!.deletedAt || (usage.get(id)?.entries ?? 0) > 0));
  });
}
