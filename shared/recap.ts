/**
 * The monthly and yearly recaps: a run of story cards about one finished logical month or year,
 * computed from the same functions as the Stats tab (statsEntries, statsByCategory, budgetStatus)
 * so every number on a card is one the user can find on Stats. Pure: nothing is stored for it.
 * See docs/specs/monthly-recap.md and docs/specs/yearly-recap.md.
 */
import type { Snapshot } from "./ops";
import { addDays, diffDays, make, MONTH_LONG, weekday, type ISODate } from "./dates";
import { monthKey, monthKeyForDate, monthRange, parseMonthKey, shiftMonthKey, yearRange, type MonthKey, type Range } from "./period";
import { budgetStatus, settingsOf, statsByCategory, statsEntries, type Tx } from "./views";

/** A month needs this many expense entries before it gets a recap. */
export const RECAP_MIN_ENTRIES = 5;
/** The ledger nudge shows for this many days from the start of the logical month. */
export const RECAP_NUDGE_DAYS = 7;
/** A category is a "mover" when it changed by more than this share of the month's total. */
export const RECAP_MOVER_SHARE = 0.05;
/** A note has to appear this often to be "on repeat". */
export const RECAP_REPEAT_MIN = 3;

// ---- the year (docs/specs/yearly-recap.md) ----

/** A year needs this many logical months that qualify for a monthly recap. */
export const RECAP_YEAR_MIN_MONTHS = 3;
/** The year's ledger nudge shows for this many days from the start of logical month 1. */
export const RECAP_YEAR_NUDGE_DAYS = 14;
/** A category is a year "mover" when it changed by more than this share of the year's total. */
export const RECAP_YEAR_MOVER_SHARE = 0.02;
/** "Your top five" needs this many notes with at least RECAP_YEAR_TOP5_MIN_COUNT entries each. */
export const RECAP_YEAR_TOP5_MIN_NOTES = 3;
export const RECAP_YEAR_TOP5_MIN_COUNT = 5;
/** "On the clock" needs a time on at least this share of the year's expense entries. */
export const RECAP_YEAR_TIMED_SHARE = 0.5;
/** "New this year" lists categories and methods with at least this many entries in the year. */
export const RECAP_YEAR_NEW_MIN = 5;
/** "Month by month" needs this many months with entries. */
export const RECAP_YEAR_MONTHS_MIN = 3;

/** The spending personality rules (spec §4.3), evaluated top to bottom; the first match wins. */
export const PERSONALITY = {
  /** The Planner: scheduled (repeat) entries at or above this share of spend… */
  plannerScheduledShare: 0.35,
  /** …or every budget held in at least this many months. */
  plannerBudgetMonths: 9,
  /** The Homebody: Household at or above this share. */
  homebodyShare: 0.4,
  /** The Foodie: Food (and food-like categories) at or above this share. */
  foodieShare: 0.3,
  /** The Explorer: Travel plus Transport at or above this share. */
  explorerShare: 0.2,
  /** The Weekender: Saturdays and Sundays at or above this share of spend. */
  weekenderShare: 0.45,
  /** The Night Owl: this share of timed entries at or after `nightHour`, with times on at least RECAP_YEAR_TIMED_SHARE of entries. */
  nightOwlShare: 0.4,
  nightHour: 21,
  /** The Big-Day Spender: the ten largest entries at or above this share of the year. */
  bigDayShare: 0.4,
  bigDayCount: 10,
  /** The Steady Hand: no month strays more than this from the monthly average, over at least `steadyMonths` months. */
  steadyDeviation: 0.15,
  steadyMonths: 6,
} as const;

export type Archetype = "The Planner" | "The Homebody" | "The Foodie" | "The Explorer" | "The Weekender" | "The Night Owl" | "The Big-Day Spender" | "The Steady Hand" | "The All-Rounder";

/** The one sentence under each archetype. */
export const PERSONALITY_WHY: Record<Archetype, string> = {
  "The Planner": "Most of your money moves on a schedule, and budgets mostly held.",
  "The Homebody": "Home took the biggest share by far.",
  "The Foodie": "Eating well was the year's main line item.",
  "The Explorer": "A fifth of the year went on getting somewhere.",
  "The Weekender": "Saturdays and Sundays carried nearly half the year.",
  "The Night Owl": "Most of your entries land after nine.",
  "The Big-Day Spender": "A handful of big days shaped the whole year.",
  "The Steady Hand": "Every month looked much like the last.",
  "The All-Rounder": "No single thing dominated: spread across categories, days and months.",
};

/** Category names that widen a default category's share, matched case-insensitively (spec §4.3). */
const HOME_WORDS = ["home", "house", "rent"];
const FOOD_WORDS = ["food", "eating", "dining", "restaurant", "cafe"];
const TRAVEL_WORDS = ["travel", "transport"];

export type RecapBudgets = { held: number; total: number; worst?: { name: string; over: number } };

/** The month's colour signature: the top three categories by share, in Stats order; everything else is the grey rest. */
export type RecapStrip = { id: string; name: string; pct: number }[];

/** The six tiles of the closer card and the lines of the text summary. */
export type RecapSummary = {
  range: Range;
  /** Days tracked: from the ledger's first entry when it falls inside the range, else the whole range. */
  days: number;
  entries: number;
  strip: RecapStrip;
  spent: number;
  /** Change vs the previous month (or year) as a signed fraction (-0.08 is 8% less). */
  change?: number;
  prevLabel?: string;
  top?: { name: string; pct: number };
  biggest?: { note: string; amount: number };
  keptPct?: number;
  noSpend: number;
  repeat?: { text: string; count: number };
  /** The year only: the spending personality for the poster's last row. */
  personality?: Archetype;
};

/** Which story a shared card belongs to, where the copy differs. Absent means a month. */
export type RecapScope = "month" | "year";

