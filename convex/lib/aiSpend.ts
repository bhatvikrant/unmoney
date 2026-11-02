/**
 * Record what a Claude answer cost, for the superadmin dashboard (usage.recordAi). Called as soon as
 * an answer is back, before it is checked, since a refused or cut-off answer is billed too. A failed
 * record is logged and never fails the feature that made the call.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { AiFeature } from "../../shared/aiCost";

export async function recordSpend(ctx: ActionCtx, userId: Id<"users">, feature: AiFeature, res: Anthropic.Message): Promise<void> {
  const u = res.usage;
  try {
    await ctx.runMutation(internal.usage.recordAi, {
      userId, feature, model: res.model,
      tokens: { input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 },
    });
  } catch (e) {
    console.error("ai-spend failed", e instanceof Error ? e.message : e);
  }
}
