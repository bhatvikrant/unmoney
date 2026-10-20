# Spec: Gmail sync

Status: built · 2026-10-20 (steps 1 to 5 in the code; step 6, Google's verification, is paperwork)

## 1. The idea, refined

The user connects their Gmail once. From then on UnMoney reads the mail that banks, cards, UPI apps and shops send about money ("Rs 1,250.00 debited from a/c XX1234 to VPA swiggy@…"), turns each one into a **draft entry**, and drops it into the ledger on its day as a faded row. The user taps the row, checks or fixes what was read, and saves it: the row turns solid and from then on it is an ordinary entry. Nothing counts (balances, stats, budgets, recaps) until it is saved.

What to hold to:

- **Drafts are not entries.** They live in their own table, never in `transactions`, so no read model has to learn to ignore them. A mis-read amount can never move a balance. The same rule the app already follows for files waiting in the import inbox (`pendingImports`) and for AI Tidy-up suggestions: the machine proposes, the user applies, and the apply is a normal op.
- **The user confirms every entry in v1.** No auto-save, however confident the parser is. The faded row *is* the confirmation step, so it costs one tap and a glance. Auto-saving high-confidence drafts is a later, opt-in switch.
- **The server reads the mail, the app never does.** Gmail tokens and message bodies only ever exist inside Convex actions. What is kept per message: its Gmail id, sender, a trimmed subject, when it arrived, and the fields that were extracted. Never the body.
- **Cheap before clever.** Gmail's own search narrows to money mail. Regexes handle the bank-alert formats that make up most of it. Claude is asked only about what is left, several mails per call, with the user's own category and payment-method names so it answers in their vocabulary. The user's history fills in categories before the model is asked (same note last time → same category, as the entry form's autocomplete already does).
- **One transaction, one draft.** A purchase often produces two mails (the bank alert and the shop's receipt). The sync folds them into one draft. A draft that matches an entry the user already typed in by hand is shown as "already added?", not as a new row.
- **Name.** "Gmail" in the UI ("Connect Gmail", "Found in Gmail", "4 from Gmail to review"). Rows are "unsaved" until saved. No "AI" in the labels; the parsing is an implementation detail.

## 2. Where things stand in the code

- Sign-in is Google only through Convex Auth ([convex/auth.ts](../../convex/auth.ts)); it asks for profile scopes only. Gmail access must be a **second, separate consent** (incremental authorisation), not more scopes on sign-in: a user who never connects Gmail should never see a consent screen mentioning their mail.
- HTTP routes already exist on the Convex site ([convex/http.ts](../../convex/http.ts), `/import/<token>`), so the OAuth callback is one more route there.
- Every write is an op in [shared/ops.ts](../../shared/ops.ts) applied by the same reducer on both sides. Accepting or dismissing a draft is a new op; inserting drafts happens on the server only (an `internalMutation`, like `repeats.materialiseAll`), and reaches the app through the normal `sync.table` subscription once `drafts` joins `TABLES`.
- The AI pattern to copy is [convex/ai.ts](../../convex/ai.ts) + [shared/tidyAi.ts](../../shared/tidyAi.ts): the server builds the prompt from the database, calls Claude with a JSON schema, validates the answer against the user's real ids before anyone sees it, uses short ids ("e3", "a2") to save tokens, and logs token counts.
- Crons live in [convex/crons.ts](../../convex/crons.ts); an hourly job that fans out per user is already the shape of `repeats.materialiseAll`.
- Accounts carry `bankName` and `last4` for cards, and a UPI method can be linked to a bank account (`linkedAccountId`). That is enough to match "card ending 1234" and "a/c XX5678" to a payment method.
- Import already has a duplicate rule (same day, account, type, amount, note) in `transactions.importRows`; the draft matcher uses the same key, loosened to ±1 day.
- The uncommitted `split: { app: "unsplit", expenseId }` field on `transactions` is the precedent for a small provenance object; Gmail adds `source: { app: "gmail", messageId }` beside it.
- Delete account purges tables by name in [convex/account.ts](../../convex/account.ts); the two new tables join that list, and the Gmail token is revoked first.
- Destructive confirmations go through `useConfirm()` (ConfirmDialog), never `window.confirm`.

## 3. Connecting

### 3.1 Settings page

More › Data gets a row **Gmail** (value: "Off", or the connected address). It opens `/settings/gmail`.

Not connected:

```
Gmail
Let UnMoney read the mail your bank, cards and shops send about payments, and turn each one
into an entry you can check and save.

• Reads mail only. It cannot send, delete or label anything.
• Keeps the amount, date, merchant and which card: never the mail itself.
• Disconnect any time; saved entries stay, drafts are removed.

Look back   [From now] [7 days] [30 days] [90 days]
[Connect Gmail]
```

Connected:

```
Connected as vik@gmail.com                         [Disconnect]
Last checked 12 min ago · 3 drafts waiting         [Check now]

Senders        alerts@hdfcbank.net, noreply@axisbank.com, … (+ add)
               [x] Also scan mail Gmail files under Purchases
Paused         [ ]

Recent checks  10:40  scanned 12, found 2
               09:40  scanned 0
               …
```

Disconnect asks through the in-app confirm modal, revokes the token at Google, deletes the connection and every open draft, and leaves saved entries and their `source` link alone.

### 3.2 OAuth flow

Same Google Cloud OAuth client as sign-in, with a second redirect URI `https://<deployment>.convex.site/gmail/callback`.

1. **Start.** The app calls action `gmail.connectUrl({ lookbackDays })`. The action builds the Google auth URL with scope `https://www.googleapis.com/auth/gmail.readonly`, `access_type=offline`, `prompt=consent` (so a refresh token is always issued), `include_granted_scopes=true`, `login_hint=<user's sign-in email>`, and `state` = `<userId>.<lookback>.<timestamp>.<HMAC>` signed with `GMAIL_TOKEN_KEY`. The browser navigates there in the same tab.
2. **Callback.** `GET /gmail/callback?code&state` (httpAction). Verify the HMAC and that the timestamp is under 10 minutes old; on `error=access_denied` redirect back with `?gmail=denied`. Exchange the code at `oauth2.googleapis.com/token`, read the address from `gmail/v1/users/me/profile`, encrypt the refresh token (AES-256-GCM, key from `GMAIL_TOKEN_KEY`, fresh IV), upsert `gmailConnections`, schedule the first sync, and redirect to `${SITE_URL}/settings/gmail?gmail=connected`.
3. **Tokens.** Access tokens are minted from the refresh token inside each sync action and never stored. `invalid_grant` (user revoked access in their Google account, or password change) sets `status: "reauth"`; the settings row and a ledger banner say "Reconnect Gmail".

Scope: `gmail.readonly` only. `gmail.metadata` would be cheaper to get verified but gives no bodies, and the amount is in the body.

### 3.3 Google's rules (a real constraint)

`gmail.readonly` is a **restricted scope**. Until the OAuth consent screen passes Google's verification, the consent page shows "Google hasn't verified this app" (users can continue through Advanced), and the app is capped at 100 users. Keep the consent screen's publishing status at **In production** rather than Testing: in Testing, refresh tokens die after 7 days and every user would reconnect weekly.

Verification needs a privacy policy URL, a homepage that explains the feature, a demo video of the consent and the feature, and, for restricted scopes, a CASA security assessment (Tier 2, by an approved assessor, yearly). Budget this as its own task once the feature is worth it; nothing in the build depends on it. The Limited Use policy is met: mail data is used only to show the user their own entries, is not used to train models, and is not shown to humans at UnMoney.

Env vars to add: `GMAIL_TOKEN_KEY` (32 random bytes, base64) on each Convex deployment; `AUTH_GOOGLE_ID`/`SECRET` are already there. `scripts/convex-preview-env.mjs` copies it to preview deployments like the others.

## 4. Data model

```ts
gmailConnections: {
  userId, email,
  refreshTokenEnc: string, iv: string,
  historyId?: string,            // Gmail cursor for incremental sync
  lastSyncAt?: number, lastError?: string,
  status: "ok" | "reauth" | "paused",
  lookbackDays: number,
  senders: string[],             // allowlist, editable; seeded with known bank/UPI/shop senders
  scanPurchases: boolean,        // also scan category:purchases
  accountMap: Record<string, Id<"accounts">>,  // "hdfcbank.net|1234" → the card; learned from the user's picks
  aiMonth: string, aiCalls: number,            // per-user monthly cap on model calls
  log: { at: number; scanned: number; found: number; error?: string }[]   // last 10
}.index("by_user")

drafts: {
  userId,
  source: "gmail",
  messageId: string,             // primary Gmail message; indexable
  extraMessageIds: string[],     // the receipt that was folded into the bank alert, etc.
  threadId: string,
  receivedAt: number,
  from: string, subject: string, // subject trimmed to 120 chars
  proposal: {
    type: "income" | "expense" | "transfer",
    date: string, time?: string,
    amount: number,              // minor units, main currency
    subAmount?: number, subCurrency?: string,   // when the mail was in another currency
    note: string,                // merchant, cleaned ("Swiggy", not "SWIGGY*ORDER 8812-BLR")
    description?: string,        // one line of provenance: "HDFC alert · card ending 1234"
    accountId?: Id<"accounts">, toAccountId?: Id<"accounts">,
    categoryId?: Id<"categories">, subcategoryId?: Id<"categories">,
    accountHint?: { bankName?: string; last4?: string; channel?: "upi" | "card" | "netbanking" | "wallet" },
  },
  confidence: "high" | "medium" | "low",
  how: "rule" | "ai",
  matchedTransactionId?: Id<"transactions">,   // "already added?"
  status: "open" | "accepted" | "dismissed",
  transactionId?: Id<"transactions">,
  resolvedAt?: number,
}
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_user_message", ["userId", "messageId"])

transactions.source?: { app: "gmail"; messageId: string }
```

`drafts` joins `TABLES` in `shared/ops.ts` (snapshot, `loadTable`, `emptySnapshot`) so the app receives it like bookmarks or notes. `gmailConnections` stays server-only; the app reads a safe projection through `gmail.status` (email, status, lastSyncAt, senders, scanPurchases, lookbackDays, log, open draft count).

Retention: resolved drafts are deleted after 90 days by a daily cron step beside `pruneSyncOps`. Open drafts are kept until resolved or disconnected.

### Ops

```ts
"drafts.accept":  { args: TxFields & { id: Id<"drafts"> }; result: Id<"transactions"> }
  // inserts the entry with source: { app: "gmail", messageId }, marks the draft accepted with that id
"drafts.dismiss": { args: { ids: Id<"drafts">[] }; result: void }
"drafts.link":    { args: { id: Id<"drafts">; transactionId: Id<"transactions"> }; result: void }
  // "yes, that's the one I typed in": sets source on the existing entry, draft becomes accepted
```

`OP_TABLES` gives them `["drafts", "transactions", "accounts", "categories"]`; `txScope` for `drafts.link` is `{ ids: [transactionId] }`. The reducer validates like `transactions.create` does (account exists and is not archived, category type matches). `transactions.copy` drops `source` the way it drops `split`.

Learning on accept: the client-side accept also sends the usual `settings`-free hint to the server through the same op? No: keep ops pure. Instead `gmail.sync` reads **saved entries with a `source`** and the draft they came from: when the draft had an `accountHint` and no `accountId`, and the user saved with account X, the sync writes `accountMap["<sender domain>|<last4>"] = X`. The next mail from that card fills in the account without asking. Same idea for categories, but that one needs no table: the sync already looks the merchant up in the user's past entries.

## 5. Sync

### 5.1 When

- Hourly cron `check Gmail` → `internal.gmail.syncAll` lists connections with `status: "ok"` and schedules `internal.gmail.syncUser` for each, spread over the hour (the app has few users; this stays well inside Gmail's quota of a few thousand units per user per second).
- On connect, once, with the chosen lookback.
- "Check now" on the settings page, and when the app comes to the front with `lastSyncAt` older than 15 minutes (the client calls the public action `gmail.syncNow`, rate-limited to one a minute per user).

Push via `users.watch` + Pub/Sub would make it instant but needs a GCP topic and a push endpoint; not for v1.

### 5.2 What `syncUser` does

1. Mint an access token from the stored refresh token.
2. **Find candidate message ids** with one `messages.list` search (`shared/gmail/query.ts`): `after:<unix time>` and one of `from:(<allowlisted senders>)`, `category:purchases` when enabled, or `subject:(debited OR credited OR transaction OR payment OR receipt OR invoice OR order OR spent OR UPI OR txn OR "payment received")`. The first check's window is the lookback the user chose (up to 300 mails); every later one starts two days before the previous check ended (`syncedUpTo`, up to 100 mails), so mail that arrived late is still seen. Ids that already have a draft (`by_user_message`, or folded into one) are dropped before anything is fetched. (The spec first planned Gmail's `history.list` cursor; the dated window is simpler, survives the week-long history expiry, and the dedup makes the overlap free.)
3. **Fetch** each remaining message with `messages.get?format=full`, take the `text/plain` part, else strip the HTML part to text, cap at 4,000 characters, drop quoted replies and signatures.
4. **Triage** (pure, `shared/gmail/triage.ts`): keep a mail only if it has a currency amount pattern (`Rs.`, `₹`, `INR`, `$`, `USD`, `€`, …) and a money verb nearby; drop OTPs, "transaction failed/declined", statements ("your statement is ready"), promos, balance alerts without a transaction. This throws away most of what the Gmail query let through, before any model call.
5. **Rules** (pure, `shared/gmail/rules.ts`): a parser per known format, each returning `{ amount, type, date, last4?, bankName?, channel, merchantRaw, vpa? }` or null. v1 formats, written from real samples: HDFC, ICICI, Axis, SBI, Kotak debit/credit alerts (card, UPI, net banking), the UPI apps' "payment successful" mails, Amazon/Flipkart/Swiggy/Zomato/Uber/Ola order receipts, Apple/Google Play/Netflix/Spotify receipts, credit-card "payment received" (→ transfer). A rule hit with amount + date + type is `confidence: "high"`, `how: "rule"`.
6. **Model** (`convex/gmail.ts` + `shared/gmail/ai.ts`): everything triage kept that no rule parsed, in batches of up to 10 mails per call to `claude-haiku-5-5` with a JSON schema. Input per mail: short id, sender, subject, date received, the text. Shared context: the user's main currency, their expense and income categories as short ids with names (as `tidyAi.buildSummary` does), their payment methods as short ids with name, kind, bankName, last4. Output per mail:

   ```
   { id, isTransaction, kind: "debit"|"credit"|"cardPayment"|"refund"|"other",
     amount: number (major units), currency, date, merchant, accountRef?: short id, accountHint?: {bankName,last4,channel},
     categoryRef?: short id, confidence, reason }
   ```

   Validation before anything is stored: amount > 0 and under a sanity cap, date within 3 days of `receivedAt`, short ids resolve, category type matches the entry type. Anything that fails is dropped and logged, never shown. Per-user cap of 300 model calls a month; past it, rule-parsed mail still becomes drafts and the rest waits ("Gmail: monthly AI limit reached, 14 mails waiting" in the log).
7. **Resolve fields** (pure, `shared/gmail/resolve.ts`):
   - Account: `accountMap[sender domain|last4]` → else `last4` equal to a card or debit card's `last4` → else `bankName` equal to a bank account's `bankName`/name → else a UPI method whose linked account matches → else unset (the row says "Pick payment method").
   - Category: the user's most recent saved entry with the same normalised note (`normNote` from categoryLint) → else the model's `categoryRef` → else unset.
   - Note: merchant cleaned by a small table of known suffixes/prefixes (`SWIGGY*`, `AMZN`, `PAYTM-`, `*BLR`, trailing order ids).
   - Transfer for card payments only when both the bank and the card resolve; otherwise an expense with `description` noting it looks like a card payment, so the user can switch it.
   - Currency: if the mail's currency is not the main one, keep `subAmount`/`subCurrency` and convert with the user's saved rate (`currencies` table) for `amount`, confidence capped at medium.
8. **Dedup** (pure, `shared/gmail/dedup.ts`), in this order:
   - Within the batch and against open drafts: same amount, dates within 1 day, and either same last4 or one side a merchant receipt → fold into the one with the account info; add the other's id to `extraMessageIds`, keep the better note (the merchant's).
   - Against entries: same amount, date within 1 day, same account when both known → `matchedTransactionId` (shown as "already added?", not as a ledger row). Entries that a repeat materialised count too, so a salary mail matches the salary repeat.
