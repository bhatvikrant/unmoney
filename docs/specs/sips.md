# Spec: SIPs

Status: built · 2026-11-02 (days of the month: this revision)

## 1. The idea

A ₹10,000 SIP on the 10th is not spending. Counting it as an expense makes every month look ₹10,000 worse than it is, crowds the daily list with the same row each month, and eats into a budget. The money does leave the bank, though, so the balance has to move.

A **SIP payment is an expense filed under a SIP** (`transactions.sipId`). It still comes off its bank account. It leaves the daily list and every spending total (the ledger's, Stats, Budgets, Recaps), because `kindsOf` counts it as a transfer. What went into SIPs gets its own card in the recaps.

## 2. Gmail only

SIPs are found in, and filed from, **what Gmail read**. That means:

- entries saved from mail (`source.app === "gmail"`)
- drafts still waiting (the faded rows)
- drafts the user dismissed

An entry typed by hand is never suggested, never filed automatically, and can't be marked as a SIP. `fileUnderSip` and `sipPayments` in `shared/ops.ts` both check `fromGmail`.

## 3. Finding them (`sipSuggestions` in `shared/sips.ts`)

1. **Payments.** `gmailPayments` gathers the expenses Gmail read that aren't in a SIP. Each one carries the mail it came from (sender, subject).
2. **Groups.** Payments are grouped by **name** (`sipKey`: the normalised note, with digits folded so "ACH D- ICCL-2398472" and next month's narration match) and the **exact amount**. Two SIPs on one platform become two groups.
3. **One per payment.** `onePerPayment` treats records of one group within 3 days of each other as one payment (say, the bank's alert and the fund's mail). It keeps a saved entry over a waiting draft, and a waiting draft over a dismissed one.
4. **Days of the month.** One name and amount can be several SIPs: Mirae ₹2,500 on the 7th, 14th, 21st and 28th is four. `schedulesOf` reads a group two ways and keeps the one that explains more payments, or as many with the debits nearer their dates:
   - **Days of the month.** Each day the payments keep (`daysOf`: the most common day first; each debit goes to the day it is least off, `lateBy`: up to 5 days late, the next working day, or 2 early) is a SIP of its own when its payments repeat monthly or quarterly (±5 days). Two days a month are two SIPs; nothing is read as "twice a month" any more.
   - **One weekday.** Every week or every two weeks, counted from the first payment of the stretch, so it keeps its weekday (±2 days, which never adds up). The 28th's debit followed by the 7th's, nine days on, is not a late week.

   A stretch needs two payments one instalment apart, and up to three missed instalments may sit inside it: that much decides what a group of payments is (8 Sep and 10 Oct is monthly; two months apart is nothing). A day the payments stopped keeping and a later day they moved to (the SIP's date was changed) are one SIP, on the later day.
5. **Pauses.** A pause between stretches doesn't matter: the whole history of that name and amount (that day's, when there are several) goes with the suggestion.
6. **Six months.** A schedule is only suggested once it has kept up for six months (`steady`): 6 monthly debits, 26 weekly, 13 every two weeks or 3 quarterly in one stretch, with no more than about a month missed between two of them (one missed monthly debit inside the stretch is fine, two in a row are not). Mark as SIP needs none of this: a SIP with two payments so far can be marked by hand. A cancelled SIP's debits are still offered back after one.
7. **Ranking.**
   - **Looks like a SIP:** the mail, the name or the category reads like an investment (SIP, mutual fund, ICCL, CAMS, KFintech, Groww, Zerodha, Kuvera…).
   - **Maybe a SIP:** everything else that repeats (rent, an EMI, a bill). The user adds or dismisses those.
   - **Not a SIP** adds the name to `settings.dismissedSips`.
8. **Naming.** A suggestion is named after the mail's name. When that name is a bank's generic one ("Payment") and the signal came from the mail, it's named after the sender ("CAMS"). When the name's payments are several SIPs, or a SIP of that name keeps a day, the day goes on the end: "Mirae Asset Mutual Fund · 7th". "Not a SIP" on one of those remembers the name and day (`key@7`), leaving the others.
9. **Already handled.** Payments a running SIP takes are left out (they get saved into it). Payments that fit a **cancelled** SIP come back as "*X* is marked cancelled, but payments came again". One payment is enough for that, and accepting resumes the SIP.

## 4. Accepting, marking, and what comes later

- **Accept** (`sips.create`): files the group's Gmail entries and saves its drafts, waiting and dismissed, as payments of the new SIP. Each saved payment:
  - is dated the day and amount the mail gave
  - goes on the bank account the mail named, else the SIP's
  - is filed under **Investments** (created if the user has none)
  - carries `source` pointing at its mail

  A draft is **never saved twice**. It is skipped if it is flagged as an entry already typed (`matchedTransactionId`), or if an entry of its amount within 2 days is already that payment: one typed by hand, or one Gmail read under the same name. An entry in another SIP, or one Gmail read under another name, is another payment, so two SIPs of one amount on one day (₹10,000 to PPFAS and to Tata on the 7th) both save. When no saved entry, mail or SIP names the bank account, the Mark as SIP sheet asks **Paid from** (and Add on the SIPs page opens that sheet); without one a draft stays in review. When nothing can be saved, the error says which of the two it was. The SIP keeps its name, keys, usual amount, last date, bank account, rhythm and, monthly or quarterly, its **day**. Its id is `sip_<op id>`, so the device and the server agree.
- **Mark as SIP:** on a Gmail entry's or draft's screen, or for rows ticked in the daily list's select mode. `similarPayments` lists every Gmail payment with the same name and exact amount, from every month there is data for (only the picked payment's day when they are several SIPs). Each has a tick box, all ticked; flagged drafts are left out. The user names the SIP and confirms. If the payments fit an existing SIP, the sheet adds them to it, resuming it if it was cancelled.
- **Later debits:**
  - After a Gmail check writes its drafts, `writeSync` runs `sips.saveDrafts` through `runOps`. That is the same reducer the device runs, so a running SIP's new debit is saved into it at once, with the same account and category rules.
  - A Gmail draft the user saves from review is filed as it is saved (`Work.insert`), within 20% of the SIP's amount (step-ups).
  - A SIP with a day takes only debits on that day (`sipFor` with `lateBy`), so the 7th's SIP never takes the 14th's debit. If the fund moves the date, the new debits go to the daily list and come back as a suggestion for the new day. A SIP saved before days were read, and a weekly one, takes a debit on any date.
  - A payment on or after `lastDate` moves the SIP's amount.
- **Undo:** accepting or marking can be undone. The SIP goes (or the entries come out of it), and drafts it saved are as they were again, with the entries made from them deleted (`drafts.reopen`, then `drafts.dismiss` for ones that were dismissed).

## 5. Keeping up, pauses and cancellation

Each SIP on the page says when it was last paid and how it is keeping up (`sipsList`, `missedDebits`): debits due since the last payment (`nextDue`: the usual day by rhythm) that never came, each counted once its drift has passed.

| Status | When | Shown |
|---|---|---|
| Running | nothing missed | "Last paid 26 days ago · next Nov 7", grey |
| Late | 1–2 debits missed (the 7th's monthly SIP with nothing by the 13th) | **Late** badge, "Last paid 6 weeks ago · 1 debit missed", amber |
| Stale | 3 or more missed: 3 months for a monthly SIP, 3 weeks for a weekly one, 9 months for a quarterly one | **Stopped?** badge, "Last paid 7 months ago · Apr 7, 2026", red |
| Cancelled | the user said so | **Cancelled** badge, grey |

- Nothing is changed or deleted for a late or stale SIP. The next debit goes straight in and it is running again.
- "Every month" counts running and late SIPs, not stale or cancelled ones.
- **Cancelled** is the user's call (**Mark as cancelled**, `stoppedAt`). The SIP keeps its payments and takes no new ones, and they are left as they are. If debits with that name come again, it is offered back to resume (§3).

## 6. Where it lives

| Where | What |
|---|---|
| More › Invest › SIPs (`/sips`) | This month / every month (each running SIP at its rhythm: weekly ×52/12, fortnightly ×26/12, twice a month ×2, quarterly ÷3) / so far. "N SIP payments waiting in Gmail review" with **Save** (`sips.saveDrafts`). **Looks like a SIP** and **Maybe a SIP**, each row with Add, Review (the Mark as SIP sheet) and Not a SIP. **Your SIPs**: by when each was last paid, most recent first (cancelled ones last, then any with no payment yet in their group), each with how it is keeping up (§5). A SIP opens a sheet: name edited in place, Mark as cancelled / Not cancelled, Delete (in-app confirm; payments go back to the ledger), and its payments, each with Not a SIP. |
| Daily ledger | SIP payments and the drafts a running SIP takes are not listed. One line under the summary says "₹17,000 into SIPs · not spending" and opens the page. Select mode has **Mark as SIP**, enabled when every ticked row is a Gmail expense. |
| Entry / draft screen | **Mark as SIP** on an expense read from Gmail. On a SIP payment: "SIP · *name*" and **Not a SIP**. |
| Gmail review | A **SIP** badge on drafts a running SIP takes. |
| Recaps (month and year) | An **Invested** card: the total, each SIP with its count and amount (tap for its payments, drill `sip`), the change from the period before and, for a year, the average a month. The closer gains an **Invested** row (poster and copied text too). Spending figures never include SIPs. |
| Search, a payment method's entries | SIP payments stay listed, with a **SIP** badge; balances count them. |

## 7. Storage and sync

SIPs live on the settings document (`settings.sips`), not in a table of their own. A device still running an older version of the app, which has no such table, would crash on the first change it was sent from one; it already takes the settings document and ignores fields it doesn't know.

A SIP is `{ id, name, keys, amount, lastDate?, accountId?, rhythm?, day?, stoppedAt? }`. `twiceMonthly` is still a rhythm a saved SIP may have; it is no longer read.

- Changing the main currency's decimals (or the currency, keeping data) rescales SIP amounts. A new currency without the data drops the SIPs, and so does wiping everything.
- Backups restore exactly what was filed, and nothing is re-filed on restore or on an unmerge.
- Every op that writes entries loads `settings`. `sips.create`, `sips.mark` and `sips.saveDrafts` also load drafts, categories and accounts, plus the entries within 2 days of each draft (`TxScope.dates`) for the duplicate check. `sips.remove` finds a SIP's entries through `transactions.by_sip`.

## 8. Out of scope

- Fund units, NAV and current value. This tracks money put in.
- Reading the fund name out of a CAMS or KFintech mail body.
- Turning SIPs into transfers to an investment payment method.
