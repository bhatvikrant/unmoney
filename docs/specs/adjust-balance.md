# Spec: Adjust balance (reconcile)

Status: built · 2026-10-21 (roadmap B5 in docs/reviews/2026-10-21-product-review.md)

## 1. The idea

A manual ledger drifts: a missed coffee, a bank fee nobody typed in, interest. Today the only fix is to edit the opening balance, which silently rewrites every past month, or to invent an income or expense that pollutes Stats, budgets and recaps. Users of Money Manager complain that its numbers stop matching the bank and they stop trusting it.

**Adjust balance** lets the user type what the bank (or card statement) says. UnMoney records the difference as a **transfer from a hidden "Balance adjustments" account**, so the balance matches from today on, past months stay as they were, and income and spending don't move. The method shows **"Reconciled 3 days ago"**, a small nudge that the number has been checked.

## 2. UX

| Where | What |
|---|---|
| Payment method page, under "Balance today" | `Reconciled 3 days ago · Adjust balance` (just `Adjust balance` before the first time). Not shown for debit cards or linked UPIs: they have no balance of their own, so their bank is the one to check. |
| Adjust balance dialog | "UnMoney shows ₹80,000.00 on Bank today." A field prefilled with that figure: *What Bank says the balance is* (cards, loans and overdrafts: *What HDFC card says you owe*). A live line under it says what will happen: "The difference, +₹15.50, is saved as a transfer from Balance adjustments. It doesn't count as income or spending." or "That matches. It will be marked as reconciled today." The button reads **Save adjustment** or **Mark reconciled**. Enter saves. |
| Payment methods list | Accounts without card details show "Reconciled 3 days ago" under their name. |
| Ledger | The adjustment is an ordinary transfer row, "Balance adjustment", Balance adjustments → Bank. It can be opened, edited or deleted like any entry (deleting it undoes the adjustment). |
| Payment methods history | "Adjusted Bank to ₹815.50 (+₹15.50)" or "Checked Bank: it matched". |

The label moves from "today" to "yesterday" to "N days ago", then to a date after a month.

**Offline:** works offline like every op. The difference is worked out on the device from the balance the user was looking at, and sent as a `delta`, so an entry synced from another device in between doesn't turn the user's figure into a different correction.

## 3. Data and ops

`accounts` gains two optional fields:

- `reconciledAt?: string` — the day it was last checked.
- `system?: "adjustments"` — marks the account the app made for itself. It is `hidden`, `includeInTotals: false` and kind `other`. `accountsList` leaves it out of `groups`, `archived` and `accounts` (so no picker, settings list, filter or count sees it) and returns it in a separate `system` list, so `accountName` still resolves on entries.

New op `accounts.adjustBalance { id, delta, balance, date }` → the new entry's id, or `null` when `delta` is 0. It refuses deleted methods, the adjustments account itself, debit cards and linked UPIs, and non-integer amounts. The adjustments account is created on first use and reused after that. `balance` is only used in the history sentence.

Because the entry is a transfer from an account left out of totals, net worth moves by the difference (the bank really holds that money), while `kindsOf` counts it as a transfer. So Stats, budgets, recaps and the ledger's income and expense totals don't change.

## 4. Out of scope

- Per-entry cleared / reconciled status (YNAB style).
- Adjusting at a past date ("the statement on 30 Sep said…"). It is always today.
- Investment "Update value" with gain/loss (roadmap later). It would reuse this op with a different note.
- Showing or editing the adjustments account in Settings.
