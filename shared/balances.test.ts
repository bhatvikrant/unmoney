import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { accountGet, accountsList } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;

test("installments due later are upcoming, not in today's balance or the card's outstanding", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const card = s.accounts.find((a) => a.name === "Card")!;
  const bank = s.accounts.find((a) => a.name === "Bank")!;
  s = run(s, "accounts.update", { ...card, id: card._id, billingAccountId: bank._id, settlementDay: 1, paymentDay: 15 });
  const tx = { type: "expense", accountId: card._id, categoryId: food, note: "TV", tags: [], photoIds: [] };
  // 3 x 100.00 starting today (2026-10-19), plus a coffee today and a refund next week
  s = run(s, "transactions.create", { ...tx, amount: 30000, date: "2026-10-19", installment: { count: 3 } });
  s = run(s, "transactions.create", { ...tx, amount: 500, date: "2026-10-19" });
  s = run(s, "transactions.create", { ...tx, amount: -500, date: "2026-10-26" });

  const row = accountsList(s, "2026-10-19").accounts.find((a) => a._id === card._id)!;
  expect(row.balance).toBe(-10500);
  expect(row.outstanding).toBe(10500);
  expect(row.upcoming).toBe(-20000 + 500);
  expect(accountsList(s, "2026-10-19").liabilities).toBe(10500);

  const detail = accountGet(s, card._id, "daily", "2026-10-01", "2026-10-31", "2026-10-19")!;
  expect([detail.balance, detail.upcoming, detail.card?.outstanding]).toEqual([-10500, -19500, 10500]);
  // a month later the next installment has happened
  expect(accountsList(s, "2026-11-19").accounts.find((a) => a._id === card._id)!.balance).toBe(-20000);
});