9. **Write** through one `internalMutation` per batch: insert drafts (idempotent on `messageId`), update `historyId`, `lastSyncAt`, the log line, the AI counter.

Errors: any step's failure writes `lastError` and a log line and leaves `historyId` untouched, so the next run retries the same window. Three consecutive failures pause the connection with a message in Settings.

### 5.3 What is stored, what is not

Stored: ids, sender, trimmed subject, timing, the proposal, confidence, the log. Not stored: bodies, attachments, headers beyond sender, anything from mails that triage dropped. Console logs carry counts and token usage only, never subjects.

## 6. In the app

### 6.1 Ledger rows

`TransactionsPage` already groups `txs` by day. It also takes the open drafts in the shown range (`draftsRange(snap, from, to)` in views.ts, status open and without `matchedTransactionId`) and hands `TransactionList` a merged list per day, drafts sorted among entries by time. A draft row is the same `TransactionRow` layout, rendered from the proposal, with:

- the whole row at **55% opacity**, a `Mail` icon where the repeat/camera icons go, and "Unsaved" in the secondary line beside the payment method (or "Pick payment method" in the warning colour when none resolved);
- no checkbox in select mode, no swipe-to-delete (swipe would read as "delete an entry"; dismissing happens in the editor or the review page);
- excluded from `DayHeader` sums, `SummaryBar`, calendar and monthly views (those read `txs` only).

