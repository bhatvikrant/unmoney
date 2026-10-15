# Recon map: Money Manager by Realbyte (iOS / Android, rebuilt for web)

Scope: the whole personal-finance core: transactions (income / expense / transfer), accounts by group with card billing cycles, categories with subcategories, budgets, stats, calendar, notes, bookmarks, repeat and installment schedules, search and filter, sub-currencies, photo attachments, passcode, settings, backup/export/import. Everything the paid tier gates (no account limit, PC Manager style desktop editing, data sync) ships free.
For: the user's own product ("unmoney"), a web + PWA money manager with no paywall.
Date: 2026-10-15

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing site | https://www.realbyteapps.com/ | 8 feature points, 9 light + 9 dark screenshots (saved to replica/screens/) |
| 2 | help center, Android user guide | https://help.realbyteapps.com/hc/en-us/categories/360003093993-Android-User-Guide | 60+ articles read: Getting started, Accounts, Category, Card, Backup, PC Manager, Other Features, What's new |
| 3 | help center, iOS user guide | https://help.realbyteapps.com/hc/en-us/categories/360003093873-iOS-User-Guide | same structure as Android |
| 4 | App Store listing | https://apps.apple.com/us/app/money-manager-expense-budget/id560481810 | feature list, IAP (sub $2.49/mo, $19.99/yr for Data Sync), 4.8 from ~20K ratings, version 2.15 adds tags |
| 5 | Play Store listing | https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree | paid version: no ads, no asset limit, PC Manager; free capped at 15 accounts |
| 6 | changelogs | help center "What's new" sections | Android 4.6 to 4.13, iOS 2.12 to 2.15: tags, widgets, daily/monthly/annual account views, bulk edit, multi-photo, copy with date choice, swap from/to |
| 7 | CHOICE review | https://www.choice.com.au/products/money/financial-planning-and-investing/creating-a-budget/realbyte-money-manager | feature checklist: recurring, scheduled view, reports, trends, images, CSV/TSV import |

## Core loop

