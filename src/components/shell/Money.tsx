import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app";

export function Money({ amount, kind, className, sign, muted }: {
  amount: number; kind?: "income" | "expense" | "transfer" | "auto" | "plain"; className?: string; sign?: boolean; muted?: boolean;
}) {
  const { fmt } = useApp();
  const k = kind === "auto" ? (amount > 0 ? "income" : amount < 0 ? "expense" : "plain") : kind ?? "plain";
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        k === "income" && "text-income",
        k === "expense" && "text-expense",
        k === "transfer" && "text-transfer",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {fmt(kind === "auto" ? amount : amount, { sign })}
    </span>
  );
}

export function SummaryBar({ income, expense, total, totalLabel = "Total" }: { income: number; expense: number; total: number; totalLabel?: string }) {
  return (
    <div className="grid grid-cols-3 text-center py-2 border-b text-sm">
      <div><div className="text-xs text-muted-foreground">Income</div><Money amount={income} kind="income" className="font-medium" /></div>
      <div><div className="text-xs text-muted-foreground">Expenses</div><Money amount={expense} kind="expense" className="font-medium" /></div>
      <div><div className="text-xs text-muted-foreground">{totalLabel}</div><Money amount={total} className="font-medium" /></div>
    </div>
  );
}
