import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useApp } from "./app";
import { useView } from "./store";
import { todayISO } from "../../shared/dates";
import { kindsOf } from "../../shared/ledger";
import { monthKeyForDate, monthRange, shiftMonthKey, type MonthKey } from "../../shared/period";

/** The month in the URL (?month=YYYY-MM), defaulting to today's logical month. */
export function useMonthParam(): { month: MonthKey; setMonth: (m: MonthKey) => void; range: { from: string; to: string }; shift: (n: number) => void } {
  const { settings } = useApp();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? monthKeyForDate(todayISO(), settings.monthStartDay);
  const setMonth = (m: MonthKey) => {
    const next = new URLSearchParams(params);
    next.set("month", m);
    setParams(next, { replace: true });
  };
  return { month, setMonth, range: monthRange(month, settings.monthStartDay), shift: (n) => setMonth(shiftMonthKey(month, n)) };
}

/**
 * Every logical month that has at least one transaction (optionally only for one account) or note, for greying out
 * empty months in the picker, plus what was spent in each (minor units; empty for notes).
 */
export function useMonthsWithData(source: "transactions" | "notes", accountId?: string): { months: Set<MonthKey>; spent: Map<MonthKey, number> } {
  const { settings, ledger } = useApp();
  const snap = useView();
  return useMemo(() => {
    const months = new Set<MonthKey>();
    const spent = new Map<MonthKey, number>();
    if (source === "notes") {
      for (const n of snap.notes) months.add(monthKeyForDate(n.date, settings.monthStartDay));
      return { months, spent };
    }
    const rows = accountId ? snap.transactions.filter((t) => t.accountId === accountId || t.toAccountId === accountId) : snap.transactions;
    for (const t of rows) {
      const key = monthKeyForDate(t.date, settings.monthStartDay);
      months.add(key);
      spent.set(key, (spent.get(key) ?? 0) + kindsOf(t, ledger).expense);
    }
    return { months, spent };
  }, [snap, source, accountId, settings.monthStartDay, ledger]);
}
