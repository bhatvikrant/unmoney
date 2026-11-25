/**
 * What the mail a person saved to a payment method says about that method. One typed in as
 * "SBI Cashback CC" may have no type, bank or last four digits, while every mail filed under it
 * reads "SBI card ending 1234". Rules only, no model, and only from what the device already holds:
 * the drafts the person saved (kept 90 days) and the entries they became. The server's accountMap
 * is learned from those same drafts, so it has nothing to add and is not asked for.
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { normNote } from "../categoryLint";
import { resolveKind } from "../ledger";

type Snap = { accounts: Doc<"accounts">[]; accountGroups: Doc<"accountGroups">[]; drafts: Doc<"drafts">[]; transactions: Doc<"transactions">[] };

/** What to fill in on a method, and how to say it: "an SBI credit card ending 1234". Only fields the method lacks are set. */
export type MethodSuggestion = { accountId: Id<"accounts">; kind?: "card" | "debitCard"; bankName?: string; last4?: string; looks: string };

/** Mails that must agree before a value is offered: one alone may be a mail imported onto the default method. */
const MIN_MAILS = 2;
const CREDIT = /\bcredit\b|\bcc\b/i;
const DEBIT = /\bdebit\b/i;
const WHAT: Record<string, string> = { card: "credit card", debitCard: "debit card", bank: "account" };

/** The one value all the mails that carry one give, when enough of them do. */
function agreed(values: (string | undefined)[]): string | undefined {
  const got = values.filter((v): v is string => !!v);
  return got.length >= MIN_MAILS && got.every((v) => normNote(v) === normNote(got[0])) ? got[0] : undefined;
}

/** "an SBI credit card ending 1234", "a Kotak debit card", "an account ending 7788". */
function looksLike(kind: string, bank: string | undefined, last4: string | undefined): string {
  const what = [bank, WHAT[kind]].filter(Boolean).join(" ");
  // by how the first letter sounds: "an SBI", "an HDFC", "a Kotak", "a UCO"
  const an = /^[aeioAEIO]|^[AEFHILMNORSX][A-Z]+\b/.test(what);
  return `${an ? "an" : "a"} ${what}${last4 ? ` ending ${last4}` : ""}`;
}

/**
 * For each payment method missing its type, bank or last four digits: what the mail saved to it
 * agrees on. A type is offered only to a method that has none ("Other"), and only a card's: its
 * mail says "card", and its name or the subjects say credit or debit. Digits and bank are offered
 * only when every mail that carries one carries the same. Nothing the person typed is changed.
 */
export function suggestMethods(snap: Snap): MethodSuggestion[] {
  const saved = new Map<string, Doc<"drafts">>();
  for (const d of snap.drafts) if (d.status === "accepted" && d.transactionId && d.proposal.accountHint) saved.set(d.transactionId, d);
  if (!saved.size) return [];
  const filedTo = new Map<string, Doc<"drafts">[]>();
  for (const t of snap.transactions) {
    const d = saved.get(t._id);
    // as accountMap learns: a transfer's mail names only one of its two methods
    if (!d || t.type === "transfer") continue;
    filedTo.set(t.accountId, [...(filedTo.get(t.accountId) ?? []), d]);
  }
  const out: MethodSuggestion[] = [];
  for (const a of snap.accounts) {
    const filed = filedTo.get(a._id);
    if (!filed || a.deletedAt || a.archivedAt || a.system) continue;
    const was = resolveKind(a, snap.accountGroups);
    let kind = was;
    if (was === "other") {
      const words = [a.name, ...filed.map((d) => d.subject)].join(" ");
      if (filed.length < MIN_MAILS || !filed.every((d) => d.proposal.accountHint?.channel === "card") || CREDIT.test(words) === DEBIT.test(words)) continue;
      kind = CREDIT.test(words) ? "card" : "debitCard";
    }
    // only cards and bank accounts carry digits (and only cards a bank name): shared/ops.ts cardFields
    if (kind !== "card" && kind !== "debitCard" && kind !== "bank") continue;
    const isCard = kind !== "bank";
    const hints = filed.map((d) => d.proposal.accountHint!)
      // a bank account's digits are not its debit card's, and a card's are not those of the account that pays it
      .filter((h) => (isCard ? !h.channel || h.channel === "card" : h.channel !== "card"))
      // mail naming other digits than the method's own is about another card
      .filter((h) => !a.last4 || h.last4 === a.last4);
    const last4 = a.last4 ? undefined : agreed(hints.map((h) => h.last4));
    const bank = agreed(hints.map((h) => h.bankName));
    const bankName = isCard && !a.bankName ? bank : undefined;
    if (kind === was && !last4 && !bankName) continue;
    out.push({
      accountId: a._id, ...(kind !== was ? { kind: kind as "card" | "debitCard" } : {}), ...(bankName ? { bankName } : {}), ...(last4 ? { last4 } : {}),
      looks: looksLike(kind, a.bankName ?? bank, a.last4 ?? last4),
    });
  }
  return out;
}
