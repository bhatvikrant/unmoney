import type { Doc } from "../convex/_generated/dataModel";

export type AccountKind = NonNullable<Doc<"accounts">["kind"]>;

/** Every type a payment method can have, in picker order. */
export const ACCOUNT_KINDS: { kind: AccountKind; label: string }[] = [
  { kind: "cash", label: "Cash" },
  { kind: "bank", label: "Bank account" },
  { kind: "card", label: "Credit card" },
  { kind: "debitCard", label: "Debit card" },
  { kind: "upi", label: "UPI" },
  { kind: "prepaid", label: "Wallet / prepaid" },
  { kind: "savings", label: "Savings" },
  { kind: "investment", label: "Investment" },
  { kind: "overdraft", label: "Overdraft" },
  { kind: "loan", label: "Loan" },
  { kind: "insurance", label: "Insurance" },
  { kind: "other", label: "Other" },
];

export function kindLabel(kind: string | undefined): string {
  return ACCOUNT_KINDS.find((k) => k.kind === kind)?.label ?? "Other";
}

/** Colours a card can have in the app, deep enough to read white on, plus two light metals read in dark ink. */
export const CARD_COLORS: { name: string; value: string }[] = [
  { name: "Midnight", value: "#1e293b" },
  { name: "Graphite", value: "#3f3f46" },
  { name: "Sapphire", value: "#1d4ed8" },
  { name: "Ocean", value: "#0e7490" },
  { name: "Emerald", value: "#047857" },
  { name: "Plum", value: "#6d28d9" },
  { name: "Ruby", value: "#be123c" },
  { name: "Copper", value: "#c2410c" },
  { name: "Gold", value: "#b8860b" },
  { name: "Silver", value: "#cbd5e1" },
  { name: "Pearl", value: "#f1efe9" },
];

/** A card with no colour chosen: credit cards midnight, debit cards sapphire. */
export function cardColorOf(a: { kind?: string; color?: string }): string {
  return a.color ?? (a.kind === "debitCard" ? "#1d4ed8" : "#1e293b");
}

/** Groups a new user starts with. Only names: a group is a folder and has no type. */
export const DEFAULT_GROUPS = ["Cash", "Credit cards", "Debit cards", "Bank accounts", "UPIs"];

export const DEFAULT_ACCOUNTS: { name: string; kind: AccountKind; group: string }[] = [
  { name: "Cash", kind: "cash", group: "Cash" },
  { name: "Bank", kind: "bank", group: "Bank accounts" },
  { name: "Card", kind: "card", group: "Credit cards" },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Food", "Social Life", "Pets", "Transport", "Culture", "Household",
  "Apparel", "Beauty", "Health", "Education", "Gift", "Other",
];

export const DEFAULT_INCOME_CATEGORIES = ["Allowance", "Salary", "Petty cash", "Bonus", "Other"];

export const NOTE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];
