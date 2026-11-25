/**
 * Where a budget is headed by the end of its period, worked out on the device from the person's own
 * entries: arithmetic only, so it costs nothing and works offline.
 *
 * A straight line (spent so far ÷ the part of the period gone) reads rent on the 1st as far over
 * pace, and weekly groceries as fine until they are not. Instead:
 * - Each of the last few complete periods says what share of its spending was out by this day of
 *   the period. The usual share is their median, and what is spent so far ÷ that share is where this
 *   period ends. Periods with nothing spent, and the one the ledger began part-way through, are left out.
 * - What is scheduled is known, so it is not guessed: entries a schedule added, entries dated later
 *   in the period and bills still due each count once, as they are, and stay out of the shares.
 * - With fewer than two such periods, or a usual share too small to divide by, the unscheduled
 *   spending falls back to the straight line.
 */
import type { Doc } from "../convex/_generated/dataModel";
import { addDays, diffDays, type ISODate } from "./dates";
import { kindsOf } from "./ledger";
import type { Snapshot } from "./ops";
import { elapsedFraction, periodKey, periodRange } from "./period";
import { upcomingOccurrences } from "./upcoming";
import { ledgerOf, settingsOf, type BudgetStatus } from "./views";

export type BudgetPace = {
  /** What the period is likely to end at, bills still due included. */
  end: number;
  /** The part of `end` already out (0..1). On the budget's bar, spending past this point is headed over the limit. */
  mark: number;
  /** The day spending likely passes the limit. Set only when every earlier period agrees that it will. */
  overOn?: ISODate;
};

/** How many earlier periods to learn from. */
const PERIODS = 6;
/** A usual share below this is too small to divide by: early in a period it would turn one entry into a huge total. */
const MIN_SHARE = 0.05;
/** Periods that must agree before a day is named for going over. */
const SURE_PERIODS = 3;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
};

/** Unscheduled spending on each day of each period (this one first, then earlier ones), and what is known of this one. */
type Series = { open: number[][]; known: number[] };

/**
 * The pace of every budget in `status`, by budget id, and of all spending under "". Empty unless
 * `today` is inside the period. One pass over the entries: call it once per ledger change, not per render.
 */
export function budgetPace(snap: Snapshot, period: Doc<"budgets">["period"], status: BudgetStatus, today: ISODate): Map<string, BudgetPace> {
  const out = new Map<string, BudgetPace>();
  const settings = settingsOf(snap);
  const { range } = status;
  if (!settings || today < range.from || today > range.to) return out;
  const { monthStartDay: msd, weekStartDay: wsd } = settings;
  const ranges = [range];
  for (let i = 0; i < PERIODS; i++) ranges.push(periodRange(period, periodKey(period, addDays(ranges[i].from, -1), msd, wsd), msd, wsd));
  const lens = ranges.map((r) => diffDays(r.from, r.to) + 1);
  // all spending under "", and one series per budgeted main category
  const series = new Map<string, Series>();
  for (const k of ["", ...status.perCategory.map((i) => i.budget.categoryId as string)]) {
    series.set(k, { open: lens.map((n) => new Array<number>(n).fill(0)), known: new Array<number>(lens[0]).fill(0) });
  }
  // which period a date is in and which day of it: worked out once per date, as a ledger has many entries a day
  const placed = new Map<ISODate, [number, number]>();
  const place = (date: ISODate) => {
    let at = placed.get(date);
    if (!at) {
      const i = ranges.findIndex((r) => date >= r.from);
      placed.set(date, (at = [i, diffDays(ranges[i].from, date)]));
    }
    return at;
  };
  const add = (date: ISODate, cat: string | undefined, amount: number, known: boolean) => {
    const [i, day] = place(date);
    const all = series.get("")!;
    (known ? all.known : all.open[i])[day] += amount;
    const own = cat ? series.get(cat) : undefined;
    if (own) (known ? own.known : own.open[i])[day] += amount;
  };
  const ledger = ledgerOf(snap);
  // a subcategory counts under its main category, as budgetStatus counts it
  const parentOf = new Map(snap.categories.filter((c) => c.type === "expense").map((c) => [c._id as string, (c.parentId ?? c._id) as string]));
  const mainOf = (id: string | undefined) => (id ? parentOf.get(id) ?? id : undefined);
  const from = ranges[PERIODS].from;
  let first = today;
  for (const t of snap.transactions) {
    if (t.date < first) first = t.date;
    if (t.date < from || t.date > range.to) continue;
    const e = kindsOf(t, ledger).expense;
    if (!e) continue;
    // a schedule's entries are known amounts: exact in this period, and no part of the pattern learnt from earlier ones
    if (t.repeatId && t.date < range.from) continue;
    add(t.date, mainOf(t.categoryId), e, !!t.repeatId || t.date > today);
  }
  // bills still due become entries later: counted here once, on their dates, as budgets will count them
  for (const o of upcomingOccurrences(snap, addDays(today, 1), range.to, today)) {
    const p = o.repeat.template;
    if (p.type === "income") continue;
    const e = kindsOf({ _id: "", ...p, date: o.date } as Parameters<typeof kindsOf>[0], ledger).expense;
    if (e) add(o.date, p.type === "expense" ? mainOf(p.categoryId) : undefined, e, true);
  }

  const day = diffDays(range.from, today) + 1;
  const paceOf = (s: Series, spent: number, limit?: number): BudgetPace => {
    // per earlier period: the share of its spending out by each day of this period. A period of
    // another length is read at the same point through it, so the last day lines up with the last day.
    const curves: number[][] = [];
    for (let i = 1; i < ranges.length; i++) {
      const total = sum(s.open[i]);
      // the period the ledger began in is only part of one, unless it began on its first day
      if (total <= 0 || ranges[i].from < first) continue;
      const run = [0];
      for (const x of s.open[i]) run.push(run[run.length - 1] + x);
      curves.push(Array.from({ length: lens[0] + 1 }, (_, d) => clamp01(run[Math.round((d * lens[i]) / lens[0])] / total)));
    }
    const usual = (d: number) => median(curves.map((c) => c[d]));
    const typical = curves.length >= 2 ? usual(day) : 0;
    const learnt = typical >= MIN_SHARE;
    const share = learnt ? typical : elapsedFraction(range, today);
    const open = sum(s.open[0]);
    const known = sum(s.known);
    const end = Math.round(known + open / share);
    const pace: BudgetPace = { end, mark: end > 0 ? clamp01(spent / end) : share };
    // named only when even the period that had spent the most by today points past the limit
    if (limit !== undefined && limit > 0 && spent <= limit && learnt && curves.length >= SURE_PERIODS && known + open / Math.max(...curves.map((c) => c[day])) > limit) {
      let fixed = sum(s.known.slice(0, day));
      for (let d = day + 1; d <= lens[0]; d++) {
        fixed += s.known[d - 1];
        if (fixed + (open * usual(d)) / typical > limit) { pace.overOn = addDays(range.from, d - 1); break; }
      }
    }
    return pace;
  };
  const all = paceOf(series.get("")!, status.spentAll, status.total?.limit);
  out.set("", all);
  if (status.total) out.set(status.total.budget._id, all);
  for (const it of status.perCategory) out.set(it.budget._id, paceOf(series.get(it.budget.categoryId!)!, it.spent, it.limit));
  return out;
}
