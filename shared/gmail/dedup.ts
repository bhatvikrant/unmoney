/**
 * One transaction, one draft. A purchase often produces two mails (the bank's alert and the
 * shop's receipt): they fold into one draft. A draft that matches an entry the user already
 * typed in is marked, so the ledger shows "already added?" instead of a new row.
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { diffDays } from "../dates";
import { drawsFromLinked } from "../ledger";
import { isShopMail } from "./rules";

/** A draft about to be written: everything but what the database and the user add. */
export type DraftCandidate = Omit<Doc<"drafts">, "_id" | "_creationTime" | "userId" | "status" | "transactionId" | "resolvedAt">;
type Draftish = Pick<DraftCandidate, "from" | "subject" | "messageId" | "receivedAt" | "proposal">;

/** Folding one draft into another: the one that stays, and what it takes over. */
export type Fold = { extraMessageIds: string[]; note?: string; categoryId?: Id<"categories">; subcategoryId?: Id<"categories"> };
export type FoldResult = {
  /** New drafts to insert, folded among themselves. */
  inserts: DraftCandidate[];
  /** Open drafts that absorbed a new mail. */
  updates: ({ id: Id<"drafts"> } & Fold)[];
};

const withinADay = (a: string, b: string) => Math.abs(diffDays(a, b)) <= 1;
const hasAccount = (d: Draftish) => !!d.proposal.accountId || !!d.proposal.accountHint?.last4;

/**
 * Whether two mails describe the same movement of money: same amount and kind, dates within a
 * day, and either the same card or account digits or one of them a shop's receipt. Two bank
 * alerts with the same digits only pair when they name the same counterparty (two coffees on
 * the same card are two entries).
 */
export function samePayment(a: Draftish, b: Draftish): boolean {
  const pa = a.proposal, pb = b.proposal;
  if (pa.amount !== pb.amount || pa.type !== pb.type || !withinADay(pa.date, pb.date)) return false;
  const receipts = Number(isShopMail(a)) + Number(isShopMail(b));
  if (receipts === 1) return true;
  if (receipts === 2) return false;
  const l4a = pa.accountHint?.last4, l4b = pb.accountHint?.last4;
  if (!l4a || l4a !== l4b) return false;
  const na = pa.note.trim().toLowerCase(), nb = pb.note.trim().toLowerCase();
  return !na || !nb || na === nb;
}

/** The side whose note and category are worth keeping: the shop's. */
function better(keep: Draftish, other: Draftish): Omit<Fold, "extraMessageIds"> {
  if (!isShopMail(other) || isShopMail(keep)) return {};
  const p = other.proposal;
  return { note: p.note, categoryId: p.categoryId ?? keep.proposal.categoryId, subcategoryId: p.categoryId ? p.subcategoryId : keep.proposal.subcategoryId };
}

/**
 * Folds a batch of new mail: first among itself, then against the user's open drafts. The mail
 * with the account information (a bank alert) is the one that stays; the receipt's message id
 * goes into `extraMessageIds` and its merchant name becomes the note.
 */
export function foldDrafts(batch: DraftCandidate[], open: Doc<"drafts">[]): FoldResult {
  const inserts: DraftCandidate[] = [];
  const updates = new Map<Id<"drafts">, { id: Id<"drafts"> } & Fold>();
  const openLive = open.filter((d) => d.status === "open");
  for (const c of [...batch].sort((a, b) => a.receivedAt - b.receivedAt)) {
    const existing = openLive.find((d) => samePayment(d, c));
    if (existing) {
      const u = updates.get(existing._id) ?? { id: existing._id, extraMessageIds: [...existing.extraMessageIds] };
      if (!u.extraMessageIds.includes(c.messageId)) u.extraMessageIds.push(c.messageId);
      Object.assign(u, better(existing, c));
      updates.set(existing._id, u);
      continue;
    }
    const i = inserts.findIndex((d) => samePayment(d, c));
    if (i < 0) {
      inserts.push(c);
      continue;
    }
    const kept = inserts[i];
    // the alert stays, the receipt is folded in; two of a kind keep the earlier mail
    const [stay, fold] = !hasAccount(kept) && hasAccount(c) ? [c, kept] : [kept, c];
    const take = better(stay, fold);
    inserts[i] = {
      ...stay,
      extraMessageIds: [...new Set([...stay.extraMessageIds, fold.messageId, ...fold.extraMessageIds])],
      proposal: { ...stay.proposal, ...(take.note ? { note: take.note } : {}), ...(take.categoryId ? { categoryId: take.categoryId, subcategoryId: take.subcategoryId } : {}) },
    };
  }
  return { inserts, updates: [...updates.values()] };
}

/**
 * An entry the user already has that looks like this draft: same amount, dated within a day,
 * same money when both methods are known. A bank account, its debit cards and the UPIs linked to
 * it are the same money, so an alert read as "HDFC" still finds the entry typed under "PhonePe".
 * Entries a schedule made count too, so a salary mail matches the salary repeat. The closest in
 * date wins, then the exact method, then the most recent. Entries that came from a draft
 * themselves are never matched again.
 */
export function matchEntry(draft: Pick<DraftCandidate, "proposal">, transactions: Doc<"transactions">[], accounts: Doc<"accounts">[] = []): Id<"transactions"> | undefined {
  const p = draft.proposal;
  const byId = new Map(accounts.map((a) => [a._id as string, a]));
  const holder = (id: Id<"accounts"> | undefined) => {
    const a = id ? byId.get(id) : undefined;
    return a && drawsFromLinked(a) && a.linkedAccountId ? a.linkedAccountId : id;
  };
  const want = holder(p.accountId);
  const exact = (t: Doc<"transactions">) => t.accountId === p.accountId || t.toAccountId === p.accountId;
  let best: Doc<"transactions"> | undefined;
  for (const t of transactions) {
    if (t.source || t.amount !== p.amount || !withinADay(t.date, p.date)) continue;
    if (p.accountId && !exact(t) && holder(t.accountId) !== want && holder(t.toAccountId) !== want) continue;
    if (!best) { best = t; continue; }
    const db = Math.abs(diffDays(best.date, p.date)), dt = Math.abs(diffDays(t.date, p.date));
    if (dt !== db) { if (dt < db) best = t; continue; }
    if (exact(t) !== exact(best)) { if (exact(t)) best = t; continue; }
    if (t._creationTime > best._creationTime) best = t;
  }
  return best?._id;
}
