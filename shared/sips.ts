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

type Payment = { type: string; note: string; amount: number; date?: string };

/**
 * The SIP a payment belongs to: one of its keys, about its amount, and, for a SIP with a day of the
 * month, on that day (a few days late, or a day or two early). Several SIPs of one name and amount
 * (the 7th's and the 14th's) are told apart by the day; otherwise the closest amount wins. Cancelled
 * SIPs take nothing, unless `withCancelled`.
 */
export function sipFor(sips: Sip[], t: Payment, withCancelled = false): Sip | undefined {
  if (t.type !== "expense" || t.amount <= 0) return undefined;
  const key = sipKey(t.note);
  if (!key) return undefined;
  let best: { sip: Sip; off: number; late: number } | undefined;
  for (const s of sips) {
    if ((s.stoppedAt && !withCancelled) || !s.keys.includes(key)) continue;
    const off = Math.abs(t.amount - s.amount);
    if (off > Math.abs(s.amount) * SIP_AMOUNT_TOLERANCE) continue;
    const late = s.day !== undefined && t.date ? lateBy(s.day, t.date) : 0;
    if (late === null) continue;
    if (!best || off < best.off || (off === best.off && Math.abs(late) < best.late)) best = { sip: s, off, late: Math.abs(late) };
  }
  return best?.sip;
}

// ---------- rhythm ----------

/**
 * How far a debit may land from its schedule: a SIP due on a weekend or holiday goes out on the
 * next working day (or a bank's a little before).
 */
const DRIFT: Record<Rhythm, number> = { weekly: 2, fortnightly: 2, twiceMonthly: 5, monthly: 5, quarterly: 5 };
/** Missed instalments a run may skip and still be one rhythm (a bounced debit, a month's pause). */
const MAX_SKIP: Record<Rhythm, number> = { weekly: 4, fortnightly: 2, twiceMonthly: 1, monthly: 3, quarterly: 2 };
/**
 * What a suggestion needs: six months of instalments in one steady stretch (6 monthly debits, 26
 * weekly, 13 every two weeks, 3 quarterly), with no more than about a month missed between two of
 * them (`STEADY_STEP`: how many instalments apart two payments may be). Marking by hand needs none.
 */
const STEADY: Record<Rhythm, number> = { weekly: 26, fortnightly: 13, twiceMonthly: 12, monthly: 6, quarterly: 3 };
const STEADY_STEP: Record<Rhythm, number> = { weekly: 5, fortnightly: 3, twiceMonthly: 3, monthly: 2, quarterly: 1 };
/** Two Gmail records of one name and amount this close are one payment (the bank's alert and the fund's mail). */
export const SAME_PAYMENT_DAYS = 3;
/**
 * On a tie, the rhythm read first. Twice a month is never read: two days a month are two SIPs
 * (`schedulesOf`). It stays a Rhythm for SIPs saved before.
 */
const ORDER: Rhythm[] = ["monthly", "fortnightly", "weekly", "quarterly"];
/** How early a bank may take a debit due on a day of the month. */
const EARLY = 2;

/**
 * How many days after its day of the month a debit went out (negative: early), or null when it is
 * not that day's. The 28th's debit on Monday 2 March is 2 days late; the 31st is due on the 30th in a
 * 30-day month.
 */
export function lateBy(day: number, date: string): number | null {
  const p = parts(date);
  let best: number | null = null;
  for (const k of [-1, 0, 1]) {
    const m = parts(addMonths(make(p.y, p.m, 1), k));
    const off = diffDays(make(m.y, m.m, clampDay(m.y, m.m, day)), date);
    if (off >= -EARLY && off <= DRIFT.monthly && (best === null || Math.abs(off) < Math.abs(best))) best = off;
  }
  return best;
}

/**
 * Where a date sits on a weekly or two-weekly schedule started at `anchor`: the instalment number and
 * how many days off it the debit went out, or null when it is off the schedule.
 */
function onWeekday(r: "weekly" | "fortnightly", anchor: string, date: string): { n: number; off: number } | null {
  const every = r === "weekly" ? 7 : 14;
  const gap = diffDays(anchor, date);
  const n = Math.round(gap / every);
  const off = Math.abs(gap - n * every);
  return off <= DRIFT[r] ? { n, off } : null;
}

/**
 * How many instalments apart b is from a on rhythm r (1 = the next one), or 0 when it isn't. Weekly
 * and every two weeks count from `anchor`, the run's first payment, so they keep its weekday: a
 * debit two days late doesn't move the next one's date, and the 28th's debit followed by the 7th's
 * (nine days) is not a late week.
 */
