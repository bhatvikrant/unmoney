import { expect, test } from "vitest";
import { statementDue } from "./ledger";

test("a card's payable falls due on the first payment day from the start of the current cycle", () => {
  expect(statementDue({ settlementDay: 1, paymentDay: 15 }, "2026-10-21")).toBe("2026-10-15");
  expect(statementDue({ settlementDay: 20, paymentDay: 5 }, "2026-10-21")).toBe("2026-11-05");
  expect(statementDue({ settlementDay: 20, paymentDay: 5 }, "2026-10-10")).toBe("2026-10-05");
  expect(statementDue({ settlementDay: 31, paymentDay: 10 }, "2026-02-27")).toBe("2026-02-10");
  expect(statementDue({ settlementDay: 1 }, "2026-10-21")).toBeUndefined();
});

test("a card with due tracking off has no due date, and keeps the setting through edits that leave it out", async () => {
  expect(statementDue({ settlementDay: 1, paymentDay: 15, noDueTracking: true }, "2026-10-21")).toBeUndefined();
  const { applyOp, emptySnapshot } = await import("./ops");
  const ctx = { userId: "u" as never };
  let n = 0;
  const run = (s: ReturnType<typeof emptySnapshot>, kind: string, args: unknown) => applyOp(s, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const bank = s.accounts.find((a) => a.kind === "bank")!._id;
  const base = { name: "Visa", kind: "card", initialBalance: 0, includeInTotals: true, hidden: false, transferAsExpense: false, billingAccountId: bank, settlementDay: 1, paymentDay: 15 };
  const made = run(s, "accounts.create", { ...base, noDueTracking: true });
  s = made.snap;
  const card = () => s.accounts.find((a) => a._id === made.result)!;
  expect(card().noDueTracking).toBe(true);
  s = run(s, "accounts.update", { id: made.result, ...base, name: "Visa Gold" }).snap;
  expect(card().noDueTracking).toBe(true);
  s = run(s, "accounts.update", { id: made.result, ...base, noDueTracking: false }).snap;
  expect(card().noDueTracking).toBeUndefined();
});
