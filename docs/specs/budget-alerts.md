# Spec: Budget alerts and carry-over

Status: built · 2026-10-21 (roadmap A3 in docs/reviews/2026-10-21-product-review.md)

## 1. The idea

Budgets in UnMoney are a page you have to remember to open. Nothing tells you the moment Food passes 80%, and one big month wrecks the next month's figure because nothing carries over. Money Manager users complain about both ("There is no rollover on the budget"). YNAB and Monarch have both.

- **Alerts:** when a change pushes a budget of the current period past **80%** or **over**, a toast says so ("Food budget: 82% used · 9 days left", "Food budget is over by ₹540"). **View** opens the Budget page.
- **A dot on the Stats tab** (phone tab bar and desktop sidebar) while any budget of the current period is over.
- **Carry over**, per budget: what's left at the end of a period adds to the next one, and overspending takes from it. It starts with the period it was turned on in, so nothing already past changes. The bar shows "· +₹700 carried over".

## 2. UX

| Where | What |
|---|---|
| Anywhere in the app | A toast when a budget goes up a band: under 80% → 80% or more → at or over. It fires whatever made the change: the entry form, quick add, a Gmail draft, a change synced from another device. Opening the app sets the baseline without a toast. A budget created just now never alerts. Staying in the same band doesn't alert again. The toast id is per budget, so a second change replaces it rather than stacking. |
| Stats tab | A small expense-coloured dot on the icon, `role="status"`, labelled "A budget is over". |
| Budget bars (Budget page, ledger Summary) | "Food · +₹700 carried over" in the label. The limit, %, spent/left and the bar all use the period's amount plus the carry. |
| Budget settings › a budget | **Carry over** switch: "What's left at the end of each month adds to the next one; overspending takes from it. Starts with this month." The list row's hint adds "· carries over". |

States: no budgets, no alerts, no dot. Offline works: everything reads the local snapshot.

## 3. Data and logic

- `budgets.rolloverFrom?: string` is the period key carrying over starts from (`"2026-10"`, a week's first day, or `"2026"`). New op `budgets.setRollover { id, from | null }`. The settings dialog sends the current period's key when the switch is turned on, and null when it is turned off.
- `budgetStatus` items gain `carry`: the sum of (period amount, override included, − spent) over every period from `rolloverFrom` up to the one shown. It is worked out in one pass over the entries (`carryOver` in shared/views.ts) and respects custom month and week starts. `limit` includes it.
- `currentBudgetLevels(snap, today)` gives each budget of the current weekly / monthly / yearly period with a level (0 under 80%, 1 from 80%, 2 at or over; a zero budget with spending is over). `budgetCrossings(before, after)` gives the budgets that went up a level. `useBudgetAlerts()` (src/lib/budgetAlerts.ts, mounted in AppShell) compares readings and toasts, and returns whether anything is over (for the dot).

## 4. Out of scope

- Push notifications for budgets (roadmap A4).
- Choosing the thresholds, or switching alerts off per budget.
- Carrying over only the unspent part (YNAB's "overspending doesn't roll" option). Both directions carry.
- Showing the carry in recaps' wording ("you had ₹700 extra this month").
