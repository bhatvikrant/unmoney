/**
 * SIPs: regular investments debited from a bank account. An expense filed under one (sipId) leaves
 * the ledger and every spending total but still leaves the account it was paid from. SIPs are found
 * in what Gmail read (entries saved from mail and the drafts waiting or dismissed), never in entries
 * typed by hand, from payments of one name and amount that come back on a rhythm
 * (docs/specs/sips.md).
 */
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { Snapshot } from "./ops";
import { addDays, addMonths, clampDay, diffDays, make, parts } from "./dates";
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
export type Rhythm = NonNullable<Sip["rhythm"]>;

export const RHYTHM_LABEL: Record<Rhythm, string> = {
  weekly: "every week", fortnightly: "every two weeks", twiceMonthly: "twice a month", monthly: "every month", quarterly: "every quarter",
};
/** Payments in an average month, for "every month" totals. */
export const PER_MONTH: Record<Rhythm, number> = { weekly: 52 / 12, fortnightly: 26 / 12, twiceMonthly: 2, monthly: 1, quarterly: 1 / 3 };

/** The user's SIPs (they live on settings). */
export function sipsOf(snap: Pick<Snapshot, "settings">): Sip[] {
  return snap.settings[0]?.sips ?? [];
}

/** Filed under a SIP: the only entries the SIP rules apply to. */
export function isSip(t: { type: string; sipId?: string }): boolean {
  return t.type === "expense" && !!t.sipId;
}

/** Read from Gmail: the only entries SIPs are found in or filed from. */
export function fromGmail(t: { source?: { app: string } }): boolean {
  return t.source?.app === "gmail";
}

/** Once a SIP is set, a payment may differ from its usual amount by this much (a yearly step-up) and still be filed under it. */
export const SIP_AMOUNT_TOLERANCE = 0.2;

type Payment = { type: string; note: string; amount: number };

/** The SIP a payment belongs to: one of its keys, about its amount; the closest amount when several fit. Cancelled SIPs take nothing, unless `withCancelled`. */
export function sipFor(sips: Sip[], t: Payment, withCancelled = false): Sip | undefined {
  if (t.type !== "expense" || t.amount <= 0) return undefined;
  const key = sipKey(t.note);
  if (!key) return undefined;
  let best: Sip | undefined;
  for (const s of sips) {
    if ((s.stoppedAt && !withCancelled) || !s.keys.includes(key)) continue;
    const off = Math.abs(t.amount - s.amount);
    if (off > Math.abs(s.amount) * SIP_AMOUNT_TOLERANCE) continue;
    if (!best || off < Math.abs(t.amount - best.amount)) best = s;
  }
  return best;
}

// ---------- rhythm ----------

/**
 * How far a debit may land from its schedule: a SIP due on a weekend or holiday goes out on the
 * next working day (or a bank's a little before).
 */
const DRIFT: Record<Rhythm, number> = { weekly: 2, fortnightly: 2, twiceMonthly: 5, monthly: 5, quarterly: 5 };
/** Missed instalments a run may skip and still be one rhythm (a bounced debit, a month's pause). */
const MAX_SKIP: Record<Rhythm, number> = { weekly: 4, fortnightly: 2, twiceMonthly: 1, monthly: 3, quarterly: 2 };
/** Two Gmail records of one name and amount this close are one payment (the bank's alert and the fund's mail). */
export const SAME_PAYMENT_DAYS = 3;
/** On a tie, the rhythm read first. */
const ORDER: Rhythm[] = ["monthly", "twiceMonthly", "fortnightly", "weekly", "quarterly"];

/** How far apart two dates' days of the month are, across a month's end (the 30th and the 2nd are 3 apart). */
function dayOff(a: string, b: string): number {
  const d = Math.abs(parts(a).d - parts(b).d);
  return Math.min(d, 31 - d);
}

/** How many instalments apart b is from a on this rhythm (1 = the next one), or 0 when it isn't. */
function step(r: Rhythm, a: string, b: string): number {
  const gap = diffDays(a, b);
  for (let k = 1; k <= MAX_SKIP[r]; k++) {
    const due = r === "weekly" ? addDays(a, 7 * k) : r === "fortnightly" ? addDays(a, 14 * k) : r === "quarterly" ? addMonths(a, 3 * k) : addMonths(a, k);
    if (r === "twiceMonthly") continue;
    if (Math.abs(diffDays(due, b)) <= DRIFT[r]) return k;
  }
  void gap;
  return 0;
}