export type MonthCard =
  | { kind: "cover"; scope?: RecapScope; range: Range; entries: number; days: number; count: number; strip: RecapStrip }
  | { kind: "total"; scope?: RecapScope; amount: number; prev?: number; change?: number; prevLabel?: string; perDay: number; perMonth?: number }
  | { kind: "categories"; scope?: RecapScope; total: number; top: { id: string; name: string; amount: number; pct: number }[]; rest: { count: number; amount: number; pct: number }; lead: { count: number; avg: number } }
  /** `amount` is what the entry counted as spending (a transfer's amount plus its fee), which can differ from `tx.amount`. */
  | { kind: "biggest"; scope?: RecapScope; tx: Tx; amount: number; share: number; runnersUp: { note: string; amount: number; tx: Tx }[]; topShare: number }
  | { kind: "days"; perDay: { date: ISODate; amount: number; count: number }[]; busiest: ISODate; busiestNotes: string[]; noSpend: number; weekendShare: number; entriesPerDay: number }
  | { kind: "repeat"; note?: { text: string; count: number; amount: number }; nextNotes: { text: string; count: number }[]; account?: { id: string; name: string; share: number }; scheduled?: { amount: number; count: number } }
  | { kind: "changes"; scope?: RecapScope; prevLabel: string; movers: { id: string; name: string; before: number; after: number; pct?: number }[]; threshold: number }
  | { kind: "inout"; scope?: RecapScope; income: number; spent: number; keptPct: number; prevKeptPct?: number; budgets?: RecapBudgets; bestMonth?: { month: MonthKey; keptPct: number }; budgetMonths?: { held: number; total: number } }
  | { kind: "budgets"; scope?: RecapScope; budgets: RecapBudgets }
  | { kind: "closer"; scope?: RecapScope; summary: RecapSummary };

/** The cards only a year has (spec §5). */
export type YearCard =
  | { kind: "months"; perMonth: { month: MonthKey; amount: number }[]; priciest: MonthKey; lightest: MonthKey; ratio: number; aboveAvg: number; swing: number }
  | { kind: "top5"; notes: { text: string; count: number; amount: number }[]; everyDays?: number }
  | { kind: "calendar"; perDay: { date: ISODate; amount: number; count: number }[]; rows: { month: MonthKey; from: ISODate; days: number }[]; busiest: ISODate; busiestNotes: string[]; noSpend: number; streak: number; spendDay: { weekday: number; share: number } }
  | { kind: "clock"; perHour: number[]; peakHour: number; eveningShare: number; morningShare: number; first?: { time: string; note: string; date: ISODate }; timed: number; total: number }
  | { kind: "methods"; top: { id: string; name: string; amount: number; count: number }[]; share: number; mostEntries?: { id: string; name: string; count: number; avg: number } }
  | { kind: "new"; items: { kind: "category" | "account"; id: string; name: string; first: ISODate; count: number; amount: number }[] }
  | { kind: "personality"; archetype: Archetype; why: string; traits: { label: string; value: string; matched: boolean }[] };

export type RecapCard = MonthCard | YearCard;

/** A story: `month` is the month key, or the year as "YYYY" for a yearly recap. */
export type Recap = { month: MonthKey; cards: RecapCard[]; range: Range };

const longMonth = (k: MonthKey) => MONTH_LONG[parseMonthKey(k).m - 1];

/** Whether a month has enough expense entries for a recap. */
export function recapQualifies(snap: Snapshot, month: MonthKey): boolean {
  const settings = settingsOf(snap);
  if (!settings) return false;
  const r = monthRange(month, settings.monthStartDay);
  return statsEntries(snap, r.from, r.to, "expense").length >= RECAP_MIN_ENTRIES;
}

