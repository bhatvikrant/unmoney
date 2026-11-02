/**
 * What a Claude call costs, from the tokens its answer reports. Each call is priced when it is made
 * (convex/usage.ts recordAi) and the dollars are stored, so a later price change does not rewrite
 * the past; the superadmin dashboard sums them.
 */

/** Which part of UnMoney made the call. */
export type AiFeature = "tidy" | "gmail";

export type AiTokens = { input: number; output: number; cacheWrite: number; cacheRead: number };

/**
 * Anthropic's list prices in USD per million tokens. A prompt over `longAbove` input tokens is
 * charged the long rates for the whole call. Cache writes cost 1.25× input, cache reads 0.1×.
 */
export const PRICES: Record<string, { input: number; output: number; longAbove?: number; longInput?: number; longOutput?: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longAbove: 100_000, longInput: 0.5, longOutput: 2.5 },
};

/** The call's cost in USD; 0 for a model with no price here (shared/aiCost.test.ts keeps the app's models covered). */
export function costOf(model: string, t: AiTokens): number {
  const p = PRICES[model];
  if (!p) return 0;
  const long = p.longAbove !== undefined && t.input + t.cacheWrite + t.cacheRead > p.longAbove;
  const input = long ? p.longInput! : p.input;
  const output = long ? p.longOutput! : p.output;
  return (t.input * input + t.cacheWrite * input * 1.25 + t.cacheRead * input * 0.1 + t.output * output) / 1_000_000;
}
