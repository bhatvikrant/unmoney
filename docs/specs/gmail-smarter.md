# Spec: Gmail sync, smarter

Status: built · 2026-10-21 (roadmap C11 in docs/reviews/2026-10-21-product-review.md). Builds on docs/specs/gmail-sync.md and the data-safety fixes (#54).

## 1. The idea

Gmail sync reads well, but it forgets. Once a user renames "Paytmqr28…" to "Chai stall · Food", the next mail from that UPI id starts blank again. It double counts: money moved from HDFC to ICICI arrives as an expense and an income, and a card bill as an expense plus a transfer. It can't be told "this sender never sends money mail". And an AI guess about mail from a sender the user never listed gets ticked for import like a bank alert.

## 2. What changes

1. **Merchant memory.** When a draft is saved, the merchant as the mail named it is remembered with the note and category the user saved it with. The next mail from that merchant starts with them, overriding the rules' and the model's guesses. Learned on each check from the last 200 saved drafts, like the card memory (`accountMap`).
2. **Transfers between the user's own methods.** Two mails about the same money are one transfer draft:
   - a debit from one method and a credit into another of the user's methods (same amount, within a day, neither a shop's receipt, not the same money such as a bank and its linked UPI): **from → to**;
   - a bank's "debited towards your card" and the card's "payment received" (already a transfer): the debit folds into it, **from the account the bank named**.
   This works within one check, and against a draft still waiting from an earlier check, which becomes the transfer. The draft says "… · paired with the other side's mail" and drops to medium confidence, so it is checked before saving.
3. **Mute a sender.** A bell-off button on each review row: "Stop reading mail from offers@swiggy.in?" (`useConfirm`). Its waiting drafts are dismissed, it comes off the allowlist if it was on it by that exact address, and it is left out of the Gmail search (`-from:(…)`) and skipped if it slips through. A toast offers Undo. Settings › Gmail › **Never read** lists muted senders, each with a remove button.
4. **Unknown senders start unticked.** A draft the AI read from a sender not on the allowlist (it came in through Purchases or a money word in the subject) starts unticked on the review page, like "already added?" ones, with "Sender not on your list, so unticked". Select all still ticks everything.

## 3. Data

- `drafts.merchant?: string`: the cleaned merchant as read, before memory replaced the note. It is the key memory learns under, so a corrected note doesn't hide the raw merchant.
- `gmailConnections.merchantMap?: Record<key, { note, categoryId?, subcategoryId? }>`: the key is `merchantKey` (lower-case letters and digits, since a database field name can't hold just anything), capped at 400, newest last. `gmailConnections.muted?: string[]` holds addresses.
- `shared/gmail/learn.ts`: `merchantKey`, `learnMerchants` (only income and expense of the draft's own type, live categories, later saves win), `mergeMerchants`, `applyMerchantMemory` (a category of the wrong type is not used).
- `shared/gmail/dedup.ts`: `transferBetween`, and `foldDrafts(batch, open, accounts)` pairs after folding receipts. A `Fold` can carry `transfer`, which `writeSync` applies to an open draft.
- `buildQuery({ …, muted })`, the `gmail.muteSender { from, muted }` mutation, and `gmail.status` returns `muted`.

## 4. Out of scope

- Learning from drafts the user dismissed ("this merchant is never money").
- Pairing three-way moves, or transfers through a wallet.
- Suggesting senders to add from what the user accepts (open question in gmail-sync.md §8).
- SMS alerts (roadmap C12).
