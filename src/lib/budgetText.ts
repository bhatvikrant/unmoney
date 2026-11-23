import { useApp } from "@/lib/app";
import { formatMoney } from "../../shared/money";
import { monthLabel } from "@/lib/format";

type BudgetState = { limit: number; spent: number };

/** Money without the ".00" when it's a whole amount: "₹ 10,500", short enough to show two side by side. */
export function useShortMoney() {
  const { settings, fmt } = useApp();
  const unit = 10 ** settings.decimals;
  return (minor: number) => (minor % unit === 0 ? formatMoney(minor / unit, { symbol: settings.symbol, symbolPosition: settings.symbolPosition, decimals: 0 }) : fmt(minor));
}

/** A budget past its limit, as what went out against it: "₹ 10,500 / ₹ 10,000". */
export function useOverText() {
  const short = useShortMoney();
  return (b: BudgetState) => `${short(b.spent)} / ${short(b.limit)}`;
}

/** A budget period key as words: "Nov 2026", "week of 2026-11-23", "2026". */
export function periodKeyLabel(period: "weekly" | "monthly" | "yearly", key: string): string {
  return period === "monthly" ? monthLabel(key) : period === "weekly" ? `week of ${key}` : key;
}
