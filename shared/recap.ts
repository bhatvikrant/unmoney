/**
 * The monthly recap: a run of story cards about one finished logical month, computed from the
 * same functions as the Stats tab (statsEntries, statsByCategory, budgetStatus) so every number
 * on a card is one the user can find on Stats. Pure: nothing is stored for it.
 * See docs/specs/monthly-recap.md.
 */
import type { Snapshot } from "./ops";
import { addDays, diffDays, MONTH_LONG, weekday, type ISODate } from "./dates";
import { monthKeyForDate, monthRange, parseMonthKey, shiftMonthKey, type MonthKey, type Range } from "./period";
import { budgetStatus, settingsOf, statsByCategory, statsEntries, type Tx } from "./views";

/** A month needs this many expense entries before it gets a recap. */
export const RECAP_MIN_ENTRIES = 5;
/** The ledger nudge shows for this many days from the start of the logical month. */
export const RECAP_NUDGE_DAYS = 7;
/** A category is a "mover" when it changed by more than this share of the month's total. */
export const RECAP_MOVER_SHARE = 0.05;
/** A note has to appear this often to be "on repeat". */
export const RECAP_REPEAT_MIN = 3;

export type RecapBudgets = { held: number; total: number; worst?: { name: string; over: number } };

/** The month's colour signature: the top three categories by share, in Stats order; everything else is the grey rest. */
export type RecapStrip = { id: string; name: string; pct: number }[];

/** The six tiles of the closer card and the lines of the text summary. */
export type RecapSummary = {
  range: Range;
  entries: number;
  strip: RecapStrip;
  spent: number;
  /** Change vs the previous month as a signed fraction (-0.08 is 8% less). */
  change?: number;
  prevLabel?: string;
  top?: { name: string; pct: number };
  biggest?: { note: string; amount: number };
  keptPct?: number;
  noSpend: number;
  repeat?: { text: string; count: number };
};

export type RecapCard =
  | { kind: "cover"; range: Range; entries: number; days: number; count: number; strip: RecapStrip }
  | { kind: "total"; amount: number; prev?: number; change?: number; prevLabel?: string; perDay: number }
  | { kind: "categories"; total: number; top: { id: string; name: string; amount: number; pct: number }[]; rest: { count: number; amount: number; pct: number }; lead: { count: number; avg: number } }
  | { kind: "biggest"; tx: Tx; share: number; runnersUp: { note: string; amount: number; tx: Tx }[]; topShare: number }
  | { kind: "days"; perDay: { date: ISODate; amount: number; count: number }[]; busiest: ISODate; busiestNotes: string[]; noSpend: number; weekendShare: number; entriesPerDay: number }
  | { kind: "repeat"; note?: { text: string; count: number; amount: number }; nextNotes: { text: string; count: number }[]; account?: { name: string; share: number }; scheduled?: { amount: number; count: number } }
  | { kind: "changes"; prevLabel: string; movers: { id: string; name: string; before: number; after: number; pct?: number }[]; threshold: number }
  | { kind: "inout"; income: number; spent: number; keptPct: number; prevKeptPct?: number; budgets?: RecapBudgets }
  | { kind: "budgets"; budgets: RecapBudgets }
  | { kind: "closer"; summary: RecapSummary };

export type Recap = { month: MonthKey; cards: RecapCard[]; range: Range };

const longMonth = (k: MonthKey) => MONTH_LONG[parseMonthKey(k).m - 1];

/** Whether a month has enough expense entries for a recap. */
export function recapQualifies(snap: Snapshot, month: MonthKey): boolean {
  const settings = settingsOf(snap);
  if (!settings) return false;
  const r = monthRange(month, settings.monthStartDay);
  return statsEntries(snap, r.from, r.to, "expense").length >= RECAP_MIN_ENTRIES;
}

