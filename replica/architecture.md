# Architecture: unmoney (web clone of Money Manager)

Built from `replica/recon.md` and `replica/features.csv`. Date: 2026-10-15.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web app | Vite + React 19 + TypeScript, React Router 7 (data mode off, plain routes) | pure SPA, no server rendering needed since Convex serves every byte of data reactively |
| styling | Tailwind 4 + shadcn/ui (new-york, neutral base) + Framer Motion for sheet/tab transitions | user's pick; minimal, functional |
| charts | Recharts | pie, bar and line charts with small code |
| database + API | Convex (documents, indexes, reactive queries, mutations, crons, file storage) | one managed backend for data, realtime sync, files and scheduled jobs; replaces Realbyte's paid sync and PC Manager for free |
| auth | Convex Auth (`@convex-dev/auth`) with Password + Google providers | runs inside Convex, no third service |
| files | Convex file storage | receipt photos, up to 3 per transaction |
| jobs | Convex cron (daily) + catch-up mutation on app open | materialise repeat and installment schedules |
| PWA | vite-plugin-pwa | installable, offline shell; Convex client caches last results in memory |
| hosting | Vercel (static) + Convex Cloud | zero config |

One database. No server of our own. Every Convex function checks `getAuthUserId` and scopes by `userId`; there are no public reads.

## Conventions

- **Money** is stored as an integer in minor units (`amount: 1655` = 16.55 for a 2-decimal currency). Formatting uses the currency's `decimals`. Sums never touch floats.
- **Dates** are local calendar dates stored as `"YYYY-MM-DD"` strings (lexicographic order = chronological), with optional `time: "HH:mm"`. The app has no timezone problem because the original has none: a transaction on the 12th is on the 12th wherever you are. Range queries use the `by_user_date` index.
- **Soft delete** on accounts and account groups (`deletedAt`) so "Deleted Accounts" can restore. Transactions of a deleted account stay.
- **Derived values are computed in queries**, never stored: account balances, card payable/outstanding, budget spent, stats. Personal ledgers stay far below Convex's per-query read limits; if a user passes ~20k transactions, add a cached `balance` on accounts updated in the three transaction mutations.
- **Periods** respect `monthStartDay` and `weekStartDay` from settings. One helper (`src/lib/period.ts`) owns the math; every view calls it.

## Schema (`convex/schema.ts`)

```ts
users            // from Convex Auth authTables, extended:
  name?, email?, image?
settings         userId, mainCurrency (code), symbol, symbolPosition ("before"|"after"), decimals,
                 monthStartDay (1-28), weekStartDay (0-6), carryOver, startScreen ("daily"|"calendar"),
                 theme ("system"|"light"|"dark"), accent, colorSet ("A"|"B"), subcategoryEnabled,
                 autocompleteEnabled, timeInputEnabled, repeatDisplay ("onDate"|"firstOfMonth"),
                 cardExpenseDisplay ("atTime"|"lumpSum"), passcodeHash?, lockAfter ("always"|"5m"|"1h"), onboarded
                 index by_user
accountGroups    userId, name, kind (cash|bank|card|debitCard|savings|prepaid|investment|overdraft|loan|insurance|other),
                 order, deletedAt?
                 index by_user
accounts         userId, groupId, name, initialBalance, includeInTotals, hidden, order, transferAsExpense,
                 description?, billingAccountId?, settlementDay?, paymentDay?, linkedAccountId?, deletedAt?
                 index by_user, by_group
categories       userId, type (income|expense), name, parentId?, order, deletedAt?
                 index by_user_type, by_parent
transactions     userId, type (income|expense|transfer), date, time?, accountId, toAccountId?, categoryId?,
                 subcategoryId?, amount, subAmount?, subCurrency?, exchangeRate?, note, description?, tags[],
                 feeAmount?, photoIds[], repeatId?, installmentIndex?, installmentCount?, installmentTotal?
                 index by_user_date (userId, date), by_user_account, by_user_category, by_user_repeat
                 searchIndex search_note (note, filter userId)
repeats          userId, kind (repeat|installment), frequency (daily|weekly|biweekly|monthly|yearly),
                 startDate, endDate?, nextDate, installmentCount?, template {type, accountId, toAccountId?,
                 categoryId?, subcategoryId?, amount, note, description?, tags[], feeAmount?}, active
                 index by_user, by_next (active, nextDate)
bookmarks        userId, order, template (same shape as repeats.template)
                 index by_user
budgets          userId, categoryId? (null = total), period (weekly|monthly|yearly), amount,
                 overrides: { [periodKey]: amount }
                 index by_user
notes            userId, date, text, color
                 index by_user_date
currencies       userId, code, name, symbol, rate (sub per 1 main, float ok: it is a rate, not money),
                 decimals, symbolPosition, isCustom, order
                 index by_user
```

Hard constraints enforced in mutations: transfer `accountId !== toAccountId`; amount is an integer; category type matches transaction type; card accounts need `billingAccountId`, `settlementDay`, `paymentDay`; debit cards need `linkedAccountId`; `installmentCount` between 2 and 60; at most 3 photos.

## API (Convex functions)