Record every income, expense and transfer in a few taps, then see where the money went by day, calendar, week, month, category, account and budget.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Onboarding / sign in | first launch | sign in (email, Google), pick main currency | auth form, currency picker | empty, error |
| S02 | Transactions: Daily | tab 1 (default), `/` | day-grouped ledger for the month | month nav, sub-tabs (Daily/Calendar/Weekly/Monthly/Summary), Income/Expenses/Total header, day group rows, FAB (+), note FAB, search, bookmark, filter icons | empty month, filled, filtered |
| S03 | Transactions: Calendar | sub-tab | month grid with per-day income (blue) / expense (red), note color dots, today highlight | calendar grid, day sheet on tap | empty, filled, day selected |
| S04 | Transactions: Weekly | sub-tab | weekly income/expense/total rows for the month, tap jumps to week | week rows, totals footer | filled |
| S05 | Transactions: Monthly | sub-tab | 12 months of the year compared, tap jumps to month | month rows, totals | filled |
| S06 | Transactions: Summary (Total) | sub-tab | budget status + expenses/transfers by account type, Excel export | budget bars, account-type totals, export button | no budget, filled |
| S07 | Day detail sheet | tap a calendar day | list that day's entries, add entry or note | list, FAB, note | empty, filled |
| S08 | Add / edit transaction | FAB, tap a row, `/t/new`, `/t/:id` | record income/expense/transfer | type segmented control (Income/Expense/Transfer), Date (with time, Repeat/Installment button), Account picker, Category > Subcategory picker, Amount (calculator keypad, sub-currency globe), Note (autocomplete), Description, photos (up to 3), Fees toggle (transfer), swap From/To, tags, Save / Continue, Delete / Copy / Bookmark | new, edit, validation error (account, category, amount required), with photos, installment view (n of N, remaining) |
| S09 | Account picker | Account field | pick account by group | grouped list, "view by group / all" toggle, hidden accounts excluded | filled |
| S10 | Category picker | Category field | pick main category then subcategory | two-column list, pencil to edit categories | with/without subcategory |
| S11 | Amount keypad | Amount field | enter amount with calculator ops | keypad with + - × ÷ =, currency toggle | main, sub-currency |
| S12 | Repeat / Installment setup | Repeat button | weekly/biweekly/monthly/yearly repeat or N-month installment | frequency list, installment month count, end date | repeat, installment |
| S13 | Search | magnifier | keyword search with autocomplete; period, account, category, tag filters; bulk edit (select all, edit dates/notes, delete) | search bar, filter drawer, results list, edit mode | empty, results, bulk edit |
| S14 | Filter | filter icon | combine period + income categories + expense categories + accounts | donut rings (income %, expense %), tabs Income/Expenses/Account, checkbox lists with per-row totals | all, partial |
| S15 | Bookmarks | star icon | reuse frequent entries, reorder/delete | list, edit mode with drag handle | empty, filled, edit |
| S16 | Notes | note FAB / Note tab | daily memo with colour | note list, editor, palette | empty, filled |
| S17 | Stats | tab 2, `/stats` | pie chart of income or expense by category, period selector (W/M/Y/custom), List / Trend modes | segmented Stats/Budget/Note, period dropdown, pie, ranked list with % chips | empty, filled |
| S18 | Stats: category detail | tap a slice or row | monthly trend bar chart for a category + its transactions | bar chart, list | filled |
| S19 | Budget | Stats > Budget, `/budget` | remaining amount, total bar, per-category bars with today marker, over-budget colouring | budget bars, Budget Setting link | no budgets, filled, over |
| S20 | Budget settings | Budget Setting | add/edit/delete budgets, default budget, per-month override, weekly/annual period | list, form | empty, filled |
| S21 | Budget detail | tap a bar | monthly chart of spent vs budget | bar chart | filled |
| S22 | Accounts | tab 3, `/accounts` | assets vs liabilities totals, grouped list, card payable/outstanding, collapsible groups | header totals, group headers, rows, pencil (edit order/hide), + | empty, filled |
| S23 | Account detail | tap an account | balance trend line chart, daily/monthly/annual views, expenses by category, transfers in/out, Pay button for cards | line chart, period dropdown, lists | filled, card with payable |
| S24 | Add / edit account | + / pencil | name, group, initial amount, include in totals, show/hide, card fields (billing account, settlement date, payment date), debit card linked account | form | new, edit, card, debit |
| S25 | Account order / hide | pencil | reorder accounts and groups, show/hide | sortable list, eye toggles | filled |
| S26 | Account groups | Settings > Account Group | add/edit/delete/reorder groups, mark as credit/debit card | list, form | filled |
| S27 | Deleted accounts | Settings > Deleted Accounts | restore or permanently delete | list | empty, filled |
| S28 | Settings (More) | tab 4, `/settings` | all configuration | grouped list | filled |
| S29 | Category management | Settings | income and expense categories, subcategories, reorder, promote sub to main | two lists, drag, form | filled |
| S30 | Main currency | Settings | pick currency, symbol position, decimals | search list | filled |
| S31 | Sub currencies | Settings | add currencies with manual rate, custom currency (e.g. gold, BTC), decimals, refresh rates | list, form | empty, filled |
| S32 | Repeat settings | Settings | list of schedules, edit, delete | list | empty, filled |
| S33 | Passcode | Settings | 4-digit lock, lock timing | keypad | set, verify |
| S34 | Period settings | Settings | monthly start date, weekly start day, carry-over | form | filled |
| S35 | Style | Settings | system/dark/light, 6 theme colours, income/expense colour set | pickers | filled |
| S36 | Backup / Restore | Settings | export JSON backup, restore, export Excel/CSV, import TSV/CSV, export photos | buttons, file input, import preview | idle, preview, error rows |
| S37 | Card expense display config | Settings | at-the-time vs lump-sum on payment date | radio | filled |
| S38 | Transfer-as-expense setting | Settings | per account toggle | list | filled |
| S39 | Desktop manager view | wide screens, same routes | the "PC Manager": sidebar nav, table editing, pie + line charts | sidebar, data table | filled |

## Flows