const localDate = (ms: number) => { const d = new Date(ms); return make(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

function budgetsOf(snap: Snapshot, month: MonthKey): RecapBudgets | undefined {
  const status = budgetStatus(snap, "monthly", month);
  if (!status) return undefined;
  // only budgets that already existed in that month: made by its end, or with that month's own
  // limit or carry-over set (a restored budget is new, but its overrides show it was there)
  const existed = (b: (typeof status.perCategory)[number]["budget"]) =>
    localDate(b._creationTime) <= status.range.to || b.overrides[month] !== undefined || (!!b.rolloverFrom && b.rolloverFrom <= month);
  const items = [...(status.total ? [status.total] : []), ...status.perCategory].filter((i) => existed(i.budget));
  if (!items.length) return undefined;
  const catName = new Map(snap.categories.map((c) => [c._id as string, c.name]));
  const over = items.filter((i) => i.remaining < 0).sort((a, b) => a.remaining - b.remaining);
  const worst = over[0];
  return {
    held: items.length - over.length,
    total: items.length,
    worst: worst ? { name: worst.budget.categoryId ? catName.get(worst.budget.categoryId) ?? "Uncategorised" : "Monthly budget", over: -worst.remaining } : undefined,
  };
}

type Entry = ReturnType<typeof statsEntries>[number];

/**
 * The first day of `range` the ledger covers: its start, or the date of the ledger's very first
 * entry when that falls inside it (a sign-up or an import part-way through the month or year).
 * Averages and no-spend days run from here, not over days before there was anything to record.
 */
function trackedFrom(snap: Snapshot, range: Range): ISODate {
  let first = range.to;
  for (const t of snap.transactions) if (t.date < first) first = t.date;
  return first > range.from ? first : range.from;
}

/**
 * Entries as the ledger has them, largest first. Stats splits a transfer with a fee into two
 * buckets; for ranking single spends the parts of one entry are added back together (the first
 * bucket, the transfer's, keeps the label).
 */
function rankedByTx(entries: Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const e of entries) {
    const m = byId.get(e.t._id);
    if (m) m.amount += e.amount; else byId.set(e.t._id, { ...e });
  }
  return [...byId.values()].sort((a, b) => b.amount - a.amount || a.t.date.localeCompare(b.t.date));
}

/** Notes grouped case-insensitively and trimmed, most frequent first (then by amount); empty notes skipped. */
function notesByCount(entries: Entry[]): { text: string; count: number; amount: number }[] {
  const notes = new Map<string, { text: string; count: number; amount: number }>();
  for (const e of entries) {
    const text = e.t.note.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    const n = notes.get(key) ?? { text, count: 0, amount: 0 };
    n.count += 1;
    n.amount += e.amount;
    notes.set(key, n);
  }
  return [...notes.values()].sort((a, b) => b.count - a.count || b.amount - a.amount);
}

/** The recap for a logical month, or null when the month has fewer than RECAP_MIN_ENTRIES expense entries. */
export function monthRecap(snap: Snapshot, month: MonthKey): Recap | null {
  return remembered(snap, `m:${month}`, () => buildMonthRecap(snap, month));
}

/**
 * Recaps are built from scratch, and the Recaps index asks for every finished month's and year's.
 * Each is kept while the tables it reads are the same ones (an op copies only the tables it
 * touches), so a note saved or a sync elsewhere does not rebuild three years of recaps.
 */
const RECAP_TABLES = ["settings", "transactions", "categories", "accounts", "accountGroups", "budgets"] as const;
const recapCache = new Map<string, { deps: unknown[]; recap: Recap | null }>();
function remembered(snap: Snapshot, key: string, build: () => Recap | null): Recap | null {
  const deps = RECAP_TABLES.map((t) => snap[t]);
  const hit = recapCache.get(key);
  if (hit && hit.deps.every((d, i) => d === deps[i])) return hit.recap;
  const recap = build();
  recapCache.set(key, { deps, recap });
  return recap;
}

function buildMonthRecap(snap: Snapshot, month: MonthKey): Recap | null {
  const settings = settingsOf(snap);
  if (!settings) return null;
  const range = monthRange(month, settings.monthStartDay);
  const entries = statsEntries(snap, range.from, range.to, "expense");
  if (entries.length < RECAP_MIN_ENTRIES) return null;
  const byCat = statsByCategory(snap, range.from, range.to, "expense");
  const total = byCat.total;
  const from = trackedFrom(snap, range);
  const days = diffDays(from, range.to) + 1;

  const prevKey = shiftMonthKey(month, -1);
  const prevRange = monthRange(prevKey, settings.monthStartDay);
  const prevEntries = statsEntries(snap, prevRange.from, prevRange.to, "expense");
  const prevCat = prevEntries.length ? statsByCategory(snap, prevRange.from, prevRange.to, "expense") : undefined;
  const prevLabel = longMonth(prevKey);

  const cards: RecapCard[] = [];
  const strip: RecapStrip = byCat.items.slice(0, 3).map(({ id, name, pct }) => ({ id, name, pct }));
  const cover: RecapCard = { kind: "cover", range, entries: entries.length, days, count: 0, strip };
  cards.push(cover);

  // 2 · total spent
  const change = prevCat && prevCat.total > 0 ? (total - prevCat.total) / prevCat.total : undefined;
  cards.push({ kind: "total", amount: total, prev: prevCat?.total, change, prevLabel: prevCat ? prevLabel : undefined, perDay: Math.round(total / days) });

  // 3 · where it went
  const nameOf = new Map(byCat.items.map((i) => [i.id, i.name]));
  if (byCat.items.length >= 2) {
    const top = byCat.items.slice(0, 3).map(({ id, name, amount, pct }) => ({ id, name, amount, pct }));
    const restItems = byCat.items.slice(3);
    const restAmount = restItems.reduce((s, i) => s + i.amount, 0);
    const leadCount = entries.filter((e) => e.bucket === top[0].id).length;
    cards.push({
      kind: "categories", total, top,
      rest: { count: restItems.length, amount: restAmount, pct: total ? restAmount / total : 0 },
      lead: { count: leadCount, avg: leadCount ? Math.round(top[0].amount / leadCount) : 0 },
    });
  }

  // 4 · biggest single spend (an empty note falls back to the category, as the ledger does)
  const ranked = rankedByTx(entries);
  const label = (e: (typeof entries)[number]) => e.t.note.trim() || (nameOf.get(e.bucket) ?? "Uncategorised");
  const biggest = ranked[0];
  const topThree = ranked.slice(0, 3);
  cards.push({
    kind: "biggest", tx: biggest.t, amount: biggest.amount, share: total ? biggest.amount / total : 0,
    runnersUp: ranked.slice(1, 3).map((e) => ({ note: label(e), amount: e.amount, tx: e.t })),
    topShare: total ? topThree.reduce((s, e) => s + e.amount, 0) / total : 0,
  });

  // 5 · your days
  const perDay: { date: ISODate; amount: number; count: number }[] = [];
  const dayIndex = new Map<ISODate, number>();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) { dayIndex.set(d, perDay.length); perDay.push({ date: d, amount: 0, count: 0 }); }
  let weekendAmount = 0;
  for (const e of entries) {
    const i = dayIndex.get(e.t.date);
    if (i === undefined) continue;
    perDay[i].amount += e.amount;
    perDay[i].count += 1;
    const wd = weekday(e.t.date);
    if (wd === 0 || wd === 6) weekendAmount += e.amount;
  }
  let busiest = perDay[0];
  for (const d of perDay) if (d.amount > busiest.amount) busiest = d;
  const noSpend = perDay.filter((d) => d.date >= from && d.amount === 0).length;
  // the two largest entries of the busiest day, by note, for "the flight and dinner out"
  const busiestNotes = ranked.filter((e) => e.t.date === busiest.date).slice(0, 2).map(label);
  cards.push({ kind: "days", perDay, busiest: busiest.date, busiestNotes, noSpend, weekendShare: total ? weekendAmount / total : 0, entriesPerDay: entries.length / days });

  // 6 · on repeat
  const byCount = notesByCount(entries);
  const topNote = byCount[0] && byCount[0].count >= RECAP_REPEAT_MIN ? byCount[0] : undefined;
  const scheduledEntries = entries.filter((e) => e.t.repeatId);
  const scheduled = scheduledEntries.length ? { amount: scheduledEntries.reduce((s, e) => s + e.amount, 0), count: scheduledEntries.length } : undefined;
  if (topNote || scheduled) {
    const byAccount = new Map<string, number>();
    for (const e of entries) byAccount.set(e.t.accountId, (byAccount.get(e.t.accountId) ?? 0) + e.amount);
    const [accId, accAmount] = [...byAccount.entries()].sort((a, b) => b[1] - a[1])[0];
    const accName = snap.accounts.find((a) => a._id === accId)?.name ?? "(deleted account)";
    cards.push({
      kind: "repeat",
      note: topNote,
      nextNotes: byCount.slice(1, 4).filter((n) => n.count >= 2).map(({ text, count }) => ({ text, count })),
      account: { id: accId, name: accName, share: total ? accAmount / total : 0 },
      scheduled,
    });
  }

  // 7 · what changed: categories that moved by more than RECAP_MOVER_SHARE of this month's total
  if (prevCat) {
    const threshold = total * RECAP_MOVER_SHARE;
    const before = new Map(prevCat.items.map((i) => [i.id, i]));
    const ids = new Set([...byCat.items.map((i) => i.id), ...prevCat.items.map((i) => i.id)]);
    const movers = [...ids]
      .map((id) => {
        const b = before.get(id)?.amount ?? 0;
        const a = nameOf.has(id) ? byCat.items.find((i) => i.id === id)!.amount : 0;
        return { id, name: nameOf.get(id) ?? before.get(id)!.name, before: b, after: a, pct: b > 0 ? (a - b) / b : undefined };
      })
      .filter((m) => Math.abs(m.after - m.before) > threshold)
      .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
      .slice(0, 4);
    if (movers.length) cards.push({ kind: "changes", prevLabel, movers, threshold });
  }

  // 8 · in vs out, with budgets; or budgets on their own when nothing came in
  const income = statsByCategory(snap, range.from, range.to, "income").total;
  const budgets = budgetsOf(snap, month);
  let keptPct: number | undefined;
  if (income > 0) {
    keptPct = Math.round(((income - total) / income) * 100);
    const prevIncome = prevCat ? statsByCategory(snap, prevRange.from, prevRange.to, "income").total : 0;
    const prevKeptPct = prevIncome > 0 ? Math.round(((prevIncome - prevCat!.total) / prevIncome) * 100) : undefined;
    cards.push({ kind: "inout", income, spent: total, keptPct, prevKeptPct, budgets });
  } else if (budgets) {
    cards.push({ kind: "budgets", budgets });
  }

  // 9 · closer
  const summary: RecapSummary = {
    range, days, entries: entries.length, strip,
    spent: total, change, prevLabel: prevCat ? prevLabel : undefined,
    top: byCat.items[0] ? { name: byCat.items[0].name, pct: byCat.items[0].pct } : undefined,
    biggest: { note: label(biggest), amount: biggest.amount },
    keptPct, noSpend,
    repeat: topNote ? { text: topNote.text, count: topNote.count } : undefined,
  };
  cards.push({ kind: "closer", summary });

  cover.count = cards.length;
  return { month, cards, range };
}


