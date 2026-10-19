# Spec: Monthly recap

Status: draft · 2026-10-19 · mockup: [monthly-recap-mockup.html](monthly-recap-mockup.html) (open it in a browser; tap the phone to step through)

## 1. The idea, refined

At the start of every month, the app tells the story of the month that just ended: **what you spent, where it went, what stood out and what changed**, as a short run of full-screen cards you tap through, the way Spotify Wrapped does. It takes about 30 seconds, and it is kept: every finished month's recap stays reachable from the Stats tab.

What makes it work, and what to hold to:

- **One idea per card.** A small uppercase lead-in ("YOU SPENT"), one big number or one short sentence, one line of context. Nothing scrolls inside a card.
- **Spending first.** The user asked for a recap of spends. Income, savings and budgets get one card at the end, and only when there is something to say.
- **Every number is one the user can find elsewhere.** The recap is computed with the same functions as the Stats tab (`statsEntries`, `kindsOf`), so the total on card 2 is exactly the Expenses figure for that month on Stats. No new way of counting.
- **Cards that don't apply are skipped.** No previous month: no "What changed". No income logged: no "In vs out". So the recap is 6 to 9 cards, never padded.
- **Not a modal, not a notification.** It arrives as a card at the top of the ledger during the first week. Push notifications are not set up in the app and are out of scope.
- **Name.** "Recap" everywhere: "Your September recap is ready", "September recap" on Stats, route `/recap/2026-09`. Short, says what it is, no "Wrapped" (a Spotify brand) and no "Report" (sounds like work).

## 2. Where things stand in the code

- Every screen renders from the local snapshot (`src/lib/store.tsx`); read models are pure functions in [shared/views.ts](../../shared/views.ts). The recap is one more read model: **nothing has to be stored on the server for it**, because every past month's data is already on the device. A recap of a month that was edited later simply shows the edited numbers, which is the honest behaviour.
- Logical months: [shared/period.ts](../../shared/period.ts) has `monthKey`, `monthRange(key, monthStartDay)`, `monthKeyForDate`, `shiftMonthKey`. With `monthStartDay` 25, "2026-09" is 25 Sep to 24 Oct and the recap must say so in its subtitle. The month label everywhere is `monthLabel()` from `src/lib/format.ts` ("Sep 2026").
- Stats: [StatsPage.tsx](../../src/pages/stats/StatsPage.tsx) is the natural permanent home. It already knows the month shown (`useStatPeriod`) and whether the period is monthly.
- Ledger: [TransactionsPage.tsx](../../src/pages/transactions/TransactionsPage.tsx) renders `SummaryBar` under the view tabs; the nudge card goes right under it.
- A one-time, per-device prompt already exists in [MoneyManagerPrompt.tsx](../../src/components/MoneyManagerPrompt.tsx) (localStorage keyed by user id). The recap's "seen / dismissed" marker follows the same pattern.
- Charts: `colorAt(i, n)` in [charts.tsx](../../src/pages/stats/charts.tsx) gives the category colours in rank order; the recap's "Where it went" card uses the same ranking so Food is the same blue it is on Stats.
- Keyboard and swipe helpers: `useShortcuts` and `useSwipe` in `src/lib/shortcuts.ts`.
- Full-screen routes outside the shell already exist (`Onboarding`, `Lock` render instead of `AppShell`). The recap route sits beside `AppShell` in `App.tsx`, so there is no sidebar or tab bar behind it.

## 3. Where it appears

### 3.1 Ledger card, first week of the month

A card under the summary bar on the Transactions tab (mockup, section 1, left):

```
[Sparkles]  Your September recap is ready                         ×
            What you spent, where it went and what changed. About 30 seconds.
            [See recap]
```

- Shown while **today is within the first 7 days of the current logical month** (day 1 to 7 counted from `monthStartDay`), and the previous logical month has **at least 5 expense entries**.
- "See recap" opens `/recap/<prev month>`. × hides it for that month.
- It is a card, never a dialog: the home-screen "Add" shortcut opens the entry form straight away and nothing should sit on top of it.
- It renders on the ledger only when the ledger shows the current month, so a user browsing an old month isn't nagged.

### 3.2 Stats row, always

On Stats in Monthly mode, a row directly under the Income / Expenses tabs (mockup, section 1, right):

```
[Sparkles]  September recap                                        ›
            9 cards · what you spent, where, what changed
```