```
F01 Record an expense
    S02 -> (+) S08 -> S09 account -> S10 category -> S11 amount -> save -> S02
    happy path clicks: 6 (type is preselected Expense; account defaults to last used)
    edge: no accounts yet, no category chosen, amount 0, negative amount (rebate), sub-currency, attach photo, Continue for the next entry

F02 Record a transfer with a fee
    S08 Transfer -> from -> to -> amount -> Fees toggle -> fee amount -> save
    clicks: 7
    edge: from == to, swap button, transfer-as-expense account, card settlement as transfer

F03 Reuse a bookmark
    S02 -> star S15 -> tap entry -> S08 prefilled with today's date -> save
    clicks: 3

F04 Set a monthly repeat
    S08 -> Repeat -> S12 monthly -> save; schedule materialises on the date (or 1st of month per setting)
    edge: edit schedule later from S32 without touching past entries; delete schedule keeps past entries

F05 Buy on installment
    S08 -> Repeat -> Installment -> 3 months -> save; 3 entries, each shows "1/3", remaining amount

F06 Browse the month
    S02 Daily <-> S03 Calendar <-> S04 Weekly <-> S05 Monthly <-> S06 Summary; < > month nav; swipe
    edge: custom monthly start date (e.g. 25th), week start day

F07 Find a transaction
    S02 -> S13 search "coffee" -> autocomplete -> results -> tap -> S08
    edge: filter by period / account / category / tag; bulk edit selected; no results

F08 Filter the ledger
    S02 -> S14 -> pick accounts/categories -> Filter -> S02 filtered, Income/Expenses toggle
    edge: transfers excluded unless transfer-as-expense

F09 See where money went
    S17 pie -> tap slice -> S18 trend -> tap month -> list
    edge: period W/M/Y/custom, List vs Trend, income vs expense, empty month

F10 Set a budget and watch it
    S19 -> Budget Setting S20 -> + -> category + amount -> save -> S19 bars with today marker
    edge: per-month override, default change applies from next month, over 100 %, weekly/annual budget

F11 Manage accounts
    S22 -> + S24 -> group, name, amount -> save; pencil S25 reorder/hide; tap -> S23 detail
    edge: loan as negative, exclude from totals, hidden account still in totals, delete -> S27 restore

F12 Credit card cycle
    S24 card: billing account, settlement day, payment day -> S22 shows Balance Payable and Outst. Balance -> S23 Pay -> transfer bank -> card
    edge: pay early, partial pay, lump-sum display mode, overdue (grey)

F13 Debit card
    S24 debit card linked to bank -> expense on debit deducts bank; card shows monthly usage, resets each month

F14 Daily note
    S03 -> note FAB -> S16 -> colour -> save -> dot on calendar

F15 Export and import
    S36 -> Export Excel (CSV/XLSX) ; Import TSV/CSV -> preview -> + -> entries created
    edge: unknown account/category rows fail with reason; sub-currency columns

F16 Backup and restore
    S36 -> Backup JSON download; Restore from file (replace all, confirm)

F17 Passcode lock
    S33 set -> app locks on return -> keypad -> unlock
    edge: wrong code, forgot (sign out and back in)

F18 Multi-currency entry
    S31 add EUR with rate -> S08 amount globe -> EUR amount -> converted main amount shown and editable
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Bottom tab bar / side nav | mobile tabs (Trans with today's date, Stats, Accounts, More), desktop sidebar | active, inactive | all |
| Month navigator | < Jul 2026 >, period dropdown (W/M/Y/custom) | default | S02-S06, S17, S19, S23 |
| Sub-tab strip | Daily/Calendar/Weekly/Monthly/Summary; Stats/Budget/Note; Income/Expenses | active underline | S02, S17 |
| Summary header | Income (blue) / Expenses (red) / Total | zero, filled | S02-S06, S17 |
| Day group | date badge (day, yyyy/mm, weekday chip), day income/expense | default | S02, S07 |
| Transaction row | expense, income, transfer (grey, "A -> B"), with installment badge, photo icon, tag chips | default, pressed, selected (bulk) | S02, S07, S13, S18, S23 |
| FAB | add (+), note, paste/bookmark | default | S02, S03 |
| Segmented control | Income/Expense/Transfer | selected colour per type | S08 |
| Form row | label + value, picker trigger | empty, filled, error | S08, S24 |
| Picker sheet | account (grouped), category (two-pane), date/time, frequency | default | S08 |
| Calculator keypad | main, with sub-currency toggle | default | S11 |
| Calendar grid | month, with amounts and note dots | today, selected, other-month | S03 |
| Pie chart + ranked list | expense, income | empty, filled | S17 |
| Bar / line chart | monthly trend, balance trend | filled | S18, S21, S23 |
| Budget bar | within, near, over; today marker | default | S06, S19 |
| Donut ring | income %, expense % | filled | S14 |
| Checkbox list with totals | accounts, categories | checked, partial | S14 |
| Sortable list | accounts, groups, bookmarks, categories | edit mode, dragging | S15, S25, S26, S29 |
| Toggle / radio rows | settings | on/off | S28+ |
| Dialog / confirm | delete, restore, change currency | default | many |
| Toast | saved, deleted, copied | default | many |
| Passcode keypad | set, confirm, verify | error shake | S33 |
| Empty state | no transactions, no accounts, no budgets, no results | default | many |
| Data table (desktop) | editable ledger | default | S39 |

## Inferred data model

```
User           id, email, name, mainCurrency, symbolPosition, decimals, monthStartDay (1-28),
               weekStartDay (0-6), carryOver (bool), startScreen (daily|calendar), theme, accentColor,
               incomeExpenseColorSet (A|B), subcategoryEnabled, autocompleteEnabled, timeInputEnabled,
               repeatDisplay (onDate|firstOfMonth), cardExpenseDisplay (atTime|lumpSum), passcodeHash, lockAfter
               evidence: S28-S38, help "Configuration" articles
               confidence: high