/** The longest stretch of dates (oldest first) on rhythm r with at least one back-to-back instalment, as [from, to] indexes. */
function longestRun(r: Rhythm, dates: string[]): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null;
  let start = 0;
  let next = false;
  const close = (end: number) => {
    if (end > start && next && (!best || end - start > best.to - best.from)) best = { from: start, to: end };
  };
  for (let i = 1; i < dates.length; i++) {
    let ok: boolean;
    let back2back: boolean;
    if (r === "twiceMonthly") {
      // two days a month (the 5th and the 20th): each payment is about a month after the one two before
      // it, on about the same day of the month as the first of its lane, and 5–26 days after the last.
      // Every-two-weeks debits drift two days a month, so a few months on they leave their day.
      const gap = diffDays(dates[i - 1], dates[i]);
      const first = start + ((i - start) % 2);
      const lane = i - 2 >= start
        ? Math.abs(diffDays(addMonths(dates[i - 2], 1), dates[i])) <= DRIFT.twiceMonthly && dayOff(dates[first], dates[i]) <= DRIFT.twiceMonthly
        : true;
      ok = gap >= 5 && gap <= 26 && lane;
      back2back = ok && i - 2 >= start;
    } else {
      const k = step(r, dates[i - 1], dates[i]);
      ok = k > 0;
      back2back = k === 1;
    }
    if (!ok) {
      close(i - 1);
      start = i;
      next = false;
      continue;
    }
    if (back2back) next = true;
  }
  close(dates.length - 1);
  return best;
}

/**
 * The rhythm a run of payment dates (oldest first) keeps: the one with the longest regular stretch,
 * which has to hold two payments one instalment apart (three for twice a month, which two dates
 * can't tell from every two weeks). A pause between stretches doesn't matter: it is the stretch that
 * makes it a SIP. Null when nothing repeats.
 */
export function rhythmOf(dates: string[]): Rhythm | null {
  let best: { r: Rhythm; len: number } | null = null;
  for (const r of ORDER) {
    const run = longestRun(r, dates);
    if (!run) continue;
    const len = run.to - run.from + 1;
    if (r === "twiceMonthly" && len < 3) continue;
    if (!best || len > best.len) best = { r, len };
  }
  return best?.r ?? null;
}

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

/** When the next payment is due after `last` (and, twice a month, the one before it). */
export function nextDue(rhythm: Rhythm, recent: string[]): string {
  const last = recent[0];
  if (rhythm === "weekly") return addDays(last, 7);
  if (rhythm === "fortnightly") return addDays(last, 14);
  if (rhythm === "twiceMonthly") {
    // the other day of the month: the one the payment before the last went out on, a month on
    return recent[1] ? addMonths(recent[1], 1) : addDays(last, 15);
  }
  const months = rhythm === "quarterly" ? 3 : 1;
  const day = usualDay(recent.slice(0, 6).map((d) => parts(d).d));
  const after = parts(addMonths(`${last.slice(0, 7)}-01`, months));
  return make(after.y, after.m, clampDay(after.y, after.m, day));
}

/** How long after its due date a SIP with no payment reads as paused: its drift and half an instalment. */
export function pausedAfter(rhythm: Rhythm): number {
  const cycle = { weekly: 7, fortnightly: 14, twiceMonthly: 15, monthly: 30, quarterly: 91 }[rhythm];
  return DRIFT[rhythm] + Math.ceil(cycle / 2);
}

// ---------- signals ----------

/**
 * Words only investment payments and their mail use: SIP itself, mutual funds, the clearing houses
 * and registrars that collect SIPs (ICCL, BSE StAR MF, CAMS, KFintech), and the platforms.
 */
const STRONG = /\bsips?\b|systematic invest|mutual ?funds?|\bm\.?f\.?\b|\biccl\b|indian clearing|bse ?star|\bbse ?(ltd|limited)\b|\bnsccl\b|\bcams(online)?\b|kfin|karvy|groww|zerodha|kuvera|paytm ?money|\bet ?money\b|indmoney|ppfas|parag parikh|mirae asset|nippon india|motilal oswal|\belss\b|index fund/i;
/** Words that often mean investing but also turn up elsewhere: an ACH/NACH mandate also pays loan EMIs. */
const WEAK = /invest|\bn?ach\b|e-?mandate|auto-?debit|\bnps\b|\bppf\b|\bsgb\b|gold bond|digital gold|recurring deposit|\bstocks?\b|demat|smallcase|upstox|angel ?one|\bfunds?\b/i;
/** Category names that say what the user files investments under. */
const INVEST_CATEGORY = /invest|\bsips?\b|mutual|\bfunds?\b|\bstocks?\b/i;

