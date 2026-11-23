/**
 * A budget's default amount over time. `amount` is what applies now; `earlier` holds what applied
 * before, oldest first: each entry's amount ran up to, not including, the period `until`. Changing
 * the default therefore leaves past periods as they were. `since` is the period a budget was first
 * set in (missing on budgets older than this record, which count as always there).
 * Period keys of one kind (months, week starts, years) sort as text, so they are compared as text.
 */
export type EarlierAmount = { until: string; amount: number };
export type BudgetAmounts = { amount: number; earlier?: EarlierAmount[]; since?: string };

/** The default amount in the period `key` (its own override, if any, comes on top of this). */
export function budgetAmountAt(b: BudgetAmounts, key: string): number {
  for (const e of b.earlier ?? []) if (key < e.until) return e.amount;
  return b.amount;
}

/** The amount that ran up to the period `until`: nothing before the budget was first set. */
function amountBefore(b: BudgetAmounts, until: string): number {
  if (b.since !== undefined && until <= b.since) return 0;
  return (b.earlier ?? []).find((e) => e.until >= until)?.amount ?? b.amount;
}

/** Drops entries that change nothing: one whose amount is also what follows it. */
function tidy(earlier: EarlierAmount[], amount: number): EarlierAmount[] | undefined {
  const out = earlier.filter((e, i) => e.amount !== (earlier[i + 1]?.amount ?? amount));
  return out.length ? out : undefined;
}

/**
 * The `earlier` list once the default becomes `amount` from the period `from` on. A second change
 * in the same period replaces the first, and a budget first set in `from` has no earlier amount.
 */
export function earlierAfterChange(b: BudgetAmounts, from: string, amount: number): EarlierAmount[] | undefined {
  if (b.since !== undefined && from <= b.since) return undefined;
  const kept = (b.earlier ?? []).filter((e) => e.until < from);
  return tidy([...kept, { until: from, amount: amountBefore(b, from) }], amount);
}

/** Two budgets as one (a category merged into another): their amounts added, period by period. */
export function addBudgetAmounts(a: BudgetAmounts, b: BudgetAmounts): { amount: number; earlier?: EarlierAmount[]; since?: string } {
  const amount = a.amount + b.amount;
  const since = a.since !== undefined && b.since !== undefined ? (a.since < b.since ? a.since : b.since) : undefined;
  const untils = [...new Set([...(a.earlier ?? []), ...(b.earlier ?? [])].map((e) => e.until).concat(a.since ?? [], b.since ?? []))]
    .filter((u) => since === undefined || u > since).sort();
  return { amount, since, earlier: tidy(untils.map((until) => ({ until, amount: amountBefore(a, until) + amountBefore(b, until) })), amount) };
}

/** Every amount scaled (a change of currency or decimals). */
export function scaleEarlier(earlier: EarlierAmount[] | undefined, scale: (n: number) => number): EarlierAmount[] | undefined {
  return earlier?.map((e) => ({ until: e.until, amount: scale(e.amount) }));
}

export type BudgetStep = { from?: string; amount: number };
/** The amounts in order, oldest first, each with the period it started in (unknown for the first of an old budget). */
export function budgetSteps(b: BudgetAmounts): BudgetStep[] {
  const steps: BudgetStep[] = [];
  let from = b.since;
  for (const e of b.earlier ?? []) { steps.push({ from, amount: e.amount }); from = e.until; }
  steps.push({ from, amount: b.amount });
  return steps;
}
