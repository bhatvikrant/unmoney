/**
 * "Split on UnSplit": hand entries to UnSplit (github.com/bhatvikrant/unsplit) as one shared
 * expense, and take the link to it back. The two apps share nothing but the user's Google
 * account, so the handoff is a URL: UnMoney opens UnSplit's /expenses/new with the entries in the
 * hash, UnSplit pre-fills its add-expense form from them, and once the expense is saved it sends
 * the browser back to /unsplit/return with the expense's id, which `transactions.setSplit` writes
 * on the entries. Everything travels in the URL fragment, which never reaches a server or a log.
 */
import type { Doc } from "../../convex/_generated/dataModel";
import { formatNumber } from "../../shared/money";
import { billLines, itemLabel, sharesText, splitShares, type Bill } from "../../shared/billSplit";

type Tx = Doc<"transactions">;

export const UNSPLIT_URL = ((import.meta.env.VITE_UNSPLIT_URL as string | undefined) || "https://unsplit.vikrantbhat.com").replace(/\/$/, "");

/** Amounts are decimal strings in major units ("1234.50"), whatever either app's decimals setting; the date is an ISO day. */
export type HandoffItem = { ref: string; name: string; amount: string };
export type Handoff = {
  v: 1;
  source: "unmoney";
  /** The entries' ids, echoed back by UnSplit so they can be linked to the expense. */
  refs: string[];
  description: string;
  notes?: string;
  currency: string;
  date: string;
  amount: string;
  /** The entries' category, for UnSplit's own category guess. */
  category?: string;
  /** More than one entry: one line each, for an itemised split. */
  items?: HandoffItem[];
};
/** What UnSplit puts in the hash of /unsplit/return. */
export type SplitReturn = { v: 1; expenseId: string; refs: string[] };

/** base64url of the JSON, UTF-8 safe. */
export function encodePayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePayload<T>(text: string): T | null {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as T;
  } catch {
    return null;
  }
}

/** Only expenses can be split: income and transfers have no one to share them with. */
export const canSplit = (t: Tx) => t.type === "expense" && t.amount > 0;

/**
 * The entries as one UnSplit expense: a single entry as it is, several as one expense with a line
 * per entry (so each line can go to different people). Amounts are in the main currency, the
 * date is the earliest entry's. Null when none of them can be split.
 */
export function buildHandoff(txs: Tx[], ctx: { currency: string; decimals: number; categoryLabel: (t: Tx) => string }): Handoff | null {
  const chosen = txs.filter(canSplit).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  if (!chosen.length) return null;
  const major = (minor: number) => formatNumber(minor, ctx.decimals, false);
  const nameOf = (t: Tx) => t.note.trim() || ctx.categoryLabel(t) || "Expense";
  const names = [...new Set(chosen.map(nameOf))];
  const description = (names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`).slice(0, 200);
  const h: Handoff = {
    v: 1,
    source: "unmoney",
    refs: chosen.map((t) => t._id),
    description,
    currency: ctx.currency,
    date: chosen[0].date,
    amount: major(chosen.reduce((sum, t) => sum + t.amount, 0)),
  };
  const single = chosen.length === 1 ? chosen[0] : undefined;
  if (single?.description?.trim()) h.notes = single.description.trim();
  // one category between them (or the one entry's), else UnSplit guesses from the description
  const cats = new Set(chosen.map((t) => t.categoryId ?? ""));
  const category = cats.size === 1 ? ctx.categoryLabel(chosen[0]) : "";
  if (category) h.category = category;
  if (chosen.length > 1) h.items = chosen.map((t) => ({ ref: t._id, name: nameOf(t), amount: major(t.amount) }));
  return h;
}

/**
 * One entry's handoff with its bill split by line item (shared/billSplit.ts). The handoff has no place
 * for people or for what each owes: UnSplit takes lines (a name and an amount), which it opens as an
 * itemised split with everyone on every line, and free-text notes. So the bill's lines go over with the
 * tax, tip and discount already spread into them (UnSplit takes its total from the lines), each named
 * with who had it, and the shares worked out here go in the notes to tick the lines against.
 */
export function withBill(h: Handoff, bill: Bill, people: string[], who: string[][], decimals: number): Handoff {
  const lines = billLines(bill);
  const shares = people.length > 1 ? splitShares(bill, people, who) : null;
  return {
    ...h,
    items: bill.items.map((it, i) => ({
      ref: h.refs[0],
      name: `${itemLabel(it)}${shares ? ` (${who[i].join(", ")})` : ""}`.slice(0, 200),
      amount: formatNumber(lines[i], decimals, false),
    })),
    notes: [h.notes, shares ? `Shares worked out in UnMoney:\n${sharesText(shares, decimals)}` : ""].filter(Boolean).join("\n\n").slice(0, 2000) || undefined,
  };
}

export const handoffUrl =(h: Handoff) => `${UNSPLIT_URL}/expenses/new#unmoney=${encodePayload(h)}`;
export const expenseUrl = (expenseId: string) => `${UNSPLIT_URL}/expenses/${encodeURIComponent(expenseId)}`;

/** The expense UnSplit made, from the hash it sent the browser back with. */
export function parseReturn(hash: string): SplitReturn | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("unsplit");
  const r = raw ? decodePayload<Partial<SplitReturn>>(raw) : null;
  if (!r || r.v !== 1 || typeof r.expenseId !== "string" || !r.expenseId.trim()) return null;
  if (!Array.isArray(r.refs) || !r.refs.every((x) => typeof x === "string")) return null;
  return { v: 1, expenseId: r.expenseId.trim(), refs: r.refs };
}
