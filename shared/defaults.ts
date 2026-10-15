export const DEFAULT_GROUPS: { name: string; kind: string }[] = [
  { name: "Cash", kind: "cash" },
  { name: "Accounts", kind: "bank" },
  { name: "Card", kind: "card" },
  { name: "Debit Card", kind: "debitCard" },
  { name: "Savings", kind: "savings" },
  { name: "Top-Up / Prepaid", kind: "prepaid" },
  { name: "Investments", kind: "investment" },
  { name: "Overdrafts", kind: "overdraft" },
  { name: "Loan", kind: "loan" },
  { name: "Insurance", kind: "insurance" },
  { name: "Others", kind: "other" },
];

export const DEFAULT_ACCOUNTS: { name: string; groupKind: string }[] = [
  { name: "Cash", groupKind: "cash" },
  { name: "Bank", groupKind: "bank" },
  { name: "Card", groupKind: "card" },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Food", "Social Life", "Pets", "Transport", "Culture", "Household",
  "Apparel", "Beauty", "Health", "Education", "Gift", "Other",
];

export const DEFAULT_INCOME_CATEGORIES = ["Allowance", "Salary", "Petty cash", "Bonus", "Other"];

export const NOTE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

export const CATEGORY_COLORS = [
  "#f87171", "#fb923c", "#fbbf24", "#facc15", "#a3e635", "#4ade80", "#2dd4bf", "#22d3ee",
  "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#c084fc", "#e879f9", "#f472b6", "#fb7185",
];
