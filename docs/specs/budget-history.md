# Spec: Budget amounts over time

Status: built · 2026-11-23 (follows docs/specs/budget-signals.md)

## 1. The idea

A budget had one default amount, used for every period without an amount of its own. Lowering Food from ₹20,000 to ₹15,000 in November therefore made October a ₹15,000 month too: recaps, runs of held months and carry-over all shifted. A new default amount now applies from the period it is set in; earlier periods keep what they had, and the change itself becomes something the app can show.

## 2. UX

| Where | What shows |
| --- | --- |
| Budget settings › a budget | Typing a different **Default amount**: "Applies from Nov 2026 on. Earlier months keep ₹20,000." Under it, the last three earlier amounts: "Before: ₹20,000 before Nov 2026". The row in the list carries the latest one too. |
| Budget › a budget | Under the chart (whose limit line already follows each period's own limit): the last three amounts, newest first, each with what went out per period on average while it applied: "₹15,000 from Nov 2026 · spent ₹14,200 a month on average". Shown once the amount has changed at least once. |
| Monthly recap › Budgets | The row of a budget whose amount changed that month: "85% of ₹15,000 · cut from ₹20,000" (or "raised from"). |
| Yearly recap › Budgets | Under a monthly budget's twelve squares, its last change of the year: "₹20,000 → ₹15,000 from Nov · spent ₹18,000 a month before, ₹14,000 after". |

Rules:

- A change takes effect in the period running today, whichever period the settings page was opened from.
- Changing the amount again in the same period replaces the change; changing it back removes it. A budget made this period has no earlier amount.
- An amount set for one period only ("Only for Nov 2026") still wins over the default for that period.
- History starts when this shipped: changes made before it were overwritten and are not recoverable.

## 3. Data

`budgets.amount` stays the amount that applies now, so older app versions keep reading the right figure. Two optional fields join it (shared/budgetAmounts.ts):

- `earlier: { until, amount }[]`, oldest first: each amount ran up to, not including, the period `until`.
- `since`: the period the budget was first set in (missing on older budgets, which count as always there).

`budgets.upsert` takes an optional `from` period key. With it the amount applies from that period; without it (older app versions) the current amount is replaced as before. Every limit goes through `budgetAmountAt(budget, key)`: `budgetStatus`, carry-over, and the recaps through them. A category merge adds two budgets' amounts period by period and its undo restores both; a change of currency or decimals scales earlier amounts; backups and the Excel export carry them.
