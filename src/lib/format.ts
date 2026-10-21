import { formatMoney, type CurrencyFormat, type DecimalMark } from "../../shared/money";
import type { ImportFormat } from "../../shared/ops";
import { MONTH_SHORT, WEEKDAY_SHORT, diffDays, parts, type ISODate } from "../../shared/dates";
import { parseMonthKey, type MonthKey } from "../../shared/period";

export { formatMoney };
export type { CurrencyFormat };

/** The decimal mark of the user's locale: "," in most of Europe and Latin America, "." elsewhere. */
export const LOCALE_DECIMAL: DecimalMark = new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === "decimal")?.value === "," ? "," : ".";

/** Whether the user's locale writes the day before the month (31/12) or after it (12/31). */
const LOCALE_DATE_ORDER: ImportFormat["dateOrder"] = (() => {
  const parts = new Intl.DateTimeFormat().formatToParts(new Date(2000, 11, 31)).map((p) => p.type);
  return parts.indexOf("day") < parts.indexOf("month") ? "dmy" : "mdy";
})();

export const LOCALE_FORMAT: ImportFormat = { dateOrder: LOCALE_DATE_ORDER, decimal: LOCALE_DECIMAL };

/** A number as the user would type it into an amount field (12,5 in German), read back with LOCALE_DECIMAL. */
export function localNumber(n: number): string {
  return String(n).replace(".", LOCALE_DECIMAL);
}

/** An amount in minor units, ready to put in an input. */
export function amountInput(minor: number, decimals: number): string {
  return localNumber(minor / 10 ** decimals);
}

export function monthLabel(key: MonthKey): string {
  const { y, m } = parseMonthKey(key);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

export function dateLabel(d: ISODate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const { y, m, d: day } = parts(d);
  let s = `${MONTH_SHORT[m - 1]} ${day}`;
  if (opts.year) s += `, ${y}`;
  if (opts.weekday) s += ` (${WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]})`;
  return s;
}

export function shortRange(from: ISODate, to: ISODate): string {
  return `${dateLabel(from)} – ${dateLabel(to)}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** "Reconciled today", "… yesterday", "… 3 days ago", or a date once it is a month old. */
export function reconciledLabel(date: ISODate, today: ISODate): string {
  const days = diffDays(date, today);
  if (days <= 0) return "Reconciled today";
  if (days === 1) return "Reconciled yesterday";
  if (days < 31) return `Reconciled ${days} days ago`;
  return `Reconciled ${dateLabel(date, { year: parts(date).y !== parts(today).y })}`;
}
