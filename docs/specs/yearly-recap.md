# Spec: Yearly recap

Status: draft · 2026-10-20 · mockup: [yearly-recap-mockup.html](yearly-recap-mockup.html) (open it in a browser; tap the phone to step through) · builds on [monthly-recap.md](monthly-recap.md), which is shipped

## 1. The idea, refined

In early January the app tells the story of the year that just ended, on the same full-screen story cards as the monthly recap, with more room for the things a year makes possible and a month does not: **the year as a calendar, a top five, when in the day you spend, what was new, and a spending personality**. That last one is the Wrapped-style reveal, and it is worked out from fixed rules on the year's numbers, with the three figures that decided it shown underneath, so it reads as a fact about the data rather than a guess about the person.

What to hold to, beyond the monthly rules (one idea per card, every number findable on Stats, cards that don't apply are skipped, no modal, no notification):

- **Same bones, same frame.** `CardFrame`, `Label`, `Num`, `H`, `Vis`, `Foot`, tiles, legend and strip from `src/pages/recap/cards.tsx` are reused as they are. The year adds card kinds, not a second system.
- **Fun comes from the data, not from adjectives.** "Coffee: one every 1.6 days", "December cost 1.8× February", "41 days logging in a row". No money equivalences ("that's 12 flights"), no judgement words ("splurge", "guilty"), no percentiles against other users (there is no server aggregation and there won't be).
- **Personality names are affectionate and explainable.** The Planner, The Homebody, The Foodie, The Explorer, The Weekender, The Night Owl, The Big-Day Spender, The Steady Hand, The All-Rounder. Each is one sentence of why plus the figures.
- **Up to 14 cards, typically 11.** Still under a minute.

## 2. Where things stand in the code

- `shared/recap.ts` has `monthRecap`, `recapNudge`, `recapIndex`, `recapText`, the `RecapCard` union and `RecapSummary`. `src/pages/recap/RecapPage.tsx` takes `/recap/:month` (regex `YYYY-MM`), builds the story, and handles navigation, the seen marker and the wide layout. `RecapsPage.tsx` lists months grouped by year. `RecapNudge.tsx` is the ledger card. `src/lib/recap.ts` is the per-device seen marker (one month key).
- Logical years: `yearRange(y, monthStartDay)` in `shared/period.ts` is 12 logical months from month 1. `statsTrend` already produces per-month totals for a list of ranges; `statsEntries` gives the entries with the amounts Stats counts. Times are on `transactions.time` ("HH:MM", optional, only when `settings.timeInputEnabled` was on). Repeats are `transactions.repeatId`.
- The Stats page has an "Annually" period and a recap row for finished months in monthly mode.

## 3. Where it appears

### 3.1 Ledger card, first two weeks of January

The same card component as the monthly nudge, with the year's copy, shown while **today is within the first 14 days of logical month 1** of the new year, the previous year qualifies (3.3), and this device has not opened or dismissed it:

```
[Sparkles]  Your 2026 recap is ready                                  ×
            Twelve months in a dozen cards: where it went, your top five, your spending personality.
            [See 2026]  [December recap]
```

In the first week both December's and the year's card would qualify. **The year wins the card**, and December's recap rides along as the second, outline button, so it isn't lost. Dismissing the card dismisses both.

### 3.2 Recaps page and Stats

- **Recaps page**: every finished year's section starts with a `2026 recap` row (filled icon square in `primary`, label in medium weight, hint "The whole year · 13 cards · ₹9,84,310 spent"), above its months. The current year has no row (its months still list as today). A year that doesn't qualify shows the row muted with "Needs 3 months with a recap".
- **Stats, Annually mode**: the same recap row under the Income / Expenses tabs for a finished year, mirroring the monthly row.
- The More-tab row "Monthly recaps" becomes **"Recaps"**, hint "Every month and year as a short story".

### 3.3 Qualifying

A year qualifies when **at least 3 of its logical months qualify for a monthly recap** (`RECAP_MIN_ENTRIES` expense entries each). Below that the year is too thin for the cards that compare months.

### 3.4 Seen marker

`src/lib/recap.ts` gains a second key `unmoney.recapYear.<userId>` holding the last year opened or dismissed, same semantics as the month key. Opening the year's recap also marks December seen (the card carried both).

## 4. The recap screen

Same route component. `/recap/:key` accepts `YYYY` as well as `YYYY-MM`; a four-digit key builds `yearRecap` instead of `monthRecap`, the close fallback is `/stats?period=yearly&year=<y>`, and the empty state reads "2026 has fewer than 3 months with a recap". Chrome, tap zones, swipe, keys, wide layout and transitions are unchanged.

### 4.1 Card layout and colour

As in the monthly spec §4.1–4.2, with two additions:

- The cover's year is set at 88 px (tracking −0.05em); the "On the clock", "Paid with" and personality headlines use the 44 px `H xl` size.
- New visuals, all built from the existing tokens: a **12-month bar strip** (the priciest bar solid expense, the lightest in the income colour, both labelled above), a **calendar heat grid** (12 rows × up to 31 cells, 2 px gaps, each cell the expense colour at an opacity from 0.18 to 1 by that day's share of the busiest day; no-spend days `foreground` at 7%; the busiest day gets a 2 px `foreground` outline), a **24-bar hour histogram** in the card's tint, and a **ranked top-five list** (numeral at 28 px in muted, the first in `foreground`; note at 17 px semibold; total and average under it; count at the right).

### 4.2 The cards

In order. "Skip when" lists the condition under which a card is left out.

| # | Card | Lead-in | The one thing | Visual in the middle | Footnote | Skip when |
|---|---|---|---|---|---|---|
| 1 | Cover | `YOUR YEAR IN MONEY` | "2026" at 88 px | entries and days tracked; card count and "under a minute"; the category strip above the footer | "UnMoney" · "Tap to start ›" | never |
| 2 | Total spent | `YOU SPENT` | the year's expenses, 60 px, expense colour | ↑/↓ % vs the previous year when it has entries; "about ₹82,000 a month · ₹2,700 a day"; the two compare bars (previous year grey, this year expense colour) | "The same figure as Expenses on Stats, Annually" | never (the comparison line and bars are left out without a previous year) |
| 3 | Month by month | `MONTH BY MONTH` | "December cost the most" | "₹1,12,400 · 1.8× February, your lightest"; the 12-month bar strip with J–D axis; three tiles: months above average, quietest month, swing (the mean absolute deviation from the monthly average, as ±%) | "Bars are each month's spend; the two extremes are labelled" | fewer than 3 months with entries |
| 4 | Where it went | `WHERE IT WENT` | "Food, then Household" | "Together half the year" (share of the top two); the tall stacked column with the **top five** categories and the rest; a three-row legend with amounts | "17 categories in all" · "Open Stats ›" | fewer than 2 categories |
| 5 | Your top five | `YOUR TOP FIVE` | "The things you logged most" | the ranked top-five list of notes by count: note, total and average, count | "Coffee: one every 1.6 days" (365 / count of the first) | fewer than 3 notes with 5+ entries |
| 6 | Biggest single spend | `BIGGEST SINGLE SPEND` | the amount, 60 px; the note at 24 px | "5% of the year in one entry · Sat 12 Dec"; the ranked bordered list of the top three (note, category · method · date, amount) | "Your ten largest entries: 19% of the year" · "Open entry ›" | never |
| 7 | Your year, day by day | `YOUR YEAR, DAY BY DAY` | "Busiest: Sat 12 Dec" | amount and entry count that day with its two largest notes; the calendar heat grid with a less/more legend; three tiles: no-spend days, longest logging streak (consecutive days with an entry), spend day (the weekday with the largest share) | "Darker days cost more; grey days cost nothing" | never |
| 8 | On the clock | `ON THE CLOCK` | the busiest hour as a range, 44 px ("8–9 pm") | "Your spending hour · 34% of entries after 7 pm"; the 24-bar hour histogram with a 12 am / 6 am / 12 pm / 6 pm / 11 pm axis; two tiles: mornings (share before noon), first entry of the year (earliest time, with its note and date) | "Only entries with a time (1,412 of 1,842)" | fewer than half the year's expense entries have a time |
| 9 | Paid with | `PAID WITH` | the most used payment method, 44 px | "58% of the year went through one card"; horizontal bars for the top four methods by amount, in the card's tint, with amounts | the method with the most entries and its average, when it differs from the top one by amount, else the top one's entry count | fewer than 2 methods with entries |
| 10 | What changed | `WHAT CHANGED SINCE 2025` | the biggest mover, e.g. "Travel doubled" | a line naming the fallers; up to four tornado rows, threshold **2% of the year's total** (the month uses 5%); a rise of 2× or more shows "N×" instead of a percentage | "Only moves above 2% of the year's total" | no previous year with entries, or no mover |
| 11 | New this year | `NEW THIS YEAR` | "You started logging Gym in March" | entry count and total since; a bordered list of up to three categories and payment methods with **no entries before this year** and at least 5 entries in it (first date, entry count, total) | "Categories and methods with no entries before 2026" | no previous year with entries, or nothing new |
| 12 | Budgets | `BUDGETS` | "10 of 12 months within budget" | "Transport went over in 2 months, ₹1,200 in all; Food never did"; up to five rows, one per monthly budget, each a **row of twelve squares** (held in green, over in the expense colour, faint before the budget existed) under its name and "over in 2 · ₹1,200" or "held all 12", with month initials under the last row; then the year's **annual budgets** as bars ("118% of ₹12,000 · over on 15 Oct"); without annual budgets, tiles: longest run of held months (unless the sentence already named it), over in all across category budgets. With annual budgets alone, the card is theirs: "2 of 3 held" and a bar each | "Each monthly budget, month by month" · "Budget ›" | no monthly budget existed in any month |
| 13 | In vs out | `IN VS OUT` | "34%" at 60 px, "of what came in, kept" | the split bar, legend rows; a best month tile (highest kept %) | "2025: 29% kept" when the previous year had income | no income that year |
| 14 | Spending personality | `YOUR SPENDING PERSONALITY` | the archetype, 44 px | one sentence of why; four trait rows (the two that matched in `foreground` with a solid tint square, two that didn't in muted with a faded square), each with its figure | "Picked by fixed rules from these figures" | never |
| 15 | Closer | `KEEP THIS ONE` | the poster: "2026" at 40 px with "1,842 entries · 365 days" under it, the category strip, eight hairline rows (Spent, vs 2025, Top category, Biggest spend, Most logged, Kept, No-spend days, Personality; plus Within budget, "10 of 12 months", before Personality when there were monthly budgets), and the signature row (mark, "UnMoney", unmoney.vercel.app) | under it: **Open 2026 in Stats** (primary), **Share** and **Download** the poster as an image (monthly spec §4.3) | "Every year's recap stays on Recaps" · "Done" | never |

### 4.3 Spending personality rules

Evaluated top to bottom; the first match wins. Every rule's inputs are computed once and shown as the trait rows, so the card can show the two that fired and two that didn't.

| Archetype | Rule | Why line |
|---|---|---|
| The Planner | scheduled (repeat) entries ≥ 35% of spend, **or** every budget held in ≥ 9 months (needs budgets) | "Most of your money moves on a schedule, and budgets mostly held." |
| The Homebody | the Household category (default name, or the top category when its name contains "home", "house", "rent") ≥ 40% | "Home took the biggest share by far." |
| The Foodie | Food (plus any category whose name contains "food", "eating", "dining", "restaurant", "cafe") ≥ 30% | "Eating well was the year's main line item." |
| The Explorer | Travel + Transport ≥ 20% | "A fifth of the year went on getting somewhere." |
| The Weekender | weekend share of spend ≥ 45% | "Saturdays and Sundays carried nearly half the year." |
| The Night Owl | ≥ 40% of timed entries at or after 21:00 (needs times on ≥ 50% of entries) | "Most of your entries land after nine." |
| The Big-Day Spender | the ten largest entries ≥ 40% of the year | "A handful of big days shaped the whole year." |
| The Steady Hand | no month's spend strays more than 15% from the monthly average (needs ≥ 6 months) | "Every month looked much like the last." |
| The All-Rounder | none of the above | "No single thing dominated: spread across categories, days and months." |

Category matching by name is case-insensitive and only ever widens a default category's share; it never renames anything. Keep thresholds as named constants so they are easy to tune.

### 4.4 Edge cases

- **Month start day ≠ 1.** The year is 12 logical months; the cover subtitle shows the real range when it straddles calendar years ("25 Dec 2025 – 24 Dec 2026"); the calendar grid still has one row per logical month, labelled by the month's key.
- **Sparse years** (an import that starts in October): qualifies with 3 months; cards 3 and 13's Steady Hand rule need their minimums; "vs 2025" is left out when 2025 has no entries.
- **No times logged**: card 8 skipped; the Night Owl rule never fires.
- **One payment method**: card 9 skipped.
- **Uncategorised, deleted methods, lump-sum cards, transfers-as-expense**: exactly as the monthly recap handles them.
- **Opened by URL** for a year that doesn't qualify: the empty state with Close.

## 5. Data

`shared/recap.ts` grows `yearRecap(snap, year)` and the new card kinds; `RecapCard` becomes a union of month and year kinds (shared kinds `cover`, `total`, `categories`, `biggest`, `changes`, `inout`, `budgets`, `closer` get an optional `scope: "month" | "year"` where the copy differs, rather than duplicating them).

```ts
export type YearCard =
  | { kind: "months"; perMonth: { month: MonthKey; amount: number }[]; priciest: MonthKey; lightest: MonthKey; ratio: number; aboveAvg: number; swing: number }
  | { kind: "top5"; notes: { text: string; count: number; amount: number }[]; everyDays?: number }
  | { kind: "calendar"; perDay: { date: ISODate; amount: number; count: number }[]; rows: { month: MonthKey; from: ISODate; days: number }[]; busiest: ISODate; busiestNotes: string[]; noSpend: number; streak: number; spendDay: { weekday: number; share: number } }
  | { kind: "clock"; perHour: number[]; peakHour: number; eveningShare: number; morningShare: number; first?: { time: string; note: string; date: ISODate }; timed: number; total: number }
  | { kind: "methods"; top: { id: string; name: string; amount: number; count: number }[]; share: number }
  | { kind: "new"; items: { kind: "category" | "account"; name: string; first: ISODate; count: number; amount: number }[] }
  | { kind: "personality"; archetype: Archetype; why: string; traits: { label: string; value: string; matched: boolean }[] };

export function yearRecap(snap: Snapshot, year: number): Recap | null;
export function yearQualifies(snap: Snapshot, year: number): boolean;
export function yearRecapNudge(snap: Snapshot, today: ISODate): number | null;  // the previous year during the first 14 days of month 1
export const RECAP_YEAR_MIN_MONTHS = 3;
export const RECAP_YEAR_NUDGE_DAYS = 14;
```

`recapIndex` gains a `year` row kind so the Recaps page can render the year rows from the same list. `recapText` gets a year variant (four lines: year, spent and vs, top and biggest and most logged, kept and no-spend and personality).

## 6. Build plan

1. **Model** — `yearRecap`, `yearQualifies`, `yearRecapNudge`, the personality rules with constants, `recapIndex` year rows, the year `recapText`. Tests in `shared/recap.test.ts`: the year total equals `statsByCategory` over `yearRange`; each personality rule fires on a constructed year and the All-Rounder on a flat one; "On the clock" skipped below 50% timed entries; "New this year" ignores categories used last year; the calendar's rows follow `monthStartDay` 25; the nudge window.
2. **Cards** — the seven new card components in `cards.tsx` plus the month/year copy switch on the shared ones; `TINT` entries for the new kinds (months `--chart-4`, top5 `--chart-7`, calendar `--chart-8`, clock `--chart-6`, methods `--chart-3`, new `--chart-4`, personality `--chart-7`).
3. **Route and entry points** — `/recap/:key` accepting a year; `RecapNudge` with the two-button year variant; the year rows on `RecapsPage` and the Stats row in Annually mode; the More-tab label; the year seen marker.
4. **Polish** — the heat grid's performance on a 365-cell render (plain divs are fine; no chart library), Copy summary for the year.

## 7. Later, not now

- Share the poster as an image.
- A "year so far" preview from July (same cards over a partial year, labelled as such).
- The Night Owl rule's 21:00 boundary as a setting, if anyone asks.