Rows are keyed by `source?.messageId ?? _id` for entries and `messageId` for drafts, so when a draft becomes an entry the row keeps its key and does not remount. The row is a `motion.div` animating `opacity` 0.55 → 1 over 300 ms; under `prefers-reduced-motion` it snaps.

Above the list, under `RecapNudge`, when there are open drafts in the shown month:

```
[Mail]  4 entries found in Gmail                                   Review ›
        Tap a faded row to check it and save, or review them all.
```

and when the connection needs attention: "Gmail needs reconnecting" with a link to Settings.

### 6.2 Saving one

Tapping a draft row opens the entry form at `/t/new?draft=<id>` (and `/search/t/new?draft=…` etc., the existing `useOpenEntry` paths) with the proposal filled in and a small banner at the top:

```
[Mail] From alerts@hdfcbank.net · 20 Oct 10:41 · Open in Gmail ↗
```

The primary button reads **Save entry**; a secondary **Not an entry** dismisses it (dismissal is harmless, so no confirm). Saving runs `drafts.accept` with the form's fields; the editor closes and the row behind it fades up. If the account is missing, Save is disabled until one is picked, as it is for a new entry today. "Open in Gmail" links to `https://mail.google.com/mail/#all/<messageId>`.

A saved entry's detail screen keeps the banner (from `source`), so the user can always find the mail an entry came from.