AccountGroup   id, userId, name, kind (cash|bank|card|debitCard|savings|prepaid|investment|overdraft|loan|insurance|other),
               order, deletedAt
               evidence: S22 group headers, "How to manage account group", 4.6 card group add-on
               confidence: high

Account        id, userId, groupId, name, initialBalance, currency, includeInTotals, hidden, order,
               transferAsExpense, description,
               card fields: billingAccountId, settlementDay (1-31), paymentDay (1-31)
               debit fields: linkedAccountId
               deletedAt
               evidence: S24, card articles, "exclude from totals", "hide accounts", "deleted accounts"
               confidence: high

Category       id, userId, type (income|expense), name, parentId (null for main), order, deletedAt
               evidence: S10, S29, subcategory articles
               confidence: high

Transaction    id, userId, type (income|expense|transfer), date (yyyy-mm-dd), time (hh:mm optional),
               accountId, toAccountId (transfer), categoryId, subcategoryId, amount (main currency, signed),
               subAmount, subCurrency, exchangeRate, note (payee/title), description, tags[],
               feeAmount (transfer), photoIds[], repeatId, installment {index, count, totalAmount},
               isBookmarkSource
               evidence: S08, import columns "Date Account Category Subcategory Note Amount Income/Expense Description AmountSub Currency", 4.9 rate editing, 4.13 tags
               confidence: high

Repeat         id, userId, template (same fields as Transaction), frequency (daily|weekly|biweekly|monthly|yearly|everyNDays),
               interval, startDate, endDate, lastMaterialisedDate, kind (repeat|installment), installmentCount
               evidence: S12, S32, repeat articles
               confidence: high (materialisation detail is medium)

Bookmark       id, userId, order, template (type, accountId, toAccountId, categoryId, subcategoryId, amount, note, description)
               evidence: S15
               confidence: high

Budget         id, userId, categoryId (null = total), period (weekly|monthly|yearly), amount, overrides { "2026-07": amount }
               evidence: S19-S21, budget article (default + per-month)
               confidence: high

Note           id, userId, date, text, color
               evidence: S16, note articles
               confidence: high

Currency       id, userId, code, name, symbol, rate (to main), decimals, symbolPosition, isCustom, order
               evidence: S31
               confidence: high

Photo          storageId, transactionId
               evidence: S08 (up to 3, later multiple)
               confidence: high
```

Relationships: User 1-n AccountGroup 1-n Account; User 1-n Category (self-referential parent); Account 1-n Transaction (and toAccount for transfers); Category 1-n Transaction; Repeat 1-n Transaction; Budget n-1 Category; Transaction 1-n Photo.

Derived values (never stored): account balance = initial + sum(income) - sum(expense) + transfers in - transfers out - fees; card balance payable / outstanding from settlement day; debit card monthly usage; budget spent per period; stats aggregates.

## Feature matrix

See `features.csv`. Must: 46, should: 24, could: 9, skip: 6.

## Out of scope (cannot or should not be cloned)

- Realbyte's name, icon, illustrations, store screenshots and copy.
- Native widgets, SMS capture (Android), Siri shortcuts, iCloud/Google Drive backup hooks: replaced by PWA install plus file export and a cloud backend.
- Realbyte Data Sync Service: unnecessary, Convex syncs every device for free.
- Ads and the paid tier: everything ships free.
- Referral program.
- Bank aggregation: the original does not have it either.

## Size

Screens 39, flows 18, entities 10. Hard parts: card billing cycles (payable vs outstanding), repeat/installment materialisation, custom month start dates across every aggregate, multi-currency amounts, TSV/CSV import matching, responsive two-layout shell. Size: L, delivered as a vertical slice first.
