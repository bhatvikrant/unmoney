/**
 * What is about to go out (or come in): the coming dates of repeat schedules, what each
 * subscription costs a month, and payments that recur without a schedule. Read models only;
 * nothing here counts in a balance or a total (docs/specs/upcoming-bills.md).
 */
import type { Doc } from "../convex/_generated/dataModel";
import { addDays, diffDays } from "./dates";
import { horizonFor, type Snapshot } from "./ops";
import { firstDateAfter, nextOccurrence, type Frequency } from "./repeat";
import { normNote } from "./categoryLint";

export type Occurrence = {
  repeat: Doc<"repeats">;
  date: string;
  /** The schedule's next date: the only one that can be added early or skipped. */
  isNext: boolean;
};

/** A schedule whose account or category is gone stops at its next run (repeats.catchUp), so it has nothing coming. */
function liveTemplate(snap: Snapshot, t: Doc<"repeats">["template"]): boolean {
  const live = <T extends { _id: string; deletedAt?: number }>(docs: T[], id: string | undefined) => {
    const d = id ? docs.find((x) => x._id === id) : undefined;
    return !!d && !d.deletedAt;
  };
  if (!live(snap.accounts, t.accountId)) return false;
  if (t.type === "transfer") return live(snap.accounts, t.toAccountId);
  return live(snap.categories, t.categoryId);
}

/**
 * Coming dates of every active repeat in [from, to], oldest first. Dates the app is about to add
 * (on or before today's horizon) are left out: they become entries as soon as the app opens.
 * Installments are left out too, as their entries already exist.
 */
export function upcomingOccurrences(snap: Snapshot, from: string, to: string, today: string): Occurrence[] {
  const horizon = horizonFor(snap.settings[0] ?? null, today);
  const out: Occurrence[] = [];
  for (const r of snap.repeats) {
    if (!r.active || r.kind !== "repeat" || !liveTemplate(snap, r.template)) continue;
    let d = r.nextDate;
    for (let guard = 0; d <= to && guard < 400; guard++) {
      if (r.endDate && d > r.endDate) break;
      if (d > horizon && d >= from) out.push({ repeat: r, date: d, isNext: d === r.nextDate });
      d = nextOccurrence(d, r.startDate, r.frequency);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.repeat.template.note.localeCompare(b.repeat.template.note));
}

/** Coming dates in the 30 days after today. */
export function next30Days(snap: Snapshot, today: string): Occurrence[] {
  return upcomingOccurrences(snap, addDays(today, 1), addDays(today, 30), today);
}

const PER_MONTH: Record<Frequency, number> = { daily: 365 / 12, weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, yearly: 1 / 12 };

/** What a schedule costs in an average month, in minor units. */
export function monthlyCost(amount: number, frequency: Frequency): number {
  return Math.round(amount * PER_MONTH[frequency]);
}

export type Subscription = { repeat: Doc<"repeats">; monthly: number };

/** Active repeating expenses, soonest first, with what each costs a month. */
export function subscriptionsList(snap: Snapshot): Subscription[] {
  return snap.repeats
    .filter((r) => r.active && r.kind === "repeat" && r.template.type === "expense" && liveTemplate(snap, r.template))
    .map((repeat) => ({ repeat, monthly: monthlyCost(repeat.template.amount, repeat.frequency) }))
    .sort((a, b) => a.repeat.nextDate.localeCompare(b.repeat.nextDate) || b.monthly - a.monthly);
}

export type RecurringSuggestion = {
  /** Normalised note: what "Not a bill" remembers. */
  key: string;
  /** The latest payment; "Make it a repeat" copies it. */
  last: Doc<"transactions">;
  count: number;
  /** When the next one would be. */
  nextDate: string;
};

/** Gaps between payments that read as "once a month". */
const MONTHLY_GAP = { min: 24, max: 38 };
/** The last payment must be this recent for the pattern to still be going. */
const STILL_GOING_DAYS = 40;
/** Amounts may move by this much (a price rise, tax) and still be the same bill. */
const AMOUNT_TOLERANCE = 0.1;
/** How far back to look. */
const LOOKBACK_DAYS = 400;

/**
 * Expenses that come back about once a month with about the same amount (three times or more,
 * the last one recent) and have no repeat schedule yet: likely subscriptions or bills. Notes the
 * user dismissed, and notes an active schedule already covers, are left out. Biggest first.
 */
export function recurringSuggestions(snap: Snapshot, today: string): RecurringSuggestion[] {
  const dismissed = new Set(snap.settings[0]?.dismissedRecurring ?? []);
  const scheduled = new Set(snap.repeats.filter((r) => r.active && r.template.type === "expense").map((r) => normNote(r.template.note)));
  const since = addDays(today, -LOOKBACK_DAYS);
  const byNote = new Map<string, Doc<"transactions">[]>();
  for (const t of snap.transactions) {
    if (t.type !== "expense" || t.repeatId || t.installmentIndex || t.date <= since || t.date > today) continue;
    const key = normNote(t.note);
    if (!key || dismissed.has(key) || scheduled.has(key)) continue;
    const list = byNote.get(key);
    if (list) list.push(t);
    else byNote.set(key, [t]);
  }
  const out: RecurringSuggestion[] = [];
  for (const [key, list] of byNote) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime);
    const last = list[list.length - 1];
    if (diffDays(last.date, today) > STILL_GOING_DAYS) continue;
    // the run of monthly-spaced payments ending at the latest one, with amounts close to it
    let run = 1;
    for (let i = list.length - 1; i > 0; i--) {
      const gap = diffDays(list[i - 1].date, list[i].date);
      const close = Math.abs(list[i - 1].amount - last.amount) <= Math.abs(last.amount) * AMOUNT_TOLERANCE;
      if (gap < MONTHLY_GAP.min || gap > MONTHLY_GAP.max || !close) break;
      run++;
    }
    if (run < 3) continue;
    out.push({ key, last, count: run, nextDate: firstDateAfter(last.date, "monthly", today) });
  }
  return out.sort((a, b) => b.last.amount - a.last.amount);
}
