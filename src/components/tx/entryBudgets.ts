import { useMemo } from "react";
import { useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { dateLabel, LOCALE_DECIMAL, monthLabel } from "@/lib/format";
import { useToday } from "@/lib/today";
import { budgetsAt, budgetsForCategory, type BudgetAlertItem } from "../../../shared/views";
import { kindsOf, type TxLike } from "../../../shared/ledger";
import { evaluateExpression, toMinor } from "../../../shared/money";
import { monthKeyForDate, periodKey } from "../../../shared/period";

const PERIOD_WORD = { weekly: "week", monthly: "month", yearly: "year" } as const;
const PERIOD_NAME = { weekly: "Weekly", monthly: "Monthly", yearly: "Annual" } as const;

export type EntryBudget = { key: string; name: string; when: string; item: BudgetAlertItem; amount: number | null };

/**
 * The budgets an expense being entered counts against, in the periods holding its date, and what
 * this entry adds to them (as budgets count it: a card purchase shown when the card is paid adds
 * nothing yet). `without` is the entry being edited, left out so it isn't counted twice. Also, for
 * the category picker, each main category's budget left in those periods.
 */
export function useEntryBudgets(f: { type: string; categoryId?: string; date: string; amount: string; accountId?: string; refund: boolean }, without?: string) {
  const view = useView();
  const { settings, ledger } = useApp();
  const expense = f.type === "expense";
  const all = useMemo(() => (expense ? budgetsAt(view, f.date, without) : []), [view, expense, f.date, without]);
  const byCategory = useMemo(() => {
    const m = new Map<string, BudgetAlertItem>();
    for (const i of all) if (i.budget.categoryId && !m.has(i.budget.categoryId)) m.set(i.budget.categoryId, i);
    return m;
  }, [all]);
  const typed = evaluateExpression(f.amount, LOCALE_DECIMAL);
  const minor = typed === null ? null : toMinor(Math.abs(typed), settings.decimals) * (f.refund ? -1 : 1);
  const counted = minor === null || !f.accountId ? minor
    : kindsOf({ _id: "", type: "expense", date: f.date, amount: minor, accountId: f.accountId } as TxLike, ledger).expense;
  const label = useBudgetLabel();
  // the category's own budget (its shortest period first), for the small bar beside it; a total budget isn't the category's
  const own = f.categoryId ? budgetsForCategory(all, view, f.categoryId).find((i) => i.budget.categoryId) : undefined;
  const pill: EntryBudget | null = own ? { key: own.budget._id, ...label(own), item: own, amount: counted } : null;
  return { pill, byCategory };
}

/** A budget's name ("Food budget", "Monthly budget") and its period ("this month", "Sep 2026", "week of Oct 5"). */
export function useBudgetLabel() {
  const today = useToday();
  const { settings, categoryById } = useApp();
  return (item: Pick<BudgetAlertItem, "budget" | "period" | "range">) => {
    const p = item.period;
    const current = today >= item.range.from && today <= item.range.to;
    const when = current ? `this ${PERIOD_WORD[p]}`
      : p === "monthly" ? monthLabel(monthKeyForDate(item.range.from, settings.monthStartDay))
      : p === "weekly" ? `week of ${dateLabel(item.range.from)}`
      : periodKey("yearly", item.range.from, settings.monthStartDay, settings.weekStartDay);
    const name = item.budget.categoryId ? `${categoryById.get(item.budget.categoryId)?.name ?? "Category"} budget` : `${PERIOD_NAME[p]} budget`;
    return { name, when };
  };
}
