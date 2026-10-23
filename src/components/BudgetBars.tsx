import { useApp } from "@/lib/app";
import { Money } from "@/components/shell/Money";
import { cn } from "@/lib/utils";
import { budgetLevel } from "../../shared/views";

export type BudgetItem = { budget: { _id: string; categoryId?: string; period: string }; limit: number; spent: number; remaining: number; isOverride?: boolean; carry?: number };

export function BudgetBar({ item, label, elapsed, onClick, due = 0 }: {
  item: BudgetItem; label: string; elapsed: number; onClick?: () => void;
  /** Bills scheduled before the period ends, not added yet: drawn lighter after what was spent. */
  due?: number;
}) {
  const { fmt } = useApp();
  const ratio = item.limit > 0 ? item.spent / item.limit : item.spent > 0 ? 1 : 0;
  // a zero (or carried-below-zero) budget is over as soon as anything is spent
  const over = item.spent > 0 && item.spent > item.limit;
  const warn = !over && ratio > elapsed + 0.0001;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper type={onClick ? "button" : undefined} onClick={onClick} className={cn("w-full text-left px-4 py-3 border-b last:border-b-0", onClick && "hover:bg-accent/40")}>
      <div className="flex items-end justify-between text-sm mb-1">
        <div>
          <div className="text-xs text-muted-foreground">{label}{item.isOverride ? " · this period" : ""}{item.carry ? <> · <Money amount={item.carry} sign muted /> carried over</> : null}</div>
          <div className="font-medium tabular">{fmt(item.limit)} <span className="text-xs font-normal text-muted-foreground">budget</span></div>
        </div>
        <div className="text-right text-xs">
          <div className={cn("font-medium", over ? "text-expense" : warn ? "text-expense/80" : "text-income")}>{Math.round(ratio * 100)}%</div>
        </div>
      </div>
      <div className="relative h-5 rounded bg-muted overflow-hidden" role="progressbar" aria-label={`${label} budget used`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={`${Math.round(ratio * 100)}% used, ${Math.round(elapsed * 100)}% of the period gone${over ? ", over budget" : warn ? ", ahead of pace" : ""}`}>
        <div className="flex h-full">
          <div className={cn("h-full rounded transition-all", over ? "bg-expense" : warn ? "bg-expense/70" : "bg-income")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          {due > 0 && ratio < 1 ? <div className={cn("h-full", item.spent + due > item.limit ? "bg-expense/35" : "bg-foreground/25")} style={{ width: `${Math.min(100 - ratio * 100, (due / Math.max(1, item.limit)) * 100)}%` }} title="Bills still due" /> : null}
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(100, elapsed * 100)}%` }} title="Today" />
      </div>
      <div className="flex justify-between text-xs mt-1">
        <span><Money amount={item.spent} kind={over ? "expense" : "income"} /> <span className="text-muted-foreground">spent</span></span>
        <span className="text-muted-foreground"><Money amount={Math.abs(item.remaining)} className={item.remaining < 0 ? "text-expense" : "text-budget-left"} /> {item.remaining < 0 ? "over" : "left"}</span>
      </div>
      {due > 0 ? (
        <div className="mt-0.5 text-xs text-muted-foreground">
          <Money amount={due} muted /> in bills still due · {item.remaining - due < 0
            ? <span className="text-expense"><Money amount={due - item.remaining} /> over after them</span>
            : <span className="text-budget-left"><Money amount={item.remaining - due} /> left after them</span>}
        </div>
      ) : null}
    </Wrapper>
  );
}

type BudgetState = { limit: number; spent: number };
const usedPct = (b: BudgetState) => (b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 100);

/**
 * Under a category on Stats, once its budget for the period is 80% used or more: a small bar and
 * "86% of budget · ₹840 left", or "₹540 over budget" in the expense colour. Nothing below 80%.
 */
export function BudgetFlag({ item }: { item: BudgetState }) {
  const { fmt } = useApp();
  if (!budgetLevel(item)) return null;
  const over = item.spent > item.limit;
  const left = item.limit - item.spent;
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight">
      <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={cn("block h-full rounded-full", over ? "bg-expense" : "bg-expense/60")} style={{ width: `${Math.min(100, usedPct(item))}%` }} />
      </span>
      <span className={cn("truncate", over ? "font-medium text-expense" : "text-expense/80")}>
        {over ? `${fmt(-left)} over budget` : left === 0 ? "Budget used up" : <>{usedPct(item)}% of budget · <span className="text-budget-left">{fmt(left)} left</span></>}
      </span>
    </span>
  );
}

/**
 * In the entry form, under the amount: what the budget this entry counts against has left in its
 * period, and what it will have once this entry is in. The bar shows what was spent and, lighter,
 * this entry's share; both turn the expense colour when they go past the limit.
 */
export function EntryBudgetHint({ name, when, item, amount, after = "After this", over = "This takes it" }: {
  name: string; when: string; item: BudgetState; amount: number | null;
  /** "After this: ₹300 left", and "This takes it ₹400 over" when it goes past the limit; other wording for bills or an import. */
  after?: string; over?: string;
}) {
  const { fmt } = useApp();
  const before = item.limit - item.spent;
  const afterLeft = amount === null ? null : before - amount;
  const wasOver = before < 0;
  const goesOver = afterLeft !== null && afterLeft < 0;
  const scale = Math.max(item.limit, item.spent + Math.max(0, amount ?? 0), 1);
  const spentW = (Math.max(0, item.spent) / scale) * 100;
  const addW = amount && amount > 0 ? (amount / scale) * 100 : 0;
  const leftText = (n: number) => (n < 0 ? `${fmt(-n)} over` : `${fmt(n)} left`);
  return (
    <div className="flex-1 min-w-0 py-0.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{name} · {when}</span>
        <span className={cn("shrink-0 tabular font-medium", wasOver ? "text-expense" : "text-budget-left")}>{leftText(before)}</span>
      </div>
      <div className="relative mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={cn("h-full", wasOver ? "bg-expense" : "bg-budget-left")} style={{ width: `${spentW}%` }} />
        {addW ? <span className={cn("h-full", goesOver ? "bg-expense/50" : "bg-budget-left/45")} style={{ width: `${addW}%` }} /> : null}
        {item.spent + Math.max(0, amount ?? 0) > item.limit && item.limit > 0 ? <span className="absolute top-0 bottom-0 w-0.5 bg-foreground/70" style={{ left: `${(item.limit / scale) * 100}%` }} /> : null}
      </div>
      {afterLeft !== null && amount ? (
        <div className={cn("mt-1 text-xs", goesOver ? "text-expense" : "text-muted-foreground")}>
          {goesOver && !wasOver ? <>{over} <b className="font-medium">{fmt(-afterLeft)} over</b></> : <>{after}: <span className={cn("tabular font-medium", afterLeft < 0 ? "text-expense" : "text-budget-left")}>{leftText(afterLeft)}</span></>}
        </div>
      ) : null}
    </div>
  );
}
