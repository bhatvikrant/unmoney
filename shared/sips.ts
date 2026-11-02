/**
 * SIPs: regular investments paid out of a payment method. An expense filed under one (sipId) leaves
 * the ledger and every spending total but still leaves the account it was paid from. This file
 * finds payments that look like SIPs, from the mail they came in with and from how they repeat,
 * and files new entries under the SIP they belong to (docs/specs/sips.md).
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { Snapshot } from "./ops";
import { addMonths, clampDay, diffDays, make, parts } from "./dates";
import { normNote } from "./categoryLint";

/**
 * A note as SIPs match it: normalised, with every run of digits the same, so a bank's
 * "ACH D- ICCL-2398472" and next month's "ACH D- ICCL-9938473" are one key.
 */
export function sipKey(note: string): string {
  return normNote(note).replace(/\d+/g, "#");
}

/** A SIP the user accepted. */
export type Sip = NonNullable<Doc<"settings">["sips"]>[number];

/** The user's SIPs (they live on settings). */
export function sipsOf(snap: Pick<Snapshot, "settings">): Sip[] {
  return snap.settings[0]?.sips ?? [];
}

/** Filed under a SIP: the only entries the SIP rules apply to. */
export function isSip(t: { type: string; sipId?: string }): boolean {
  return t.type === "expense" && !!t.sipId;
}

/** A new payment may differ from the SIP's usual amount by this much (a yearly step-up) and still be filed under it. */
export const SIP_AMOUNT_TOLERANCE = 0.2;

type Payment = { type: string; note: string; amount: number };

/** The running SIP a payment belongs to: one of its keys, about its amount; the closest amount when several fit. */
export function sipFor(sips: Sip[], t: Payment): Sip | undefined {
  if (t.type !== "expense" || t.amount <= 0) return undefined;
  const key = sipKey(t.note);
  if (!key) return undefined;
  let best: Sip | undefined;
  for (const s of sips) {
    if (s.stoppedAt || !s.keys.includes(key)) continue;
    const off = Math.abs(t.amount - s.amount);
    if (off > Math.abs(s.amount) * SIP_AMOUNT_TOLERANCE) continue;
    if (!best || off < Math.abs(t.amount - best.amount)) best = s;
  }
  return best;
}

// ---------- signals ----------

/**
 * Words only investment payments and their mail use: SIP itself, mutual funds, the clearing houses
 * and registrars that collect SIPs (ICCL, BSE StAR MF, CAMS, KFintech), and the platforms.
 */
const STRONG = /\bsips?\b|systematic invest|mutual ?funds?|\bm\.?f\.?\b|\biccl\b|indian clearing|bse ?star|\bbse ?(ltd|limited)\b|\bnsccl\b|\bcams(online)?\b|kfin|karvy|groww|zerodha|kuvera|paytm ?money|\bet ?money\b|indmoney|ppfas|parag parikh|mirae asset|nippon india|motilal oswal|\belss\b|index fund/i;
/**
 * Words that often mean investing but also turn up elsewhere: an ACH/NACH mandate also pays loan
 * EMIs, "fund" a fund transfer. These need a monthly pattern behind them.
 */
const WEAK = /invest|\bn?ach\b|e-?mandate|auto-?debit|\bnps\b|\bppf\b|\bsgb\b|gold bond|digital gold|recurring deposit|\bstocks?\b|demat|smallcase|upstox|angel ?one|\bfunds?\b/i;
/** Category names that say what the user files investments under. */
const INVEST_CATEGORY = /invest|\bsips?\b|mutual|\bfunds?\b|\bstocks?\b/i;

type Signal = { strength: 2 | 1; why: string; /** What to call it when the note says nothing (a bank's "Payment"): who sent the mail. */ name?: string };

/** Who sent a mail, as people say it: the display name, else the address's domain. */
export function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  if (name && !name.includes("@")) return name;
  const domain = (from.match(/@([^>\s]+)/)?.[1] ?? from).replace(/^(mail|email|alerts?|info|noreply)\./i, "");
  return domain;
}

