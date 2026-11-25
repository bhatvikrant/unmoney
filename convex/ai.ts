/**
 * AI suggestions for Tidy up. The browser asks; the server builds the category summary from the
 * database (so the prompt can't be inflated), enforces the data thresholds and the one-run-a-month
 * limit, asks Claude, and checks the answer against the user's categories before returning it.
 * Nothing is changed here: the user reviews the suggestions and applies them as a normal op.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { loadSnapshot, loadTable } from "./lib/snapshot";
import { toB64 } from "./lib/gmailCrypto";
import { recordSpend } from "./lib/aiSpend";
import { aiAllowed } from "./lib/auth";
import { reportServerError } from "./lib/posthog";
import {
  AI_MODEL, AI_RUN_EVERY_MS, OUTPUT_SCHEMA, SYSTEM_PROMPT, aiEligibility, buildSummary, summaryHash, validateSuggestions, type AiSuggestion,
} from "../shared/tidyAi";
import {
  RECEIPT_MAX_BYTES, RECEIPT_MEDIA_TYPES, RECEIPT_MONTHLY_CAP, RECEIPT_RECENT_ENTRIES, buildReceiptInput, receiptRequest, validateReceipt, type ReceiptRead,
} from "../shared/receiptAi";
import {
  SEARCH_MAX_QUESTION, SEARCH_MONTHLY_CAP, SEARCH_RECENT_ENTRIES, buildSearchContext, isRealDate, searchRequest, validateSearch, type SearchFilters,
} from "../shared/searchAi";

type Usage = Doc<"aiUsage">;
export type SuggestResult = { suggestions: AiSuggestion[]; lastRunAt: number; cached: boolean };

/** When the last AI run was and what it suggested, or null if there never was one. */
export const status = query({
  args: {},
  handler: async (ctx): Promise<{ lastRunAt: number; result: AiSuggestion[] } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await aiAllowed(ctx, userId))) return null;
    const u = await ctx.db.query("aiUsage").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    // lastRunAt 0 is a row that only counts attempts (claim): no run has worked yet
    return u?.lastRunAt ? { lastRunAt: u.lastRunAt, result: u.result } : null;
  },
});

/** Everything the action needs, read in one consistent query. */
export const prepare = internalQuery({
  args: { userId: v.id("users"), includeNotes: v.boolean(), today: v.string() },
  handler: async (ctx, { userId, includeNotes, today }) => {
    const snap = await loadSnapshot(ctx, userId, ["settings", "categories", "transactions"]);
    const eligible = aiEligibility(snap, today);
    const { summary, idMap } = buildSummary(snap, includeNotes);
    const usage = await ctx.db.query("aiUsage").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return {
      allowed: await aiAllowed(ctx, userId), eligible, summary, idMap, hash: summaryHash(summary), usage,
      categories: snap.categories, subcategoriesEnabled: snap.settings[0]?.subcategoryEnabled ?? true,
    };
  },
});

export const record = internalMutation({
  args: { userId: v.id("users"), lastRunAt: v.number(), summaryHash: v.string(), result: schema.tables.aiUsage.validator.fields.result },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("aiUsage").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (old) await ctx.db.replace(old._id, args);
    else await ctx.db.insert("aiUsage", args);
  },
});

/** A failed run does not use up the month, but each one is a paid Claude call: this many a day at most. */
const MAX_ATTEMPTS_A_DAY = 3;

/**
 * Counts a run before Claude is asked. In a transaction of its own, so runs started at the same moment
 * cannot all pass the limits the way they did when the run was only recorded after it had worked.
 */
export const claim = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<"ok" | "ran" | "tooMany"> => {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const u = await ctx.db.query("aiUsage").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (u && now - u.lastRunAt < AI_RUN_EVERY_MS) return "ran";
    const attempts = u?.attemptDay === day ? u.attempts ?? 0 : 0;
    if (attempts >= MAX_ATTEMPTS_A_DAY) return "tooMany";
    if (u) await ctx.db.patch(u._id, { attemptDay: day, attempts: attempts + 1 });
    else await ctx.db.insert("aiUsage", { userId, lastRunAt: 0, summaryHash: "", result: [], attemptDay: day, attempts: 1 });
    return "ok";
  },
});

