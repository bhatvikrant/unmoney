/**
 * The answer to a question asked in Search, worked out on the device from the entries the filters
 * matched. Claude only picked how, from fixed lists (SearchAnswer in searchAi.ts); every number here
 * comes from the entries, counted the way Stats counts them (kindsOf): a refund comes off its
 * category, a transfer is spending only where the ledger says so, its fee is spending, and an entry
 * paid in another currency counts at its amount in the main one.
 */
import { MONTH_LONG, MONTH_SHORT, parts, weekday } from "./dates";
import { kindsOf } from "./ledger";
import type { Snapshot } from "./ops";
import { monthKeyForDate, monthRange, parseMonthKey, shiftMonthKey, yearRange } from "./period";
import { WEEKDAYS, type SearchAnswer } from "./searchAi";
import { entryBuckets, ledgerOf, settingsOf, type SearchArgs, type Tx } from "./views";

export type Answered = {
  /** One sentence, written here from the figures. */
  text: string;
  /** The ranked list under it. Empty for a single figure. */
  rows: { key: string; label: string; value: number }[];
  /** What the values are: money spent, money received, a net amount that can be either, or a number of entries. */
  kind: "expense" | "income" | "auto" | "count";
};

const monthName = (k: string) => `${MONTH_LONG[parseMonthKey(k).m - 1]} ${parseMonthKey(k).y}`;
const dayName = (d: string) => `${MONTH_SHORT[parts(d).m - 1]} ${parts(d).d}, ${parts(d).y}`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * `txs` are the entries the search matched and `filters` what matched them (for the words "on Food in
 * October 2026" and the months an average covers). `money` formats minor units. Null when there is
 * nothing to work out: no entries, or no entry of the kind asked for to call the largest.
 */
export function answerSearch(snap: Snapshot, txs: Tx[], a: SearchAnswer, filters: SearchArgs, money: (minor: number) => string, today: string): Answered | null {
  if (!txs.length) return null;
  const ledger = ledgerOf(snap);
  const msd = settingsOf(snap)?.monthStartDay ?? 1;
  const wsd = settingsOf(snap)?.weekStartDay ?? 0;
  const catName = new Map(snap.categories.map((c) => [c._id as string, c.name]));
  const accName = new Map(snap.accounts.map((c) => [c._id as string, c.name]));
  const catIds = new Set(catName.keys());
  const kind = a.measure === "count" ? "count" : a.of === "spent" ? "expense" : a.of === "received" ? "income" : "auto";

  // As in Stats, an entry that counts for nothing here (a plain transfer, when asking what was spent)
  // is left out of the figure. A count is of every entry matched.
  const counted = txs.map((t) => {
    const k = kindsOf(t, ledger);
    return { t, amount: a.of === "spent" ? k.expense : a.of === "received" ? k.income : k.income - k.expense };
  }).filter((e) => a.measure === "count" || e.amount);
  const total = counted.reduce((sum, e) => sum + e.amount, 0);

  // The months an average or a by-month list covers, newest first: from the first day asked for to the
  // last, but not from before the ledger's first entry (a new ledger isn't averaged down, as in
  // budgetAverage) and not past today unless matched entries are.
  const dates = txs.map((t) => t.date).sort();
  const start = [filters.from ?? dates[0], snap.transactions.reduce((m, t) => (t.date < m ? t.date : m), dates[0])].sort()[1];
  const now = [today, dates[dates.length - 1]].sort()[1];
  const end = [filters.to ?? now, now].sort()[0];
  const months: string[] = [];
  for (let k = monthKeyForDate(end, msd); k >= monthKeyForDate(start, msd); k = shiftMonthKey(k, -1)) months.push(k);

  const valueOf = (amount: number, n: number) =>
    a.measure === "count" ? n : a.measure === "average" ? (n ? Math.round(amount / n) : 0) : a.measure === "monthlyAverage" ? Math.round(amount / months.length) : amount;
  const show = (v: number) => (a.measure === "count" ? String(v) : money(v));
  const calendar = a.by === "month" || a.by === "weekday";
  const limit = a.limit ?? (calendar ? 12 : 5);

  // the filters in words, for the sentence: " on Food in October 2026"
  const named = (ids: string[] | undefined, names: Map<string, string>, many: string) => {
    const found = (ids ?? []).map((id) => names.get(id)).filter((n): n is string => !!n);
    return found.length > 2 ? `${found.length} ${many}` : found.join(" and ");
  };
  const cats = named(filters.categoryIds, catName, "categories");
  const accs = named(filters.accountIds, accName, "payment methods");
  const { from, to } = filters;
  const month = from && monthKeyForDate(from, msd);
  const year = from && yearRange(parts(from).y, msd);
  const period = from && to
    ? (month && monthRange(month, msd).from === from && monthRange(month, msd).to === to ? `in ${monthName(month)}`
      : year && year.from === from && year.to === to ? `in ${parts(from).y}`
      : `from ${dayName(from)} to ${dayName(to)}`)
    : from ? `since ${dayName(from)}` : to ? `until ${dayName(to)}` : "";
  const where = [cats && `${a.of === "received" ? "from" : "on"} ${cats}`, filters.q && `matching "${filters.q}"`, accs && `with ${accs}`, filters.tag && `tagged #${filters.tag}`, period]
    .filter(Boolean).map((p) => ` ${p}`).join("");

  if (a.measure === "largest") {
    // a refund is money back, not a small expense
    const top = counted.filter((e) => e.amount > 0).sort((x, y) => (a.order === "lowest" ? x.amount - y.amount : y.amount - x.amount)).slice(0, limit)
      .map(({ t, amount }) => ({ key: t._id as string, label: `${t.note.trim() || catName.get(t.categoryId ?? "") || "No note"}, ${dayName(t.date)}`, value: amount }));
    if (!top.length) return null;
    return { kind, rows: top, text: `Your ${a.order === "lowest" ? "smallest" : "largest"} ${a.of === "received" ? "income" : "expense"}${where} is ${money(top[0].value)}: ${top[0].label}.` };
  }

  if (a.by === "none") {
    const v = valueOf(total, counted.length);
    const said = a.of === "net" ? `${v < 0 ? "spent" : "received"} ${money(Math.abs(v))} more than you ${v < 0 ? "received" : "spent"}` : `${a.of} ${money(v)}`;
    const entries = count(counted.length, "entry", "entries");
    return {
      kind, rows: [],
      text: a.measure === "count" ? `You have ${entries}${where}.`
        : a.measure === "average" ? `You ${said} an entry on average${where}, across ${entries}.`
        : a.measure === "monthlyAverage" ? `You ${said} a month on average${where}, over ${count(months.length, "month", "months")}.`
        : `You ${said}${where}, across ${entries}.`,
    };
  }

  const rows = new Map<string, { key: string; label: string; amount: number; entries: number }>();
  const add = (key: string, label: string, amount: number, entries: number) => {
    const r = rows.get(key) ?? { key, label, amount: 0, entries: 0 };
    rows.set(key, { ...r, amount: r.amount + amount, entries: r.entries + entries });
  };
  // every month and weekday in the range has a row, so one with nothing in it can be the lowest
  if (a.by === "month") for (const k of months) add(k, monthName(k), 0, 0);
  if (a.by === "weekday") for (let i = 0; i < 7; i++) add(String((wsd + i) % 7), WEEKDAYS[(wsd + i) % 7], 0, 0);
  const bucketName = (bucket: string, t: Tx) =>
    bucket.startsWith("transfer:") ? `Transfer to ${accName.get(t.toAccountId ?? "") ?? "account"}` : bucket === "fees" ? "Fees" : catName.get(bucket) ?? "Uncategorised";
  for (const { t, amount } of counted) {
    if (a.by === "category") {
      // Stats' own rows: a main category (its subcategories included), Uncategorised, "Transfer to X", and a transfer's fee under Fees
      const split = entryBuckets(t, Math.abs(amount), catIds);
      for (const b of split) add(b.bucket, bucketName(b.bucket, t), amount < 0 ? -b.amount : b.amount, 1);
      // a transfer that moves no spending has no Stats row, but is still an entry to count
      if (!split.length) add(`transfer:${t.toAccountId ?? ""}`, bucketName("transfer:", t), amount, 1);
    } else if (a.by === "month") add(monthKeyForDate(t.date, msd), monthName(monthKeyForDate(t.date, msd)), amount, 1);
    else if (a.by === "weekday") add(String(weekday(t.date)), WEEKDAYS[weekday(t.date)], amount, 1);
    else if (a.by === "account") add(t.accountId, accName.get(t.accountId) ?? "Payment method", amount, 1);
    // the same note typed in another case is the same shop or person
    else add(t.note.trim().toLowerCase(), t.note.trim() || "No note", amount, 1);
  }
  const list = [...rows.values()].map((r) => ({ key: r.key, label: r.label, value: valueOf(r.amount, r.entries) }));
  if (!list.length) return null;
  // "time" keeps months newest first and weekdays in the person's week; it means nothing for the other groups
  const inTime = a.order === "time" && calendar;
  if (!inTime) list.sort((x, y) => (a.order === "lowest" ? x.value - y.value : y.value - x.value));

  const what = a.of === "spent" ? "spending" : a.of === "received" ? "income" : "income less spending";
  const title = a.measure === "count" ? "Entries" : a.measure === "average" ? `Average ${what} an entry` : a.measure === "monthlyAverage" ? `Average ${what} a month` : what[0].toUpperCase() + what.slice(1);
  const lead = inTime
    ? `${show(valueOf(total, counted.length))} ${a.measure === "total" || a.measure === "count" ? "in all" : "overall"}`
    : `${list[0].label} is ${a.order === "lowest" ? "lowest" : "highest"} at ${show(list[0].value)}`;
  return { kind, rows: list.slice(0, limit), text: `${title} by ${a.by === "account" ? "payment method" : a.by}${where}: ${lead}.` };
}
