# Spec: fill-ups from Unfuel

Status: built, on the dev deployment, not in production · 2026-11-27

## 1. The idea

[Unfuel](https://github.com/bhatvikrant/unfuel) keeps a fuel log: mileage and cost per kilometre from a photo of the bill and the odometer. Every fill-up is also an expense, and typing it a second time here is the kind of work UnMoney exists to remove. So: **make a link in UnMoney, paste it into Unfuel, and each fill-up sent from Unfuel is added here as an expense.** In Unfuel it is a button on a fill-up, or a switch that sends every one.

The two apps share nothing but the user's Google account: separate Convex deployments, separate auth. The UnSplit hand-off does that with two URLs the browser follows, which needs the user in front of both apps. A fill-up can be read by AI on Unfuel's server while its app is closed, so this one is **server to server**: Unfuel's Convex action posts to an address on UnMoney's Convex site. The same idea as the iPhone import link (`convex/imports.ts`).

## 2. The link

More › Unfuel (`src/pages/settings/UnfuelSettings.tsx`, `/settings/unfuel`):

- The user picks **where fill-ups go**: a payment method and an expense category (with a subcategory if they like). A post carries an amount and a date and nothing about this ledger, so this is asked once, here.
- **Copy Unfuel link** makes `https://<deployment>.convex.site/unfuel/<token>` and shows it once. Only the SHA-256 of the token is stored (`unfuelLinks`). One link per user; a new one turns the old one off; **Turn off link** deletes it.
- Where fill-ups go can be changed later without a new link (`unfuel.setTarget`).
- The page shows when the link was made, how many fill-ups have come through and when the last did.

A leaked link can add expenses to that one payment method and category. It reads nothing and reaches nothing else.

## 3. The post

`POST /unfuel/<token>` (`convex/unfuel.ts` `receive`), JSON:

```json
{ "v": 1, "source": "unfuel", "ref": "<Unfuel's fill-up id>", "amount": "1000.00", "currency": "INR",
  "date": "2026-11-27", "time": "18:04", "note": "Fuel", "description": "9.72 L petrol · My vehicle · HP Koramangala", "category": "Fuel" }
```

- `amount` is a decimal string in major units, so neither app's decimals setting matters.
- `time` may be null. `note` and `description` are cut to 60 and 200 characters. `category` is Unfuel's word for it and is ignored: the link says the category.
- Every field is checked; a body that is not this is refused whole.

The reply is one plain sentence Unfuel shows to the rider:

| Status | When |
| --- | --- |
| 200 "Added to UnMoney." | the expense was added |
| 200 "Already in UnMoney." | this `ref` was added before |
| 400 | not a fill-up |
| 401 | the link was never made, was turned off or was replaced |
| 413 | more than 10 KB |
| 422 | the fill-up is in another currency than the main one; or the link's payment method or category is gone |

## 4. The entry

`unfuel.addEntry` adds the expense **through the same reducer the app uses** (`runOps` with a `transactions.create` op), as the repeats job does. So the entry gets a change number and every device's copy picks it up like any other; nothing about it is special afterwards.

- **Once per fill-up.** The op's id is `unfuel_<ref>` and is recorded in `syncOps`, as a device's ops are. Unfuel retries a post whose reply it never got; the same `ref` adds nothing. (`syncOps` rows are pruned after 30 days. Unfuel's retries end within an hour and it never sends a fill-up it has marked as sent, so a `ref` does not come back that late.)
- **A refusal is not recorded.** Once the user has picked another payment method, the same fill-up goes through.
- **Main currency only.** A fill-up in another currency would need a rate nobody gave. It is refused with the reason, not guessed.

## 5. What it does not do

- Nothing flows back, and nothing follows an edit: changing or deleting a fill-up in Unfuel leaves the entry here as it is, and the other way round.
- The entry carries no mark that it came from Unfuel beyond its description. (`transactions.source` is Gmail's.)
- No photo comes over.
- Local development: Unfuel only posts to hosts listed in its `UNMONEY_HOSTS` (the production Convex site by default), over `https`. A local UnMoney beside a local Unfuel works once Unfuel's deployment lists it (`bunx convex env set UNMONEY_HOSTS 127.0.0.1:<site port>`): plain http is accepted for this machine's own address only, and only when listed.

## 6. Checked

- `convex/unfuel.test.ts` here posts what Unfuel's `convex/app.test.ts` asserts it sends.
- By hand on 2026-11-27, both apps on local backends: a link made on this page and pasted into Unfuel; a fill-up sent with Unfuel's button and another sent on its own with "Send every fill-up" on both arrived as expenses with the right date, amount, note and description; a repeated post added nothing; with the link turned off, Unfuel showed this app's sentence and a Try again button.
