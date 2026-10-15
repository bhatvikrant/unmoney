import { formatMoney, type CurrencyFormat } from "../../shared/money";
import { MONTH_SHORT, WEEKDAY_SHORT, parts, type ISODate } from "../../shared/dates";
import { parseMonthKey, type MonthKey } from "../../shared/period";

export { formatMoney };
export type { CurrencyFormat };

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
