import { expect, test } from "vitest";
import { statementDue } from "./ledger";

test("a card's payable falls due on the first payment day from the start of the current cycle", () => {
  expect(statementDue({ settlementDay: 1, paymentDay: 15 }, "2026-10-21")).toBe("2026-10-15");
  expect(statementDue({ settlementDay: 20, paymentDay: 5 }, "2026-10-21")).toBe("2026-11-05");
  expect(statementDue({ settlementDay: 20, paymentDay: 5 }, "2026-10-10")).toBe("2026-10-05");
  expect(statementDue({ settlementDay: 31, paymentDay: 10 }, "2026-02-27")).toBe("2026-02-10");
  expect(statementDue({ settlementDay: 1 }, "2026-10-21")).toBeUndefined();
});
