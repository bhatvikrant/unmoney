import { useSearchParams } from "react-router";
import { useApp } from "@/lib/app";
import { addDays, parts, todayISO } from "../../../shared/dates";
import { monthKey, monthKeyForDate, monthRange, parseMonthKey, shiftMonthKey, weekRange, yearRange, type Range } from "../../../shared/period";
import { monthLabel, dateLabel } from "@/lib/format";

export type StatPeriod = "weekly" | "monthly" | "yearly" | "custom";

/** Period selector state shared by Stats and Budget: ?period=&month=&week=&year=&from=&to= */
export function useStatPeriod() {
  const { settings } = useApp();
  const [sp, setSp] = useSearchParams();
  const period = (sp.get("period") as StatPeriod) || "monthly";
  const today = todayISO();
  const month = sp.get("month") ?? monthKeyForDate(today, settings.monthStartDay);
  const week = sp.get("week") ?? weekRange(today, settings.weekStartDay).from;
  const year = Number(sp.get("year") ?? parts(today).y);
  const from = sp.get("from") ?? monthRange(month, settings.monthStartDay).from;
  const to = sp.get("to") ?? monthRange(month, settings.monthStartDay).to;
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) n.set(k, v); setSp(n, { replace: true }); };
  let range: Range;
  let label: string;
  let key: string;
  if (period === "weekly") { range = weekRange(week, settings.weekStartDay); label = `${dateLabel(range.from)} – ${dateLabel(range.to)}`; key = week; }
  else if (period === "yearly") { range = yearRange(year, settings.monthStartDay); label = String(year); key = String(year); }
  else if (period === "custom") { range = { from, to }; label = `${dateLabel(from, { year: true })} – ${dateLabel(to, { year: true })}`; key = `${from}:${to}`; }
  else { range = monthRange(month, settings.monthStartDay); label = monthLabel(month); key = month; }
  /** Show the period with this key: a week's first day, a month key or a year, matching `period`. */
  const go = (k: string) => {
    if (period === "weekly") set({ week: k });
    else if (period === "yearly") set({ year: k });
    else set({ month: k });
  };
  /** 12 trailing periods for trend charts (months for monthly/custom, weeks for weekly, years for yearly). */
  const trailing = (): { key: string; from: string; to: string; label: string }[] => {
    if (period === "weekly") return Array.from({ length: 12 }, (_, i) => { const w = addDays(week, -7 * (11 - i)); const r = weekRange(w, settings.weekStartDay); return { key: w, ...r, label: dateLabel(r.from) }; });
    if (period === "yearly") return Array.from({ length: 6 }, (_, i) => { const y = year - (5 - i); return { key: String(y), ...yearRange(y, settings.monthStartDay), label: String(y) }; });
    const base = period === "monthly" ? month : monthKeyForDate(to, settings.monthStartDay);
    return Array.from({ length: 12 }, (_, i) => { const k = shiftMonthKey(base, -(11 - i)); const { m } = parseMonthKey(k); return { key: k, ...monthRange(k, settings.monthStartDay), label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] }; });
  };
  return { period, setPeriod: (p: StatPeriod) => set({ period: p }), range, label, key, go, set, month, trailing, monthKey, from, to };
}
