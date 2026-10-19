import { describe, expect, it } from "vitest";
import { monthRange, neighbourPeriod, rangeHasDate, shiftMonthKey, yearRange } from "./period";

const months = (key: string, dir: 1 | -1, dates: string[], today = "2026-10-19") =>
  neighbourPeriod(key, dir, dates, today, (k) => monthRange(k, 1), shiftMonthKey);

describe("rangeHasDate", () => {
  it("finds a date inside the range and nothing outside it", () => {
    const dates = ["2026-01-05", "2026-03-10", "2026-03-11", "2026-08-01"];
    expect(rangeHasDate(dates, { from: "2026-03-01", to: "2026-03-31" })).toBe(true);
    expect(rangeHasDate(dates, { from: "2026-04-01", to: "2026-07-31" })).toBe(false);
    expect(rangeHasDate([], { from: "2026-04-01", to: "2026-07-31" })).toBe(false);
  });
});

describe("neighbourPeriod", () => {
  const dates = ["2026-01-05", "2026-03-10", "2026-10-02"];
  it("skips empty months in between", () => {
    expect(months("2026-01", 1, dates)).toBe("2026-03");
    expect(months("2026-03", -1, dates)).toBe("2026-01");
  });
  it("stops at the first and last months with data", () => {
    expect(months("2026-01", -1, dates)).toBeUndefined();
    expect(months("2026-10", 1, dates)).toBeUndefined();
  });
  it("always lets you reach the current month", () => {
    expect(months("2026-03", 1, ["2026-01-05", "2026-03-10"])).toBe("2026-10");
    expect(months("2026-12", -1, ["2026-01-05"])).toBe("2026-10");
    expect(months("2026-05", 1, [])).toBe("2026-10");
    expect(months("2026-10", 1, [])).toBeUndefined();
  });
  it("reaches a future month that already has entries", () => {
    expect(months("2026-10", 1, [...dates, "2027-02-01"])).toBe("2027-02");
    expect(months("2027-02", 1, [...dates, "2027-02-01"])).toBeUndefined();
  });
  it("works for years too", () => {
    const years = (key: string, dir: 1 | -1) => neighbourPeriod(key, dir, ["2023-06-01", "2026-10-02"], "2026-10-19", (k) => yearRange(Number(k), 1), (k, n) => String(Number(k) + n));
    expect(years("2026", -1)).toBe("2023");
    expect(years("2023", -1)).toBeUndefined();
    expect(years("2026", 1)).toBeUndefined();
  });
});
