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
import { loadSnapshot } from "./lib/snapshot";
import {
  AI_MODEL, AI_RUN_EVERY_MS, OUTPUT_SCHEMA, SYSTEM_PROMPT, aiEligibility, buildSummary, summaryHash, validateSuggestions, type AiSuggestion,
} from "../shared/tidyAi";

type Usage = Doc<"aiUsage">;
export type SuggestResult = { suggestions: AiSuggestion[]; lastRunAt: number; cached: boolean };

/** When the last AI run was and what it suggested, or null if there never was one. */
export const status = query({
  args: {},
  handler: async (ctx): Promise<{ lastRunAt: number; result: AiSuggestion[] } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const u = await ctx.db.query("aiUsage").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return u ? { lastRunAt: u.lastRunAt, result: u.result } : null;
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
      eligible, summary, idMap, hash: summaryHash(summary), usage,
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
    if (!prep.eligible.ok) throw new ConvexError(prep.eligible.reason);
    const usage = prep.usage;
    // Nothing changed since the last run: show its answer again, free.
    if (usage && usage.summaryHash === prep.hash) return { suggestions: usage.result, lastRunAt: usage.lastRunAt, cached: true };
    if (usage && Date.now() - usage.lastRunAt < AI_RUN_EVERY_MS) throw new ConvexError(`You can get new AI suggestions on ${nextRunDate(usage)}`);
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError("AI suggestions aren't set up yet");

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
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`stopped: ${res.stop_reason}`);
      const text = res.content.find((b) => b.type === "text");
      raw = JSON.parse(text && text.type === "text" ? text.text : "{}").suggestions;
    } catch (e) {
      console.error("tidy-ai failed", e instanceof Error ? e.message : e);
      throw new ConvexError("Couldn't get AI suggestions. Try again later.");
    }
    const suggestions = validateSuggestions(raw, prep.categories, prep.idMap, prep.subcategoriesEnabled);
    console.log("tidy-ai kept", { userId, returned: Array.isArray(raw) ? raw.length : 0, kept: suggestions.length });
    const lastRunAt = Date.now();
    await ctx.runMutation(internal.ai.record, { userId, lastRunAt, summaryHash: prep.hash, result: suggestions });
    return { suggestions, lastRunAt, cached: false };
  },
});
