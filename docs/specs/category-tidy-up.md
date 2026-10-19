# Spec: Tidy up categories (AI-assisted)

Status: draft · 2026-10-19

## 1. The idea, refined

People's category lists rot. Imports from Money Manager bring in near-duplicates ("Food", "food", "Foods"), people add "Coffee" and "Cafe" months apart, and "Other" turns into a junk drawer. The categories page should offer one action that **looks at the categories and the entries filed under them, proposes a short list of concrete changes, lets the user pick which ones to accept, then applies them to every affected entry in one step, with undo.**

Name and icon:

- Button label: **Tidy up**, with the lucide `WandSparkles` icon. It says what happens (the list gets cleaner) without promising magic. Alternatives considered: "Consolidate with AI" (jargon-y, and only covers merges), "Suggest improvements" (vague), "Clean up" (sounds like deleting).
- Review screen title: **Tidy up categories**. The AI part is said once, in the consent sheet and as a small "Suggested by AI" caption, not in the button.

What it suggests (five kinds, in the order shown):

| Kind | Example | What happens to entries |
|---|---|---|
| **Merge** | Coffee + Cafe + Starbucks → **Coffee** | Every entry in the sources moves to the target. Sources are deleted. |
| **Rename** | "Misc2" → **Subscriptions** | None; the category keeps its id. |
| **Group under** | Make **Groceries** a subcategory of **Food** | Entries in Groceries become Food › Groceries. |
| **Refile** | 38 entries in **Other** with notes like "Uber", "Ola" → **Transport** | Only the matching entries move. Can target a new category ("Subscriptions"). |
| **Remove unused** | "Pets" has no entries, budgets or repeats | Category is deleted. |

Two layers produce these:

1. **Quick fixes (no AI, works offline).** Exact rules run on the device: same name ignoring case, spaces and a trailing "s"; categories with no entries; deleted categories that still have entries. These appear instantly and cost nothing.
2. **AI suggestions (online).** Claude reads a summary of each category (name, entry count, total, most common notes) and proposes semantic merges, renames, grouping and refiles.

Both land in the same review list, so the user sees one flow.

## 2. Where things stand in the code

- Page: [CategoriesSettings.tsx](../../src/pages/settings/CategoriesSettings.tsx), route `settings/categories`. Shows one type at a time (Expenses / Income tabs). Header right holds the + button.
- Every write is an **op** applied by the pure reducer in [shared/ops.ts](../../shared/ops.ts), first to the local replica and then on the server by [convex/sync.ts](../../convex/sync.ts). So the apply step must be a **new op**. It can't be a Convex mutation on the side, or offline and multi-device sync break.
- `categories.remove` only sets `deletedAt` and leaves entries pointing at the deleted category. There is no "move entries elsewhere" today. `transactions.bulkUpdate` can re-category a list of ids, but it doesn't touch budgets, repeats or bookmarks, and it isn't atomic with category changes.
- Category ids are referenced from `transactions.categoryId/subcategoryId`, `budgets.categoryId`, `repeats.template.categoryId/subcategoryId` and `bookmarks.template.categoryId/subcategoryId`. A merge has to rewrite all four.
- There is no AI integration and no Convex action that calls an external API except `imports.createLink`. Secrets would live in Convex env (`npx convex env set`).
- Sync state (`pending`, `connected`) is on `useStore().status`.

## 3. User flow

### 3.1 Entry point

A full-width row at the top of the list, under the Expenses/Income tabs:

```
[WandSparkles]  Tidy up                                   >
                Merge look-alikes, rename vague ones, refile "Other"
```

