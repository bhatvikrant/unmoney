import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app";

export function Money({ amount, kind, className, sign, muted, label }: {
  amount: number; kind?: "income" | "expense" | "transfer" | "auto" | "plain"; className?: string; sign?: boolean; muted?: boolean;
  /** Said before the amount to screen readers, where only the colour tells income from expense. */
  label?: string;
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
      {label ? <span className="sr-only">{label} </span> : null}
      {fmt(amount, { sign })}
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

/** An entry's amount in its type's colour. An expense below zero is a refund: money coming back, shown "+₹899" in the income colour. */
export function EntryMoney({ type, amount, className }: { type: "income" | "expense" | "transfer"; amount: number; className?: string }) {
  if (type === "expense" && amount < 0) return <Money amount={-amount} kind="income" sign label="Refund" className={className} />;
  return <Money amount={amount} kind={type} label={type === "income" ? "Income" : type === "expense" ? "Expense" : "Transfer"} className={className} />;
}
