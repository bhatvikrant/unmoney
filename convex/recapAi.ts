/**
 * AI insights on a recap (shared/recapAi.ts). The recap page asks, and only when the person taps
 * the button; the server builds the facts from the database (so the prompt can't be inflated), asks
 * Claude, checks the answer against those facts and stores it. One answer is kept per user per
 * recap: opening the recap again reads it for free, and Claude is asked again only when the facts
 * have changed, up to RECAP_MONTHLY_CAP runs a month. Nothing in the ledger is changed here: a
 * suggested budget is set by the person, as an ordinary budget op.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import schema from "./schema";
import { loadSnapshot } from "./lib/snapshot";
import { aiAllowed } from "./lib/auth";
import { recordSpend } from "./lib/aiSpend";
import { reportServerError } from "./lib/posthog";
import { addDays } from "../shared/dates";
import { monthRange, yearRange } from "../shared/period";
import { RECAP_MONTHLY_CAP, buildRecapFacts, recapRequest, validateRecap, type RecapAiCard, type RecapInsights } from "../shared/recapAi";

const KEY = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
export type StoredInsights = RecapInsights & { hash: string; at: number };
type Row = { insights: string[]; budgets: RecapInsights["budgets"]; hash: string; at: number; title?: string; cards?: unknown };
/** A stored row as the app reads it. The schema keeps a card's type as a string; it is only ever written from a checked answer. */
const answerOf = (row: Row): StoredInsights => ({
  insights: row.insights, budgets: row.budgets, hash: row.hash, at: row.at,
  ...(row.title ? { title: row.title } : {}), ...(row.cards ? { cards: row.cards as RecapAiCard[] } : {}),
});

/** The stored answer for a recap, or null when it was never asked for. */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<StoredInsights | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.query("recapInsights").withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", key)).unique();
    return row ? answerOf(row) : null;
  },
});

/** The facts and the stored answer, read in one consistent query. */
export const prepare = internalQuery({
  args: { userId: v.id("users"), key: v.string() },
  handler: async (ctx, { userId, key }) => {
    // the tables a recap is built from (shared/recap.ts)
    const snap = await loadSnapshot(ctx, userId, ["settings", "transactions", "categories", "accounts", "accountGroups", "budgets"]);
    const msd = snap.settings[0]?.monthStartDay ?? 1;
    const to = (key.length === 4 ? yearRange(Number(key), msd) : monthRange(key, msd)).to;
    // a period still running has no recap. Somewhere it is already tomorrow, so the server's day plus one is the latest "today".
    const finished = to < addDays(new Date().toISOString().slice(0, 10), 1);
    const stored = await ctx.db.query("recapInsights").withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", key)).unique();
    return { allowed: await aiAllowed(ctx, userId), facts: finished ? buildRecapFacts(snap, key) : null, stored };
  },
});

const fields = schema.tables.recapInsights.validator.fields;
export const store = internalMutation({
  args: { userId: v.id("users"), key: v.string(), hash: v.string(), at: v.number(), insights: fields.insights, budgets: fields.budgets, title: fields.title, cards: fields.cards },
  handler: async (ctx, args) => {
    // deleted while the call was out: nothing of theirs is written back
    if (!(await ctx.db.get(args.userId))) return;
    const old = await ctx.db.query("recapInsights").withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", args.key)).unique();
    if (old) await ctx.db.replace(old._id, args);
    else await ctx.db.insert("recapInsights", args);
  },
});

/**
 * Ask Claude what stands out in a finished month or year, and for a month what to budget next.
 * Errors meant for the person are ConvexErrors carrying a plain sentence.
 */
export const ask = action({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<StoredInsights> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    if (!KEY.test(key)) throw new ConvexError("That recap can't be read");
    const { allowed, facts, stored } = await ctx.runQuery(internal.recapAi.prepare, { userId, key });
    // off for everyone until the superadmin turns it on for them (lib/auth.ts aiAllowed)
    if (!allowed) throw new ConvexError("AI insights aren't turned on for your account");
    if (!facts) throw new ConvexError("There isn't a recap for this period yet");
    // nothing changed since the last run: show its answer again, free
    if (stored && stored.hash === facts.hash) return answerOf(stored);
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError("AI insights aren't set up yet");
    if (!(await ctx.runMutation(internal.usage.claimAi, { userId, feature: "recap", cap: RECAP_MONTHLY_CAP }))) {
      throw new ConvexError(`AI has written insights ${RECAP_MONTHLY_CAP} times this month, the most it does. It starts again next month.`);
    }
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    try {
      const res = await client.messages.create(recapRequest(facts.input));
      console.log("recap-ai", { userId, key, stop: res.stop_reason, input: res.usage.input_tokens, output: res.usage.output_tokens });
      await recordSpend(ctx, userId, "recap", res, true);
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`stopped: ${res.stop_reason}`);
      const text = res.content.find((b) => b.type === "text");
      const result = validateRecap(JSON.parse(text && text.type === "text" ? text.text : "{}"), facts);
      // an answer with nothing usable in it is not kept: the person can ask again
      if (!result.insights.length && !result.cards?.length) throw new Error("no insight passed the checks");
      const out = { ...result, hash: facts.hash, at: Date.now() };
      await ctx.runMutation(internal.recapAi.store, { userId, key, ...out });
      return out;
    } catch (e) {
      console.error("recap-ai failed", e instanceof Error ? e.message : e);
      await reportServerError("recapAi.ask", e, { userId });
      throw new ConvexError("Couldn't get insights. Try again later.");
    }
  },
});
