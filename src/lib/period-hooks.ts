import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useApp } from "./app";
import { useView } from "./store";
import { addDays, todayISO } from "../../shared/dates";
import { kindsOf } from "../../shared/ledger";
import { monthKeyForDate, monthRange, neighbourPeriod, shiftMonthKey, weekRange, yearRange, type MonthKey } from "../../shared/period";

/** The month in the URL (?month=YYYY-MM), defaulting to today's logical month. */
export function useMonthParam(): { month: MonthKey; setMonth: (m: MonthKey) => void; range: { from: string; to: string } } {
  const { settings } = useApp();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? monthKeyForDate(todayISO(), settings.monthStartDay);
  const setMonth = (m: MonthKey) => {
    const next = new URLSearchParams(params);
    next.set("month", m);
    setParams(next, { replace: true });
  };
  return { month, setMonth, range: monthRange(month, settings.monthStartDay) };
}

export type MonthsWithData = {
  /** Every logical month with at least one entry. */
  months: Set<MonthKey>;
  /** What was spent in each month (minor units; empty for notes). */
  spent: Map<MonthKey, number>;
  /** Every date with at least one entry, sorted ascending, for stepping between periods of any length. */
  dates: string[];
};

/**
 * Every logical month that has at least one transaction (optionally only for one account) or note, for greying out
 * empty months in the picker and stopping the arrows at the months that have something in them.
 */
export function useMonthsWithData(source: "transactions" | "notes", accountId?: string): MonthsWithData {
  const { settings, ledger } = useApp();
  const snap = useView();
  return useMemo(() => {
    const months = new Set<MonthKey>();
    const spent = new Map<MonthKey, number>();
    const dateSet = new Set<string>();
    if (source === "notes") {
      for (const n of snap.notes) { months.add(monthKeyForDate(n.date, settings.monthStartDay)); dateSet.add(n.date); }
      return { months, spent, dates: [...dateSet].sort() };
    }
    const rows = accountId ? snap.transactions.filter((t) => t.accountId === accountId || t.toAccountId === accountId) : snap.transactions;
    for (const t of rows) {
      const key = monthKeyForDate(t.date, settings.monthStartDay);
      months.add(key);
      dateSet.add(t.date);
      spent.set(key, (spent.get(key) ?? 0) + kindsOf(t, ledger).expense);
    }
    return { months, spent, dates: [...dateSet].sort() };
  }, [snap, source, accountId, settings.monthStartDay, ledger]);
}

export type PeriodKind = "weekly" | "monthly" | "yearly";

/**
 * The periods with something in them on either side of `key` (a week's first day, a month key or a year), or the
 * current one. Undefined where there is none, so the arrow, shortcut and swipe for that direction do nothing.
 */
export function usePeriodNeighbours(period: PeriodKind, key: string, dates: string[]): { prev?: string; next?: string } {
  const { settings } = useApp();
  const today = todayISO();
  return useMemo(() => {
    const rangeOf = period === "weekly" ? (k: string) => weekRange(k, settings.weekStartDay)
      : period === "yearly" ? (k: string) => yearRange(Number(k), settings.monthStartDay)
      : (k: string) => monthRange(k, settings.monthStartDay);
    const shift = period === "weekly" ? (k: string, n: number) => addDays(k, 7 * n)
      : period === "yearly" ? (k: string, n: number) => String(Number(k) + n)
      : shiftMonthKey;
    return {
      prev: neighbourPeriod(key, -1, dates, today, rangeOf, shift),
      next: neighbourPeriod(key, 1, dates, today, rangeOf, shift),
    };
  }, [period, key, dates, today, settings.weekStartDay, settings.monthStartDay]);
}
