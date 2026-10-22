/**
 * One transaction, one draft. A purchase often produces two mails (the bank's alert and the
 * shop's receipt): they fold into one draft. A draft that matches an entry the user already
 * typed in is marked, so the ledger shows "already added?" instead of a new row.
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { diffDays } from "../dates";
import { drawsFromLinked } from "../ledger";
import { isShopMail } from "./rules";
import { senderAddress } from "./mail";

/** A draft about to be written: everything but what the database and the user add. */
export type DraftCandidate = Omit<Doc<"drafts">, "_id" | "_creationTime" | "userId" | "status" | "transactionId" | "resolvedAt" | "keptNew">;
type Draftish = Pick<DraftCandidate, "from" | "subject" | "messageId" | "receivedAt" | "proposal">;

/** Folding one draft into another: the one that stays, and what it takes over. `transfer`: it becomes a transfer between these two methods. */
export type Fold = {
  extraMessageIds: string[]; note?: string; categoryId?: Id<"categories">; subcategoryId?: Id<"categories">;
  transfer?: { accountId: Id<"accounts">; toAccountId: Id<"accounts"> };
};
type Acc = Pick<Doc<"accounts">, "_id" | "kind" | "linkedAccountId">;
/** Said on a draft made from two mails about money moving between the user's own methods. */
export const PAIRED_NOTE = "paired with the other side's mail";
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
 * alerts with the same digits only pair when they come from different senders and name the same
 * counterparty: a bank sends one alert per payment, so three ₹598 alerts from it are three
 * payments, even when none of them names who paid.
 */
export function samePayment(a: Draftish, b: Draftish): boolean {
  const pa = a.proposal, pb = b.proposal;
  if (pa.amount !== pb.amount || pa.type !== pb.type || !withinADay(pa.date, pb.date)) return false;
  const receipts = Number(isShopMail(a)) + Number(isShopMail(b));
  if (receipts === 1) return true;
  if (receipts === 2) return false;
  const l4a = pa.accountHint?.last4, l4b = pb.accountHint?.last4;
  const sameSender = senderAddress(a.from) === senderAddress(b.from);
  // the bank's alert and its own summary of the payment ("INR 2500.00 payment successful"), which names no account
  if (sameSender && !!l4a !== !!l4b) return true;
  if (!l4a || l4a !== l4b) return false;
  if (sameSender) return false;
  const na = pa.note.trim().toLowerCase(), nb = pb.note.trim().toLowerCase();
  return !na || !nb || na === nb;
}

/** A bank's summary of a payment it also alerted about: its biller name reads better than the alert's code. */
const isSummaryOf = (other: Draftish, keep: Draftish) =>
  !other.proposal.accountHint?.last4 && !!keep.proposal.accountHint?.last4 && senderAddress(other.from) === senderAddress(keep.from);

/** The side whose note and category are worth keeping: the shop's receipt, or the bank's summary. */
function better(keep: Draftish, other: Draftish): Omit<Fold, "extraMessageIds"> {
  if (!isSummaryOf(other, keep) && (!isShopMail(other) || isShopMail(keep))) return {};
  const p = other.proposal;
  return { note: p.note, categoryId: p.categoryId ?? keep.proposal.categoryId, subcategoryId: p.categoryId ? p.subcategoryId : keep.proposal.subcategoryId };
}

/**
 * Folds a batch of new mail: first among itself, then against the user's open drafts. The mail
 * with the account information (a bank alert) is the one that stays; the receipt's message id
 * goes into `extraMessageIds` and its merchant name becomes the note.
 */
/**
 * Money moved between two of the user's own methods arrives as two mails: HDFC's "debited" and
 * ICICI's "credited", or the bank's "debited towards your card" and the card's "payment received".
 * Saved as they come that is an expense and an income (or an expense and a transfer): counted
 * twice. The transfer they are, when the two match (same amount, within a day, neither a shop's
 * receipt): from the method the debit names to the one credited.
 */
