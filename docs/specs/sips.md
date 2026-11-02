# Spec: SIPs

Status: built · 2026-11-02

## 1. The idea

A ₹5,000 SIP on the 5th is not spending. Counting it as an expense makes every month look ₹5,000 worse than it is, crowds the daily list with the same row each month, and eats into the "Other" budget. The money does leave the bank, though, so the balance has to move.

A **SIP is an expense filed under a SIP** (`transactions.sipId`). It still comes off its payment method. It leaves the daily list, and it leaves every spending total (the ledger's, Stats, Budgets, Recaps), because `kindsOf` counts it as a transfer. That is the same thing it already does for a credit-card purchase shown when the card is paid.

## 2. Finding them

The SIPs page lists **Looks like a SIP** (`sipSuggestions` in `shared/sips.ts`). It works from what is already in the ledger, plus the mail each entry was read from: an accepted draft keeps its `from` and `subject`.

- **Strong signal**: a SIP word in the mail's subject or sender, in the note or description, or in the category name. SIP words include SIP, systematic investment, mutual fund, ICCL, BSE StAR MF, CAMS, KFintech, Groww, Zerodha, Kuvera, Paytm Money, ET Money, INDmoney, the fund houses, ELSS and index fund. A category counts when it is called Investments, SIP, Mutual funds or Stocks. One strong signal is enough, even for a single payment.
- **Weak signal**: invest, NACH/ACH, e-mandate, auto-debit, NPS, PPF, SGB, digital gold, RD, stocks, demat, smallcase, fund. A weak signal also needs payments about a month apart (24–38 days), two or more. An ACH mandate pays loan EMIs too.
- **No signal: never suggested.** A monthly payment with no SIP word is rent or a bill, and Bills & subscriptions finds those.
- **Grouping**: payments are grouped by merchant (`sipKey`: the normalised note with digits folded, so "ACH D- ICCL-2398472" and next month's narration match). Within a merchant they are split by amount (within 10%), so two SIPs on one platform become two suggestions.
- **Name**: the note. When the note is a bank's generic "Payment" and the mail gave the signal, the sender's name is used instead ("CAMS", "Groww").
- **Each suggestion** shows why ("Mail from CAMS · 3 payments, monthly around the 10th") and offers **Add as SIP** and **Not a SIP**. Not a SIP adds the merchant to `settings.dismissedSips`, with Undo. If the payments fit an existing SIP, the button says **Add to <SIP>**.

## 3. Later payments

A SIP lives on the settings document (`settings.sips`), not in a table of its own. A device still running an older version of the app, with no such table, would crash on the first change it was sent from one. It already takes the settings document and ignores fields it doesn't know. Each SIP keeps:

- `keys`: the `sipKey`s of the payments filed under it
- its `id`: `sip_` plus the id of the op that created it, so the device and the server make the same one. Entries point at it with `sipId` (a plain string), and backups keep both unchanged.
- its usual `amount` and `lastDate`
- the payment method
- `stoppedAt`

`Work.insert` in `shared/ops.ts` files every new expense under the running SIP it fits: one of its keys, and an amount within 20%. If several fit, the closest amount wins. This happens on whichever op wrote the entry: the entry form, a Gmail draft, an import, a repeat. So it works offline and on the server alike. Every op that writes entries loads `settings` for this (`OP_TABLES`).

- **The date never matters for filing.** A SIP is debited on a working day, so the 5th becomes the 6th or 7th after a weekend or holiday. Filing looks only at the note and the amount, and detection allows 24–38 days between payments. The SIPs page shows the next payment "around" the usual day (`usualDay`: the most common day, a tie going to the earlier one, since shifts only ever move a debit later).
- A payment dated on or after `lastDate` moves `amount` along, so a yearly step-up keeps matching.
- A stopped SIP takes nothing new.
- Changing the main currency's decimals (or the currency, keeping data) rescales each SIP's `amount`. A new currency without the data drops the SIPs, and so does wiping everything.
- Backups restore exactly what was filed. Nothing is re-filed on restore, so an entry the user took out of a SIP stays out.
- An open Gmail draft that a SIP will take (`sipDrafts`) is left off the daily list too. It shows a **SIP** badge on the review page and is counted on the SIPs page ("1 SIP payment waiting in Gmail review").

## 4. Where it lives

| Where | What |
|---|---|
| More › Invest › SIPs (`/sips`) | This month / every month / so far, the waiting-in-Gmail line, Looks like a SIP, and Your SIPs. A SIP opens a sheet with its name editable in place (saved on Enter or leaving the field), and buttons to stop or restart it or delete it (an in-app confirm; its payments go back to the ledger). The sheet lists its payments, each with **Not a SIP**. |
| Daily ledger | SIP payments and SIP drafts are not listed. When the month has any, one line under the summary says "₹7,000 into SIPs · not spending" and opens the page. |
| Entry form (a saved expense) | **Mark as SIP**: files it under the SIP it fits, or makes one named after its note. On a SIP payment: "SIP · <name>" and **Not a SIP**. Both come with Undo. |
| Search, a payment method's entries | SIP payments stay listed with a **SIP** badge. Balances still count them. |

## 5. Ops

- `sips.create { name, transactionIds }`
- `sips.mark { id, transactionIds }`: also adds the entries' keys
- `sips.unmark { ids }`
- `sips.update { id, name?, stopped? }`
- `sips.remove { id }`: unfiles every entry, which the server finds through `transactions.by_sip` (`TxScope.sipIds`)

## 6. Out of scope

- Fund units, NAV and current value. This tracks money put in, not what it is worth.
- Reading the fund name out of a CAMS or KFintech mail body.
- Turning SIPs into transfers to an investment payment method.
