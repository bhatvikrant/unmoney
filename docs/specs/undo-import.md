# Spec: Undo an import, and safety copies

Status: built · 2026-10-21 (roadmap C10 in docs/reviews/2026-10-21-product-review.md). Builds on the data-safety fixes (#54): `backupProblem`, the confirmed restore, `bulkRemove { ifPresent }`.

## 1. The idea

Importing a Money Manager export or a bank statement is the scariest thing a new user does. If the wrong file or the wrong date order puts 3,412 entries in the ledger, the only way out today is deleting them one by one, or restoring a backup they probably don't have. Restore, Delete all and a main-currency change are just as final.

- **Undo an import.** Every import is one batch. The Import page lists the last ten with **Undo**, and the "Imported 3,412 entries" toast has **Undo** too.
- **Safety copies.** Just before restoring a backup, deleting all entries, changing the main currency or undoing an import, the app keeps a full backup **on this device** for a week. Backup & data › **Safety copies** can **Put back** or **Download** it.

## 2. UX

| Where | What |
|---|---|
| Import › success toast | "Imported 3,412 entries · Undo" (10 s). |
| Import page › Recent imports | One row per import: file name, when, "3,380 of 3,412 entries still here", **Undo**. Once undone: "· undone", no button. Hidden while there are none. |
| Undo confirm (`useConfirm`) | "Undo the import of MoneyManager.xlsx? Its 3,380 entries are deleted, including any you edited since. Payment methods and categories it created stay. A safety copy is kept on this device for a week (Backup & data)." |
| Backup & data › Safety copies | One row per copy: "21 Oct 2026, 15:41 · Before restoring a backup · 3,412 entries", with **Download** and **Put back**. Footer: "Kept on this device only, for 7 days." Hidden while there are none. |
| Put back confirm | "It replaces ALL current data with what you had before …. A copy of what you have now is kept first." |
| Restore / Delete all confirms | "This cannot be undone" becomes "A safety copy … is kept on this device for a week". |

States: offline works (the undo is ordinary queued ops). A device that can't store a copy (private mode, storage full) shows "Couldn't keep a safety copy on this device. Download a backup first…" and goes on. An empty ledger keeps no copy.

## 3. Data and code

- `transactions.importId?: string`, and `settings.recentImports?: { id, name, at, count, undoneAt? }[]` (newest first, at most 10).
- `transactions.importRows` takes `batch: { id, name }`. Every chunk of one file sends the same batch. It stamps `importId` on what it inserts and adds the count to the batch's line, creating the line on the first chunk that inserts anything. An import where nothing was new isn't listed.
- `useBulkOps().undoImport(id)` (src/lib/bulk.ts): a safety copy, then the batch's entries removed in chunks of 500 with `bulkRemove { ifPresent }` (as Delete all does), then `settings.update` marks the line undone. It reads the latest data through a ref, so the toast's Undo works after the import screen has closed.
- `src/lib/safetyCopy.ts`: its own IndexedDB database (`unmoney-safety`), so the replica's schema is untouched. It keeps the newest 3 per user and drops anything older than 7 days (`expiredCopies`, tested). It is cleared on sign-out with the rest of the device's data. `useBulkOps` saves one before `restore`, `wipeAll`, `changeMainCurrency` and `undoImport`. Putting a copy back is `bulk.restore`, so it saves a copy of now first.

## 4. Out of scope

- Undoing the payment methods and categories an import created (they may be used since).
- Server-side safety copies (Convex storage), so another device could put one back. A copy holds a whole backup, and the device is where the user just acted.
- An "Undo" for Gmail bulk import (the quick-ux PR adds Undo for Gmail actions).