/** The strongest reason to think this payment is an investment, or null. */
function signalOf(t: Doc<"transactions">, mail: Doc<"drafts"> | undefined, category: string | undefined): Signal | null {
  const text = `${t.note} ${t.description ?? ""}`;
  const plain = !STRONG.test(t.note) && !WEAK.test(t.note);
  if (mail && STRONG.test(`${mail.subject} ${mail.from}`)) return { strength: 2, why: `Mail from ${senderName(mail.from)}`, name: plain ? senderName(mail.from) : undefined };
  if (STRONG.test(text)) return { strength: 2, why: "The note reads like a SIP" };
  if (category && INVEST_CATEGORY.test(category)) return { strength: 2, why: `Filed under ${category}` };
  if (mail && WEAK.test(`${mail.subject} ${mail.from}`)) return { strength: 1, why: `Mail from ${senderName(mail.from)}`, name: plain ? senderName(mail.from) : undefined };
  if (WEAK.test(text)) return { strength: 1, why: "The note reads like an investment" };
  return null;
}

// ---------- suggestions ----------

export type SipSuggestion = {
  /** Stable across renders: the merchant and the first payment. */
  id: string;
  /** What "Not a SIP" remembers (settings.dismissedSips). */
  key: string;
  /** What the SIP will be called: the note, or who sent the mail when the note is a bank's generic one. */
  name: string;
  /** The latest payment's amount. */
  amount: number;
  /** Newest first. */
  entries: Doc<"transactions">[];
  last: Doc<"transactions">;
  /** About a month between payments. */
  monthly: boolean;
  /** The day of the month the payments usually go out on. */
  day: number;
  /** One line on why this looks like a SIP. */
  why: string;
  /** A SIP these payments fit already (stopped, or set up after them): accepting files them under it. */
  sip?: Sip;
};

/** Gaps between payments that read as "once a month". */
const MONTHLY_GAP = { min: 24, max: 38 };
/** Payments of one merchant within this much of each other are one SIP; further apart, two SIPs on one platform. */
const SAME_SIP = 0.1;

/**
 * The day of the month payments are scheduled for. A debit that falls on a weekend or holiday goes
 * out on the next working day, only ever later, so the most common day wins and a tie goes to the
 * earlier one: 5, 6, 5, 7, 6 is the 5th.
 */
export function usualDay(days: number[]): number {
  const count = new Map<number, number>();
  for (const d of days) count.set(d, (count.get(d) ?? 0) + 1);
  let best = days[0];
  for (const [d, c] of count) if (c > count.get(best)! || (c === count.get(best)! && d < best)) best = d;
  return best;
}

/**
 * Expenses not filed under a SIP that look like one. An investment word in the mail an entry came
 * from, its note or its category (SIP, a mutual fund, ICCL, Groww...) is enough on its own, even for
 * a single payment; a weaker word (NACH, invest) also needs two payments about a month apart. A
 * monthly payment with no such word is never suggested: that is rent or an EMI, and Bills &
 * subscriptions finds it. Payments of one merchant are split by amount, so two SIPs on one platform
 * are two suggestions. Biggest first.
 */