- One run covers **both Expenses and Income**, whichever tab you're on. The review shows them as two sections. Suggestions never cross the two: a merge, refile or grouping only ever involves categories of the same type.
- Disabled states (row stays visible, subtitle changes):
  - **Not enough data yet.** The AI part needs at least **8 live categories and 100 entries** in total (expense and income together), with the first entry at least **30 days old**. Below that, the subtitle says what's missing: "Tidy up unlocks at 100 entries (you have 64)". Quick fixes still run, since they're free. Keep the three numbers as constants in `shared/categoryLint.ts` so they're easy to tune.
  - **Already used this month.** The AI part can run **once every 30 days**. Until then the row says "Next AI tidy-up on 18 Nov". Tapping it still opens the review page with fresh quick fixes and the last AI suggestions (cached, no new call), so nothing is lost.
  - Offline: the quick fixes still run. The AI part shows "AI suggestions need a connection".
  - Unsynced changes (`status.pending > 0`): "Syncing… try again in a moment". The server summary must see the same data the user does, and new categories must have real ids.
- Optional (phase 4): a gentle highlight on the row when it's likely worth it, e.g. "Other" holds over 15% of spend, or a quick fix exists.

### 3.2 First-time consent (bottom sheet)

Shown once per device, before the first AI call:

> **Tidy up uses AI**
> To suggest changes, UnMoney sends Anthropic's Claude a summary of your expense and income categories: their names, how many entries each has, their totals, and the most common notes. It does not send dates, accounts, photos or individual entries. Nothing is changed until you approve it.
>
> [x] Include notes (better suggestions for "Other")
>
> **Continue** · Not now

Store the answer in `localStorage` (`tidy.consent = { notes: boolean }`). If notes are off, refile suggestions are skipped and the prompt gets only names, counts and totals.

### 3.3 Working state

The page `/settings/categories/tidy` opens right away:

- Quick fixes render at once.
- Below them, a skeleton card with "Reading 1,248 entries…" while the action runs (typically 5–15 s). A Cancel link aborts the request and keeps the quick fixes.
- If the AI call fails: an inline line "Couldn't get AI suggestions. Try again", with the quick fixes still usable.

### 3.4 Review

```
Tidy up categories
8 suggestions · 431 entries would change

EXPENSES · 6
  Merge
  [x] Coffee, Cafe, Starbucks  →  Coffee        [edit]
      Same kind of spending under three names.
      86 entries · ₹12,400                   [See entries v]

  [x] Groceries, Supermarket  →  Groceries
      ...

  Group under
  [x] Snacks  →  under Food
      ...

  Refile
  [ ] 38 entries in Other  →  Transport          low confidence
      Notes: Uber (21), Ola (12), Metro card (5)

  Remove unused
  [x] Pets · no entries

INCOME · 2
  Merge
  [x] Salary, Paycheck  →  Salary
      19 entries · ₹9,12,000

  Rename
  [x] Petty cash  →  Cashback
      Notes are all card and app cashback.

[ Preview new list ]

────────────────────────────────────────────
[ Apply 5 changes ]                    (sticky)
```

Card behaviour:

- **Checkbox.** On by default for high and medium confidence and for every quick fix. Off by default for low confidence.
- **Reason.** One line from the model (quick fixes have fixed text, e.g. "Same name, different case").
- **Impact.** Entry count and total, computed on the device from the local snapshot, not taken from the model.
- **See entries.** Expands the 20 most recent affected entries, using the existing transaction row component.
- **Edit.** For merges: a radio list of the source names plus "New name…". For refiles: the target category picker (the one with search and A–Z sorting) and chips for each note, each removable. For renames: a text field.
- **Conflicts.** If two checked cards touch the same category (e.g. merge Groceries into Food *and* group Groceries under Food), the later card shows "Conflicts with the merge above" and can't be checked until the other is unchecked. Validation is in §5.4.
- **Budget notes.** If a merge combines budgets, the card says so: "Budgets combine: ₹2,000 + ₹1,000 = ₹3,000 a month".
- **Sections.** Expenses first, then Income; a section with nothing to suggest shows one line ("Income looks tidy"). Each section header has a tick-all box.
- **Preview new list.** Opens a sheet (with Expenses / Income tabs) with the category tree as it would look after the checked changes. This is the best way to check a set of changes.

### 3.5 Apply