### 6.3 Picking what to import

`/gmail` lists every open draft as a checklist before anything is imported (`src/pages/transactions/GmailReviewPage.tsx`). The header says how many entries were found; every new one starts ticked, and "Select all" covers them. Drafts that look like an entry the user already has sit in a "Maybe already added" group, unticked, with a link button for "same entry". The bar at the bottom shows how many are ticked and what they add up to (out and in), with **Import N** (or **Import all N**) and **Dismiss** (asks first). Unticked drafts stay, here and as faded rows in the ledger, until imported or dismissed.

A gap the mail left is filled the way the entry form would (`shared/gmail/importable.ts`): the default payment method, and the "Other" category of the right type. The row says what was filled in, and tapping it opens the form to change it first. A transfer missing one of its methods cannot be ticked; it has to be opened.

Right after connecting, the settings page shows "Looking for money mail in your inbox…" until the first check finishes, then opens this list. With the "From now" look-back, or when nothing was found, it says so instead.

Keyboard on desktop: `j`/`k` move, space ticks, `Enter` opens, `x` dismisses.

### 6.4 Offline

Drafts arrive with the snapshot, so they show offline once seen. Accept, dismiss and link are ops: applied locally at once, queued, retried. A draft dismissed on the phone disappears on the laptop with the next sync like any other change. Connecting, disconnecting and "Check now" need the network and say so.