export function sipSuggestions(snap: Snapshot): SipSuggestion[] {
  const dismissed = new Set(snap.settings[0]?.dismissedSips ?? []);
  const mailOf = new Map<string, Doc<"drafts">>();
  for (const d of snap.drafts) if (d.status === "accepted" && d.transactionId) mailOf.set(d.transactionId, d);
  const catName = new Map(snap.categories.map((c) => [c._id as string, c.name]));

  const byKey = new Map<string, Doc<"transactions">[]>();
  for (const t of snap.transactions) {
    if (t.type !== "expense" || t.sipId || t.amount <= 0) continue;
    const key = sipKey(t.note);
    if (!key || dismissed.has(key)) continue;
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
  }

  const out: SipSuggestion[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime);
    // one run per amount: each payment joins the run whose latest amount is closest, within SAME_SIP
    const runs: { amount: number; entries: Doc<"transactions">[] }[] = [];
    for (const t of list) {
      let best: (typeof runs)[number] | undefined;
      for (const r of runs) {
        const off = Math.abs(t.amount - r.amount);
        if (off <= r.amount * SAME_SIP && (!best || off < Math.abs(t.amount - best.amount))) best = r;
      }
      if (best) { best.entries.push(t); best.amount = t.amount; }
      else runs.push({ amount: t.amount, entries: [t] });
    }
    for (const run of runs) {
      const signals = run.entries.map((t) => signalOf(t, mailOf.get(t._id), catName.get((t.subcategoryId ?? t.categoryId) as string) ?? catName.get(t.categoryId as string)))
        .filter((s): s is Signal => !!s);
      if (!signals.length) continue;
      const strong = signals.find((s) => s.strength === 2);
      let gaps = 0;
      for (let i = 1; i < run.entries.length; i++) {
        const g = diffDays(run.entries[i - 1].date, run.entries[i].date);
        if (g >= MONTHLY_GAP.min && g <= MONTHLY_GAP.max) gaps++;
      }
      const monthly = gaps > 0 && gaps >= (run.entries.length - 1) / 2;
      if (!strong && !(monthly && run.entries.length >= 2)) continue;
      const entries = [...run.entries].reverse();
      const last = entries[0];
      const day = usualDay(run.entries.map((t) => parts(t.date).d));
      const n = entries.length;
      const history = n === 1 ? "1 payment" : `${n} payments${monthly ? `, monthly around the ${ordinal(day)}` : ""}`;
      out.push({
        id: `${key}|${run.entries[0]._id}`,
        key,
        name: (strong ?? signals[0]).name ?? last.note,
        amount: last.amount,
        entries,
        last,
        monthly,
        day,
        why: `${(strong ?? signals[0]).why} · ${history}`,
        sip: sipFor(sipsOf(snap).map((s) => ({ ...s, stoppedAt: undefined })), last),
      });
    }
  }
  return out.sort((a, b) => b.entries.length - a.entries.length || b.amount - a.amount);
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

// ---------- the SIPs page ----------

export type SipRow = {
  sip: Sip;
  /** Newest first. */
  entries: Doc<"transactions">[];
  /** Every payment so far. */
  total: number;
  /** Paid in [from, to]. */
  inRange: number;
  /** The day of the month it usually goes out on: a SIP is debited on a working day, so a weekend or holiday moves it a day or two. */
  day?: number;
  /** About when the next payment goes out: its usual day in the month after the last one; none for a stopped SIP. */
  next?: string;
};

/** Every SIP with its payments, running ones first, then by what has gone into them. */
export function sipsList(snap: Snapshot, from: string, to: string): SipRow[] {
  const by = new Map<string, Doc<"transactions">[]>();
  for (const t of snap.transactions) {
    if (!isSip(t)) continue;
    const list = by.get(t.sipId!);
    if (list) list.push(t);
    else by.set(t.sipId!, [t]);
  }
  return sipsOf(snap).map((sip) => {
    const entries = (by.get(sip.id) ?? []).sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime);
    const total = entries.reduce((s, t) => s + t.amount, 0);
    const inRange = entries.reduce((s, t) => s + (t.date >= from && t.date <= to ? t.amount : 0), 0);
    // the usual day over the last few payments, so one moved past a weekend doesn't move the next one
    const day = entries.length ? usualDay(entries.slice(0, 6).map((t) => parts(t.date).d)) : undefined;
    let next: string | undefined;
    if (!sip.stoppedAt && entries[0] && day) {
      const after = parts(addMonths(`${entries[0].date.slice(0, 7)}-01`, 1));
      next = make(after.y, after.m, clampDay(after.y, after.m, day));
    }
    return { sip, entries, total, inRange, day, next };
  }).sort((a, b) => Number(!!a.sip.stoppedAt) - Number(!!b.sip.stoppedAt) || b.total - a.total || a.sip.name.localeCompare(b.sip.name));
}

/** What went into SIPs in [from, to]: for the line on the ledger that says where those payments went. */
export function sipsInRange(snap: Snapshot, from: string, to: string): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const t of snap.transactions) {
    if (!isSip(t) || t.date < from || t.date > to) continue;
    total += t.amount;
    count++;
  }
  return { total, count };
}

/** Open Gmail drafts a running SIP will take once saved: the ledger leaves them out, the SIPs page counts them. */
export function sipDrafts(snap: Snapshot): Map<Id<"drafts">, Sip> {
  const out = new Map<Id<"drafts">, Sip>();
  const sips = sipsOf(snap);
  if (!sips.length) return out;
  for (const d of snap.drafts) {
    if (d.status !== "open" || d.matchedTransactionId) continue;
    const sip = sipFor(sips, d.proposal);
    if (sip) out.set(d._id, sip);
  }
  return out;
}