/** Who sent a mail, as people say it: the display name, else the address's domain. */
export function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  if (name && !name.includes("@")) return name;
  return (from.match(/@([^>\s]+)/)?.[1] ?? from).replace(/^(mail|email|alerts?|info|noreply)\./i, "");
}

// ---------- what Gmail read ----------

/** One payment Gmail read: an entry saved from its mail, or a draft waiting or dismissed. */
export type GmailPayment = {
  key: string;
  note: string;
  amount: number;
  date: string;
  entry?: Doc<"transactions">;
  draft?: Doc<"drafts">;
  mail?: { from: string; subject: string };
  category?: string;
};

/**
 * Every expense Gmail read that is not in a SIP: entries saved from mail, and drafts still waiting
 * or dismissed. Entries typed by hand are never here. A draft flagged as an entry the user already
 * typed is here (it is what the mail said) but is never saved from a SIP (see `sips.create`).
 */
export function gmailPayments(snap: Snapshot): GmailPayment[] {
  const mailByTx = new Map<string, Doc<"drafts">>();
  const mailByMessage = new Map<string, Doc<"drafts">>();
  for (const d of snap.drafts) {
    if (d.transactionId) mailByTx.set(d.transactionId, d);
    mailByMessage.set(d.messageId, d);
  }
  const catName = new Map(snap.categories.map((c) => [c._id as string, c.name]));
  const out: GmailPayment[] = [];
  for (const t of snap.transactions) {
    if (t.type !== "expense" || t.sipId || t.amount <= 0 || !fromGmail(t)) continue;
    const key = sipKey(t.note);
    if (!key) continue;
    const mail = mailByTx.get(t._id) ?? (t.source ? mailByMessage.get(t.source.messageId) : undefined);
    out.push({ key, note: t.note, amount: t.amount, date: t.date, entry: t, mail: mail && { from: mail.from, subject: mail.subject }, category: catName.get((t.subcategoryId ?? t.categoryId) as string) });
  }
  for (const d of snap.drafts) {
    if (d.status === "accepted" || d.proposal.type !== "expense" || d.proposal.amount <= 0) continue;
    const key = sipKey(d.proposal.note);
    if (!key) continue;
    out.push({ key, note: d.proposal.note, amount: d.proposal.amount, date: d.proposal.date, draft: d, mail: { from: d.from, subject: d.subject } });
  }
  return out;
}

/** Which of two records of one payment to keep: a saved entry, then a waiting draft, then a dismissed one. */
const rank = (p: GmailPayment) => (p.entry ? 0 : p.draft?.status === "open" ? 1 : 2);

