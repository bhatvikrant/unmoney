import { expect, test } from "vitest";
import { PRICES, costOf } from "./aiCost";
import { AI_MODEL as TIDY_MODEL } from "./tidyAi";
import { AI_MODEL as GMAIL_MODEL } from "./gmail/ai";

test("every model the app calls has a price", () => {
  expect(PRICES[TIDY_MODEL]).toBeDefined();
  expect(PRICES[GMAIL_MODEL]).toBeDefined();
});

test("a call is priced by its input, output and cache tokens", () => {
  // 2,247 in and 1,113 out on Haiku 5.5: $0.0002247 + $0.0005565
  expect(costOf("claude-haiku-5-5", { input: 2247, output: 1113, cacheWrite: 0, cacheRead: 0 })).toBeCloseTo(0.0007812, 10);
  expect(costOf("claude-haiku-5-5", { input: 0, output: 0, cacheWrite: 10_000, cacheRead: 10_000 })).toBeCloseTo(0.00125 + 0.0001, 10);
});

test("a prompt past the long-context mark is charged the long rates", () => {
  expect(costOf("claude-haiku-5-5", { input: 100_000, output: 0, cacheWrite: 0, cacheRead: 0 })).toBeCloseTo(0.01, 10);
  expect(costOf("claude-haiku-5-5", { input: 100_001, output: 1000, cacheWrite: 0, cacheRead: 0 })).toBeCloseTo(0.0500005 + 0.0025, 10);
});

test("an unknown model costs nothing rather than failing the call", () => {
  expect(costOf("some-other-model", { input: 1000, output: 1000, cacheWrite: 0, cacheRead: 0 })).toBe(0);
});
