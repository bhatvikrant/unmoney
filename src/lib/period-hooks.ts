import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useApp } from "./app";
import { useView } from "./store";
import { todayISO } from "../../shared/dates";
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

/** Every logical month that has at least one transaction (optionally only for one account) or note, for greying out empty months in the picker. */
export function useMonthsWithData(source: "transactions" | "notes", accountId?: string): Set<MonthKey> {
  const { settings } = useApp();
  const snap = useView();
  return useMemo(() => {
    const set = new Set<MonthKey>();
    const rows = source === "notes" ? snap.notes : accountId ? snap.transactions.filter((t) => t.accountId === accountId || t.toAccountId === accountId) : snap.transactions;
    for (const r of rows) set.add(monthKeyForDate(r.date, settings.monthStartDay));
    return set;
  }, [snap, source, accountId, settings.monthStartDay]);
}
