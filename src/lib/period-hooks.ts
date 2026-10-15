import { useSearchParams } from "react-router";
import { useApp } from "./app";
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