function step(r: Rhythm, a: string, b: string, anchor: string, most = MAX_SKIP[r]): number {
  if (r === "weekly" || r === "fortnightly") {
    const from = onWeekday(r, anchor, a);
    const to = onWeekday(r, anchor, b);
    const k = from && to ? to.n - from.n : 0;
    return k >= 1 && k <= most ? k : 0;
  }
  for (let k = 1; k <= most; k++) {
    if (Math.abs(diffDays(addMonths(a, r === "quarterly" ? 3 * k : k), b)) <= DRIFT[r]) return k;
  }
  return 0;
}

/** Every stretch of dates (oldest first) on rhythm r with at least one back-to-back instalment, as [from, to] indexes; two payments at most `most` instalments apart. */
function runsOf(r: Rhythm, dates: string[], most = MAX_SKIP[r]): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let start = 0;
  let next = false;
  const close = (end: number) => {
    if (end > start && next) runs.push({ from: start, to: end });
  };
  for (let i = 1; i < dates.length; i++) {
    const k = step(r, dates[i - 1], dates[i], dates[start], most);
    if (!k) {
      close(i - 1);
      start = i;
      next = false;
      continue;
    }
    if (k === 1) next = true;
  }
  close(dates.length - 1);
  return runs;
}

/** The rhythm, of these, whose longest stretch is longest, and how long it is. */
function longestOf(rhythms: Rhythm[], dates: string[]): { r: Rhythm; len: number } | null {
  let best: { r: Rhythm; len: number } | null = null;
  for (const r of rhythms) {
    for (const run of runsOf(r, dates)) {
      const len = run.to - run.from + 1;
      if (!best || len > best.len) best = { r, len };
    }
  }
  return best;
}

/**
 * The rhythm a run of payment dates (oldest first) keeps: the one with the longest regular stretch,
 * which has to hold two payments one instalment apart. A pause between stretches doesn't matter: it
 * is the stretch that makes it a SIP. Null when nothing repeats. Payments of one name and amount may
 * be several SIPs: `schedulesOf` says which.
 */
export function rhythmOf(dates: string[]): Rhythm | null {
  return longestOf(ORDER, dates)?.r ?? null;
}

/** One SIP's share of the payments of one name and amount: its rhythm, its day of the month (monthly and quarterly), and its dates, oldest first. */
export type Schedule = { rhythm: Rhythm; day?: number; dates: string[] };

/** Whether a schedule has kept up for six months: enough instalments in one steady stretch to suggest it as a SIP (`STEADY`). */
export function steady(schedule: Schedule): boolean {
  return runsOf(schedule.rhythm, schedule.dates, STEADY_STEP[schedule.rhythm]).some((run) => run.to - run.from + 1 >= STEADY[schedule.rhythm]);
}

/**
 * The days of the month dates (oldest first) keep to, each with its dates and how many days late
 * they went out in all. The most common day comes first, and each date goes to the day it is least
 * off: 7, 14, 21 and 28, with their next-working-day debits (the 8th, the 30th), are four days.
 */
function daysOf(dates: string[]): { day: number; dates: string[]; late: number }[] {
  const count = new Map<number, number>();
  for (const d of dates) count.set(parts(d).d, (count.get(parts(d).d) ?? 0) + 1);
  const byCount = [...dates].sort((a, b) => count.get(parts(b).d)! - count.get(parts(a).d)! || parts(a).d - parts(b).d);
  const days: number[] = [];
  for (const d of byCount) if (!days.some((day) => lateBy(day, d) !== null)) days.push(parts(d).d);
  const lanes = new Map(days.map((day) => [day, { day, dates: [] as string[], late: 0 }]));
  for (const d of dates) {
    let day = days[0];
    let off = Infinity;
    for (const x of days) {
      const l = lateBy(x, d);
      if (l !== null && Math.abs(l) < off) [day, off] = [x, Math.abs(l)];
    }
    const lane = lanes.get(day)!;
    lane.dates.push(d);
    lane.late += off;
  }
  return [...lanes.values()];
}

/**
 * The SIPs that payments of one name and one amount (dates oldest first) are. Each day of the month
 * they keep, monthly or quarterly, is a SIP of its own: debits on the 7th, 14th, 21st and 28th are
 * four SIPs, on the 5th and the 20th two. They are one SIP, every week or every two weeks, only when
 * that reading (on one weekday) explains more of the payments, or as many with the debits nearer
 * their dates. A day the payments stopped keeping and a later one they moved to (the SIP's date was
 * changed) are one SIP, on the later day. Payments no reading explains are left out. Empty when
 * nothing repeats.
 */