const nextRunDate = (u: Usage) => new Date(u.lastRunAt + AI_RUN_EVERY_MS).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Ask Claude for category suggestions. Errors meant for the user are ConvexErrors carrying a
 * plain sentence; a failed run does not use up the month.
 */
export const suggestCategoryCleanup = action({
  args: { includeNotes: v.boolean(), today: v.string() },
  handler: async (ctx, { includeNotes, today }): Promise<SuggestResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    const prep = await ctx.runQuery(internal.ai.prepare, { userId, includeNotes, today });
    if (!prep.allowed) throw new ConvexError("AI suggestions aren't turned on for your account");
    if (!prep.eligible.ok) throw new ConvexError(prep.eligible.reason);
    const usage = prep.usage;
    // Nothing changed since the last run: show its answer again, free.
    if (usage && usage.summaryHash === prep.hash) return { suggestions: usage.result, lastRunAt: usage.lastRunAt, cached: true };
    if (usage && Date.now() - usage.lastRunAt < AI_RUN_EVERY_MS) throw new ConvexError(`You can get new AI suggestions on ${nextRunDate(usage)}`);
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError("AI suggestions aren't set up yet");
    const claimed = await ctx.runMutation(internal.ai.claim, { userId });
    if (claimed === "ran") throw new ConvexError("AI suggestions were just made. Open Tidy up again to see them.");
    if (claimed === "tooMany") throw new ConvexError("AI suggestions didn't work a few times today. Try again tomorrow.");

    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    let raw: unknown;
    try {
      const res = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 8000,
        output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(prep.summary) }],
      });
      console.log("tidy-ai", { userId, stop: res.stop_reason, input: res.usage.input_tokens, output: res.usage.output_tokens });
      await recordSpend(ctx, userId, "tidy", res);
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`stopped: ${res.stop_reason}`);
      const text = res.content.find((b) => b.type === "text");
      raw = JSON.parse(text && text.type === "text" ? text.text : "{}").suggestions;
    } catch (e) {
      console.error("tidy-ai failed", e instanceof Error ? e.message : e);
      await reportServerError("ai.suggestCategoryCleanup", e, { userId });
      throw new ConvexError("Couldn't get AI suggestions. Try again later.");
    }
    const suggestions = validateSuggestions(raw, prep.categories, prep.idMap, prep.subcategoriesEnabled);
    console.log("tidy-ai kept", { userId, returned: Array.isArray(raw) ? raw.length : 0, kept: suggestions.length });
    const lastRunAt = Date.now();
    await ctx.runMutation(internal.ai.record, { userId, lastRunAt, summaryHash: prep.hash, result: suggestions });
    return { suggestions, lastRunAt, cached: false };
  },
});

// ---- reading a photo attached to an entry (shared/receiptAi.ts) ----

const entryType = v.union(v.literal("expense"), v.literal("income"));

/** What goes with the photo, built from the database so the prompt can't be inflated, and whether the person turned this on and may use AI. */
export const prepareReceipt = internalQuery({
  args: { userId: v.id("users"), type: entryType, today: v.string() },
  handler: async (ctx, { userId, type, today }) => {
    const [settings, categories, transactions] = await Promise.all([
      loadTable(ctx, userId, "settings"),
      loadTable(ctx, userId, "categories"),
      // the newest entries of any type: enough of this type's notes among them without reading the whole ledger
      ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).order("desc").take(RECEIPT_RECENT_ENTRIES),
    ]);
    return { enabled: !!settings[0]?.receiptAiEnabled && (await aiAllowed(ctx, userId)), categories, ...buildReceiptInput({ settings, categories, transactions }, type, today) };
  },
});

/**
 * Ask Claude what a photo attached to an entry says: a note in the person's own words, a description,
 * a category and the date. Only for people who turned it on, and at most RECEIPT_MONTHLY_CAP times a
 * month. The photo is passed through and not kept here; the entry's own copy is uploaded as before.
 * Nothing is saved: the form fills in what is still empty and the person checks it.
 */
