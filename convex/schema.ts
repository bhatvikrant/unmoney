import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const txType = v.union(v.literal("income"), v.literal("expense"), v.literal("transfer"));
/** What a payment method is. Decides behaviour: credit cards get billing cycles, debit cards (and linked UPIs) draw from a bank account. */
export const accountKind = v.union(
  v.literal("cash"),
  v.literal("bank"),
  v.literal("card"),
  v.literal("debitCard"),
  v.literal("upi"),
  v.literal("savings"),
  v.literal("prepaid"),
  v.literal("investment"),
  v.literal("overdraft"),
  v.literal("loan"),
  v.literal("insurance"),
  v.literal("other"),
);
export const frequency = v.union(
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("biweekly"),
  v.literal("monthly"),
  v.literal("yearly"),
);
/**
 * On every document the app syncs: the user's change number (syncState.rev) when it was last
 * written, so a device asks only for what changed since it last looked (sync.changes). Unset on
 * documents not written since this was added; a device loading everything still gets those.
 */
const synced = { rev: v.optional(v.number()) };
export const budgetPeriod = v.union(v.literal("weekly"), v.literal("monthly"), v.literal("yearly"));

/** [categoryId, subcategoryId] of an entry or template, null where unset. */
const catPair = v.array(v.union(v.id("categories"), v.null()));

/** Shape shared by bookmarks and repeat schedules. */
export const template = v.object({
  type: txType,
  accountId: v.id("accounts"),
  toAccountId: v.optional(v.id("accounts")),
  categoryId: v.optional(v.id("categories")),
  subcategoryId: v.optional(v.id("categories")),
  amount: v.number(),
  note: v.string(),
  description: v.optional(v.string()),
  tags: v.array(v.string()),
  feeAmount: v.optional(v.number()),
});