// ---- the year ----

/** The hour (0–23) of an entry's "HH:MM" time, when it has a valid one. */
function hourOf(t: Tx): number | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(t.time ?? "");
  if (!m) return undefined;
  const h = Number(m[1]);
  return h < 24 && Number(m[2]) < 60 ? h : undefined;
}

/** How many of a logical year's months qualify for a monthly recap, from one pass over the year's expense entries. */
function qualifyingMonths(entries: Entry[], year: number, monthStartDay: number): number {
  const counts = new Map<MonthKey, number>();
  for (const e of entries) {
    const k = monthKeyForDate(e.t.date, monthStartDay);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let n = 0;
  for (let m = 1; m <= 12; m++) if ((counts.get(monthKey(year, m)) ?? 0) >= RECAP_MIN_ENTRIES) n++;
  return n;
}

/** Whether a logical year has at least RECAP_YEAR_MIN_MONTHS months that qualify for a monthly recap. */
export function yearQualifies(snap: Snapshot, year: number): boolean {
  const settings = settingsOf(snap);
  if (!settings) return false;
  const r = yearRange(year, settings.monthStartDay);
  return qualifyingMonths(statsEntries(snap, r.from, r.to, "expense"), year, settings.monthStartDay) >= RECAP_YEAR_MIN_MONTHS;
}

/** "Food", "Household"… by default name, widened by categories whose name contains one of `words` (spec §4.3). */
function namedShare(items: { name: string; pct: number }[], defaultName: string, words: string[], topOnly = false): number {
  let share = 0;
  items.forEach((it, i) => {
    const lower = it.name.toLowerCase();
    if (lower === defaultName.toLowerCase() || ((!topOnly || i === 0) && words.some((w) => lower.includes(w)))) share += it.pct;
  });
  return share;
}

const pctText = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The recap for a logical year (12 logical months from month 1), or null when fewer than
 * RECAP_YEAR_MIN_MONTHS of its months qualify for a monthly recap. Spec §4.2 lists the cards.
 */
export function yearRecap(snap: Snapshot, year: number): Recap | null {
  return remembered(snap, `y:${year}`, () => buildYearRecap(snap, year));
}

function buildYearRecap(snap: Snapshot, year: number): Recap | null {
  const settings = settingsOf(snap);
  if (!settings) return null;
  const msd = settings.monthStartDay;
  const range = yearRange(year, msd);
  const entries = statsEntries(snap, range.from, range.to, "expense");
  const months = Array.from({ length: 12 }, (_, i) => monthKey(year, i + 1));
  const monthIndex = new Map(months.map((k, i) => [k, i]));
  const perMonth = months.map((month) => ({ month, amount: 0, count: 0 }));
  for (const e of entries) {
    const i = monthIndex.get(monthKeyForDate(e.t.date, msd));
    if (i !== undefined) { perMonth[i].amount += e.amount; perMonth[i].count += 1; }
  }
  if (perMonth.filter((m) => m.count >= RECAP_MIN_ENTRIES).length < RECAP_YEAR_MIN_MONTHS) return null;
  const byCat = statsByCategory(snap, range.from, range.to, "expense");
  const total = byCat.total;
  // a year the ledger joined part-way (an import that starts in October) is averaged over the months and days tracked
  const from = trackedFrom(snap, range);
  const days = diffDays(from, range.to) + 1;
  const monthsTracked = 12 - (monthIndex.get(monthKeyForDate(from, msd)) ?? 0);
  const nameOf = new Map(byCat.items.map((i) => [i.id, i.name]));
  const label = (e: Entry) => e.t.note.trim() || (nameOf.get(e.bucket) ?? "Uncategorised");

  const prevRange = yearRange(year - 1, msd);
  const prevEntries = statsEntries(snap, prevRange.from, prevRange.to, "expense");
  const prevCat = prevEntries.length ? statsByCategory(snap, prevRange.from, prevRange.to, "expense") : undefined;
  const prevLabel = String(year - 1);

  const cards: RecapCard[] = [];
  const strip: RecapStrip = byCat.items.slice(0, 3).map(({ id, name, pct }) => ({ id, name, pct }));
  const cover: RecapCard = { kind: "cover", scope: "year", range, entries: entries.length, days, count: 0, strip };
  cards.push(cover);

  // 2 · total spent
  const change = prevCat && prevCat.total > 0 ? (total - prevCat.total) / prevCat.total : undefined;
  cards.push({ kind: "total", scope: "year", amount: total, prev: prevCat?.total, change, prevLabel: prevCat ? prevLabel : undefined, perDay: Math.round(total / days), perMonth: Math.round(total / monthsTracked) });

  // 3 · month by month: the months with entries, against their own average
  const active = perMonth.filter((m) => m.count > 0);
  const monthAvg = active.length ? active.reduce((s, m) => s + m.amount, 0) / active.length : 0;
  const steady = active.length >= PERSONALITY.steadyMonths && monthAvg > 0 && active.every((m) => Math.abs(m.amount - monthAvg) / monthAvg <= PERSONALITY.steadyDeviation);
  const swing = monthAvg > 0 ? active.reduce((s, m) => s + Math.abs(m.amount - monthAvg), 0) / active.length / monthAvg : 0;
  if (active.length >= RECAP_YEAR_MONTHS_MIN) {
    let priciest = active[0], lightest = active[0];
    for (const m of active) { if (m.amount > priciest.amount) priciest = m; if (m.amount < lightest.amount) lightest = m; }
    cards.push({
      kind: "months", perMonth: perMonth.map(({ month, amount }) => ({ month, amount })),
      priciest: priciest.month, lightest: lightest.month, ratio: lightest.amount > 0 ? priciest.amount / lightest.amount : 0,
      aboveAvg: active.filter((m) => m.amount > monthAvg).length, swing,
    });
  }

  // 4 · where it went: the top five
  if (byCat.items.length >= 2) {
    const top = byCat.items.slice(0, 5).map(({ id, name, amount, pct }) => ({ id, name, amount, pct }));
    const restItems = byCat.items.slice(5);
    const restAmount = restItems.reduce((s, i) => s + i.amount, 0);
    const leadCount = entries.filter((e) => e.bucket === top[0].id).length;
    cards.push({
      kind: "categories", scope: "year", total, top,
      rest: { count: restItems.length, amount: restAmount, pct: total ? restAmount / total : 0 },
      lead: { count: leadCount, avg: leadCount ? Math.round(top[0].amount / leadCount) : 0 },
    });
  }

  // 5 · your top five notes
  const byCount = notesByCount(entries);
  if (byCount.filter((n) => n.count >= RECAP_YEAR_TOP5_MIN_COUNT).length >= RECAP_YEAR_TOP5_MIN_NOTES) {
    const notes = byCount.filter((n) => n.count >= 2).slice(0, 5);
    cards.push({ kind: "top5", notes, everyDays: days / notes[0].count });
  }

  // 6 · biggest single spend, with the ten largest in the footnote
  const ranked = rankedByTx(entries);
  const biggest = ranked[0];
  const topTen = ranked.slice(0, PERSONALITY.bigDayCount);
  const bigDayShare = total ? topTen.reduce((s, e) => s + e.amount, 0) / total : 0;
  cards.push({
    kind: "biggest", scope: "year", tx: biggest.t, amount: biggest.amount, share: total ? biggest.amount / total : 0,
    runnersUp: ranked.slice(1, 3).map((e) => ({ note: label(e), amount: e.amount, tx: e.t })),
    topShare: bigDayShare,
  });

  // 7 · the year, day by day
  const perDay: { date: ISODate; amount: number; count: number }[] = [];
  const dayIndex = new Map<ISODate, number>();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) { dayIndex.set(d, perDay.length); perDay.push({ date: d, amount: 0, count: 0 }); }
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const e of entries) {
    const i = dayIndex.get(e.t.date);
    if (i === undefined) continue;
    perDay[i].amount += e.amount;
    perDay[i].count += 1;
    byWeekday[weekday(e.t.date)] += e.amount;
  }
  let busiest = perDay[0];
  for (const d of perDay) if (d.amount > busiest.amount) busiest = d;
  const noSpend = perDay.filter((d) => d.date >= from && d.amount === 0).length;
  let streak = 0, run = 0;
  for (const d of perDay) { run = d.count ? run + 1 : 0; if (run > streak) streak = run; }
  const spendWeekday = byWeekday.indexOf(Math.max(...byWeekday));
  const weekendShare = total ? (byWeekday[0] + byWeekday[6]) / total : 0;
  const busiestNotes = ranked.filter((e) => e.t.date === busiest.date).slice(0, 2).map(label);
  cards.push({
    kind: "calendar", perDay,
    rows: months.map((month) => { const r = monthRange(month, msd); return { month, from: r.from, days: diffDays(r.from, r.to) + 1 }; }),
    busiest: busiest.date, busiestNotes, noSpend, streak,
    spendDay: { weekday: spendWeekday, share: total ? byWeekday[spendWeekday] / total : 0 },
  });

  // 8 · on the clock, only when at least half the entries carry a time
  const timed = entries.map((e) => ({ e, hour: hourOf(e.t) })).filter((x): x is { e: Entry; hour: number } => x.hour !== undefined);
  const timedEnough = entries.length > 0 && timed.length >= entries.length * RECAP_YEAR_TIMED_SHARE;
  const nightShare = timed.length ? timed.filter((x) => x.hour >= PERSONALITY.nightHour).length / timed.length : 0;
  if (timedEnough) {
    const perHour = Array.from({ length: 24 }, () => 0);
    for (const x of timed) perHour[x.hour] += 1;
    const peakHour = perHour.indexOf(Math.max(...perHour));
    const first = [...timed].sort((a, b) => a.e.t.time!.localeCompare(b.e.t.time!) || a.e.t.date.localeCompare(b.e.t.date))[0];
    cards.push({
      kind: "clock", perHour, peakHour,
      eveningShare: timed.filter((x) => x.hour >= 19).length / timed.length,
      morningShare: timed.filter((x) => x.hour < 12).length / timed.length,
      first: { time: first.e.t.time!, note: label(first.e), date: first.e.t.date },
      timed: timed.length, total: entries.length,
    });
  }

  // 9 · paid with: payment methods by amount, when more than one was used
  const byAccount = new Map<string, { id: string; name: string; amount: number; count: number }>();
  for (const e of entries) {
    const id = e.t.accountId as string;
    const m = byAccount.get(id) ?? { id, name: snap.accounts.find((a) => a._id === id)?.name ?? "(deleted account)", amount: 0, count: 0 };
    m.amount += e.amount;
    m.count += 1;
    byAccount.set(id, m);
  }
  const methods = [...byAccount.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
  if (methods.length >= 2) {
    const mostEntries = [...methods].sort((a, b) => b.count - a.count || b.amount - a.amount)[0];
    cards.push({
      kind: "methods", top: methods.slice(0, 4), share: total ? methods[0].amount / total : 0,
      mostEntries: { id: mostEntries.id, name: mostEntries.name, count: mostEntries.count, avg: Math.round(mostEntries.amount / mostEntries.count) },
    });
  }

  // 10 · what changed since last year: movers above RECAP_YEAR_MOVER_SHARE of this year's total
  if (prevCat) {
    const threshold = total * RECAP_YEAR_MOVER_SHARE;
    const before = new Map(prevCat.items.map((i) => [i.id, i]));
    const ids = new Set([...byCat.items.map((i) => i.id), ...prevCat.items.map((i) => i.id)]);
    const movers = [...ids]
      .map((id) => {
        const b = before.get(id)?.amount ?? 0;
        const a = nameOf.has(id) ? byCat.items.find((i) => i.id === id)!.amount : 0;
        return { id, name: nameOf.get(id) ?? before.get(id)!.name, before: b, after: a, pct: b > 0 ? (a - b) / b : undefined };
      })
      .filter((m) => Math.abs(m.after - m.before) > threshold)
      .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
      .slice(0, 4);
    if (movers.length) cards.push({ kind: "changes", scope: "year", prevLabel, movers, threshold });
  }

  // 11 · new this year: categories and methods with no entries before the year and at least RECAP_YEAR_NEW_MIN in it
  if (prevEntries.length) {
    const dayBefore = addDays(range.from, -1);
    const bucketsBefore = new Set(statsEntries(snap, "0000-00-00", dayBefore, "expense").map((e) => e.bucket));
    const accountsBefore = new Set<string>();
    for (const t of snap.transactions) if (t.date <= dayBefore) { accountsBefore.add(t.accountId); if (t.toAccountId) accountsBefore.add(t.toAccountId); }
    const firsts = new Map<string, { first: ISODate; count: number; amount: number }>();
    const note = (key: string, e: Entry) => {
      const f = firsts.get(key) ?? { first: e.t.date, count: 0, amount: 0 };
      if (e.t.date < f.first) f.first = e.t.date;
      f.count += 1;
      f.amount += e.amount;
      firsts.set(key, f);
    };
    for (const e of entries) { note(`c:${e.bucket}`, e); note(`a:${e.t.accountId}`, e); }
    const items: Extract<YearCard, { kind: "new" }>["items"] = [];
    for (const it of byCat.items) {
      const f = firsts.get(`c:${it.id}`);
      if (it.id === "none" || it.id === "fees" || it.id.startsWith("transfer:") || bucketsBefore.has(it.id) || !f || f.count < RECAP_YEAR_NEW_MIN) continue;
      items.push({ kind: "category", id: it.id, name: it.name, ...f });
    }
    for (const m of methods) {
      const f = firsts.get(`a:${m.id}`);
      if (accountsBefore.has(m.id) || !f || f.count < RECAP_YEAR_NEW_MIN) continue;
      items.push({ kind: "account", id: m.id, name: m.name, ...f });
    }
    items.sort((a, b) => a.first.localeCompare(b.first) || b.amount - a.amount);
    if (items.length) cards.push({ kind: "new", items: items.slice(0, 3) });
  }

  // 12 · in vs out, with the best month and the months within budget; or budgets on their own
  const incomeEntries = statsEntries(snap, range.from, range.to, "income");
  const income = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const monthBudgets = months.map((k) => budgetsOf(snap, k));
  // out of the months that had a budget, not twelve: budgets set in October are three months, not "3 of 12"
  const budgetMonths = monthBudgets.some(Boolean) ? { held: monthBudgets.filter((b) => b && b.held === b.total).length, total: monthBudgets.filter(Boolean).length } : undefined;
  let keptPct: number | undefined;
  if (income > 0) {
    keptPct = Math.round(((income - total) / income) * 100);
    const prevIncome = prevCat ? statsByCategory(snap, prevRange.from, prevRange.to, "income").total : 0;
    const prevKeptPct = prevIncome > 0 ? Math.round(((prevIncome - prevCat!.total) / prevIncome) * 100) : undefined;
    const incomeByMonth = perMonth.map(() => 0);
    for (const e of incomeEntries) { const i = monthIndex.get(monthKeyForDate(e.t.date, msd)); if (i !== undefined) incomeByMonth[i] += e.amount; }
    let bestMonth: { month: MonthKey; keptPct: number } | undefined;
    perMonth.forEach((m, i) => {
      if (incomeByMonth[i] <= 0) return;
      const k = Math.round(((incomeByMonth[i] - m.amount) / incomeByMonth[i]) * 100);
      if (!bestMonth || k > bestMonth.keptPct) bestMonth = { month: m.month, keptPct: k };
    });
    cards.push({ kind: "inout", scope: "year", income, spent: total, keptPct, prevKeptPct, bestMonth, budgetMonths });
  } else if (budgetMonths) {
    cards.push({ kind: "budgets", scope: "year", budgets: { held: budgetMonths.held, total: budgetMonths.total } });
  }

  // 13 · spending personality: fixed rules on figures computed once (spec §4.3)
  const scheduledShare = total ? entries.filter((e) => e.t.repeatId).reduce((s, e) => s + e.amount, 0) / total : 0;
  const homeShare = namedShare(byCat.items, "Household", HOME_WORDS, true);
  const foodShare = namedShare(byCat.items, "Food", FOOD_WORDS);
  const travelShare = namedShare(byCat.items, "Travel", TRAVEL_WORDS);
  // every rule's figures, each with its own verdict; a rule matches when any of its figures does
  type Trait = { label: string; value: string; matched: boolean };
  const rules: { archetype: Archetype; traits: Trait[] }[] = [
    {
      archetype: "The Planner",
      traits: [
        { label: "Scheduled entries", value: `${pctText(scheduledShare)} of spend`, matched: scheduledShare >= PERSONALITY.plannerScheduledShare },
        ...(budgetMonths ? [{ label: "Months within budget", value: `${budgetMonths.held} of ${budgetMonths.total}`, matched: budgetMonths.held >= PERSONALITY.plannerBudgetMonths }] : []),
      ],
    },
    { archetype: "The Homebody", traits: [{ label: "Household", value: `${pctText(homeShare)} of spend`, matched: homeShare >= PERSONALITY.homebodyShare }] },
    { archetype: "The Foodie", traits: [{ label: "Food", value: `${pctText(foodShare)} of spend`, matched: foodShare >= PERSONALITY.foodieShare }] },
    { archetype: "The Explorer", traits: [{ label: "Travel and transport", value: `${pctText(travelShare)} of spend`, matched: travelShare >= PERSONALITY.explorerShare }] },
    { archetype: "The Weekender", traits: [{ label: "Weekend share", value: pctText(weekendShare), matched: weekendShare >= PERSONALITY.weekenderShare }] },
    { archetype: "The Night Owl", traits: timedEnough ? [{ label: "After 9 pm", value: `${pctText(nightShare)} of entries`, matched: nightShare >= PERSONALITY.nightOwlShare }] : [] },
    { archetype: "The Big-Day Spender", traits: [{ label: "Top ten entries", value: `${pctText(bigDayShare)} of the year`, matched: bigDayShare >= PERSONALITY.bigDayShare }] },
    { archetype: "The Steady Hand", traits: active.length >= PERSONALITY.steadyMonths ? [{ label: "Month swing", value: `±${pctText(swing)}`, matched: steady }] : [] },
  ];
  const archetype: Archetype = rules.find((r) => r.traits.some((t) => t.matched))?.archetype ?? "The All-Rounder";
  const all = rules.flatMap((r) => r.traits);
  const traits = [...all.filter((t) => t.matched), ...all.filter((t) => !t.matched)].slice(0, 4);
  cards.push({ kind: "personality", archetype, why: PERSONALITY_WHY[archetype], traits });

  // 14 · closer
  const summary: RecapSummary = {
    range, days, entries: entries.length, strip,
    spent: total, change, prevLabel: prevCat ? prevLabel : undefined,
    top: byCat.items[0] ? { name: byCat.items[0].name, pct: byCat.items[0].pct } : undefined,
    biggest: { note: label(biggest), amount: biggest.amount },
    keptPct, noSpend,
    repeat: byCount[0] ? { text: byCount[0].text, count: byCount[0].count } : undefined,
    personality: archetype,
  };
  cards.push({ kind: "closer", scope: "year", summary });

  cover.count = cards.length;
  return { month: String(year), cards, range };
}

