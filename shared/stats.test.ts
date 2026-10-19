import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { statsByCategory, statsEntries } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;

test("each Stats figure is exactly the sum of the entries its category screen lists", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const [cash, bank] = s.accounts;
  const tx = { accountId: cash._id, tags: [], photoIds: [], note: "", date: "2026-01-05" };
  s = run(s, "transactions.create", { ...tx, type: "expense", categoryId: food, amount: 1000 });
  s = run(s, "transactions.create", { ...tx, type: "expense", categoryId: food, amount: 250 });
  // a category deleted later still holds entries: they show as Uncategorised, and only they do
  const pets = s.categories.find((c) => c.name === "Pets")!._id;
  s = run(s, "transactions.create", { ...tx, type: "expense", categoryId: pets, amount: 70 });
  s = { ...s, categories: s.categories.filter((c) => c._id !== pets) };
  s = run(s, "accounts.update", { ...bank, id: bank._id, transferAsExpense: true });
  s = run(s, "transactions.create", { ...tx, type: "transfer", accountId: cash._id, toAccountId: bank._id, amount: 500 });

  const stats = statsByCategory(s, "2026-01-01", "2026-01-31", "expense");
  const entries = statsEntries(s, "2026-01-01", "2026-01-31", "expense");
  for (const item of stats.items) {
    expect(entries.filter((e) => e.bucket === item.id).reduce((sum, e) => sum + e.amount, 0)).toBe(item.amount);
  }
  expect(entries.filter((e) => e.bucket === "none").map((e) => e.amount)).toEqual([70]);
  expect(stats.total).toBe(1820);
});