export default defineSchema({
  ...authTables,

  settings: defineTable({
    userId: v.id("users"),
    ...synced,
    onboarded: v.boolean(),
    mainCurrency: v.string(),
    symbol: v.string(),
    symbolPosition: v.union(v.literal("before"), v.literal("after")),
    decimals: v.number(),
    monthStartDay: v.number(),
    weekStartDay: v.number(),
    carryOver: v.boolean(),
    startScreen: v.union(v.literal("daily"), v.literal("calendar")),
    theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
    accent: v.string(),
    colorSet: v.union(v.literal("A"), v.literal("B")),
    subcategoryEnabled: v.boolean(),
    autocompleteEnabled: v.boolean(),
    timeInputEnabled: v.boolean(),
    repeatDisplay: v.union(v.literal("onDate"), v.literal("firstOfMonth")),
    cardExpenseDisplay: v.union(v.literal("atTime"), v.literal("lumpSum")),
    passcodeHash: v.optional(v.string()),
    /** "Forgot passcode" was asked for at this time; a sign-in after it removes the passcode (convex/passcode.ts). */
    passcodeResetRequestedAt: v.optional(v.number()),
    passcodeSalt: v.optional(v.string()),
    lockAfter: v.union(v.literal("always"), v.literal("5m"), v.literal("1h")),
    /** Account a new entry starts on; falls back to the first visible account when unset or gone. */
    defaultAccountId: v.optional(v.id("accounts")),
    /** Notes (normalised) the user said are not bills, so the Bills & subscriptions page stops suggesting them. */
    dismissedRecurring: v.optional(v.array(v.string())),
    /** The last imports (newest first, at most 10), so one can be undone: its entries carry its id as importId. */
    recentImports: v.optional(v.array(v.object({ id: v.string(), name: v.string(), at: v.number(), count: v.number(), undoneAt: v.optional(v.number()) }))),
  }).index("by_user", ["userId"]).index("by_user_rev", ["userId", "rev"]),

  /** Folders that organise payment methods. They have no behaviour of their own. */
  accountGroups: defineTable({
    userId: v.id("users"),
    ...synced,
    name: v.string(),
    /**
     * Legacy: groups used to carry the type of every account in them. The type now lives on each
     * account (the "accounts.adoptKinds" op and migrations:accountKinds copy it over); this is only
     * read as a fallback for accounts that have not been migrated yet.
     */
    kind: v.optional(accountKind),
    order: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]).index("by_user_rev", ["userId", "rev"]),

  /** Payment methods. The table keeps its old name to avoid a data migration. */
  accounts: defineTable({
    userId: v.id("users"),
    ...synced,
    /** Unset when the method sits outside any group. */
    groupId: v.optional(v.id("accountGroups")),
    /** Optional only until every account has been migrated; every write sets it. */
    kind: v.optional(accountKind),
    name: v.string(),
    initialBalance: v.number(),
    includeInTotals: v.boolean(),
    hidden: v.boolean(),
    order: v.number(),
    transferAsExpense: v.boolean(),
    description: v.optional(v.string()),
    billingAccountId: v.optional(v.id("accounts")),
    settlementDay: v.optional(v.number()),
    paymentDay: v.optional(v.number()),
    linkedAccountId: v.optional(v.id("accounts")),
    /** Cards only (credit and debit): what is printed on the card, for telling cards apart. */
    bankName: v.optional(v.string()),
    last4: v.optional(v.string()),
    /** Cards only: background of the card in the app, "#rrggbb". */
    color: v.optional(v.string()),
    /** Credit cards only: the most the card can owe, for "available credit" and how much of it is used. */
    creditLimit: v.optional(v.number()),
    /** Credit cards only: true when the user pays this card outside UnMoney, so no due date, "Overdue" or bill reminder is shown. */
    noDueTracking: v.optional(v.boolean()),
    /**
     * Set when the user archives a method they no longer use. It drops out of pickers and the
     * grouped list, but its balance and every entry on it stay exactly as they were.
     */
    archivedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    /** The day the user last checked this balance against the bank's (accounts.adjustBalance). */
    reconciledAt: v.optional(v.string()),
    /**
     * Made by the app, not the user: "adjustments" is the hidden, left-out-of-totals account that
     * balance adjustments are transfers from, so they never count as income or spending.
     */
    system: v.optional(v.literal("adjustments")),
  })
    .index("by_user", ["userId"])
    .index("by_group", ["groupId"])
    .index("by_user_rev", ["userId", "rev"]),

  categories: defineTable({
    userId: v.id("users"),
    ...synced,
    type: v.union(v.literal("income"), v.literal("expense")),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    order: v.number(),
    /** Set when the user archives a category they no longer use: it leaves the pickers (with its subcategories), entries keep it. */
    archivedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_user_type", ["userId", "type"])
    .index("by_parent", ["parentId"])
    .index("by_user_rev", ["userId", "rev"]),

  transactions: defineTable({
    userId: v.id("users"),
    ...synced,
    type: txType,
    date: v.string(),
    time: v.optional(v.string()),
    accountId: v.id("accounts"),
    toAccountId: v.optional(v.id("accounts")),
    categoryId: v.optional(v.id("categories")),
    subcategoryId: v.optional(v.id("categories")),
    amount: v.number(),
    subAmount: v.optional(v.number()),
    subCurrency: v.optional(v.string()),
    exchangeRate: v.optional(v.number()),
    note: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    feeAmount: v.optional(v.number()),
    photoIds: v.array(v.id("_storage")),
    repeatId: v.optional(v.id("repeats")),
    installmentIndex: v.optional(v.number()),
    installmentCount: v.optional(v.number()),
    installmentTotal: v.optional(v.number()),
    /** The shared expense this entry was handed to UnSplit as (src/lib/unsplit.ts). */
    split: v.optional(v.object({ app: v.literal("unsplit"), expenseId: v.string() })),
    /** The import this entry came in with (settings.recentImports), so the whole import can be undone. */
    importId: v.optional(v.string()),
    /** The mail this entry was read from (Gmail sync), so its detail screen can link back to it. */
    source: v.optional(v.object({ app: v.literal("gmail"), messageId: v.string() })),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_user_account", ["userId", "accountId"])
    .index("by_user_to_account", ["userId", "toAccountId"])
    .index("by_user_category", ["userId", "categoryId"])
    .index("by_repeat", ["repeatId"])
    .searchIndex("search_note", { searchField: "note", filterFields: ["userId"] })
    .index("by_user_rev", ["userId", "rev"]),

  repeats: defineTable({
    userId: v.id("users"),
    ...synced,
    kind: v.union(v.literal("repeat"), v.literal("installment")),
    frequency: frequency,
    startDate: v.string(),
    endDate: v.optional(v.string()),
    nextDate: v.string(),
    /** Switched off because its account or category was deleted; restoring that switches it back on. */
    pausedForDeleted: v.optional(v.boolean()),
    installmentCount: v.optional(v.number()),
    template: template,
    active: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_active_next", ["active", "nextDate"])
    .index("by_user_rev", ["userId", "rev"]),

  bookmarks: defineTable({
    userId: v.id("users"),
    ...synced,
    order: v.number(),
    template: template,
    /** The entry it was bookmarked from, so that entry can show a star. */
    transactionId: v.optional(v.id("transactions")),
  }).index("by_user", ["userId"]).index("by_user_rev", ["userId", "rev"]),

  budgets: defineTable({
    userId: v.id("users"),
    ...synced,
    categoryId: v.optional(v.id("categories")),
    period: budgetPeriod,
    amount: v.number(),
    overrides: v.record(v.string(), v.number()),
    /** Carrying over is on from this period key: each period's leftover (or overspend) adds to the next one. */
    rolloverFrom: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_user_rev", ["userId", "rev"]),

  notes: defineTable({
    userId: v.id("users"),
    ...synced,
    date: v.string(),
    text: v.string(),
    color: v.string(),
  }).index("by_user_date", ["userId", "date"]).index("by_user_rev", ["userId", "rev"]),

  /**
   * The secret link the iPhone "Send to unmoney" shortcut posts files to. Only a SHA-256 of the
   * token is kept; one link per user, and making a new one turns the old one off.
   */
  importLinks: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_hash", ["tokenHash"]),

  /** Files that arrived through an import link, waiting for the user to review them in the app. */
  pendingImports: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    name: v.string(),
    size: v.number(),
  }).index("by_user", ["userId"]),

  /** Who uploaded each stored file (receipt photos, import inbox), so nobody else can read or delete it. */
  fileOwners: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
  })
    .index("by_storage", ["storageId"])
    .index("by_user", ["userId"]),

  /**
   * The last "Tidy up" of a user's categories, with what it changed, so it can be undone for 30
   * days. Only the most recent one is kept. Missing subcategories are null (arrays cannot hold
   * undefined).
   */
  categoryCleanups: defineTable({
    userId: v.id("users"),
    ...synced,
    at: v.number(),
    /** One line per change that went through, e.g. "Merged Cafe into Coffee". */
    label: v.array(v.string()),
    undoneAt: v.optional(v.number()),
    createdCategoryIds: v.array(v.id("categories")),
    categoriesBefore: v.array(v.object({
      id: v.id("categories"),
      name: v.string(),
      parentId: v.optional(v.id("categories")),
      deletedAt: v.optional(v.number()),
      order: v.number(),
    })),
    budgetsBefore: v.array(v.object({
      id: v.id("budgets"),
      categoryId: v.optional(v.id("categories")),
      period: budgetPeriod,
      amount: v.number(),
      overrides: v.record(v.string(), v.number()),
    })),
    entries: v.array(v.object({ id: v.id("transactions"), from: catPair, to: catPair })),
    templates: v.array(v.object({ table: v.union(v.literal("repeats"), v.literal("bookmarks")), id: v.string(), from: catPair, to: catPair })),
  }).index("by_user", ["userId"]).index("by_user_rev", ["userId", "rev"]),

  /**
   * The change history shown on the Payment methods and Categories pages: one plain sentence per
   * change, written by the op that made it (shared/history.ts). Capped per user.
   */
  history: defineTable({
    userId: v.id("users"),
    ...synced,
    at: v.number(),
    scope: v.union(v.literal("accounts"), v.literal("categories")),
    text: v.string(),
  }).index("by_user", ["userId"]).index("by_user_rev", ["userId", "rev"]),

  /**
   * A user's last AI run for Tidy up: when (runs are limited to one a month), a fingerprint of the
   * summary it saw (an unchanged summary reuses the answer), and the checked suggestions.
   */
  aiUsage: defineTable({
    userId: v.id("users"),
    lastRunAt: v.number(),
    summaryHash: v.string(),
    result: v.array(v.object({
      kind: v.union(v.literal("merge"), v.literal("rename"), v.literal("nest")),
      type: v.union(v.literal("income"), v.literal("expense")),
      ids: v.array(v.id("categories")),
      targetId: v.optional(v.id("categories")),
      newName: v.optional(v.string()),
      parentId: v.optional(v.id("categories")),
      reason: v.string(),
      confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    })),
  }).index("by_user", ["userId"]),

  /**
   * A user's change number: every mutation that writes their synced documents adds one and stamps
   * what it wrote with it (convex/lib/changes.ts). `prunedRev` is the newest delete whose tombstone
   * has been dropped; a device that last looked before it has to load everything again.
   */
  syncState: defineTable({
    userId: v.id("users"),
    rev: v.number(),
    prunedRev: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  /** A synced document that was deleted, so devices that hold it hear about it. Dropped after a while (sync.pruneTombstones). */
  tombstones: defineTable({
    userId: v.id("users"),
    table: v.string(),
    docId: v.string(),
    rev: v.number(),
  }).index("by_user_rev", ["userId", "rev"]),

  /** Ops the client has synced, for idempotent retries. */
  syncOps: defineTable({
    userId: v.id("users"),
    opId: v.string(),
    kind: v.string(),
    status: v.union(v.literal("applied"), v.literal("rejected")),
    error: v.optional(v.string()),
    idMap: v.optional(v.record(v.string(), v.string())),
  }).index("by_user_op", ["userId", "opId"]),

  /**
   * A user's Gmail connection (docs/specs/gmail-sync.md). Server-only: the refresh token is
   * encrypted with GMAIL_TOKEN_KEY and the app reads a safe projection through gmail.status.
   */
  gmailConnections: defineTable({
    userId: v.id("users"),
    email: v.string(),
    refreshTokenEnc: v.string(),
    iv: v.string(),
    /** The last check covered mail received up to this instant; the next one starts the look-back before it (shared/gmail/query.ts windowStart). Unset until the first check. */
    syncedUpTo: v.optional(v.number()),
    /** A check is running since this instant (gmail.ts syncUser claims it, the check's write or failure clears it): one check at a time. */
    syncingSince: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    status: v.union(v.literal("ok"), v.literal("reauth"), v.literal("paused")),
    lookbackDays: v.number(),
    /** Mail received before this is never read: when the user connected, minus the look-back they chose. */
    readsFrom: v.optional(v.number()),
    /** Sender allowlist, editable; seeded with known bank, UPI and shop senders. */
    senders: v.array(v.string()),
    /** Also scan mail Gmail files under Purchases. */
    scanPurchases: v.boolean(),
    /** "hdfcbank.net|1234" → the card; learned from what the user picked when saving. */
    accountMap: v.record(v.string(), v.id("accounts")),
    /** Per-user monthly cap on model calls. */
    aiMonth: v.string(),
    aiCalls: v.number(),
    /** Drafts written after this change number (syncState.rev) have not been learned from yet (prepareSync). */
    learnedRev: v.optional(v.number()),
    /** gmailSeen holds this user's drafts and `processed` (which then moves there too): set by the first check after it was added. */
    seenFilled: v.optional(v.boolean()),
    /** The last 10 checks. */
    log: v.array(v.object({ at: v.number(), scanned: v.number(), found: v.number(), error: v.optional(v.string()), note: v.optional(v.string()) })),
    /**
     * Mails read that made no draft (triage dropped them, or the AI said they are not a payment), so
     * a later check's overlap does not fetch them and ask the AI again. Kept while a window can still reach them.
     */
    processed: v.optional(v.array(v.object({ id: v.string(), receivedAt: v.number() }))),
    /** Merchant (as mail names it, shared/gmail/learn.ts merchantKey) → the note and category the user saves it with. */
    merchantMap: v.optional(v.record(v.string(), v.object({ note: v.string(), categoryId: v.optional(v.id("categories")), subcategoryId: v.optional(v.id("categories")) }))),
    /** Senders the user said send no money mail: left out of the search and never read. */
    muted: v.optional(v.array(v.string())),
  }).index("by_user", ["userId"]),

  /**
   * A Gmail grant back from Google, waiting for the app to claim it with the one-time `claim` it was
   * sent back with. Only the account that started connecting can, so a connect link someone sends
   * to another person attaches nothing. Dropped after 10 minutes.
   */
  gmailPending: defineTable({
    userId: v.id("users"),
    claim: v.string(),
    email: v.string(),
    refreshTokenEnc: v.string(),
    iv: v.string(),
    lookbackDays: v.number(),
  }).index("by_claim", ["claim"]).index("by_user", ["userId"]),

  /**
   * Entries read from mail, waiting for the user to check and save them. Never counted anywhere:
   * saving one creates a real entry through the drafts.accept op.
   */
  drafts: defineTable({
    userId: v.id("users"),
    ...synced,
    source: v.literal("gmail"),
    /** The primary Gmail message. */
    messageId: v.string(),
    /** The merchant as the mail named it (cleaned), before what the user taught replaced the note: the key merchant memory learns under. */
    merchant: v.optional(v.string()),
    /** Mails folded into this one: the receipt that went with the bank alert, etc. */
    extraMessageIds: v.array(v.string()),
    threadId: v.string(),
    receivedAt: v.number(),
    from: v.string(),
    /** Trimmed to 120 characters. */
    subject: v.string(),
    proposal: v.object({
      type: txType,
      date: v.string(),
      time: v.optional(v.string()),
      /** Minor units of the main currency. */
      amount: v.number(),
      /** When the mail was in another currency. */
      subAmount: v.optional(v.number()),
      subCurrency: v.optional(v.string()),
      /** The merchant, cleaned ("Swiggy", not "SWIGGY*ORDER 8812-BLR"). */
      note: v.string(),
      /** One line of provenance: "HDFC alert · card ending 1234". */
      description: v.optional(v.string()),
      accountId: v.optional(v.id("accounts")),
      toAccountId: v.optional(v.id("accounts")),
      categoryId: v.optional(v.id("categories")),
      subcategoryId: v.optional(v.id("categories")),
      accountHint: v.optional(v.object({
        bankName: v.optional(v.string()),
        last4: v.optional(v.string()),
        channel: v.optional(v.union(v.literal("upi"), v.literal("card"), v.literal("netbanking"), v.literal("wallet"))),
      })),
    }),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    how: v.union(v.literal("rule"), v.literal("ai")),
    /** An entry the user already typed in that looks like this one ("already added?"). */
    matchedTransactionId: v.optional(v.id("transactions")),
    /** The user said "No, it's new": the draft is never matched to an entry again. */
    keptNew: v.optional(v.boolean()),
    status: v.union(v.literal("open"), v.literal("accepted"), v.literal("dismissed")),
    transactionId: v.optional(v.id("transactions")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_user_message", ["userId", "messageId"])
    .index("by_user_rev", ["userId", "rev"]),

  /**
   * Every Gmail message a check has dealt with: the mail of a draft (its own and the ones folded
   * into it) and mail read that made none. A check skips these, so it reads only these small rows,
   * never the drafts. Kept a little longer than the longest look-back can reach.
   */
  gmailSeen: defineTable({
    userId: v.id("users"),
    messageId: v.string(),
    receivedAt: v.number(),
    /** No draft came of it (triage dropped it, or the AI said it is not a payment): "Read again" forgets these. */
    processed: v.optional(v.boolean()),
  })
    .index("by_user_message", ["userId", "messageId"])
    .index("by_user_received", ["userId", "receivedAt"]),

  currencies: defineTable({
    userId: v.id("users"),
    ...synced,
    code: v.string(),
    name: v.string(),
    symbol: v.string(),
    rate: v.number(),
    decimals: v.number(),
    symbolPosition: v.union(v.literal("before"), v.literal("after")),
    isCustom: v.boolean(),
    order: v.number(),
  }).index("by_user", ["userId"]).index("by_user_rev", ["userId", "rev"]),
});
