import { useApp } from "@/lib/app";
import { Money } from "@/components/shell/Money";
import { cn } from "@/lib/utils";

export type BudgetItem = { budget: { _id: string; categoryId?: string; period: string }; limit: number; spent: number; remaining: number; isOverride?: boolean; carry?: number };

export function BudgetBar({ item, label, elapsed, onClick }: { item: BudgetItem; label: string; elapsed: number; onClick?: () => void }) {
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
        <div className={cn("h-full rounded transition-all", over ? "bg-expense" : warn ? "bg-expense/70" : "bg-income")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(100, elapsed * 100)}%` }} title="Today" />
      </div>
      <div className="flex justify-between text-xs mt-1">
        <span><Money amount={item.spent} kind={over ? "expense" : "income"} /> <span className="text-muted-foreground">spent</span></span>
        <span className="text-muted-foreground"><Money amount={Math.abs(item.remaining)} className={item.remaining < 0 ? "text-expense" : undefined} /> {item.remaining < 0 ? "over" : "left"}</span>
      </div>
    </Wrapper>
  );
}
