/**
 * What Gmail sync learns from the drafts the user saves (docs/specs/gmail-smarter.md): which note
 * and category they give a merchant, so the next mail from "PAYTMQR28…" starts as "Chai stall ·
 * Food" instead of blank. The card or account a mail hints at is learned separately (accountMap).
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { normNote } from "../categoryLint";

export type MerchantMemory = { note: string; categoryId?: Id<"categories">; subcategoryId?: Id<"categories"> };
/** At most this many merchants are remembered per connection. */
export const MERCHANT_MAP_MAX = 400;

/** A merchant as a map key: letters and digits only (a database field name can't hold just anything), or "" when nothing is left. */
export function merchantKey(merchant: string): string {
  return normNote(merchant).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
}

/**
 * From saved drafts: merchant (as the mail named it) → the note and category the user saved it
 * with. Only income and expense entries of the draft's own type count, and only with a category
 * that still exists. Later saves win; entries already remembered exactly are left out.
 */
export function learnMerchants(
  accepted: { draft: Pick<Doc<"drafts">, "merchant" | "proposal" | "resolvedAt">; tx: Doc<"transactions"> }[],
  current: Record<string, MerchantMemory>,
  categories: Pick<Doc<"categories">, "_id" | "deletedAt">[],
): Record<string, MerchantMemory> {
  const live = new Set(categories.filter((c) => !c.deletedAt).map((c) => c._id as string));
  const out: Record<string, MerchantMemory> = {};
  for (const { draft, tx } of [...accepted].sort((a, b) => (a.draft.resolvedAt ?? 0) - (b.draft.resolvedAt ?? 0))) {
    if (tx.type === "transfer" || tx.type !== draft.proposal.type || !tx.categoryId || !live.has(tx.categoryId)) continue;
    const key = merchantKey(draft.merchant ?? draft.proposal.note);
    if (!key) continue;
    const mem: MerchantMemory = { note: tx.note.trim() || draft.proposal.note, categoryId: tx.categoryId, ...(tx.subcategoryId && live.has(tx.subcategoryId) ? { subcategoryId: tx.subcategoryId } : {}) };
    const had = current[key];
    if (had && had.note === mem.note && had.categoryId === mem.categoryId && had.subcategoryId === mem.subcategoryId) { delete out[key]; continue; }
    out[key] = mem;
  }
  return out;
}

/** The map after learning, newest last, capped. */
export function mergeMerchants(current: Record<string, MerchantMemory>, learned: Record<string, MerchantMemory>): Record<string, MerchantMemory> {
  const merged = { ...current };
  for (const [k, v] of Object.entries(learned)) { delete merged[k]; merged[k] = v; }
  const entries = Object.entries(merged);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MERCHANT_MAP_MAX)));
}

/**
 * A proposal with what the user taught for its merchant: their note, and their category when it
 * still exists and is of the proposal's type. Transfers are left alone.
 */
export function applyMerchantMemory<P extends Pick<Doc<"drafts">["proposal"], "type" | "note" | "categoryId" | "subcategoryId">>(
  p: P, merchant: string, map: Record<string, MerchantMemory> | undefined, categories: Pick<Doc<"categories">, "_id" | "type" | "deletedAt">[],
): P {
  if (!map || p.type === "transfer") return p;
  const mem = map[merchantKey(merchant)];
  if (!mem) return p;
  const cat = mem.categoryId ? categories.find((c) => c._id === mem.categoryId && !c.deletedAt) : undefined;
  const sub = cat && mem.subcategoryId ? categories.find((c) => c._id === mem.subcategoryId && !c.deletedAt) : undefined;
  return { ...p, note: mem.note || p.note, ...(cat && cat.type === p.type ? { categoryId: cat._id, subcategoryId: sub?._id } : {}) };
}