/**
 * The previous logical year, when `today` is within the first RECAP_YEAR_NUDGE_DAYS days of logical
 * month 1 and that year qualifies for a recap; otherwise null.
 */
export function yearRecapNudge(snap: Snapshot, today: ISODate): number | null {
  const settings = settingsOf(snap);
  if (!settings) return null;
  const current = monthKeyForDate(today, settings.monthStartDay);
  const { y, m } = parseMonthKey(current);
  if (m !== 1) return null;
  const day = diffDays(monthRange(current, settings.monthStartDay).from, today) + 1;
  if (day > RECAP_YEAR_NUDGE_DAYS) return null;
  return yearQualifies(snap, y - 1) ? y - 1 : null;
}

/**
 * The previous logical month, when `today` is within the first RECAP_NUDGE_DAYS days of the current
 * one and that month qualifies for a recap; otherwise null.
 */
export function recapNudge(snap: Snapshot, today: ISODate): MonthKey | null {
  const settings = settingsOf(snap);
  if (!settings) return null;
  const current = monthKeyForDate(today, settings.monthStartDay);
  const day = diffDays(monthRange(current, settings.monthStartDay).from, today) + 1;
  if (day > RECAP_NUDGE_DAYS) return null;
  const prev = shiftMonthKey(current, -1);
  return recapQualifies(snap, prev) ? prev : null;
}

