# Spec: Monthly recap

Status: draft · 2026-10-19 (cards redesigned the same day) · mockup: [monthly-recap-mockup.html](monthly-recap-mockup.html) (open it in a browser; tap the phone to step through)

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

- **Progress segments** across the top, one per card, in `foreground` at 15% with the done ones solid, exactly as story UIs do. The current one fills over 5 s.
- **Pause / play** beside × (or `Space`); hidden on the last card.
- **×** top right closes: back to where it was opened from, falling back to `/stats?month=<key>` (`useGoBack`).
- **Navigation:** tap the right 65% of the card for next, left 35% for back; horizontal swipe; `←` `→`; `Esc` closes. The last card's "Done" closes too.
- **Transitions:** a 220 ms fade with a 16 px slide, via Framer Motion's `AnimatePresence`, off under `prefers-reduced-motion`.
- **Autoplay:** each card moves on by itself after 5 s; the last card waits for Done. Holding the card down (finger or mouse) pauses it, and letting go carries on from where it was; a release after a hold of 300 ms or more does not count as a tap. It also waits while a drawer is open (§4.4), while the tab is in the background, and while paused with the button.

### 4.1 Card layout

Every card has the same bones, top to bottom:

1. `label`: xs uppercase tracked muted text, the app's section-label style, with a 6 px square in the card's tint colour before it.
2. The one thing: either a **big number** (60 px, semibold, tabular, tracking −0.04em; the expense colour when it is money spent) or a **headline** (24 px semibold; 44 px for the cover month and the "On repeat" note).
3. One or two **context lines**, 15 px muted, with the key figure in `foreground` medium weight.
4. A **visual that fills the middle** of the card (`flex: 1`, vertically centred). Every card has one; this is what keeps the cards from reading as a number sitting over empty space.
5. A **footnote** pinned to the bottom, xs muted: a second fact, and sometimes a link ("Open entry ›").

Padding 56 px top (under the progress segments), 24 px sides, 28 px bottom. Type sizes above the app's usual 14 px are the only new scale; everything else is the existing tokens. Visual elements reuse the app's own shapes: bordered `bg-card` lists and tiles at the app's radius, rows with hairline dividers, 3 px-radius colour swatches.

### 4.2 Colour

Each card gets a faint **tint**: one of the eight `--chart-N` hues mixed into the page background at 9% (14% in dark mode). That is what gives the run its Wrapped-like rhythm while staying inside the app's palette.

- Mix with `color-mix(in srgb, …)`, not `oklch`: the app's greys are written as `oklch(… 0 0)` with an explicit hue of 0, and an oklch mix drags every tint toward red (found while building the mockup).
- Text drawn on a solid chart colour (the stacked column on card 3) is a fixed near-black, `oklch(0.145 0 0)`, in both themes: it clears contrast on all three hues used there, white does not on the green.
- The mockup has a "Plain cards" toggle. If the tint feels like too much, the plain variant is the same screens on `bg-background`, and nothing else changes.

### 4.3 The cards

In order. "Skip when" lists the condition under which a card is left out.