| function | kind | does | flow |
| --- | --- | --- | --- |
| `settings.get` / `settings.update` | q / m | user settings, creates defaults on first read | S28+ |
| `settings.completeOnboarding` | m | sets currency, seeds groups, accounts, categories | S01, F01 |
| `settings.setPasscode` / `settings.verifyPasscode` | m / q | SHA-256 hash with per-user salt | F17 |
| `accountGroups.list/create/update/remove/restore/reorder` | q / m | groups | S26 |
| `accounts.list` | q | all accounts with computed balance, card payable/outstanding, debit monthly usage, group totals, assets, liabilities | S22, F11, F12 |
| `accounts.get` | q | one account + balance series for a period + category breakdown + transfers | S23 |
| `accounts.create/update/remove/restore/reorder/setHidden` | m | | S24, S25, S27 |
| `accounts.payCard` | m | creates a transfer billing account -> card | F12 |
| `categories.list/create/update/remove/reorder/promote` | q / m | | S29 |
| `transactions.listRange` | q | transactions in [from, to] with optional account/category filters | S02-S07, S14 |
| `transactions.get/create/update/remove` | q / m | one entry; create accepts `repeat` or `installment` and fans out | S08, F01-F05 |
| `transactions.search` | q | full-text on note + filters period/account/category/tag | S13 |
| `transactions.bulkUpdate/bulkRemove` | m | edit dates/notes or delete a selection | F07 |
| `transactions.noteSuggestions` | q | distinct recent notes for autocomplete | S08 |
| `transactions.importRows` | m | batch of parsed rows; resolves names to ids; returns per-row errors | F15 |
| `transactions.exportAll` | q | flat rows with names for CSV | F15 |
| `repeats.list/update/remove` | q / m | schedules | S32 |
| `repeats.materialise` | internal m | creates due entries up to today; idempotent via `nextDate` | F04, cron daily 00:05 UTC + on app open |
| `bookmarks.list/create/remove/reorder` | q / m | | S15 |
| `budgets.list/upsert/remove/setOverride` | q / m | | S20 |
| `budgets.status` | q | per-budget spent, limit, remaining for a period; total budget | S19, S06 |
| `notes.listRange/upsert/remove` | q / m | | S16 |
| `currencies.list/add/update/remove/reorder` | q / m | sub-currencies and custom ones | S31 |
| `stats.byCategory` | q | income or expense totals per main category for a period | S17 |
| `stats.categoryTrend` | q | monthly totals for one category over 12 months | S18 |
| `files.generateUploadUrl` / `files.url` | m / q | photos | S08 |
| `backup.export` | q | every table for the user as one JSON | F16 |
| `backup.restore` | m | wipes and reloads the user's data from JSON | F16 |

Cron: `crons.daily("materialise repeats", { hourUTC: 0, minuteUTC: 5 }, internal.repeats.materialiseAll)`.

## The parts that bite

- **Card cycles.** Balance payable = card expenses in the cycle that ended at the last settlement day, minus payments; outstanding = expenses since. Lump-sum mode changes what Stats counts as an expense on which date. Owned by `convex/lib/cards.ts` with unit tests.
- **Custom month start.** "Jul 2026" with start day 25 means Jun 25 to Jul 24. Every aggregate (ledger, calendar header, stats, budgets, weekly) must use the same period helper, which is shared between client and Convex via `convex/lib/period.ts`.
- **Repeat materialisation** must be idempotent: cron and client catch-up can race. The mutation re-reads `nextDate` and advances it in the same transaction (Convex mutations are serialisable), so duplicates cannot happen.
- **Installments** create all N entries up front (the original shows future ones on their dates), linked by `repeatId` and `installmentIndex`, so editing one can offer "this entry" or "all remaining".
- **Multi-currency** stores both the sub amount and the converted main amount; changing a rate later never rewrites history.
- **Import** matches account and category names case-insensitively, reports row-level failures, and never half-imports: the mutation validates every row before writing.
- **Photos** are capped at 3 per entry and 5 MB each client-side.
- **Passcode** is a UI lock, not security: data is already behind auth. The hash lives in settings so it syncs across devices.
- **Deletion.** Removing an account hides it and keeps its transactions; permanent delete from Deleted Accounts also deletes those transactions after a confirm.

## Routes (React Router)

```
/sign-in                      S01
/onboarding                   S01 currency
/                             S02-S06  ?view=daily|calendar|weekly|monthly|summary  &month=YYYY-MM
/t/new  /t/:id                S08 (sheet on desktop, page on mobile)
/search                       S13
/bookmarks                    S15
/notes                        S16
/stats  /stats/c/:categoryId  S17, S18
/budget  /budget/settings     S19, S20, S21
/accounts  /accounts/new  /accounts/:id  /accounts/:id/edit  /accounts/order   S22-S25
/settings                     S28
/settings/categories  /settings/currency  /settings/sub-currencies  /settings/repeats
/settings/passcode  /settings/period  /settings/style  /settings/backup
/settings/account-groups  /settings/deleted-accounts  /settings/card-display  /settings/transfer-expense
```

Shell: bottom tab bar under 768px (Trans shows today's date, Stats, Accounts, More); left sidebar at 768px and up (the "PC Manager" layout, S39). Same routes, same components.

## Build order

1. **Vertical slice**: scaffold, Convex Auth sign-in, onboarding seeds data, add an expense, see it in the Daily ledger, see the balance on Accounts. Screens S01, S02, S08, S09, S10, S11, S22. Tables: settings, accountGroups, accounts, categories, transactions.
2. **Must-haves by area**: transfer + fees, edit/delete/copy, calendar/weekly/monthly/summary, period settings, search + filter, bookmarks, repeat + installment + cron, stats + category detail, budgets, account detail + card cycles + pay + debit, categories management, sub-currencies, passcode, theme, export/import/backup, PWA.
3. **Should/could**: tags, bulk edit, notes with colour, hide/exclude/reorder, deleted accounts, transfer-as-expense, lump-sum display, accent colours, colour set swap, custom currency, promote subcategory.
4. Test pass with the recon flows, then parity check.