// ---- drilling into a card ----

/**
 * What a tap on part of a card asks for: the entries behind a category block, a day's bar, a note,
 * a payment method… always inside the recap's own range (a day or a month narrows it).
 */
export type RecapDrill =
  | { kind: "category"; id: string }
  /** The categories after the card's top ones. */
  | { kind: "rest"; exclude: string[] }
  | { kind: "day"; date: ISODate }
  | { kind: "month"; month: MonthKey }
  | { kind: "note"; text: string }
  | { kind: "account"; id: string }
  | { kind: "hour"; hour: number }
  | { kind: "scheduled" }
  | { kind: "income" }
  /** The `count` largest single entries, largest first. */
  | { kind: "largest"; count: number };

/**
 * The entries behind a drill, counted as the card counted them: `amount` is what they add up to on
 * the card (a transfer's fee included), `txs` each entry once, newest first ("largest": largest first).
 */
export function recapDrill(snap: Snapshot, range: Range, drill: RecapDrill): { txs: Tx[]; amount: number } {
  const msd = settingsOf(snap)?.monthStartDay ?? 1;
  let { from, to } = range;
  if (drill.kind === "day") from = to = drill.date;
  if (drill.kind === "month") ({ from, to } = monthRange(drill.month, msd));
  if (from < range.from) from = range.from;
  if (to > range.to) to = range.to;
  if (from > to) return { txs: [], amount: 0 };
  const all = statsEntries(snap, from, to, drill.kind === "income" ? "income" : "expense");
  let picked: Entry[];
  switch (drill.kind) {
    case "category": picked = all.filter((e) => e.bucket === drill.id); break;
    case "rest": { const out = new Set(drill.exclude); picked = all.filter((e) => !out.has(e.bucket)); break; }
    case "note": { const key = drill.text.trim().toLowerCase(); picked = all.filter((e) => e.t.note.trim().toLowerCase() === key); break; }
    case "account": picked = all.filter((e) => e.t.accountId === drill.id); break;
    case "hour": picked = all.filter((e) => hourOf(e.t) === drill.hour); break;
    case "scheduled": picked = all.filter((e) => e.t.repeatId); break;
    case "largest": {
      const top = rankedByTx(all).slice(0, drill.count);
      return { txs: top.map((e) => e.t), amount: top.reduce((s, e) => s + e.amount, 0) };
    }
    default: picked = all;
  }
  const seen = new Set<string>();
  const txs: Tx[] = [];
  for (const e of picked) if (!seen.has(e.t._id)) { seen.add(e.t._id); txs.push(e.t); }
  txs.sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime);
  return { txs, amount: picked.reduce((s, e) => s + e.amount, 0) };
}