/** One payment per instalment: records of one name and amount within SAME_PAYMENT_DAYS of each other are one payment. Oldest first. */
export function onePerPayment(list: GmailPayment[]): GmailPayment[] {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b));
  const out: GmailPayment[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && diffDays(prev.date, p.date) <= SAME_PAYMENT_DAYS) {
      if (rank(p) < rank(prev)) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

// ---------- suggestions ----------

export type SipSuggestion = {
  /** Stable across renders: the name, the amount and the first payment's date. */
  id: string;
  /** What "Not a SIP" remembers (settings.dismissedSips). */
  key: string;
  /** What the SIP will be called: the mail's name, or who sent the mail when the name is a bank's generic one. */
  name: string;
  amount: number;
  /** Unknown only when the payments belong to a SIP already set (one is enough then). */
  rhythm?: Rhythm;
  /** The mail, the name or the category reads like an investment: listed under "Looks like a SIP"; the rest are "Maybe". */
  likely: boolean;
  /** One line on why. */
  why: string;
  /** One per payment, newest first. */
  payments: GmailPayment[];
  /** The entries and drafts accepting it files, and the drafts' dates (for the server's duplicate check). */
  transactionIds: Id<"transactions">[];
  draftIds: Id<"drafts">[];
  draftDates: string[];
  /** A cancelled SIP these payments belong to: accepting resumes it. */
  sip?: Sip;
};

/** What a group's mail, name or category says, most telling first; `name` is who sent the mail, when the payment's own name is a bank's generic one. */
export function readSignal(group: GmailPayment[]): { likely: boolean; why: string; name?: string } {
  const plain = (p: GmailPayment) => !STRONG.test(p.note) && !WEAK.test(p.note);
  for (const p of group) if (p.mail && STRONG.test(`${p.mail.subject} ${p.mail.from}`)) return { likely: true, why: `Mail from ${senderName(p.mail.from)}`, name: plain(p) ? senderName(p.mail.from) : undefined };
  for (const p of group) if (STRONG.test(p.note)) return { likely: true, why: "The name reads like a SIP" };
  for (const p of group) if (p.category && INVEST_CATEGORY.test(p.category)) return { likely: true, why: `Filed under ${p.category}` };
  for (const p of group) if (p.mail && WEAK.test(`${p.mail.subject} ${p.mail.from}`)) return { likely: false, why: `Mail from ${senderName(p.mail.from)}` };
  const m = group.find((p) => p.mail)?.mail;
  return { likely: false, why: m ? `Mail from ${senderName(m.from)}` : "From Gmail" };
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (d: string) => `${MONTHS[parts(d).m - 1]} ${parts(d).y}`;

/** "monthly around the 10th", "every week", "twice a month". */
export function rhythmText(rhythm: Rhythm, dates: string[]): string {
  if (rhythm === "monthly" || rhythm === "quarterly") return `${rhythm} around the ${ordinal(usualDay(dates.map((d) => parts(d).d)))}`;
  return RHYTHM_LABEL[rhythm];
}

/**
 * Payments Gmail read that look like a SIP: one name and the exact same amount, two or more times
 * on a rhythm (weekly to quarterly, each debit up to a few days off its date). The whole history of
 * that name and amount goes with it, pauses and all. Payments a running SIP takes are left out
 * (they are saved into it); ones of a cancelled SIP come back as "resume it", one payment being
 * enough. Names the user said are not SIPs are left out. Likely ones first, then by how many payments.
 */
export function sipSuggestions(snap: Snapshot): SipSuggestion[] {
  const dismissed = new Set(snap.settings[0]?.dismissedSips ?? []);
  const sips = sipsOf(snap);
  const groups = new Map<string, GmailPayment[]>();
  for (const p of gmailPayments(snap)) {
    if (dismissed.has(p.key)) continue;
    if (sipFor(sips, { type: "expense", note: p.note, amount: p.amount })) continue;
    const id = `${p.key}|${p.amount}`;
    const list = groups.get(id);
    if (list) list.push(p);
    else groups.set(id, [p]);
  }
  const out: SipSuggestion[] = [];
  for (const [id, raw] of groups) {
    const group = onePerPayment(raw);
    const dates = group.map((p) => p.date);
    const cancelled = sipFor(sips, { type: "expense", note: group[0].note, amount: group[0].amount }, true);
    const rhythm = rhythmOf(dates) ?? undefined;
    if (!rhythm && !cancelled) continue;
    const signal = readSignal(group);
    const payments = [...group].reverse();
    const n = payments.length;
    const history = [`${n} payment${n === 1 ? "" : "s"}`, rhythm ? rhythmText(rhythm, dates) : "", n > 1 ? `since ${monthYear(dates[0])}` : ""].filter(Boolean).join(", ");
    const drafts = payments.flatMap((p) => (p.draft ? [p.draft] : []));
    out.push({
      id: `${id}|${dates[0]}`,
      key: group[0].key,
      name: cancelled?.name ?? signal.name ?? payments[0].note,
      amount: group[0].amount,
      rhythm,
      likely: signal.likely || !!cancelled,
      why: cancelled ? `${cancelled.name} is marked cancelled, but payments came again · ${history}` : `${signal.why} · ${history}`,
      payments,
      transactionIds: payments.flatMap((p) => (p.entry ? [p.entry._id] : [])),
      draftIds: drafts.map((d) => d._id),
      draftDates: drafts.map((d) => d.proposal.date),
      sip: cancelled,
    });
  }
  return out.sort((a, b) => Number(b.likely) - Number(a.likely) || b.payments.length - a.payments.length || b.amount - a.amount);
}

/**
 * "Mark as SIP" on payments the user picked: every payment Gmail read with the same name and the
 * exact same amount as one of them, in every month there is data for, one per payment, newest
 * first. Ones already in a SIP are not here (they are in it).
 */
export function similarPayments(snap: Snapshot, picked: { note: string; amount: number }[]): GmailPayment[] {
  const wanted = new Set(picked.map((p) => `${sipKey(p.note)}|${p.amount}`));
  const groups = new Map<string, GmailPayment[]>();
  for (const p of gmailPayments(snap)) {
    const id = `${p.key}|${p.amount}`;
    // a draft flagged as an entry already typed would be that payment twice
    if (!wanted.has(id) || p.draft?.matchedTransactionId) continue;
    const list = groups.get(id);
    if (list) list.push(p);
    else groups.set(id, [p]);
  }
  return [...groups.values()].flatMap(onePerPayment).sort((a, b) => b.date.localeCompare(a.date));
}

/** The ids `sips.create` and `sips.mark` take for these payments. */
export function sipArgs(payments: GmailPayment[]): { transactionIds: Id<"transactions">[]; draftIds: Id<"drafts">[]; draftDates: string[] } {
  const drafts = payments.flatMap((p) => (p.draft ? [p.draft] : []));
  return { transactionIds: payments.flatMap((p) => (p.entry ? [p.entry._id] : [])), draftIds: drafts.map((d) => d._id), draftDates: drafts.map((d) => d.proposal.date) };
}

// ---------- the SIPs page ----------

export type SipStatus = "running" | "paused" | "cancelled";

export type SipRow = {
  sip: Sip;
  /** Newest first. */
  entries: Doc<"transactions">[];
  /** Every payment so far. */
  total: number;
  /** Paid in [from, to]. */
  inRange: number;
  /** Cancelled: the user said so. Paused: no payment for a while past when one was due; nothing changes, the next one goes in as usual. */
  status: SipStatus;
  /** About when the next payment is due; none once cancelled. */
  next?: string;
};

/** Every SIP with its payments: running, then paused, then cancelled, each by what has gone into it. */
export function sipsList(snap: Snapshot, from: string, to: string, today: string): SipRow[] {
  const by = new Map<string, Doc<"transactions">[]>();
  for (const t of snap.transactions) {
    if (!isSip(t)) continue;
    const list = by.get(t.sipId!);
    if (list) list.push(t);
    else by.set(t.sipId!, [t]);
  }
  const order: Record<SipStatus, number> = { running: 0, paused: 1, cancelled: 2 };
  return sipsOf(snap).map((sip): SipRow => {
    const entries = (by.get(sip.id) ?? []).sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime);
    const total = entries.reduce((s, t) => s + t.amount, 0);
    const inRange = entries.reduce((s, t) => s + (t.date >= from && t.date <= to ? t.amount : 0), 0);
    const rhythm = sip.rhythm ?? "monthly";
    const next = !sip.stoppedAt && entries[0] ? nextDue(rhythm, entries.map((t) => t.date)) : undefined;
    const status: SipStatus = sip.stoppedAt ? "cancelled" : next && diffDays(next, today) > pausedAfter(rhythm) ? "paused" : "running";
    return { sip, entries, total, inRange, status, next };
  }).sort((a, b) => order[a.status] - order[b.status] || b.total - a.total || a.sip.name.localeCompare(b.sip.name));
}

/** What the running SIPs put in, in an average month. */
export function perMonth(rows: SipRow[]): number {
  return Math.round(rows.filter((r) => r.status === "running").reduce((s, r) => s + r.sip.amount * PER_MONTH[r.sip.rhythm ?? "monthly"], 0));
}

/** What went into SIPs in [from, to], by SIP (most first): for the ledger's line and the recaps. */
export function sipsInRange(snap: Snapshot, from: string, to: string): { total: number; count: number; bySip: { id: string; name: string; amount: number; count: number }[] } {
  const names = new Map(sipsOf(snap).map((s) => [s.id, s.name]));
  const by = new Map<string, { id: string; name: string; amount: number; count: number }>();
  let total = 0;
  let count = 0;
  for (const t of snap.transactions) {
    if (!isSip(t) || t.date < from || t.date > to) continue;
    total += t.amount;
    count++;
    const row = by.get(t.sipId!) ?? { id: t.sipId!, name: names.get(t.sipId!) ?? "SIP", amount: 0, count: 0 };
    row.amount += t.amount;
    row.count++;
    by.set(t.sipId!, row);
  }
  return { total, count, bySip: [...by.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)) };
}

/**
 * Waiting Gmail drafts a running SIP takes: they are saved into it as they arrive (`sips.saveDrafts`),
 * so these are the ones that could not be (no bank account known, or flagged as an entry already
 * typed). The ledger leaves them out; the SIPs page and the review list say which SIP they are.
 */
export function sipDrafts(snap: Snapshot): Map<Id<"drafts">, Sip> {
  const out = new Map<Id<"drafts">, Sip>();
  const sips = sipsOf(snap);
  if (!sips.length) return out;
  for (const d of snap.drafts) {
    if (d.status !== "open") continue;
    const sip = sipFor(sips, d.proposal);
    if (sip) out.set(d._id, sip);
  }
  return out;
}

/** Each date and the two days either side: where an entry already saved for a draft's payment would be. */
export function aroundDates(dates: string[]): string[] {
  return [...new Set(dates.flatMap((d) => [-2, -1, 0, 1, 2].map((n) => addDays(d, n))))];
}
