# Spec: Budget signals across the app

Status: built · 2026-10-24 (follows docs/specs/budget-alerts.md)

## 1. The idea

Budgets lived on the Budget page and in a toast when one crossed 80%. The figures matter where decisions get made: when you look at a category, when you log a spend, and when you look back on a month or a year. This puts each budget's state in those places, read from the same `budgetStatus` the Budget page uses, so every figure matches it.

Colour: what a budget has **left** is green (`text-budget-left`, the chart green, the same in both colour sets); what is **over** is the expense colour.

## 2. UX

| Where | What |
|---|---|
| Budget settings › a budget | Under **Default amount**: "You spent ₹6,450 a month on average over the last 6 months" for the chosen category (or everything, for the total budget), in the budget's own period (a week, a month, a year). The six whole months before this one; fewer when the ledger is younger; hidden with no earlier month. |
| Stats › Expenses list | Under a category whose budget for the shown period is 80% used or more: a small bar and "87% of budget · ₹800 left" (left in green), or "₹600 over budget" in the expense colour. Nothing under 80%, nothing for a custom range. |
| Stats › a category | Its budget bar for the period (tap: the Budget page), and the budget drawn on the trend chart: a dashed line, bars past their period's limit in the expense colour. |
| Entry form | With an expense category picked, a **Budget** row under the amount: "Food budget · this month — ₹800 left", a bar of what was spent with this entry's share lighter on top, and "After this: ₹300 left", or "This takes it ₹400 over". An entry dated in another period says that period ("Sep 2026"). The category's own budget, else the total one; a weekly and a monthly budget both show. Editing an entry leaves its old amount out. A card purchase counted when the card is paid adds nothing yet. |
| Category picker (entry form) | A budgeted category's tile shows "₹800 left" in green or "₹600 over" in the expense colour, for the entry's date. |
| Monthly recap | A **Budgets** card before In vs out (monthly spec card 8): each budget's bar, the day it went over, months-in-a-row runs, and two tiles of the most telling facts. |
| Yearly recap | A **Budgets** card (yearly spec card 12): each monthly budget as twelve held/over squares, and the year's **annual budgets** as bars under them (or the whole card, with annual budgets alone: "2 of 3 held", runs counted in years). |
| Recap closer (poster, shared image, copied text) | A **Budgets** row: "2 of 4 held" (a month) or **Within budget** "10 of 12 months" (a year), green when every one held. Only when there were budgets. |
| Bills & subscriptions | A **Budgets after bills** section: each budget running now that a bill still due in its period adds to, what it has left now, the bar with the bills lighter on top, "After these bills: ₹100 left" or "These bills take it ₹100 over", and which bills ("₹900 due: Meal kit Oct 28"). |
| Budget page | In the period running today, each bar shows the bills still due as a lighter segment (grey, or faint red past the limit) and "₹900 in bills still due · ₹100 over after them". |
| Gmail review | Above Import: the budgets the ticked entries take over, or leave under 20%: "Takes Food budget ₹400 over", "Food budget: ₹150 left after import". |

## 3. Data and logic

- `budgetAverage(snap, categoryId?, period, today, months = 6)` in shared/views.ts.
- `budgetsAt(snap, date, without?)`: every budget in the weekly, monthly and annual periods holding `date`, with its level; `without` drops one entry from the spending. `currentBudgetLevels` is now `budgetsAt(snap, today)`. `budgetsForCategory(items, snap, categoryId)` picks a (sub)category's main category budgets, else the totals.
- The entry form's figures come from `useEntryBudgets` (src/components/tx/entryBudgets.ts), which counts the typed amount with `kindsOf`, the same way budgets count entries.
- `budgetImpact(snap, pending)` in shared/views.ts: what expenses not in the ledger yet (bills, drafts) do to every budget they count against (category and total, in their own date's period), worst off first. `billsAgainstBudgets(snap, today)` in shared/upcoming.ts runs it over the scheduled bills still due in the periods running today.
- Recaps: `budgetRows` (per-budget limit, spent, carry, `overOn`, `streak`) and `budgetYearRows` (twelve outcomes, months held / over, total overrun, longest held run) in shared/recap.ts. A run stops at the ledger's first entry. In vs out no longer carries a budgets tile.

- Recaps: `periodBudgets` / `budgetRows` take a period, so a year's annual budgets get the same rows; `RecapSummary.budgets` feeds the poster row and `recapText`.

## 4. Out of scope

- Showing budget state for income categories.
- Bills that fall in the next period counting against it (Bills & subscriptions shows the periods running today only).