| # | Card | Lead-in | The one thing | Visual in the middle | Footnote | Skip when |
|---|---|---|---|---|---|---|
| 1 | Cover | `YOUR RECAP` | "September" at 44 px, "2026" under it in muted | entry and day count, range, card count; a thin **category strip** (the month's colour signature, same order and colours as card 3) just above the footer | "UnMoney" · "Tap to start ›" | never |
| 2 | Total spent | `YOU SPENT` | total expenses, 60 px, expense colour | ↓/↑ % vs previous month (a drop in the income colour, a rise in the expense colour) and the daily average; then **two horizontal bars**, Aug in muted grey at full width and Sep in the expense colour at its share, with the amounts at the end | "The same figure as Expenses on Stats" | never |
| 3 | Where it went | `WHERE IT WENT` | "Food took the biggest slice" | top category's amount, entry count, average; a **tall stacked column** (190–280 px) with one block per top-3 category sized by share and the rest as a grey block, name left and % right inside each block; a four-row legend with amounts | "14 categories in all" · "Open Stats ›" | fewer than 2 categories |
| 4 | Biggest single spend | `BIGGEST SINGLE SPEND` | the amount, 60 px, expense colour; the note as a 24 px headline | "22% of the month in one entry"; a **ranked bordered list** of the top three entries in the ledger's row style (rank, note, category · method · date, amount) | "Top three together: half the month" · "Open entry ›" | never |
| 5 | Your days | `YOUR DAYS` | "Busiest: Sat 12 Sep" | amount and entry count that day; a **150 px bar strip**, one bar per day of the range, busiest solid, weekends slightly lighter, no-spend days as 3 px stubs, with a small "← Sat 12" callout; axis labels; three tiles: no-spend days, weekend share, entries per day | "Lighter bars are weekends" | never |
| 6 | On repeat | `ON REPEAT` | the most frequent note in quotes, 44 px | count, total, average; **count bars** for the top four notes in the card's tint (top one solid, others at 35%); two tiles: most used payment method with its share, scheduled (repeat) entries' total and count | "Notes matched ignoring case" | no note appears 3+ times and no repeats |
| 7 | What changed | `WHAT CHANGED SINCE AUGUST` | the biggest mover, e.g. "Shopping doubled" | one line naming the fallers; up to four **tornado rows**: name with before → after, a centred axis with a bar to the right (expense colour) for a rise or to the left (income colour) for a fall, bar length by the move's size relative to the biggest, and the delta | "Only moves above 5% of the month's total" | no previous month with entries, or no category moved by more than 5% of the month's total |
| 8 | In vs out | `IN VS OUT` | "30%" at 60 px, "of what came in, kept" | a **48 px bar** split Spent (expense colour, labelled with the amount) / Kept (income colour); legend rows for income, spent, kept; a budgets tile ("4 of 5 held · Food went over by ₹1,140") when budgets exist | "August: 24% kept" | no income that month (then budgets, if any, become their own small card) |
| 9 | Closer | `KEEP THIS ONE` | a **poster**: a `bg-card` card with the app's shadow and a 14 px radius, carrying "September / 2026" at 30 px with the range and entry count under it, the category strip, then seven hairline rows (Spent, vs August, Top category, Biggest spend, Kept, No-spend days, On repeat), and a signature row under a rule: the mark and "UnMoney" left, unmoney.vercel.app right | under the poster: **Open in Stats** (primary), **Share** and a **Download** icon (outline); without a share sheet that takes files, **Download** takes Share's place | "Every month's recap stays on Stats" · "Done" | never |

The closer is the only card whose content sits in an inset card rather than on the tint: the poster is the thing to keep (and, later, to share as an image), and the actions stay outside it so a screenshot of the poster is clean. Its tint is the neutral `--chart-rest`.

Wording rules:

- Say "less" / "more" rather than "down" / "up" for money; use the arrow glyphs for the sign.
- A drop in spending reads as good: income colour. A rise: expense colour. Nothing else is red or blue.
- Notes are matched case-insensitively and trimmed ("coffee", "Coffee " are one). Empty notes are skipped for card 6.
- Percentages are rounded to whole numbers; amounts use `fmt()` like everywhere else.
- Previous-month comparisons compare logical months of the same `monthStartDay`.

**Share** and **Download** send the poster as a 1080 px PNG (`unmoney-recap-2026-09.png`) in the current theme. `src/pages/recap/poster.ts` draws it on a canvas from the same rows as the card (`posterRows`), rather than capturing the HTML, which loses web fonts on iOS. The image is made when the card opens, because iOS only opens the share sheet straight from the tap.

`recapText` still builds the plain-text summary, e.g.

```
September 2026 · UnMoney
Spent ₹84,310 (8% less than Aug) · Top: Food 31% · Biggest: Flight to Goa ₹18,400
Kept 30% of income · 5 no-spend days · "Coffee" ×22
```

but the card no longer has a Copy button for it.

### 4.4 Tapping into a card

Parts of a card open the entries behind them in a drawer over the card, so the user never leaves the story. The drawer's total is always the figure on the card (`recapDrill` in `shared/recap.ts` filters the same `statsEntries`), and the drawer is in the URL (`?drill=`) so Back from an entry opened in it reopens it.

| Card | Tap | Drawer |
|---|---|---|
| Where it went | a category block or legend row | its entries, with Open in Stats |
| | "N other categories" / Everything else | those categories, each opening its entries (with a way back) |
| Biggest spend | a row | opens that entry |
| | Top ten (year: See all ten) | the ten largest, largest first |
| Your days / Year day by day | a bar or a calendar cell | that day; ‹ › (or ← →) step through the days |
| On repeat / Top five | a note | every entry with that note |
| | Most used method, Scheduled | that method's entries; the scheduled ones |
| What changed | a mover | that category's entries in this period |
| In vs out | Income | what came in |
| Month by month | a bar, Quietest, Best month | that month, stepping ‹ ›, with Open its recap |
| On the clock | an hour's bar, Earliest | that hour across the year, stepping ‹ ›; that day |
| Paid with / New this year | a method or category | its entries |

A tap on one of these never steps to the next card (a swipe still does); footnotes on the chart cards say what a tap does.

### 4.5 Edge cases

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

- `recapSeenMonth` on settings so the nudge is dismissed on every device at once.
- A yearly recap in January, built from the same cards with 12 months in place of 30 days.
- A PWA push notification on the 1st (needs a push subscription flow the app doesn't have).