export const readReceipt = action({
  args: { image: v.bytes(), mediaType: v.union(...RECEIPT_MEDIA_TYPES.map((t) => v.literal(t))), type: entryType, today: v.string() },
  handler: async (ctx, { image, mediaType, type, today }): Promise<ReceiptRead> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    if (!image.byteLength || image.byteLength > RECEIPT_MAX_BYTES || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new ConvexError("That photo can't be read");
    const prep = await ctx.runQuery(internal.ai.prepareReceipt, { userId, type, today });
    if (!prep.enabled) throw new ConvexError("Reading photos with AI is turned off");
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError("Reading photos with AI isn't set up yet");
    if (!(await ctx.runMutation(internal.usage.claimAi, { userId, feature: "receipt", cap: RECEIPT_MONTHLY_CAP }))) {
      throw new ConvexError(`AI has read ${RECEIPT_MONTHLY_CAP} photos this month, the most it reads. It starts again next month.`);
    }
    const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
    try {
      const res = await client.messages.create(receiptRequest(prep.input, mediaType, toB64(new Uint8Array(image))));
      console.log("receipt-ai", { userId, stop: res.stop_reason, input: res.usage.input_tokens, output: res.usage.output_tokens });
      await recordSpend(ctx, userId, "receipt", res, true);
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`stopped: ${res.stop_reason}`);
      const text = res.content.find((b) => b.type === "text");
      return validateReceipt(JSON.parse(text && text.type === "text" ? text.text : "{}"), prep.ids, prep.categories, today);
    } catch (e) {
      console.error("receipt-ai failed", e instanceof Error ? e.message : e);
      await reportServerError("ai.readReceipt", e, { userId });
      throw new ConvexError("Couldn't read the photo with AI. Fill it in yourself this time.");
    }
  },
});

// ---- search by asking a question (shared/searchAi.ts) ----

/** The names that go with a question, built from the database so the prompt can't be inflated, and whether the person may use AI. No entry leaves here: only the tags on the newest ones. */
export const prepareSearch = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const [settings, categories, accounts, transactions] = await Promise.all([
      loadTable(ctx, userId, "settings"),
      loadTable(ctx, userId, "categories"),
      loadTable(ctx, userId, "accounts"),
      ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).order("desc").take(SEARCH_RECENT_ENTRIES),
    ]);
    return { allowed: await aiAllowed(ctx, userId), ...buildSearchContext({ settings, categories, accounts, transactions }) };
  },
});

/**
 * Ask Claude which of the search page's filters a typed question means. Only when the person taps
 * Ask AI, and at most SEARCH_MONTHLY_CAP times a month. Claude sees the question and the names of
 * their categories, payment methods and tags, never an entry; the search then runs on the device.
 * One quick call: someone is waiting, and the page falls back to its plain search if this is slow or fails.
 */
export const askSearch = action({
  args: { question: v.string(), today: v.string() },
  handler: async (ctx, args): Promise<SearchFilters> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    const question = args.question.replace(/\s+/g, " ").trim();
    if (!question || !isRealDate(args.today)) throw new ConvexError("That question can't be read");
    if (question.length > SEARCH_MAX_QUESTION) throw new ConvexError(`That question is too long for AI: keep it under ${SEARCH_MAX_QUESTION} characters`);
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError("Asking AI isn't set up yet");
    const prep = await ctx.runQuery(internal.ai.prepareSearch, { userId });
    if (!prep.allowed) throw new ConvexError("Asking AI isn't turned on for your account");
    if (!(await ctx.runMutation(internal.usage.claimAi, { userId, feature: "search", cap: SEARCH_MONTHLY_CAP }))) {
      throw new ConvexError(`AI has answered ${SEARCH_MONTHLY_CAP} questions this month, the most it answers. It starts again next month.`);
    }
    const client = new Anthropic({ timeout: 10_000, maxRetries: 1 });
    try {
      const res = await client.messages.create(searchRequest(prep.context, question, args.today));
      console.log("search-ai", { userId, stop: res.stop_reason, input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens ?? 0 });
      await recordSpend(ctx, userId, "search", res, true);
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`stopped: ${res.stop_reason}`);
      const text = res.content.find((b) => b.type === "text");
      return validateSearch(JSON.parse(text && text.type === "text" ? text.text : "{}"), prep.ids, prep.context.tags);
    } catch (e) {
      console.error("search-ai failed", e instanceof Error ? e.message : e);
      await reportServerError("ai.askSearch", e, { userId });
      throw new ConvexError("AI couldn't work that question out");
    }
  },
});
