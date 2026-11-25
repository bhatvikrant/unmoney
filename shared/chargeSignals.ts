/**
 * Odd charges, spotted by rules on the person's own entries (no network, no model): a regular
 * charge whose price stepped up, and a payment that looks taken twice. Read models only, shown on
 * Bills & subscriptions beside recurringSuggestions (docs/specs/upcoming-bills.md). Both stay
 * quiet when unsure: a wrong alarm is worse than a missed one.
 */
import type { Doc } from "../convex/_generated/dataModel";
import { addDays, diffDays } from "./dates";
import type { Snapshot } from "./ops";
import { normNote } from "./categoryLint";

type Tx = Doc<"transactions">;

export type PriceRise = {
  /** What "Got it" remembers (settings.dismissedRecurring): the note and the new price, so a later rise shows again. */
  key: string;
  /** The last charge at the old price. */
  before: Tx;
  /** The first charge at the new price: its month is when the price went up. */
  after: Tx;
};

export type DoubleCharge = {
  /** What "Not a double" remembers (settings.dismissedRecurring): the note, the day and the amount. */
  key: string;
  first: Tx;
  second: Tx;
};

/** How far back a charge's history is read (as recurringSuggestions). */
const LOOKBACK_DAYS = 400;
/** Only what happened in the last two months is reported: older news is stale. */
const RECENT_DAYS = 62;
/** A price counts as settled once it was charged this many times running, to the last minor unit: a bill that varies (electricity) never is. */
const MIN_BEFORE = 3;
/** Smaller rises (rounding, a tax change) are not worth a line. */
const MIN_RISE = 1.05;
/** Regular means monthly or slower, with no gap much longer than another (24 to 38 days passes, as in recurringSuggestions). */
const MIN_GAP_DAYS = 24;
const GAP_SPREAD = 1.6;

/** The currency an entry was charged in, when it is not the main one. */
const foreign = (t: Tx) => (t.subAmount && t.subCurrency ? t.subCurrency : "");
/** What was charged, in that currency: a foreign price is compared as charged, so a moving exchange rate is not a rise. Below zero for a refund. */
export const charged = (t: Tx) => (foreign(t) && t.subAmount) || t.amount;

/** The step up at the end of a note's charges (oldest first), when there is a clear one. */
function priceRise(paid: Tx[]): { before: Tx; after: Tx } | undefined {
  const n = paid.length;
  const now = charged(paid[n - 1]);
  // the charges at the latest price, and before them the ones at the price it replaced
  let i = n - 1;
  while (i > 0 && charged(paid[i - 1]) === now) i--;
  if (i === 0) return;
  const was = charged(paid[i - 1]);
  let j = i - 1;
  while (j > 0 && charged(paid[j - 1]) === was) j--;
  if (i - j < MIN_BEFORE || now < was * MIN_RISE) return;
  // Seen once, double or more is likelier a yearly plan or two months in one entry than a price; once it comes round again it is the price
  if (n - i === 1 && now >= was * 2) return;
  let min = Infinity, max = 0;
  for (let k = j + 1; k < n; k++) {
    const gap = diffDays(paid[k - 1].date, paid[k].date);
    min = Math.min(min, gap);
    max = Math.max(max, gap);
  }
  if (min < MIN_GAP_DAYS || max > min * GAP_SPREAD) return;
  return { before: paid[i - 1], after: paid[i] };
}

/** Two entries that read as one payment: not ones a schedule added on purpose, nor ones shared out on UnSplit. */
const samePayment = (a: Tx, b: Tx) =>
  a.accountId === b.accountId && a.amount === b.amount && charged(a) === charged(b) && !a.repeatId && !b.repeatId && !a.split && !b.split;

/**
 * Price rises and double charges among the expenses of the last two months, newest first, without
 * the ones the person dismissed. Entries are told apart by note (and currency), so entries with
 * no note are left out, like transfers, SIP payments and instalments.
 *
 * - A price rise: a charge that came round on a steady interval at one price, three times or more,
 *   and now costs at least 5% more, with no refund since.
 * - A double charge: two entries with the same note, payment method and amount on the same day or
 *   a day apart, when that note has no other two payments that close in its history (two coffees
 *   a day is a habit), and no refund of that amount since.
 */
export function chargeSignals(snap: Snapshot, today: string): { rises: PriceRise[]; doubles: DoubleCharge[] } {
  // keys start in capitals, which a normalised note (what else this setting holds) never has
  const dismissed = new Set(snap.settings[0]?.dismissedRecurring ?? []);
  const since = addDays(today, -LOOKBACK_DAYS);
  const recent = addDays(today, -RECENT_DAYS);
  const byNote = new Map<string, Tx[]>();
  for (const t of snap.transactions) {
    if (t.type !== "expense" || t.sipId || t.installmentIndex || t.date <= since || t.date > today) continue;
    const note = normNote(t.note);
    if (!note) continue;
    const key = `${note}|${foreign(t)}`;
    const list = byNote.get(key);
    if (list) list.push(t);
    else byNote.set(key, [t]);
  }
  const rises: PriceRise[] = [];
  const doubles: DoubleCharge[] = [];
  for (const [note, all] of byNote) {
    // most notes have nothing recent: skip them before sorting
    if (!all.some((t) => t.date > recent)) continue;
    all.sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime);
    const paid = all.filter((t) => charged(t) > 0);
    const refundSince = (date: string, amount?: number) => all.some((t) => t.date >= date && (amount === undefined ? charged(t) < 0 : t.amount === -amount));

    const rise = paid.length ? priceRise(paid) : undefined;
    if (rise && rise.after.date > recent && !refundSince(rise.after.date)) {
      const key = `PRICE|${note}|${charged(rise.after)}`;
      if (!dismissed.has(key)) rises.push({ key, ...rise });
    }

    let close = 0;
    let pair: [Tx, Tx] | undefined;
    for (let k = 1; k < paid.length; k++) {
      if (diffDays(paid[k - 1].date, paid[k].date) > 1) continue;
      close++;
      if (paid[k].date > recent && samePayment(paid[k - 1], paid[k])) pair = [paid[k - 1], paid[k]];
    }
    // shortcut: three of the same in a row count as a habit and stay quiet, as one close pair is all a first double charge has
    if (close === 1 && pair && !refundSince(pair[0].date, pair[0].amount)) {
      const key = `TWICE|${note}|${pair[1].date}|${pair[1].amount}`;
      if (!dismissed.has(key)) doubles.push({ key, first: pair[0], second: pair[1] });
    }
  }
  return {
    rises: rises.sort((a, b) => b.after.date.localeCompare(a.after.date)),
    doubles: doubles.sort((a, b) => b.second.date.localeCompare(a.second.date)),
  };
}
