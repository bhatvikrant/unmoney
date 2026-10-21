# Spec: Upcoming bills and subscriptions

Status: built · 2026-10-21 (roadmap A1 in docs/reviews/2026-10-21-product-review.md)

## 1. The idea

Money Manager only looks back. The most common reason people leave it is that it never says what is about to go out: rent on the 1st, Netflix on the 14th, the phone bill next week. UnMoney already knows most of this, because repeat schedules hold their next date and the ledger holds every past payment. This feature shows it.

- **Upcoming rows in the ledger.** Every active repeat schedule shows its coming dates in the visible month as faded rows, like Gmail drafts. They never count in a total. Tapping one offers **Add now** (pay it early: the entry is saved today and the schedule moves on), **Skip this one** (the schedule moves on and nothing is added) and **Edit schedule**.
- **Bills & subscriptions page** (More › Look ahead). Three lists:
  1. *Next 30 days*: every coming date of every schedule, with the total going out and coming in.
  2. *Subscriptions*: each active expense schedule with what it costs a month ("₹649 a month", "₹1,499 a year ≈ ₹125 a month") and a total a month and a year.
  3. *Looks like a subscription*: payments that recur in the ledger but have no schedule (same note, about a month apart, three or more times, amounts within 10%). **Make it a repeat** creates the schedule from the last payment; **Not a bill** hides the suggestion for good. Entries read from Gmail count like any other, so a Netflix receipt saved every month is found.

What to hold to:

- **Nothing new is counted.** Upcoming rows are a read model over `repeats`; balances, stats and budgets do not move until an entry exists.
- **Only the next date can be added or skipped.** A schedule keeps one `nextDate`; skipping a later date would need a list of exceptions. A later row (a weekly schedule's second row) shows only Edit schedule, with a line saying to handle the earlier one first.
- **Installments are not shown as upcoming**: their entries already exist, dated in the future, and show as ordinary rows.

## 2. Where it lives

| Where | What |
|---|---|
| Ledger, Daily view | Faded rows on their day after the entries and drafts; a repeat icon and "Upcoming · <method>". Hidden while a filter is on, like drafts. |
| Ledger row tap | A bottom sheet: what, when, how much, how often; Add now / Skip this one / Edit schedule. |
| More › Look ahead › Bills & subscriptions (`/upcoming`) | The three lists above. Rows open the same sheet; a suggestion row opens its last entry. |
| More › Set up › Repeats | Unchanged (Edit schedule goes there). |

States:

- **Empty:** "No repeats yet. Add one from the Repeat button on an entry's date, or make one from a payment below." The suggestions list still shows when it has something.
- **Offline:** everything works; the ops queue like any other.
- **Paused / ended / deleted account schedules:** not shown.
- **"Show repeats on the 1st of the month" setting:** the month's entries are created ahead, so only later months have upcoming rows.

## 3. Data and ops

No new table. One optional field on `settings`:

- `dismissedRecurring?: string[]` — normalised notes the user said are not bills. Set through `settings.update`.

New ops in `shared/ops.ts` (tables: `repeats`, plus `transactions`/`accounts`/`categories` where noted):

- `repeats.addNext { id, date, entryDate }` → the entry's id. `date` must still be the schedule's `nextDate` ("That one was already added or skipped" otherwise, e.g. another device got there first). Saves the template as an entry on `entryDate` with `repeatId`, through `validateTx` (a deleted account or category is refused), and moves `nextDate` on. Past the end date the schedule stops.
- `repeats.skip { id, date }` → moves `nextDate` past `date`. A `date` already behind `nextDate` is a no-op (the other device skipped it); one after it is refused.
- `repeats.create { template, frequency, after, fromTransactionId? }` → a schedule whose first date is the first one after `after` that is later than today, so nothing is back-filled. `fromTransactionId` links that entry to the schedule (the repeat icon).

Read models in `shared/upcoming.ts`: `upcomingOccurrences(snap, from, to, today)`, `subscriptionsList(snap)`, `recurringSuggestions(snap, today)`, `monthlyCost(amount, frequency)`.

## 4. Out of scope

- Due dates of credit cards in the 30-day list (roadmap A2 adds them).
- Reminders and push (A4).
- Yearly or weekly suggestion detection; only monthly patterns are suggested.
- Skipping a date other than the next one, and amounts that change per occurrence.
- Calendar view dots for upcoming dates.
