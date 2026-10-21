# Spec: Refunds

Status: built · 2026-10-21 (roadmap B6 in docs/reviews/2026-10-21-product-review.md)

## 1. The idea

When Myntra refunds ₹899 of a ₹2,499 order, the honest picture is "Apparel this month: ₹1,600". Today the refund can only be entered as income (Gmail files it under income "Other"). That inflates the month's income, leaves Apparel at ₹2,499, shows the budget as more spent than it is, and puts a fake "income" line in the recap.

A **refund is money back on an expense**: it nets against the category, budget and recap the purchase counted in, and never shows as income.

## 2. Model: an expense below zero

The ledger already handles an expense with a negative amount correctly everywhere. `kindsOf` gives a negative expense, so stats, budgets, recaps and the ledger's totals net it. `computeBalances` adds it to the account. `cardStatus` lowers the outstanding and `debitMonthlyUsage` lowers the usage. So a refund is stored as **`type: "expense"`, `amount < 0`**, in the purchase's category, with no new field and no migration. `subAmount` carries the same sign.

## 3. UX

| Where | What |
|---|---|
| Entry form, Expense | A **Refund** row with a switch, under Amount. Off: "Money back from a shop or service". On: "Money back: comes off this category's spending, not counted as income". The amount is always typed positive, and the switch decides the sign. Opening an existing refund shows the switch on and the amount positive. "Continue" resets it. |
| Ledger rows, Gmail drafts, review list | A small **Refund** badge, and the amount as **+₹899** in the income colour (`EntryMoney`). The day header nets it. |
| Stats | The category's total nets the refund, and its entry list includes it with the same figure. The pie leaves out a category whose refunds outweighed its spending in the period (there is nothing to draw). |
| Budgets, recaps | They net automatically through `kindsOf` / `statsByCategory`. |
| CSV/TSV export → import | A refund exports with type **Refund** and a negative amount. The importer reads "Refund" as an expense below zero. Before this change, the importer dropped the sign and turned a refund into a purchase. |

### Gmail

A refund mail (rules or AI) becomes a **negative expense draft**:

- **Category:** the category of the purchase it returns. That is the latest expense with the same merchant (normalised note), at least as big as the refund, in the 60 days before it (`refundOf` in `shared/gmail/resolve.ts`). Failing that, the category last used with that merchant, else none (the user picks).
- **Description:** "… · refund of 12 Oct Myntra" when a purchase matched, else "… · refund".
- The AI prompt now asks for an *expense* category for refunds.
- `importable` allows a negative amount only on an expense, so a refund can be imported in bulk from the review page like any other draft.

## 4. Out of scope

- Turning past income entries that were really refunds into refunds (a bulk "Mark as refund" later).
- A link from the refund to the purchase entry. The description names it, which is enough to find it.
- Refunds of transfers, and refunds on income.