## 7. Build order

Each step ships on its own and is useful (or at least harmless) alone.

1. **Model and pure parsing** (no UI, no Google): schema tables, `source` on transactions, `drafts` in `TABLES`, the three ops with reducer tests (`shared/ops` tests), `shared/gmail/{triage,rules,resolve,dedup}.ts` with vitest fixtures built from anonymised real mails (a `shared/gmail/fixtures/` folder of `.txt` bodies with expected JSON). Purge list and the daily prune. Files: `convex/schema.ts`, `shared/ops.ts`, `shared/views.ts` (`draftsRange`), `convex/lib/snapshot.ts`, `convex/account.ts`, `convex/sync.ts`.
2. **Connect and disconnect**: `convex/gmail.ts` (`connectUrl`, `status`, `disconnect`, token crypto in `convex/lib/gmailCrypto.ts`), the callback route in `convex/http.ts`, `src/pages/settings/GmailSettings.tsx`, the row on `SettingsPage`, `GMAIL_TOKEN_KEY` in `.env.example` and the preview-env script, README section for the redirect URI. Testable end to end with your own account on the dev deployment.
3. **Sync**: `syncUser`/`syncAll`/`syncNow`, the Gmail client (`convex/lib/gmailApi.ts`: token refresh, history, list, get, HTML→text), the model call with `shared/gmail/ai.ts` (schema, prompt, validation), the cron, the log. Drafts appear in the database; the settings page shows the log and the count. A dev-only `internal.gmail.dryRun` prints what a sync would create without writing, for tuning the rules on your own inbox.
4. **Ledger and editor**: draft rows, the ledger card, editor prefill and `Save entry`/`Not an entry`, the fade. This is the moment the feature exists for a user.
5. **Review page and learning**: `/gmail`, Save all, "already added?" handling, `accountMap` learning, sender list editing.
6. **Google verification**: consent screen, privacy policy page, demo video, CASA. Independent of the code; starts whenever the feature is worth opening to others.

Later, not now: auto-save of high-confidence drafts (opt-in), Pub/Sub push for instant drafts, SMS or other sources feeding the same `drafts` table (which is why `source` is a field, not a table name), attachments (PDF invoices).

## 8. Open questions

- **Sender seed list.** The first allowlist decides how useful day one is. Start from the user's own inbox: on the first sync, a dry pass over `newer_than:90d` counts which senders carry money mail, and the connect screen offers the top ones with checkboxes before the real sync runs.
- **Refunds.** A refund is a credit to the card or account. v1 proposes it as an income entry with the merchant's name and `description: "Refund"`; some users would rather see a negative expense against the original category. Decide after seeing real ones.
- **Non-INR mail for an INR ledger** (and the reverse): the saved sub-currency rate may be stale; the draft says so in its description and stays medium confidence. Fine for v1.
- **Time.** Bank mails carry the time; the entry form only shows it when `timeInputEnabled`. The draft keeps it; the row sorts by it; the form hides it as it does today.