/** Whole-number percent with its sign, for "8% less" / "12% more". */
export function pctChange(change: number): { pct: number; less: boolean } {
  return { pct: Math.round(Math.abs(change) * 100), less: change < 0 };
}

const shortMonth = (label: string) => label.slice(0, 3);

/**
 * The plain-text summary behind "Copy summary". A month is three lines:
 *   September 2026 · UnMoney
 *   Spent ₹84,310 (8% less than Aug) · Top: Food 31% · Biggest: Flight to Goa ₹18,400
 *   Kept 30% of income · 5 no-spend days · "Coffee" ×22
 * A year is four:
 *   2026 · UnMoney
 *   Spent ₹9,84,310 (6% more than 2025)
 *   Top: Food 27% · Biggest: Flights to Lisbon ₹48,000 · Most logged: "Coffee" ×226
 *   Kept 34% of income · 58 no-spend days · The Planner
 */
export function recapText(s: RecapSummary, label: string, fmt: (minor: number) => string, scope: RecapScope = "month"): string {
  let spent = `Spent ${fmt(s.spent)}`;
  if (s.change !== undefined && s.prevLabel) {
    const { pct, less } = pctChange(s.change);
    spent += ` (${pct === 0 ? "same as" : `${pct}% ${less ? "less" : "more"} than`} ${scope === "year" ? s.prevLabel : shortMonth(s.prevLabel)})`;
  }
  const top = s.top ? `Top: ${s.top.name} ${Math.round(s.top.pct * 100)}%` : "";
  const biggest = s.biggest ? `Biggest: ${s.biggest.note} ${fmt(s.biggest.amount)}` : "";
  // more out than in reads as "Spent 120% of income", never as a negative share kept
  const kept = s.keptPct === undefined ? "" : s.keptPct < 0 ? `Spent ${100 - s.keptPct}% of income` : `Kept ${s.keptPct}% of income`;
  const noSpend = `${s.noSpend} no-spend ${s.noSpend === 1 ? "day" : "days"}`;
  if (scope === "year") {
    const line3 = [top, biggest, s.repeat ? `Most logged: "${s.repeat.text}" ×${s.repeat.count}` : ""].filter(Boolean).join(" · ");
    const line4 = [kept, noSpend, s.personality ?? ""].filter(Boolean).join(" · ");
    return `${label} · UnMoney\n${spent}\n${line3}\n${line4}`;
  }
  const line2 = [spent, top, biggest].filter(Boolean).join(" · ");
  const line3 = [kept, noSpend, s.repeat ? `"${s.repeat.text}" ×${s.repeat.count}` : ""].filter(Boolean).join(" · ");
  return `${label} · UnMoney\n${line2}\n${line3}`;
}

