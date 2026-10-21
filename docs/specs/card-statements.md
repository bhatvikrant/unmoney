# Spec: Card statements, due dates and credit limit

Status: built · 2026-10-21 (roadmap A2 in docs/reviews/2026-10-21-product-review.md). Builds on the Payment-methods quick wins (#59): `statementDue`, "Due 25 Oct" / "Overdue" on card rows and the card page.

## 1. The idea

Credit cards are already strong in UnMoney (settlement day, payment day, payable vs outstanding, Pay). What's missing is what a card statement tells you: **when the next payment is due and how much**, without opening the card; **what each statement was**; and **how much credit is left**. A Money Manager user complains it only shows "the outstanding balance which is 20k" instead of the credit still available.

## 2. UX

| Where | What |
|---|---|
| Ledger (current month) | A reminder card per credit card with something payable that is due within **3 days** or **overdue**: "HDFC Regalia: ₹14,000 · Due Fri, Oct 23" / "Due tomorrow" / "Overdue since Oct 23", with **Pay** and a hide button. Hiding lasts until that card's next due date (on this device). |
| Pay (from the reminder) | Opens the card page with the payment dialog already open and prefilled with what is payable (`/payment-methods/<id>?pay=1`). |
| Card page | **Statements**: the open cycle ("Oct 5 – Nov 4 · Open · so far") and the last five closed ones ("Sep 5 – Oct 4 · Due Oct 23 · paid ₹10,000"), each with its charges. Quiet cycles are left out. Tapping one shows that cycle's entries instead of the month's ("Transactions · Sep 5 – Oct 4 · Show the month"). |
| Card page, with a limit | The card face shows **Available ₹72,055** bottom right (the unused `CardFace.footer` slot). A thin bar under the balance shows "Available ₹72,055 · 28% of ₹1,00,000 used" (green under 30%, then warmer, red from 80%). |
| Card editor | **Credit limit (optional)** under the payment day. |
| History | "Edited HDFC: credit limit ₹1,00,000" / "credit limit removed". |

## 3. Data and logic

- `accounts.creditLimit?: number` (credit cards only), in minor units. It is rescaled with a change of decimals or main currency, like opening balances. In `accounts.update`, a missing `creditLimit` keeps the card's limit (pages that edit other fields don't know about it), and `null` removes it. Removing must be `null`, because an `undefined` disappears when the op is sent as JSON.
- `statementCycles(account, today, n)` (shared/ledger.ts): cycles from a settlement day to the day before the next (short months settle on their last day), due on the first payment day after the cycle closes. This is the same rule as `statementDue`, so the closed cycle's due date is the payable's due date.
- `cycleTotals(cardId, txs, cycle)`: charges (expenses including refunds below zero, transfers out and fees) and payments (transfers or income into the card).
- `cardsDue(rows, today, 3)` (shared/views.ts): cards with `payable > 0` whose due date is at most 3 days away or past. Archived and hidden cards are left out.
- `creditAvailable(row)`: limit − what the card owes, counting later installments already charged to it (banks block them).

## 4. Out of scope

- Card due dates in the Bills & subscriptions "Next 30 days" list (roadmap A1, PR #55). Add them once both are merged.
- Push reminders (A4).
- Minimum amount due, interest and statement balances "as printed by the bank". The statement here is what UnMoney recorded.
- Available credit on the Payment methods row. The row is already full on a phone, and the card page shows it.