- Shown for **every finished logical month with at least 5 expense entries**. Stepping to an older month shows that month's row, so recaps are reachable forever.
- Not shown for the current month (the month isn't over). Not shown for empty months.
- The card count in the hint is real: it comes from the computed recap.

### 3.3 Marker: seen and dismissed

Per device, like the Money Manager prompt: `localStorage["unmoney.recap.<userId>"] = "<monthKey>"` set when the recap for that month is opened or its card dismissed. The ledger card shows only while the stored key is older than the previous month.

Later, if it matters that phone and desktop agree: a `recapSeenMonth` field on `settings`, written with the existing `settings.update` op. Not needed for v1.

## 4. The recap screen

Route `/recap/:month`, full screen, outside `AppShell`. Phone: the card fills the screen. Wide screen: a 420 × 560 card centred on the page background with arrow buttons either side (mockup, section 4).

Chrome:

- **Progress segments** across the top, one per card, in `foreground` at 15% with the done ones solid, exactly as story UIs do.
- **×** top right closes: back to where it was opened from, falling back to `/stats?month=<key>` (`useGoBack`).
- **Navigation:** tap the right 65% of the card for next, left 35% for back; horizontal swipe; `←` `→`; `Esc` closes. The last card's "Done" closes too.
- **Transitions:** a 220 ms fade with a 16 px slide, via Framer Motion's `AnimatePresence`, off under `prefers-reduced-motion`.
- No autoplay. People read numbers at their own pace.

### 4.1 Card layout

Every card has the same bones, top to bottom:

1. `label`: xs uppercase tracked muted text, the app's section-label style.
2. The one thing: either a **big number** (48 px, semibold, tabular, tight tracking; the expense colour when it is money spent) or a **headline sentence** (22 px semibold).
3. One or two **context lines**, 15 px muted, with the key figure in `foreground` medium weight.
4. An optional small visual: a stacked bar, a 30-bar strip, two or three stat tiles.
5. A **footnote** pinned to the bottom, xs muted: a second fact, and sometimes a link ("Open ›").

Type sizes above the app's usual 14 px are the only new scale; everything else is the existing tokens.

### 4.2 Colour

Each card gets a faint **tint**: one of the eight `--chart-N` hues mixed into the page background at 9% (14% in dark mode). That is what gives the run its Wrapped-like rhythm while staying inside the app's palette.

- Mix with `color-mix(in srgb, …)`, not `oklch`: the app's greys are written as `oklch(… 0 0)` with an explicit hue of 0, and an oklch mix drags every tint toward red (found while building the mockup).
- The mockup has a "Plain cards" toggle. If the tint feels like too much, the plain variant is the same screens on `bg-background`, and nothing else changes.

### 4.3 The cards

In order. "Skip when" lists the condition under which a card is left out.

| # | Card | Lead-in | The one thing | Context | Skip when |
|---|---|---|---|---|---|
| 1 | Cover | `SEPTEMBER 2026 · 1–30 SEP` | "Your September recap" | entries and days tracked; card count; "Tap to start" | never |
| 2 | Total spent | `YOU SPENT` | total expenses, expense colour | ↑/↓ % vs previous month (a drop is drawn in the income colour, a rise in the expense colour); daily average | never |
| 3 | Where it went | `WHERE IT WENT` | "Food took the biggest slice" | stacked bar + top 3 categories with % and amount, then "N other categories"; footnote: top category's entry count and average | fewer than 2 categories |
| 4 | Biggest single spend | `BIGGEST SINGLE SPEND` | the amount | note, category, payment method, date; "22% of the month in one go"; footnote: 2nd and 3rd; "Open ›" opens the entry | never (there is at least one entry) |
| 5 | Your days | `YOUR DAYS` | "Busiest: Sat 12 Sep" | amount and entry count that day; 30-bar strip with the busiest bar solid and no-spend days as stubs; tiles: no-spend days, weekend share | never |
| 6 | On repeat | `ON REPEAT` | most frequent note, e.g. "\"Coffee\" · 22 times" | total and average; tiles: most used payment method with its share, scheduled (repeat) entries' total and count; footnote: next two notes | no note appears 3+ times and no repeats (then the payment-method tile alone would be thin) |
| 7 | What changed | `WHAT CHANGED SINCE AUGUST` | the biggest mover, e.g. "Shopping doubled" | up to 4 rows: risers (expense-tinted ↑) and fallers (income-tinted ↓), with before → after and the delta; footnote: the threshold | no previous month with entries, or no category moved by more than 5% of the month's total |
| 8 | In vs out | `IN VS OUT` | "30%" + "of what came in, kept" | income / spent / kept rows and bar; a budgets tile ("4 of 5 held · Food went over by ₹1,140") when budgets exist; footnote: last month's kept % | no income that month (then budgets, if any, become their own small card) |
| 9 | Closer | `SEPTEMBER IN ONE CARD` | six tiles: spent (with vs last month), top category, biggest spend, kept %, no-spend days, on repeat | buttons: **Open September in Stats** (primary), **Copy summary**; "Done" | never |

Wording rules:

- Say "less" / "more" rather than "down" / "up" for money; use the arrow glyphs for the sign.
- A drop in spending reads as good: income colour. A rise: expense colour. Nothing else is red or blue.
- Notes are matched case-insensitively and trimmed ("coffee", "Coffee " are one). Empty notes are skipped for card 6.
- Percentages are rounded to whole numbers; amounts use `fmt()` like everywhere else.
- Previous-month comparisons compare logical months of the same `monthStartDay`.

"Copy summary" writes plain text to the clipboard, e.g.

```
September 2026 · UnMoney
Spent ₹84,310 (8% less than Aug) · Top: Food 31% · Biggest: Flight to Goa ₹18,400
Kept 30% of income · 5 no-spend days · "Coffee" ×22
```

Sharing an image of the closer card is a later step (needs an html-to-image dependency); the text copy is enough for v1.

### 4.4 Edge cases

- **Few entries.** The thresholds above keep thin months out. A month with 5 entries and one category still produces cards 1, 2, 4, 5, 9.
- **Month start day ≠ 1.** Cover subtitle shows the real range ("25 Sep – 24 Oct"); the 30-bar strip has as many bars as the range has days.
- **Credit cards in lump-sum mode, transfers-as-expense, fees.** Counted exactly as Stats counts them (via `statsEntries`), so "Transfer to Savings" can appear as a category on card 3 if the user set that account to count as expense, same as on Stats.
- **Uncategorised entries** show as "Uncategorised", same as Stats.
- **Deleted payment method** on the biggest spend: "(deleted account)", the same fallback `accountName()` uses.
- **Opened by URL** for a month with nothing in it: the screen shows the app's `EmptyState` ("Nothing recorded in Sep 2026") with a Close button.
- **Offline:** everything is local; works.

## 5. Data

A new pure module, `shared/recap.ts`:

```ts
export type RecapCard =
  | { kind: "cover"; range: Range; entries: number; days: number; count: number }
  | { kind: "total"; amount: number; prev?: number; perDay: number }
  | { kind: "categories"; total: number; top: { id: string; name: string; amount: number; pct: number }[]; rest: { count: number; amount: number } }
  | { kind: "biggest"; tx: Tx; share: number; runnersUp: { note: string; amount: number }[] }
  | { kind: "days"; perDay: { date: ISODate; amount: number; count: number }[]; busiest: ISODate; noSpend: number; weekendShare: number }
  | { kind: "repeat"; note?: { text: string; count: number; amount: number }; nextNotes: { text: string; count: number }[]; account?: { name: string; share: number }; scheduled?: { amount: number; count: number } }
  | { kind: "changes"; prevLabel: string; movers: { id: string; name: string; before: number; after: number }[] }
  | { kind: "inout"; income: number; spent: number; keptPct: number; prevKeptPct?: number; budgets?: { held: number; total: number; worst?: { name: string; over: number } } }
  | { kind: "closer" };

export function monthRecap(snap: Snapshot, month: MonthKey): { cards: RecapCard[]; range: Range } | null;
export function recapNudge(snap: Snapshot, today: ISODate): MonthKey | null; // the previous month, when today is in the first 7 days and that month qualifies
export const RECAP_MIN_ENTRIES = 5;
export const RECAP_NUDGE_DAYS = 7;
```

`monthRecap` returns `null` below the entry threshold. The UI maps each `kind` to a card component and never computes a number itself.

## 6. Build plan

1. **Model** — `shared/recap.ts` + `shared/recap.test.ts`. Tests: the total equals `statsByCategory(...).total` for the same range; card skipping (no income → no `inout`, no previous month → no `changes`); `recapNudge` across a month boundary and with `monthStartDay` 25; note grouping ignores case.
2. **Screen** — `src/pages/recap/RecapPage.tsx` (route, chrome, navigation, wide layout), `src/pages/recap/cards.tsx` (one small component per `kind`), tint and type styles as Tailwind classes. Route in `App.tsx` beside `AppShell`.
3. **Entry points** — `RecapNudge` card on `TransactionsPage` under `SummaryBar`; recap row on `StatsPage` under the type tabs; the localStorage marker in `src/lib/recap.ts`.
4. **Polish** — Framer Motion transitions with reduced-motion off switch; "Copy summary"; the `Esc` / arrow shortcuts.

Phases 1 and 2 can be built in parallel against the `RecapCard` types; 3 depends on 1.

## 7. Later, not now

- Share as image (closer card → PNG).
- `recapSeenMonth` on settings so the nudge is dismissed on every device at once.
- A yearly recap in January, built from the same cards with 12 months in place of 30 days.
- A PWA push notification on the 1st (needs a push subscription flow the app doesn't have).