/** One line of the Recaps index: a logical month and whether its recap can be opened. */
export type RecapIndexMonthRow = {
  kind: "month";
  month: MonthKey;
  /** Expense entries in the month, counted as Stats counts them. */
  entries: number;
  spent: number;
  /** "ready": open it; "thin": below RECAP_MIN_ENTRIES; "current": the month is not over yet (`readyOn` is the day after it ends). */
  state: "ready" | "thin" | "current";
  cards?: number;
  readyOn?: ISODate;
};
/** A finished logical year's row, listed before its months. "thin": fewer than RECAP_YEAR_MIN_MONTHS months qualify. */
export type RecapIndexYearRow = { kind: "year"; year: number; entries: number; spent: number; months: number; state: "ready" | "thin"; cards?: number };
export type RecapIndexRow = RecapIndexMonthRow | RecapIndexYearRow;

/**
 * Every logical month with an expense entry, newest first, plus the current month, so the Recaps
 * page can list what is there to open; every finished year with an entry gets a row before its
 * months. Built on demand from the local data, like the recaps.
 */
export function recapIndex(snap: Snapshot, today: ISODate): RecapIndexRow[] {
  const settings = settingsOf(snap);
  if (!settings) return [];
  const current = monthKeyForDate(today, settings.monthStartDay);
  const currentYear = parseMonthKey(current).y;
  const byMonth = new Map<MonthKey, { entries: number; spent: number }>();
  byMonth.set(current, { entries: 0, spent: 0 });
  for (const e of statsEntries(snap, "0000-00-00", "9999-99-99", "expense")) {
    const k = monthKeyForDate(e.t.date, settings.monthStartDay);
    if (k > current) continue; // later installments: not a month to recap yet
    const m = byMonth.get(k) ?? { entries: 0, spent: 0 };
    m.entries += 1;
    m.spent += e.amount;
    byMonth.set(k, m);
  }
  const months: RecapIndexMonthRow[] = [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, m]) => {
      if (month >= current) return { kind: "month", month, ...m, state: "current", readyOn: addDays(monthRange(month, settings.monthStartDay).to, 1) };
      if (m.entries < RECAP_MIN_ENTRIES) return { kind: "month", month, ...m, state: "thin" };
      return { kind: "month", month, ...m, state: "ready", cards: monthRecap(snap, month)?.cards.length };
    });
  const out: RecapIndexRow[] = [];
  let lastYear: number | undefined;
  for (const row of months) {
    const y = parseMonthKey(row.month).y;
    if (y !== lastYear && y < currentYear) {
      const ofYear = months.filter((r) => parseMonthKey(r.month).y === y);
      const qualifying = ofYear.filter((r) => r.state === "ready").length;
      const entries = ofYear.reduce((s, r) => s + r.entries, 0);
      const spent = ofYear.reduce((s, r) => s + r.spent, 0);
      if (qualifying >= RECAP_YEAR_MIN_MONTHS) out.push({ kind: "year", year: y, entries, spent, months: qualifying, state: "ready", cards: yearRecap(snap, y)?.cards.length });
      else out.push({ kind: "year", year: y, entries, spent, months: qualifying, state: "thin" });
    }
    lastYear = y;
    out.push(row);
  }
  return out;
}