export function schedulesOf(dates: string[]): Schedule[] {
  const lanes: (Schedule & { late: number })[] = [];
  for (const lane of daysOf(dates)) {
    const best = longestOf(["monthly", "quarterly"], lane.dates);
    if (best) lanes.push({ rhythm: best.r, day: lane.day, dates: lane.dates, late: lane.late });
  }
  let weekly: { rhythm: Rhythm; covered: number; off: number } | null = null;
  for (const r of ["weekly", "fortnightly"] as const) {
    let covered = 0;
    let off = 0;
    for (const run of runsOf(r, dates)) {
      covered += run.to - run.from + 1;
      for (let i = run.from; i <= run.to; i++) off += onWeekday(r, dates[run.from], dates[i])!.off;
    }
    if (covered && (!weekly || covered > weekly.covered)) weekly = { rhythm: r, covered, off };
  }
  const covered = lanes.reduce((s, l) => s + l.dates.length, 0);
  const late = lanes.reduce((s, l) => s + l.late, 0);
  if (weekly && (weekly.covered > covered || (weekly.covered === covered && weekly.off / weekly.covered < late / covered))) {
    return [{ rhythm: weekly.rhythm, dates }];
  }
  // a day that ended before another began is one SIP whose date was changed: it goes on, on the later day
  const out: Schedule[] = [];
  for (const lane of lanes.sort((a, b) => a.dates[0].localeCompare(b.dates[0]))) {
    const before = out
      .filter((s) => s.rhythm === lane.rhythm && s.dates[s.dates.length - 1] < lane.dates[0])
      .sort((a, b) => b.dates[b.dates.length - 1].localeCompare(a.dates[a.dates.length - 1]))[0];
    if (before) {
      before.dates.push(...lane.dates);
      before.day = lane.day;
    } else out.push({ rhythm: lane.rhythm, day: lane.day, dates: [...lane.dates] });
  }
  return out;
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

/**
 * Debits that were due after the last payment (dates newest first) and never came by `today`, each
 * counted once its drift has passed: the 7th's monthly SIP with nothing by the 13th has missed one.
 */
export function missedDebits(rhythm: Rhythm, recent: string[], today: string): number {
  let dates = recent;
  let missed = 0;
  // past 3 it only says "stopped?"; a cap keeps a weekly SIP stopped for years cheap
  while (missed < 60) {
    const due = nextDue(rhythm, dates);
    if (diffDays(due, today) <= DRIFT[rhythm]) break;
    missed++;
    dates = [due, ...dates];
  }
  return missed;
}
/** Missed debits from which a SIP reads as most likely stopped, not just late. */
export const STALE_AFTER = 3;

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
  /** What "Not a SIP" remembers (settings.dismissedSips): the name, and the day when the name's payments are several SIPs ("…@7"). */
  key: string;
  /** What the SIP will be called: the mail's name, or who sent the mail when the name is a bank's generic one. */
  name: string;
  amount: number;
  /** Unknown only when the payments belong to a SIP already set (one is enough then). */
  rhythm?: Rhythm;
  /** The day of the month it is due (monthly and quarterly). */
  day?: number;
  /** The mail, the name or the category reads like an investment: listed under "Looks like a SIP"; the rest are "Maybe". */
  likely: boolean;
  /** One line on why. */
  why: string;
  /** Just what says it's a SIP, without the history: "Mail from Axis Bank Alerts", "The name reads like a SIP". */
  signal: string;
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

/** "Mirae Asset · 7th": a SIP's name with its day, when payments of its name and amount are several SIPs. */
const withDay = (name: string, day?: number) => (day ? `${name} · ${ordinal(day)}` : name);

/** Payments of one name and one amount make several SIPs (their days), or a SIP of that name keeps a day: names then say the day. */
function splitByDay(sips: Sip[], key: string, schedules: Schedule[]): boolean {
  return schedules.length > 1 || sips.some((s) => s.day !== undefined && s.keys.includes(key));
}

/**
 * Payments Gmail read that look like a SIP: one name and the exact same amount on a rhythm (weekly
 * to quarterly, each debit up to a few days off its date), kept up for six months (`steady`). Payments that keep
 * several days of the month are a suggestion per day (`schedulesOf`), named with it. Each takes its
 * whole history, pauses and all. Payments a running SIP takes are left out (they are saved into
 * it); ones of a cancelled SIP come back as "resume it", one payment being enough. Names the user
 * said are not SIPs are left out. Likely ones first, then by how many payments.
 */
export function sipSuggestions(snap: Snapshot): SipSuggestion[] {
  const dismissed = new Set(snap.settings[0]?.dismissedSips ?? []);
  const sips = sipsOf(snap);
  const groups = new Map<string, GmailPayment[]>();
  for (const p of gmailPayments(snap)) {
    if (dismissed.has(p.key)) continue;
    if (sipFor(sips, { type: "expense", note: p.note, amount: p.amount, date: p.date })) continue;
    const id = `${p.key}|${p.amount}`;
    const list = groups.get(id);
    if (list) list.push(p);
    else groups.set(id, [p]);
  }
  const out: SipSuggestion[] = [];
  for (const [id, raw] of groups) {
    const group = onePerPayment(raw);
    const schedules = schedulesOf(group.map((p) => p.date));
    const split = splitByDay(sips, group[0].key, schedules);
    // fewer than six months of it, or nothing repeating: only a cancelled SIP's payments are offered (to resume it)
    const shares = schedules.length ? schedules.map((sc) => ({ sc, list: group.filter((p) => sc.dates.includes(p.date)) })) : [{ sc: undefined, list: group }];
    for (const { sc, list } of shares) {
      const latest = list[list.length - 1];
      const cancelled = sipFor(sips, { type: "expense", note: latest.note, amount: latest.amount, date: latest.date }, true);
      if (!(sc && steady(sc)) && !cancelled) continue;
      const key = split && sc?.day ? `${group[0].key}@${sc.day}` : group[0].key;
      if (dismissed.has(key)) continue;
      const dates = list.map((p) => p.date);
      const signal = readSignal(list);
      const payments = [...list].reverse();
      const n = payments.length;
      const history = [`${n} payment${n === 1 ? "" : "s"}`, sc ? rhythmText(sc.rhythm, dates) : "", n > 1 ? `since ${monthYear(dates[0])}` : ""].filter(Boolean).join(", ");
      const drafts = payments.flatMap((p) => (p.draft ? [p.draft] : []));
      out.push({
        id: `${id}|${dates[0]}`,
        key,
        name: cancelled?.name ?? withDay(signal.name ?? payments[0].note, split ? sc?.day : undefined),
        amount: group[0].amount,
        rhythm: sc?.rhythm,
        day: sc?.day,
        likely: signal.likely || !!cancelled,
        why: cancelled ? `${cancelled.name} is marked cancelled, but payments came again · ${history}` : `${signal.why} · ${history}`,
        signal: cancelled ? `${cancelled.name} is marked cancelled, but payments came again` : signal.why,
        payments,
        transactionIds: payments.flatMap((p) => (p.entry ? [p.entry._id] : [])),
        draftIds: drafts.map((d) => d._id),
        draftDates: drafts.map((d) => d.proposal.date),
        sip: cancelled,
      });
    }
  }
  return out.sort((a, b) => Number(b.likely) - Number(a.likely) || b.payments.length - a.payments.length || b.amount - a.amount || (a.day ?? 0) - (b.day ?? 0));
}

/**
 * "Mark as SIP" on payments the user picked: every payment Gmail read with the same name and the
 * exact same amount as one of them, in every month there is data for, one per payment, newest
 * first. When those payments are several SIPs (the 7th's and the 14th's), only the ones of the SIP a
 * picked payment is part of. Ones already in a SIP are not here (they are in it).
 */
export function similarPayments(snap: Snapshot, picked: { note: string; amount: number; date?: string }[]): GmailPayment[] {
  const wanted = new Map<string, string[]>();
  for (const p of picked) {
    const id = `${sipKey(p.note)}|${p.amount}`;
    wanted.set(id, [...(wanted.get(id) ?? []), ...(p.date ? [p.date] : [])]);
  }
  const groups = new Map<string, GmailPayment[]>();
  for (const p of gmailPayments(snap)) {
    const id = `${p.key}|${p.amount}`;
    // a draft flagged as an entry already typed would be that payment twice
    if (!wanted.has(id) || p.draft?.matchedTransactionId) continue;
    const list = groups.get(id);
    if (list) list.push(p);
    else groups.set(id, [p]);
  }
  return [...groups].flatMap(([id, raw]) => {
    const list = onePerPayment(raw);
    const schedules = schedulesOf(list.map((p) => p.date));
    const near = (a: string, b: string) => Math.abs(diffDays(a, b)) <= SAME_PAYMENT_DAYS;
    const mine = schedules.length > 1 ? schedules.filter((sc) => wanted.get(id)!.some((d) => sc.dates.some((x) => near(x, d)))) : [];
    return mine.length ? list.filter((p) => mine.some((sc) => sc.dates.includes(p.date))) : list;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * What a SIP made of these payments (newest first) is by default: its rhythm and day when they keep
 * one schedule, and its name, with the day ("· 7th") when payments of that name and amount are
 * several SIPs.
 */
export function newSipOf(snap: Snapshot, payments: GmailPayment[]): { name: string; rhythm?: Rhythm; day?: number } {
  if (!payments.length) return { name: "" };
  const dates = payments.map((p) => p.date).reverse();
  const own = schedulesOf(dates);
  const one = own.length === 1 ? own[0] : undefined;
  const p = payments[0];
  const all = onePerPayment(gmailPayments(snap).filter((x) => x.key === p.key && x.amount === p.amount));
  const split = one?.day !== undefined && splitByDay(sipsOf(snap), p.key, schedulesOf(all.map((x) => x.date)));
  return { name: withDay(readSignal(payments).name ?? p.note, split ? one?.day : undefined), rhythm: one?.rhythm ?? rhythmOf(dates) ?? undefined, day: one?.day };
}

/**
 * Whether a SIP of these payments knows the bank account they were paid from: a saved entry's, a
 * mail that named one, or the SIP's own. When none does, the user picks one, or nothing can be saved.
 */
export function knowsAccount(snap: Snapshot, payments: GmailPayment[], sip?: Sip): boolean {
  const live = (id?: Id<"accounts">) => !!id && snap.accounts.some((a) => a._id === id && !a.deletedAt);
  return live(sip?.accountId) || payments.some((p) => (p.entry ? live(p.entry.accountId) : live(p.draft?.proposal.accountId)));
}

/** The ids `sips.create` and `sips.mark` take for these payments. */
export function sipArgs(payments: GmailPayment[]): { transactionIds: Id<"transactions">[]; draftIds: Id<"drafts">[]; draftDates: string[] } {
  const drafts = payments.flatMap((p) => (p.draft ? [p.draft] : []));
  return { transactionIds: payments.flatMap((p) => (p.entry ? [p.entry._id] : [])), draftIds: drafts.map((d) => d._id), draftDates: drafts.map((d) => d.proposal.date) };
}

// ---------- the SIPs page ----------

/**
 * Running: paid on schedule. Late: one or two debits missed. Stale: three or more missed, so most
 * likely stopped (it still takes the next debit, which makes it running again). Cancelled: the user
 * said so.
 */
export type SipStatus = "running" | "late" | "stale" | "cancelled";

export type SipRow = {
  sip: Sip;
  /** Newest first. */
  entries: Doc<"transactions">[];
  /** Every payment so far. */
  total: number;
  /** Paid in [from, to]. */
  inRange: number;
  /** Nothing changes for a late or stale SIP: the next debit goes in as usual. */
  status: SipStatus;
  /** About when the payment after the last one was due; none once cancelled. */
  next?: string;
  /** Debits due since the last payment that never came. */
  missed: number;
};

/** Every SIP with its payments: running, then late, then stale, then cancelled, each by what has gone into it. */
export function sipsList(snap: Snapshot, from: string, to: string, today: string): SipRow[] {
  const by = new Map<string, Doc<"transactions">[]>();
  for (const t of snap.transactions) {
    if (!isSip(t)) continue;
    const list = by.get(t.sipId!);
    if (list) list.push(t);
    else by.set(t.sipId!, [t]);
  }
  const order: Record<SipStatus, number> = { running: 0, late: 1, stale: 2, cancelled: 3 };
  return sipsOf(snap).map((sip): SipRow => {
    const entries = (by.get(sip.id) ?? []).sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime);
    const total = entries.reduce((s, t) => s + t.amount, 0);
    const inRange = entries.reduce((s, t) => s + (t.date >= from && t.date <= to ? t.amount : 0), 0);
    const rhythm = sip.rhythm ?? "monthly";
    const dates = entries.map((t) => t.date);
    const next = !sip.stoppedAt && entries[0] ? nextDue(rhythm, dates) : undefined;
    const missed = sip.stoppedAt || !entries[0] ? 0 : missedDebits(rhythm, dates, today);
    const status: SipStatus = sip.stoppedAt ? "cancelled" : missed >= STALE_AFTER ? "stale" : missed ? "late" : "running";
    return { sip, entries, total, inRange, status, next, missed };
  }).sort((a, b) => order[a.status] - order[b.status] || b.total - a.total || a.sip.name.localeCompare(b.sip.name));
}

/** What the SIPs still going put in, in an average month: running and late ones, not stale or cancelled. */
export function perMonth(rows: SipRow[]): number {
  return Math.round(rows.filter((r) => r.status === "running" || r.status === "late").reduce((s, r) => s + r.sip.amount * PER_MONTH[r.sip.rhythm ?? "monthly"], 0));
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
