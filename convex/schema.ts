import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const txType = v.union(v.literal("income"), v.literal("expense"), v.literal("transfer"));
export const groupKind = v.union(
  v.literal("cash"),
  v.literal("bank"),
  v.literal("card"),
  v.literal("debitCard"),
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
    passcodeSalt: v.optional(v.string()),
    lockAfter: v.union(v.literal("always"), v.literal("5m"), v.literal("1h")),
    /** Account a new entry starts on; falls back to the first visible account when unset or gone. */
    defaultAccountId: v.optional(v.id("accounts")),
  }).index("by_user", ["userId"]),

  accountGroups: defineTable({
    userId: v.id("users"),
    name: v.string(),
    kind: groupKind,
    order: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  accounts: defineTable({
    userId: v.id("users"),
    groupId: v.id("accountGroups"),
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
    deletedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_group", ["groupId"]),

  categories: defineTable({
    userId: v.id("users"),
    type: v.union(v.literal("income"), v.literal("expense")),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    order: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_user_type", ["userId", "type"])
    .index("by_parent", ["parentId"]),

  transactions: defineTable({
    userId: v.id("users"),
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
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_user_account", ["userId", "accountId"])
    .index("by_user_to_account", ["userId", "toAccountId"])
    .index("by_user_category", ["userId", "categoryId"])
    .index("by_repeat", ["repeatId"])
    .searchIndex("search_note", { searchField: "note", filterFields: ["userId"] }),

  repeats: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("repeat"), v.literal("installment")),
    frequency: frequency,
    startDate: v.string(),
    endDate: v.optional(v.string()),
    nextDate: v.string(),
    installmentCount: v.optional(v.number()),
    template: template,
    active: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_active_next", ["active", "nextDate"]),

  bookmarks: defineTable({
    userId: v.id("users"),
    order: v.number(),
    template: template,
    /** The entry it was bookmarked from, so that entry can show a star. */
    transactionId: v.optional(v.id("transactions")),
  }).index("by_user", ["userId"]),

  budgets: defineTable({
    userId: v.id("users"),
    categoryId: v.optional(v.id("categories")),
    period: budgetPeriod,
    amount: v.number(),
    overrides: v.record(v.string(), v.number()),
  }).index("by_user", ["userId"]),

  notes: defineTable({
    userId: v.id("users"),
    date: v.string(),
    text: v.string(),
    color: v.string(),
  }).index("by_user_date", ["userId", "date"]),

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
  }).index("by_user", ["userId"]),

  /** Ops the client has synced, for idempotent retries. */
  syncOps: defineTable({
    userId: v.id("users"),
    opId: v.string(),
    kind: v.string(),
    status: v.union(v.literal("applied"), v.literal("rejected")),
    error: v.optional(v.string()),
    idMap: v.optional(v.record(v.string(), v.string())),
  }).index("by_user_op", ["userId", "opId"]),

  currencies: defineTable({
    userId: v.id("users"),
    code: v.string(),
    name: v.string(),
    symbol: v.string(),
    rate: v.number(),
    decimals: v.number(),
    symbolPosition: v.union(v.literal("before"), v.literal("after")),
    isCustom: v.boolean(),
    order: v.number(),
  }).index("by_user", ["userId"]),
});