export function transferBetween(a: Draftish, b: Draftish, accounts: Acc[]): Fold["transfer"] | null {
  const pa = a.proposal, pb = b.proposal;
  if (!(pa.amount > 0) || pa.amount !== pb.amount || !withinADay(pa.date, pb.date) || isShopMail(a) || isShopMail(b)) return null;
  const byId = new Map(accounts.map((x) => [x._id as string, x]));
  const holder = (id: Id<"accounts">) => { const x = byId.get(id); return x && drawsFromLinked(x) && x.linkedAccountId ? x.linkedAccountId : id; };
  const isCard = (id: Id<"accounts">) => byId.get(id)?.kind === "card";
  for (const [x, y] of [[pa, pb], [pb, pa]] as const) {
    if (x.type !== "expense" || !x.accountId || !byId.has(x.accountId) || isCard(x.accountId)) continue;
    // a debit from one method and a credit into another
    if (y.type === "income" && y.accountId && byId.has(y.accountId) && !isCard(y.accountId) && holder(x.accountId) !== holder(y.accountId)) return { accountId: x.accountId, toAccountId: y.accountId };
    // a bank debit and the card's "payment received" (already a transfer): one transfer, from the account the bank names
    if (y.type === "transfer" && y.toAccountId && isCard(y.toAccountId)) return { accountId: x.accountId, toAccountId: y.toAccountId };
  }
  return null;
}

/** A draft turned into the transfer it pairs into. */
function asTransfer<T extends Draftish>(d: T, t: NonNullable<Fold["transfer"]>, other: Draftish): T {
  const p = d.proposal;
  const description = [p.description, PAIRED_NOTE].filter(Boolean).join(" · ");
  return { ...d, proposal: { ...p, type: "transfer", accountId: t.accountId, toAccountId: t.toAccountId, categoryId: undefined, subcategoryId: undefined, note: p.note || other.proposal.note, description } };
}

export function foldDrafts(batch: DraftCandidate[], open: Doc<"drafts">[], accounts: Acc[] = []): FoldResult {
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
  // then the two sides of a move between the user's own methods: against open drafts first, then among the new ones
  const paired: DraftCandidate[] = [];
  for (const c of inserts) {
    const d = openLive.find((o) => !updates.get(o._id)?.transfer && transferBetween(o, c, accounts));
    const t = d ? transferBetween(d, c, accounts) : null;
    if (d && t) {
      const u = updates.get(d._id) ?? { id: d._id, extraMessageIds: [...d.extraMessageIds] };
      for (const m of [c.messageId, ...c.extraMessageIds]) if (!u.extraMessageIds.includes(m)) u.extraMessageIds.push(m);
      u.transfer = t;
      if (!d.proposal.note && c.proposal.note) u.note = c.proposal.note;
      updates.set(d._id, u);
      continue;
    }
    const j = paired.findIndex((p) => transferBetween(p, c, accounts));
    if (j < 0) { paired.push(c); continue; }
    const kept = paired[j];
    const tr = transferBetween(kept, c, accounts)!;
    // the debit's mail stays (it names where the money left); the other side's id goes into its extras
    const [stay, fold] = kept.proposal.type === "expense" ? [kept, c] : [c, kept];
    paired[j] = { ...asTransfer(stay, tr, fold), extraMessageIds: [...new Set([...stay.extraMessageIds, fold.messageId, ...fold.extraMessageIds])], confidence: stay.confidence === "high" ? "medium" : stay.confidence };
  }
  return { inserts: paired, updates: [...updates.values()] };
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

/**
 * Open drafts that look like an entry typed in after the draft was written. Drafts already
 * matched, and ones the user said were new, are left as they are.
 */
export function laterMatches(drafts: Doc<"drafts">[], transactions: Doc<"transactions">[], accounts: Doc<"accounts">[] = []): Map<Id<"drafts">, Id<"transactions">> {
  const waiting = drafts.filter((d) => d.status === "open" && !d.matchedTransactionId && !d.keptNew);
  const out = new Map<Id<"drafts">, Id<"transactions">>();
  if (!waiting.length) return out;
  const amounts = new Set(waiting.map((d) => d.proposal.amount));
  const near = transactions.filter((t) => amounts.has(t.amount));
  for (const d of waiting) {
    const id = matchEntry(d, near, accounts);
    if (id) out.set(d._id, id);
  }
  return out;
}
