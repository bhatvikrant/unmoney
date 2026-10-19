# Spec: Split on UnSplit

Status: built · 2026-10-20

## 1. The idea

Some of what you record in UnMoney was paid for other people too: the dinner you covered, the hotel on a trip. [UnSplit](https://github.com/bhatvikrant/unsplit) is where that gets settled. So: **pick entries in UnMoney, tap Split, and they turn up in UnSplit as one expense ready to be shared; once it is saved you are back in UnMoney, and the entries carry a link to the split.**

The two apps share nothing but the user's Google account: separate Convex deployments, separate auth. Rather than tokens, a shared API or cross-deployment auth, the integration is **two URLs**:

1. UnMoney → UnSplit: `https://unsplit.vercel.app/expenses/new#unmoney=<payload>`
2. UnSplit → UnMoney: `https://unmoney.vercel.app/unsplit/return#unsplit=<payload>`

Both payloads are base64url JSON in the URL **fragment**, which the browser never sends to a server, so no amounts or notes end up in Vercel's or Convex's logs. There is nothing to configure on either deployment and nothing to keep secret.

## 2. What goes over

`src/lib/unsplit.ts` builds the handoff from the chosen entries:

- **Only expenses.** Income and transfers have no one to share them with; the dialog says how many were left out.
- **One entry** goes as it is: its note becomes the description, its description the notes, its amount and date as they are.
- **Several entries** become **one expense with a line per entry** (UnSplit's itemised split), so each line can go to different people. The description is the notes joined ("Dinner, Taxi, Hotel"; past three, "Dinner, Taxi and 2 more"), the date is the earliest entry's, the total the sum.
- Amounts travel as **decimal strings in the main currency** ("1245.50"), so neither app's decimals setting matters. UnSplit uses the currency when it is one it knows, otherwise the user's default there.
- The entries' **category name** goes along; UnSplit guesses its own category from it (its keyword list grew a few generic words for this), else from the description.
- The entries' **ids** go along and come back, so UnMoney knows which entries to link.

Entries made offline that have not synced yet still have temporary ids, so the dialog asks to wait for them.

## 3. The flow

1. **UnMoney.** In the ledger or Search, select entries and tap **Split** in the action bar; or open an expense and tap **Split on UnSplit** under its photos. A dialog says what will happen and leaves for UnSplit (same tab).
2. **UnSplit** lands on `/expenses/new`, outside the sign-in gate. It checks the payload field by field, puts it in `sessionStorage` (signing in with Google leaves and re-enters the app) and goes to the dashboard, which opens the add-expense form from it: description, amount, currency, date, notes, a guessed category, and for several entries the itemised lines with everyone on every line. A line at the top says it came from UnMoney. A handoff older than an hour is dropped.
3. The user picks the group or friend and who paid, adjusts anything, saves. UnSplit then sends the browser back to UnMoney with the new expense's id.
4. **UnMoney** on `/unsplit/return` runs `transactions.setSplit` on the entries (an op like every other write, so it works offline and syncs), toasts with an Open link, and opens the first entry.

Afterwards each linked entry shows a small people icon in lists, and its editor has a **Split on UnSplit ↗** link to the expense and an **Unlink** button. Copying an entry does not copy the link. Splitting an already-linked entry again replaces the link.

## 4. What it does not do

- Nothing flows back after the link: settling up in UnSplit does not create income or transfers in UnMoney, and deleting the expense there leaves the link (it will open UnSplit's "not found").
- No bulk split into several separate expenses; several entries always become one itemised expense (switch the split method in UnSplit if equal is wanted).
- Saved offline in UnSplit, the expense has no real id yet, so there is no trip back and no link.
- Local development: point `VITE_UNSPLIT_URL` (UnMoney) and `VITE_UNMONEY_URL` (UnSplit) at each other; both default to the live apps.
