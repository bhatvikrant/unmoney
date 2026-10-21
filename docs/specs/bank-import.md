# Spec: Import a bank statement (CSV / Excel with column mapping)

Status: built as specced, awaiting review · 2026-10-21 (roadmap C9 in docs/reviews/2026-10-21-product-review.md, size L)

## 1. The idea

Today UnMoney can only import Money Manager's own export (or a sheet with exactly its Date / Account / Category / Amount / Income-Expense columns). A new user who doesn't come from Money Manager has no way to bring in history, and Gmail sync only covers mail from now on. Every bank lets you download a statement as CSV or Excel, but each bank lays it out differently: a few lines of account details on top, then "Txn Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"…

This adds one step to the existing import: **"Match the columns"**. The user says which column is the date, which is the description, and where the amount is. Every row goes to one payment method they pick. The rows then go through the **same review** as today (dry run, duplicates left out, skipped rows explained, chunked import), so nothing new can go wrong after the mapping.

What to hold to:

- **Same pipeline.** The mapping only turns the bank's rows into the `ImportRow`s that `transactions.importRows` already takes. No new op, no schema change, and offline works as it does today.
- **Guess, then let the user fix.** Headers are recognised in English bank wording (date, narration, particulars, withdrawal, deposit, debit, credit, Dr/Cr…). Most statements need no change; the user only confirms.
- **Show what it will do.** A live preview of the first rows as entries (date, note, ± amount, income/expense) updates as the mapping changes, so a wrong sign or column is obvious before anything is saved.
- **Remember the mapping** for the next statement from the same bank, on this device (keyed by the header row), so month two is one tap.

## 2. Where things stand in the code

- `src/lib/importFile.ts` `readImportFile` reads CSV/TSV (Papa) and Excel (SheetJS `readSheet`) and assumes the first row is the header. Money Manager's shape is recognised by `mapImportRow` (`src/lib/csv.ts`).
- `src/lib/csv.ts` has an unused `parseXlsx` with header-row detection (review section 4 lists it as dead code). Its idea (find the first row with Date and Amount) moves into the new grid reader, and `parseXlsx` / `cellToString` / `dropTransferIns` are removed.
- `ImportPage` `Review` does the dry run, duplicate skip (`skipDuplicates`: same day, account, type, amount, note), chunking and the confirmed-sync wait.
- The note autocomplete history (`noteSuggestions` in shared/views.ts) knows the category last used with each note.

## 3. Flow

1. **Pick or share a file** as today (picker, Android share, iPhone shortcut inbox).
2. The file is read as a **grid** (every row as cells). If its header row has Money Manager's columns, the flow is exactly as today. Otherwise it's a bank statement and the mapping step opens.
3. **Match the columns** (`Section`s in the existing look):

```
File   HDFC_Statement_Oct.xls · 214 rows

COLUMNS
Header row              [ Row 22 · "Date, Narration, Chq./Ref.No., …" ▾ ]
Date                    [ Date ▾ ]
Description             [ Narration ▾ ]
Amount is in            ( ) one column   (•) money out / money in columns
Money out               [ Withdrawal Amt. ▾ ]
Money in                [ Deposit Amt. ▾ ]
— or, with one column —
Amount                  [ Amount ▾ ]
Income / expense from   [ The sign: − is money out ▾ ]   (or "+ is money out", or a Dr/Cr column)
Category (optional)     [ None ▾ ]

PAYMENT METHOD
All rows go to          [ HDFC Bank ▾ ]

PREVIEW (first 5)
01 Oct  UPI-SWIGGY-…            − ₹485.00   Food (from your history)
02 Oct  SALARY OCT              + ₹1,20,000  Other income
…
[ Cancel ]                                   [ Continue ]
```

4. **Continue** builds the `ImportRow`s and opens the existing Review (counts, duplicates, skipped rows with reasons, date and decimal format, Import).

### Mapping rules

- **Header row:** the first of the first 30 rows with at least 3 filled cells, one looking like a date header and one like an amount header. Otherwise the first non-empty row. The user can pick another.
- **Date:** parsed with the existing `parseImportDate` + `detectImportFormat` (day-first vs month-first is still decided in the Review). Rows whose date doesn't parse (opening/closing balance lines, totals, blank separators) are skipped with a reason, as today.
- **Amount:** either one column, or two (money out, money in). With two, a row has exactly one of them. With one column, the type comes from the sign (default: negative is money out; for a credit card the default flips, because statements list purchases as positive) or from a Dr/Cr column (values starting with `dr`/`debit`/`w` are money out, `cr`/`credit`/`d` money in). Rows with no amount, or 0, are skipped ("No amount").
- **Type:** money out → expense, money in → income. No transfers: a card bill paid from the bank comes in as an expense, which the user can bulk-edit afterwards (out of scope below).
- **Note:** the description cell, trimmed and with runs of spaces collapsed. Over 80 characters, the note keeps the first 80 and the full text goes in the description.
- **Category:** the mapped column if one is chosen (created if missing, as today). Otherwise the category last used with the same note (exact match, case-insensitive), otherwise "Other" (expense or income). The preview says which.
- **Payment method:** one existing method for the whole file (required). The default is the method whose name or bank name appears in the file name, otherwise the default payment method.
- **Remembered mapping:** saved in `localStorage` under the header row's text. It's only a convenience, so an empty or blocked storage just means guessing again.

## 4. States

- **Empty / unreadable file:** the existing errors ("That file has no columns…").
- **No date or amount column found:** the mapping opens with the selects empty and Continue disabled until Date and an amount are chosen.
- **Every row skipped:** the Review shows "Nothing new to import" with the reasons, as today.
- **Offline:** works offline (it's the same op and queue). The Review's "Waiting for a connection to save…" is unchanged.
- **Phone (390px):** each mapping row is label above select, full width. The preview is a list, not a table.

## 5. Data and code changes

- `src/lib/importFile.ts`: `readGrid(file)` → `string[][]` for CSV and Excel (Excel dates as `YYYY-MM-DD`). `readImportFile` uses the grid plus header detection. A Money Manager–shaped header keeps today's path.
- `src/lib/bankImport.ts` (new, pure, tested): `findHeaderRow(grid)`, `guessMapping(headers, accountKind)`, `toImportRows(grid, mapping, { account, categoryFor })`.
- `src/pages/settings/ImportPage.tsx`: a `ColumnMapping` step before `Review`. The More row "Import from Money Manager" becomes "Import" with the hint "Money Manager or a bank statement (CSV, Excel)".
- Remove `parseXlsx`, `cellToString`, `dropTransferIns` from `src/lib/csv.ts`, and the `read-excel-file` dependency if nothing else uses it.
- No changes to `shared/ops.ts` or `convex/schema.ts`.

Tests (vitest): header detection on an HDFC-style sheet with preamble rows, an ICICI-style Dr/Cr column, a card statement with positive purchases, debit/credit columns with blanks, closing-balance rows skipped, long narrations split into note + description, category from history, and the Money Manager file still taking the old path.

## 6. Out of scope

- PDF statements.
- Pairing transfers between the user's own accounts or card payments within the file (C11 does this for Gmail; a later pass could reuse it here).
- Several payment methods in one file (an "Account" column). Money Manager's format already covers that case.
- OFX / QIF.
- Cleaning bank narrations into merchant names ("UPI-SWIGGY-8812…" → "Swiggy"). That would reuse Gmail's merchant cleaner later.