1. Tapping **Apply 5 changes** opens a confirm dialog: "Move 412 entries and update 2 budgets? Past stats will show the new categories." Buttons: **Apply** / Cancel.
2. It runs one op, `categories.applyCleanup` (see §5). Like every op, it lands locally at once and syncs later.
3. It navigates back to the categories page, which already shows the new list. No toast (in line with the recent "let actions speak for themselves" change). Instead an inline banner sits at the top of the page until dismissed or the next cleanup: "Tidied up 5 changes · **Undo**".
4. If the reducer skipped any step (e.g. a category was deleted on another device in the meantime), the banner says "4 of 5 changes applied · 1 skipped" and links to the reason.

### 3.6 Undo

- Undo reverts the **most recent** cleanup and is offered for 30 days (shown in the banner, and as a row under the list: "Undo last tidy-up (19 Oct)").
- It restores category names, parents and deleted state, puts entries, budgets, repeats and bookmarks back, and deletes categories the cleanup created, if nothing else uses them by then.
- Entries the user edited by hand after the cleanup keep the edit. Undo only reverts an entry if it still has exactly the category the cleanup gave it.

## 4. AI suggestion pipeline

### 4.1 Shape

```
client ──(type)──▶ convex action ai.suggestCategoryCleanup
                     │ 1. auth + monthly limit + thresholds
                     │ 2. internalQuery builds the summary from the DB
                     │ 3. call the model with a strict output schema
                     │ 4. validate + drop bad suggestions
                     ◀─ suggestions (ids only, no impact numbers)
client: merge with quick fixes, compute impact locally, render review
```

The summary is built **on the server, from the DB**. The client can't inflate the prompt, and nothing is uploaded twice. That's why the entry point waits for the sync queue to be empty.

### 4.2 Summary sent to the model

Both types in one request, as two lists. Transfers are never included.

```jsonc
{
  "currency": "INR",
  "subcategoriesEnabled": true,
  "income": [ /* same shape as expense */ ],
  "expense": [
    {
      "id": "k17abc…",              // real Convex id
      "name": "Coffee",
      "parentId": null,
      "deleted": false,
      "entries": 52,
      "total": 7400,                // main currency, rounded
      "lastUsed": "2026-10",        // month only
      "hasBudget": true,
      "topNotes": [["Starbucks", 18], ["Blue Tokai", 11], ["", 9]]  // up to 20, by count
    }
  ]
}
```

- Include deleted categories that still have entries (`deleted: true`), so the model can suggest folding them into a live one.
- Normalise notes before counting (trim, collapse spaces, case-fold for grouping, keep the most common spelling for display).
- Hard caps: 150 categories in total and 20 notes per category. That's about 10–15k input tokens for a heavy user.
- If notes consent is off, `topNotes` is omitted.

### 4.3 Model and call

**Model: Claude Haiku 5.5** (`claude-haiku-5-5`), the cheapest Anthropic model, at $0.10 in / $0.50 out per million tokens. The job (group a few dozen names, return a short JSON list) is well within what it handles. The validation in §4.6 and the unticked low-confidence cards cover the cases where its judgement slips.

**Cost per run:** about 5–10k tokens in and 2–4k out, so **≈ $0.002–0.003**. Income lists are short, so covering both adds only a little. With one run per month that's roughly **$3 a month per 1,000 active users**, and less in practice since most people won't run it every month.

Keeping it cheap:

- **Effort `low`**, leaving adaptive thinking on (the default). Thinking is billed as output, and output is 5× the input price, so low effort is the biggest lever. Don't turn thinking off completely; it helps with "Groceries ≠ Eating out".
- **Trim the input.** 20 notes per category instead of 30, notes truncated to 40 characters, totals rounded to whole units, and short JSON keys. Skip categories with fewer than 3 entries unless they're part of a quick-fix group.
- **Cap the output.** At most 12 suggestions, reasons under 90 characters, `max_tokens` 8k.
- **Don't call when there's nothing to do.** If the summary hash matches the last run, show the last result without a call (this doesn't use up the month either).
- **No retries on bad output.** If the JSON fails validation, keep what passes and don't call again.

Implementation:

- **Call:** `@anthropic-ai/sdk` in a Convex action (`convex/ai.ts`; add `"use node"` if the SDK needs it). Key in `ANTHROPIC_API_KEY` via `npx convex env set` (and `--prod`).
- **Structured output:** `output_config.format` with a JSON schema of the suggestion list below, so the response is always parseable JSON.
- **Refusals:** if `stop_reason` is `"refusal"` or `"max_tokens"`, treat it as a failed run: show "Couldn't get AI suggestions" and don't count it toward the month. Haiku has no server-side fallback model, and none is needed here.
- Timeout 60 s. Log `usage` (input and output tokens) per run to track the real cost against the estimate.
- Keep the call behind one function, `suggest(summary)`, so moving to `claude-sonnet-5-5` later (≈ 20× the cost) is a one-line change if Haiku's quality turns out too weak on the §9 samples.

Considered and set aside: free tiers (Groq, Cloudflare Workers AI) have app-wide daily quotas and an ~8k tokens/minute cap that heavy users exceed; Gemini's free tier uses prompts to improve Google's products; on-device options (Chrome's built-in AI, WebLLM) don't run on an iPhone PWA or need a ~700 MB download.

### 4.4 Output schema

```ts
type Target = { id: string } | { newName: string; parentId?: string };

type AiSuggestion = { reason: string; confidence: "high" | "medium" | "low" } & (
  | { kind: "merge";  sourceIds: string[]; target: Target }   // target may be one of the sources
  | { kind: "rename"; id: string; newName: string }
  | { kind: "nest";   id: string; parentId: string }          // main → sub of another main
  | { kind: "refile"; fromId: string; notes: string[]; target: Target }
);
```

The model doesn't propose "remove unused": that's a quick fix, and it's exact.

### 4.5 Prompt rules (system prompt, abridged)

- You are tidying one person's personal finance categories. Suggest **at most 12** changes. Suggest fewer if the list is already tidy, and return an empty list if nothing is worth changing.
- Merge only categories that mean the same kind of spending. Keep distinctions people make on purpose (Groceries vs Eating out, Rent vs Utilities, Gifts given vs Donations).
- Prefer an existing name as the merge target. Use a new name only if every existing name is worse.
- Names: short (1–3 words), Title Case, in the same language and style as the user's existing names. No emoji unless the user already uses them.
- Use `nest` only if `subcategoriesEnabled` is true, and only one level deep.
- `refile.notes` must be copied **exactly** from `topNotes` of `fromId`. Refile only from vague categories (Other, Misc, Uncategorised, General) or where notes clearly belong elsewhere. Never refile entries with an empty note.
- Every id must come from the input. `reason` is one plain sentence for the user, under 90 characters.

### 4.6 Server-side validation

Drop a suggestion (and log why) if:

- any id is unknown, of the other type, or (for targets) deleted;
- a merge has fewer than 2 distinct categories in total;
- a rename or new name is empty, over 40 characters, or collides with another live category of the same type and parent (case-insensitive);
- a `nest` points at a subcategory, at itself, or at a category that has subcategories of its own, or subcategories are off;
- a refile note doesn't exist in `fromId`'s notes;
- a category already appears in an earlier kept suggestion (first one wins).

Then de-duplicate against the quick fixes on the client (a quick-fix merge beats an AI merge of the same set).

### 4.7 Cost and abuse limits

- **Once every 30 days, enforced on the server.** A small `aiUsage` table (`userId`, `lastRunAt`, `summaryHash`, `lastResult`) is checked in the action before calling the model and updated only after a successful run, so a failed or cancelled run doesn't use up the month. The client shows the next date, but the server is what enforces it.
- **Data thresholds enforced on the server too** (8 categories, 100 entries, first entry 30+ days old), using the same constants as the client.
- **Last result kept.** `lastResult` holds the validated suggestions, so the review page can show them again during the month without a new call. Suggestions whose categories no longer exist are dropped when shown.
- Log per call: user id, token counts, number of suggestions in, kept and later accepted. This is enough to tune the prompt and pick a model.

## 5. Applying: the `categories.applyCleanup` op

### 5.1 Op catalogue entry

```ts
type CatRef = { id: Id<"categories"> } | { newKey: string };   // newKey points at a step's "create"

type CleanupStep =
  | { kind: "create"; key: string; type: "income" | "expense"; name: string; parent?: CatRef }
  | { kind: "rename"; id: Id<"categories">; name: string }
  | { kind: "nest";   id: Id<"categories">; parentId: CatRef }
  | { kind: "merge";  sourceIds: Id<"categories">[]; target: CatRef }
  | { kind: "refile"; fromId: Id<"categories">; notes: string[]; target: CatRef }
  | { kind: "remove"; id: Id<"categories"> };

"categories.applyCleanup": {
  args: { steps: CleanupStep[]; label: string[] };   // label: one line per accepted card
  result: { cleanupId: Id<"categoryCleanups">; changedEntries: number; skipped: { step: number; reason: string }[] };
};
"categories.undoCleanup": { args: { id: Id<"categoryCleanups"> }; result: { restoredEntries: number } };
```

`OP_TABLES` for both: `["categories", "transactions", "budgets", "repeats", "bookmarks", "categoryCleanups"]`.

The client turns accepted cards into steps. A card that targets a new name becomes a `create` step plus the step that uses its `newKey`.

### 5.2 Why steps name categories and notes, not entry ids

The plan says "everything in Cafe" or "entries in Other whose note is Uber", and **the reducer resolves that at apply time**. If another device adds a Cafe entry between review and sync, the server run still moves it. Entry ids appear only in the undo record, which captures what actually changed.

### 5.3 Reducer semantics, per step

Steps run in the order given. Each is validated first. If a step fails validation it is skipped and added to `skipped`; the others still apply. Resolve `newKey` refs through a map filled by `create` steps. A ref to a skipped create skips the dependent step.

- **create:** insert a category of the step's `type` (name trimmed, `order = nextOrder`). If a live category with the same name and parent exists, reuse it instead of creating a duplicate.
- **rename:** same rules as `categories.update`.
- **nest:** like `categories.update` with `parentId`. Then for every entry with `categoryId = id`: set `categoryId = parent`, `subcategoryId = id`. Repeats and bookmarks get the same rewrite.
- **merge** into target T. For each source S ≠ T:
  - *S main → T main.* Entries: `categoryId S → T`, `subcategoryId` unchanged. Subcategories of S are re-parented under T. If T already has a sub with the same name, merge the two subs (entries move, S's sub is deleted).
  - *S sub → T main.* Entries: `categoryId → T`, `subcategoryId → undefined`.
  - *S main (no subs) → T sub (of P).* Entries: `categoryId → P`, `subcategoryId → T`.
  - *S sub → T sub.* Entries: `categoryId → T.parent`, `subcategoryId → T`.
  - *S main with subs → T sub:* invalid (two-level limit). Skip with reason "Has subcategories".
  - Then soft-delete S (`deletedAt = now`), same as `categories.remove`.
  - Entries include ones where S is currently deleted. That's how "deleted but still used" gets fixed.
- **refile:** entries with `categoryId = fromId` (or `subcategoryId = fromId` when it's a sub) whose normalised note is in the normalised `notes` set move to the target, using the same main/sub mapping as merge. `fromId` stays.
- **remove:** only if there are no entries, budgets, repeats or bookmarks for it at apply time. Otherwise skip with "Now in use".

Applied with every merge, nest and refile:

- **Budgets.** If target T has a budget, sources' budgets are deleted and T's stays (the card warned about this). If T has none and exactly one source has one, re-point it to T. If several sources have budgets, keep one budget on T: amounts summed if the periods match, otherwise the first source's budget is kept and the rest deleted (the card says which). `overrides` are summed key by key when periods match.
- **Repeats and bookmarks.** Templates go through the same `categoryId/subcategoryId` rewrite as entries.
- **Type safety.** One plan can hold steps for both types, but each step must stay within one type: all categories in a merge, a refile's source and target, a nest's child and parent. A step that mixes types is skipped. Transfers are never touched.

### 5.4 Client-side validation before Apply

Run the same validation the reducer uses (export it from `shared/ops.ts`) against the local snapshot with only the checked cards. This drives the conflict states in §3.4, and Apply is disabled while any checked card is invalid. A plan that passes on the client can still lose steps on the server because of other devices. That's what `skipped` is for.

### 5.5 Undo record: new `categoryCleanups` table

```ts
categoryCleanups: defineTable({
  userId: v.id("users"),
  label: v.array(v.string()),
  at: v.number(),
  undoneAt: v.optional(v.number()),
  createdCategoryIds: v.array(v.id("categories")),
  categoriesBefore: v.array(v.any()),          // full docs of every category it changed
  budgetsBefore: v.array(v.any()),             // full docs of every budget it changed or deleted
  entries: v.array(v.object({ id: v.id("transactions"), from: v.array(v.optional(v.id("categories"))), to: v.array(v.optional(v.id("categories"))) })),
  templates: v.array(v.object({ table: v.union(v.literal("repeats"), v.literal("bookmarks")), id: v.string(), from: v.any() })),
}).index("by_user", ["userId"]),
```

- Add it to `TABLES`, `emptySnapshot`, `loadTable` (`by_user`) and the client store, like the others. Leave it out of backup export.
- Keep the 3 most recent records per user. `applyCleanup` deletes older ones.
- Size: about 80 bytes per moved entry, so roughly 12k entries per record stays well under Convex's 1 MiB document limit. Above 10k moved entries, refuse with "Too many entries for one tidy-up. Apply fewer changes at a time."
- `undoCleanup` reverts entries whose current `[categoryId, subcategoryId]` still equals `to`, restores `categoriesBefore` and `budgetsBefore`, restores templates, soft-deletes `createdCategoryIds` that nothing references, and sets `undoneAt`. Only the newest record that isn't undone, within 30 days, can be undone.

### 5.6 Size limits

The server already loads every transaction of the user for any transaction op, so reads aren't new. Writes are: one document write per moved entry. Check Convex's current per-mutation write limits. The 10k-entry cap above keeps a single op well inside them for realistic users. If that proves too small, split the plan into one op per step on the client (ordered, same `cleanupId` passed along) and give up single-op atomicity.

## 6. Quick fixes (deterministic, `shared/categoryLint.ts`)

A pure function `lintCategories(snapshot)` (runs over both types, grouping only within a type) → `QuickFix[]`, same shape as AI suggestions with `source: "rule"`:

- **Duplicate names:** group live categories of the same type and parent by `normalise(name)` (lowercase, trim, collapse spaces, strip a trailing "s"/"es", "&" → "and"). Groups of 2 or more become a merge into the one with the most entries.
- **Deleted but used:** a deleted category with entries, where a live one of the same normalised name exists, becomes a merge into the live one. Without a live match, it becomes an info card: "12 entries still use deleted 'Groceries'". Tapping it opens a picker to merge into any category.
- **Unused:** zero entries, no budget, no repeat or bookmark, and not one of the built-in defaults created less than 30 days ago (so new users aren't nagged to delete starter categories). These become remove.

## 7. Files to add or change

| File | Change |
|---|---|
| `src/pages/settings/CategoriesSettings.tsx` | Tidy up row, post-apply banner with Undo, "Undo last tidy-up" row |
| `src/pages/settings/CategoryTidyUp.tsx` (new) | Review page: quick fixes, AI fetch, cards, preview sheet, apply |
| `src/App.tsx` | Route `settings/categories/tidy` |
| `shared/categoryLint.ts` (new) | Quick fixes, note normalisation, impact calculation |
| `shared/ops.ts` | `categories.applyCleanup`, `categories.undoCleanup`, shared validation, `categoryCleanups` in `TABLES` |
| `convex/schema.ts` | `categoryCleanups`, `aiUsage` tables |
| `convex/lib/snapshot.ts` | Load `categoryCleanups` |
| `convex/ai.ts` (new) | `suggestCategoryCleanup` action, `buildSummary` internal query, usage internal mutation, prompt and schema |
| `src/lib/store.tsx`, `src/lib/db.ts` | Replicate the new table locally |
| `package.json` | `@anthropic-ai/sdk` |
| README | `npx convex env set ANTHROPIC_API_KEY …` (dev and `--prod`) |

## 8. Phases

1. **Pipeline with no AI.** `applyCleanup` and `undoCleanup` ops, the `categoryCleanups` table, quick fixes, the review page and the banner. This ships value on its own (dupes from imports are the most common mess) and tests the risky part, rewriting entries, budgets and templates, without any model in the loop.
2. **AI merges, renames and grouping.** Consent sheet, `convex/ai.ts` with Claude Haiku 5.5, monthly limit and thresholds, validation, merging AI and rule suggestions.
3. **Refile from notes and new categories.** Note summaries, refile cards with note chips, `create` steps.
4. **Polish.** Entry-row highlight when it's worth running, remembering dismissed suggestions (a hash per suggestion, so the same one isn't shown again).

## 9. Testing

- **Reducer.** The repo has no test runner. Add Vitest for `shared/` only, and cover: every merge mapping in §5.3, sub re-parenting with same-name collisions, budget combining, template rewrites, skip-and-continue, `newKey` resolution, undo after a later manual edit, undo of created categories, and the 10k cap.
- **Validation.** Feed the AI validator bad output on purpose: unknown ids, cross-type merges, invented notes, duplicate category use, nest when subcategories are off.
- **Prompt quality.** Before launch, run the samples below on Haiku 5.5 and Sonnet 5.5 side by side (well under a cent in total) to confirm Haiku is good enough. Keep 5–6 sample summaries in `convex/ai.fixtures.ts` (fresh user, Money Manager import with dupes, heavy "Other", already tidy, non-English names). Run them by hand when the prompt or model changes and check: no bad merges, an empty list for the tidy one, names in the user's language.
- **Manual.** Two devices, one offline: apply a cleanup on A while B adds an entry to a source category, then let both sync. B's entry should end up in the target. Undo on A afterwards.

## 10. Acceptance criteria

- With a fresh Money Manager import containing "Food" and "food", opening Tidy up offline shows a merge card. Applying it moves every entry and leaves one "Food".
- AI suggestions never reference an id or a note that wasn't in the summary, never merge across types, and never nest when subcategories are off.
- After apply, the stats page, budgets, repeats and bookmarks all point at the new categories. No entry points at a category the cleanup deleted.
- Undo within 30 days restores the previous list and entries exactly, except entries edited by hand after the cleanup.
- A user can't get more than one AI run in 30 days, even by calling the action directly. A failed run doesn't count. Reopening during the month shows the last suggestions with no model call.
- Below 8 categories, 100 entries or 30 days of history, the AI part is off and says what's missing; quick fixes still work.
- Nothing is sent to the model before the consent sheet has been accepted on that device.

## 11. Decisions

1. **Scope.** One run covers Expenses and Income together, shown as two sections in the review.
2. **Notes.** Sent by default; the consent sheet lets people turn them off.
3. **Limit.** One AI run every 30 days, only with 8+ categories and 100+ entries in total and 30+ days of history.
5. **AI model.** Claude Haiku 5.5 at effort `low`, about $0.003 per run. Move to Sonnet 5.5 only if the §9 samples show Haiku's quality isn't good enough.
4. **Undo window.** 30 days, most recent tidy-up only.
