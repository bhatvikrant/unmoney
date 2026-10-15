import { useApp } from "@/lib/app";
import { Money } from "@/components/shell/Money";
import { cn } from "@/lib/utils";

export type BudgetItem = { budget: { _id: string; categoryId?: string; period: string }; limit: number; spent: number; remaining: number; isOverride?: boolean };

export function BudgetBar({ item, label, elapsed, onClick }: { item: BudgetItem; label: string; elapsed: number; onClick?: () => void }) {
  const { fmt } = useApp();
  const ratio = item.limit ? item.spent / item.limit : item.spent > 0 ? 1 : 0;
  const over = item.limit > 0 && item.spent > item.limit;
  const warn = !over && ratio > elapsed + 0.0001;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper type={onClick ? "button" : undefined} onClick={onClick} className={cn("w-full text-left px-4 py-3 border-b last:border-b-0", onClick && "hover:bg-accent/40")}>
      <div className="flex items-end justify-between text-sm mb-1">
        <div>
          <div className="text-xs text-muted-foreground">{label}{item.isOverride ? " · this period" : ""}</div>
          <div className="font-medium tabular">{fmt(item.limit)}</div>
        </div>
        <div className="text-right text-xs">
          <div className={cn("font-medium", over ? "text-expense" : "text-income")}>{Math.round(ratio * 100)}%</div>
        </div>
      </div>
      <div className="relative h-5 rounded bg-muted overflow-hidden">
        <div className={cn("h-full rounded transition-all", over ? "bg-expense" : warn ? "bg-expense/70" : "bg-income")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(100, elapsed * 100)}%` }} title="Today" />
      </div>
      <div className="flex justify-between text-xs mt-1">
        <Money amount={item.spent} kind={over ? "expense" : "income"} />
        <Money amount={item.remaining} className={item.remaining < 0 ? "text-expense" : "text-muted-foreground"} />
      </div>
    </Wrapper>
  );
}
