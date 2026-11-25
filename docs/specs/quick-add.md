# Spec: Quick add

Status: built · 2026-10-21 (roadmap D13 in docs/reviews/2026-10-21-product-review.md)

## 1. The idea

The daily coffee, the metro top-up and the lunch are the same entry every time, but each one still takes the full form. Money Manager's widget only opens the app, and a PWA can't have home-screen widgets at all. Quick add makes a repeat purchase **two taps** inside the app, and **zero taps after a Shortcut** outside it.

- **Hold the +** in the ledger (right-click on desktop, or press **Q**): a sheet with the first four bookmarks and **Again: <last entry>**. A tap saves it for today, with **Undo** and **Open** in the toast.
- **Bookmarks page:** a **+** on each row saves that bookmark for today. Tapping the row still opens the form, as before.
- **Links** that open a filled-in form, or save straight away with `save=1`. They work from iOS Shortcuts ("Open URLs"), Back Tap, Android shortcuts, or a home-screen bookmark.

## 2. Links

```
/t/new?amount=40&category=Food/Coffee&account=Cash&note=Chai&tags=office
/t/new?amount=40&category=Food&note=Chai&save=1
/t/new?bookmark=<id>&save=1          (Bookmarks › edit › link icon copies this)
/t/new?to=Savings&account=Bank&amount=5000&save=1   (a transfer)
```

| Param | Meaning |
|---|---|
| `amount` | Major units. A decimal comma from the phone's locale ("1,50") works, and so does a thousands mark ("1,250"). The sign is ignored. |
| `category` | Name or id. `Food/Coffee`, or `sub=Coffee`, names a subcategory. Without `type`, an income category makes it income. |
| `account`, `to` | Payment method name or id. Matching ignores case, and a unique start of a name is enough. `to` makes it a transfer. |
| `type` | `income`, `expense`, `transfer` (the first letters are enough). |
| `note`, `tags` (comma-separated), `date` (`YYYY-MM-DD`, default today) | |
| `save=1` | Save without the form and go to the ledger. It needs an amount and a category (or a `to` account). The payment method falls back to the default one. If anything is missing or a name isn't found, the form opens filled in as far as it goes, and a toast says what's missing ("Couldn't find category "Fod""). |

A link is acted on once per history entry, so going back and forward doesn't save twice. The link params are dropped from the ledger's URL when the entry closes (they join `ENTRY_PARAMS`).

## 3. What the sheet offers

`quickItems(snap)` in `shared/quickAdd.ts`:

- the first four bookmarks in the user's order that can be saved as they are: an amount above 0, and an account and category that still exist;
- then the entry added last by hand (not one a repeat schedule or installment made), unless it is the same as a bookmark already offered (same type, accounts, category, amount and note).

Empty state: "Bookmark an entry you add often (open it and tap the star) and it shows here, ready to add in one tap." Below: **All bookmarks** and **New entry**.

## 4. Data

No new ops or fields. Everything saves through `transactions.create`, so offline works and Undo is `transactions.remove`. Pure helpers in `shared/quickAdd.ts` (`quickItems`, `fromTemplate`, `templateUsable`, `parseEntryLink`, `linkEntry`) are covered by `shared/quickAdd.test.ts`.

## 5. From a sentence (AI)

Added 2026-11-25. For people the superadmin turned AI on for, a new entry has a one-line box above the form: type or dictate "450 swiggy dinner hdfc yesterday", tap **Fill in**, and the form is filled in to check (type, amount, date, time if given, note, description, category, payment method, and the receiving one for a transfer). It never saves; what the sentence does not say keeps the form's default, and what it does say replaces what was in the form. Dictation is the phone keyboard's own: there is no speech API.

- `shared/quickAi.ts`: what is sent (`buildQuickNames`: names of categories and payment methods, currency codes, the 60 most-used notes with their category; never entries or amounts), the prompt and schema, `quickRequest`, and `validateQuick`, which drops anything that is not one of the person's ids, a sane amount, a real date from the last year or the next 31 days, or a note in their own words.
- `convex/ai.ts` `quickEntry`: Haiku 5.5 at low effort, 300 sentences a month per person (`QUICK_MONTHLY_CAP`), 200 characters a sentence. The names are cached between sentences typed in a row.
- Offline, on a failure or at the cap: one line in a toast, and the form is left as it was.

## 6. Out of scope

- A real home-screen widget (not possible for a PWA).
- Choosing which bookmarks the sheet shows apart from their order (reorder them on the Bookmarks page).
- Amount prompts in the link ("ask me the amount"). An iOS Shortcut can ask for it and put it in the URL itself.
- A ready-made `.shortcut` file for quick add (the import Shortcut's signing setup could produce one later).