function budgetsOf(snap: Snapshot, month: MonthKey): RecapBudgets | undefined {
  const status = budgetStatus(snap, "monthly", month);
  if (!status) return undefined;
  const items = [...(status.total ? [status.total] : []), ...status.perCategory];
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

/** The recap for a logical month, or null when the month has fewer than RECAP_MIN_ENTRIES expense entries. */
export function monthRecap(snap: Snapshot, month: MonthKey): Recap | null {
  const settings = settingsOf(snap);
  if (!settings) return null;
  const range = monthRange(month, settings.monthStartDay);
  const entries = statsEntries(snap, range.from, range.to, "expense");
  if (entries.length < RECAP_MIN_ENTRIES) return null;
  const byCat = statsByCategory(snap, range.from, range.to, "expense");
  const total = byCat.total;
  const days = diffDays(range.from, range.to) + 1;

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
  const ranked = [...entries].sort((a, b) => b.amount - a.amount || a.t.date.localeCompare(b.t.date));
  const label = (e: (typeof entries)[number]) => e.t.note.trim() || (nameOf.get(e.bucket) ?? "Uncategorised");
  const biggest = ranked[0];
  const topThree = ranked.slice(0, 3);
  cards.push({
    kind: "biggest", tx: biggest.t, share: total ? biggest.amount / total : 0,
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
  const noSpend = perDay.filter((d) => d.amount === 0).length;
  // the two largest entries of the busiest day, by note, for "the flight and dinner out"
  const busiestNotes = entries.filter((e) => e.t.date === busiest.date).sort((a, b) => b.amount - a.amount).slice(0, 2).map(label);
  cards.push({ kind: "days", perDay, busiest: busiest.date, busiestNotes, noSpend, weekendShare: total ? weekendAmount / total : 0, entriesPerDay: entries.length / days });

  // 6 · on repeat: notes grouped case-insensitively and trimmed; empty notes skipped
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
  const byCount = [...notes.values()].sort((a, b) => b.count - a.count || b.amount - a.amount);
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
      account: { name: accName, share: total ? accAmount / total : 0 },
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
    range, entries: entries.length, strip,
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

/** Whole-number percent with its sign, for "8% less" / "12% more". */
export function pctChange(change: number): { pct: number; less: boolean } {
  return { pct: Math.round(Math.abs(change) * 100), less: change < 0 };
}

const shortMonth = (label: string) => label.slice(0, 3);

/**
 * The plain-text summary behind "Copy summary":
 *   September 2026 · UnMoney
 *   Spent ₹84,310 (8% less than Aug) · Top: Food 31% · Biggest: Flight to Goa ₹18,400
 *   Kept 30% of income · 5 no-spend days · "Coffee" ×22
 */
export function recapText(s: RecapSummary, monthLabel: string, fmt: (minor: number) => string): string {
  let spent = `Spent ${fmt(s.spent)}`;
  if (s.change !== undefined && s.prevLabel) {
    const { pct, less } = pctChange(s.change);
    spent += ` (${pct === 0 ? "same as" : `${pct}% ${less ? "less" : "more"} than`} ${shortMonth(s.prevLabel)})`;
  }
  const line2 = [spent, s.top ? `Top: ${s.top.name} ${Math.round(s.top.pct * 100)}%` : "", s.biggest ? `Biggest: ${s.biggest.note} ${fmt(s.biggest.amount)}` : ""].filter(Boolean).join(" · ");
  const line3 = [
    s.keptPct !== undefined ? `Kept ${s.keptPct}% of income` : "",
    `${s.noSpend} no-spend ${s.noSpend === 1 ? "day" : "days"}`,
    s.repeat ? `"${s.repeat.text}" ×${s.repeat.count}` : "",
  ].filter(Boolean).join(" · ");
  return `${monthLabel} · UnMoney\n${line2}\n${line3}`;
}

/** One line of the Recaps index: a logical month and whether its recap can be opened. */
export type RecapIndexRow = {
  month: MonthKey;
  /** Expense entries in the month, counted as Stats counts them. */
  entries: number;
  spent: number;
  /** "ready": open it; "thin": below RECAP_MIN_ENTRIES; "current": the month is not over yet (`readyOn` is the day after it ends). */
  state: "ready" | "thin" | "current";
  cards?: number;
  readyOn?: ISODate;
};

/**
 * Every logical month with an expense entry, newest first, plus the current month, so the Recaps
 * page can list what is there to open. Built on demand from the local data, like the recaps.
 */
export function recapIndex(snap: Snapshot, today: ISODate): RecapIndexRow[] {
  const settings = settingsOf(snap);
  if (!settings) return [];
  const current = monthKeyForDate(today, settings.monthStartDay);
  const byMonth = new Map<MonthKey, { entries: number; spent: number }>();
  byMonth.set(current, { entries: 0, spent: 0 });
  for (const e of statsEntries(snap, "0000-00-00", "9999-99-99", "expense")) {
    const k = monthKeyForDate(e.t.date, settings.monthStartDay);
    const m = byMonth.get(k) ?? { entries: 0, spent: 0 };
    m.entries += 1;
    m.spent += e.amount;
    byMonth.set(k, m);
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, m]) => {
      if (month >= current) return { month, ...m, state: "current" as const, readyOn: addDays(monthRange(month, settings.monthStartDay).to, 1) };
      if (m.entries < RECAP_MIN_ENTRIES) return { month, ...m, state: "thin" as const };
      return { month, ...m, state: "ready" as const, cards: monthRecap(snap, month)?.cards.length };
    });
}
