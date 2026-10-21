import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { budgetCrossings, currentBudgetLevels, type BudgetAlertItem } from "../../shared/views";
import { diffDays } from "../../shared/dates";
import { useView } from "./store";
import { useApp } from "./app";
import { useToday } from "./today";

const PERIOD_WORD = { weekly: "Weekly", monthly: "Monthly", yearly: "Annual" } as const;

/**
 * Budget alerts (docs/specs/budget-alerts.md): when a change pushes a budget of the current period
 * past 80% or over (an entry saved here, a quick add, a Gmail draft, a change synced from another
 * device), a toast says so. Returns whether any budget is over now, for the dot on the Stats tab.
 */
export function useBudgetAlerts(): boolean {
  const view = useView();
  const today = useToday();
  const nav = useNavigate();
  const { categoryById, fmt } = useApp();
  const levels = useMemo(() => currentBudgetLevels(view, today), [view, today]);
  const prev = useRef<BudgetAlertItem[] | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = levels;
    // the first reading (opening the app) is the baseline: nothing to say about it
    if (!before) return;
    for (const it of budgetCrossings(before, levels)) {
      const name = `${it.budget.categoryId ? categoryById.get(it.budget.categoryId)?.name ?? "A" : PERIOD_WORD[it.period]} budget`;
      const left = diffDays(today, it.range.to) + 1;
      const text = it.level === 2
        ? it.remaining < 0 ? `${name} is over by ${fmt(-it.remaining)}` : `${name} is used up`
        : `${name}: ${Math.round((it.spent / it.limit) * 100)}% used · ${left} ${left === 1 ? "day" : "days"} left`;
      const show = it.level === 2 ? toast.warning : toast;
      show(text, { id: `budget:${it.budget._id}`, duration: 6000, action: { label: "View", onClick: () => nav(`/budget?period=${it.period}`) } });
    }
  }, [levels, today, categoryById, fmt, nav]);
  return levels.some((i) => i.level === 2);
}
