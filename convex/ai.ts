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
  STATEMENT_BATCH, STATEMENT_MAX_LINES, STATEMENT_MONTHLY_CAP, STATEMENT_RECENT_ENTRIES, buildStatementContext, statementRequest, validateStatement, type StatementSuggestion,
} from "../shared/statementAi";

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

// ---- naming and filing the rows of a statement being imported (shared/statementAi.ts) ----

/** What goes with the rows, built from the database so the prompt can't be inflated, and whether the person may use AI. */
export const prepareStatement = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const [settings, categories, transactions] = await Promise.all([
      loadTable(ctx, userId, "settings"),
      loadTable(ctx, userId, "categories"),
      // the newest entries: enough of the person's notes among them without reading the whole ledger
      ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).order("desc").take(STATEMENT_RECENT_ENTRIES),
    ]);
    return { allowed: await aiAllowed(ctx, userId), categories, ...buildStatementContext({ settings, categories, transactions }) };
  },
});

/**
 * Ask Claude for a note and a category for the rows of a statement the person is about to import:
 * the bank's text of each row, in batches, with their categories and most-used notes. Nothing is
 * saved: the answers fill the import's review, where the person changes what they like and confirms
 * as before. One answer per line, in the order sent: null where a batch was not asked (the month's
 * limit) or failed, and `missed` says which, so the page can say some rows got nothing.
 */
export const suggestImport = action({
  args: { lines: v.array(v.object({ text: v.string(), kind: v.union(v.literal("out"), v.literal("in"), v.literal("refund")) })) },
  handler: async (ctx, { lines }): Promise<{ suggestions: (StatementSuggestion | null)[]; missed?: "cap" | "failed" }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    if (!lines.length || lines.length > STATEMENT_MAX_LINES) throw new ConvexError(`AI suggests for up to ${STATEMENT_MAX_LINES} different descriptions of a file`);
    const prep = await ctx.runQuery(internal.ai.prepareStatement, { userId });
    if (!prep.allowed) throw new ConvexError("AI suggestions aren't turned on for your account");
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError("AI suggestions aren't set up yet");
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    // serialised once: every batch must send the same bytes to read what the first one cached
    const context = JSON.stringify(prep.context);
    const suggestions: (StatementSuggestion | null)[] = lines.map(() => null);
    let missed: "cap" | "failed" | undefined;
    const ask = async (start: number) => {
      const batch = lines.slice(start, start + STATEMENT_BATCH);
      if (!(await ctx.runMutation(internal.usage.claimAi, { userId, feature: "statement", cap: STATEMENT_MONTHLY_CAP }))) { missed ??= "cap"; return; }
      try {
        const res = await client.messages.create(statementRequest(context, batch));
        console.log("statement-ai", { userId, rows: batch.length, stop: res.stop_reason, input: res.usage.input_tokens, cacheRead: res.usage.cache_read_input_tokens, output: res.usage.output_tokens });
        await recordSpend(ctx, userId, "statement", res, true);
        if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`stopped: ${res.stop_reason}`);
        const text = res.content.find((b) => b.type === "text");
        const got = validateStatement(JSON.parse(text && text.type === "text" ? text.text : "{}").rows, batch, prep, prep.categories);
        // a row the model left out was still asked about: it is not sent again
        got.forEach((s, i) => { suggestions[start + i] = s ?? {}; });
      } catch (e) {
        console.error("statement-ai failed", e instanceof Error ? e.message : e);
        await reportServerError("ai.suggestImport", e, { userId, context: { rows: batch.length } });
        missed = "failed";
      }
    };
    // The first batch alone, so the rest find the person's categories and notes cached; then the
    // rest together. If the first cannot be asked, the rest are not tried (and not counted).
    await ask(0);
    if (!missed) await Promise.all(lines.map((_, i) => i).filter((i) => i && i % STATEMENT_BATCH === 0).map(ask));
    if (!suggestions.some(Boolean)) {
      throw new ConvexError(missed === "cap" ? "AI has made as many suggestions as it does in a month. It starts again next month." : "Couldn't get AI suggestions. You can still import the file as it is.");
    }
    return missed ? { suggestions, missed } : { suggestions };
  },
});
