import { describe, expect, test } from "vitest";
import { evaluateExpression, parseNumber, toMinor } from "./money";
import { guessCurrency } from "./currencies";

describe("parseNumber", () => {
  test.each([
    ["12.50", ".", 12.5],
    ["12,50", ".", 12.5], // a comma with two digits after it is a decimal comma, whatever the locale
    ["12,5", ".", 12.5],
    ["1,234", ".", 1234],
    ["1,234", ",", 1.234],
    ["1.234", ",", 1234],
    ["1.234", ".", 1.234],
    ["1,234.56", ",", 1234.56],
    ["1.234,56", ".", 1234.56],
    ["1,234,567", ".", 1234567],
    ["1.234.567,8", ".", 1234567.8],
    ["1 200,50", ",", 1200.5],
    ["1'234.50", ".", 1234.5],
    ["₹ 1,200", ".", 1200],
    ["-3", ".", -3],
    ["(4.00)", ".", -4],
    ["12-", ".", -12],
    ["05", ".", 5],
    ["0.5", ".", 0.5],
    [".5", ".", 0.5],
  ] as const)("%s (decimal %s) is %d", (raw, mark, want) => {
    expect(parseNumber(raw, mark)).toBe(want);
  });

  test.each(["", "abc", "-", "."])("%j is not a number", (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });
});

describe("evaluateExpression", () => {
  test.each([
    ["12+3*2", ".", 18],
    ["12,50+3", ".", 15.5],
    ["1.234,5-0,5", ",", 1234],
    ["08.50", ".", 8.5],
    ["100÷4", ".", 25],
    ["2×3", ".", 6],
  ] as const)("%s is %d", (expr, mark, want) => {
    expect(evaluateExpression(expr, mark)).toBe(want);
  });

  test.each(["5+", "abc", ""])("%j is incomplete", (expr) => {
    expect(evaluateExpression(expr)).toBeNull();
  });
});

test("toMinor reads a string the same way", () => {
  expect(toMinor("12,50", 2)).toBe(1250);
  expect(toMinor("1.234,56", 2)).toBe(123456);
  expect(toMinor("1.500", 0, ",")).toBe(1500);
});

test("the first guess at a main currency comes from the time zone, then the browser language", () => {
  expect(guessCurrency(["en-US"], "Asia/Kolkata")).toBe("INR");
  expect(guessCurrency(["de-DE"], "Europe/Berlin")).toBe("EUR");
  expect(guessCurrency(["en-GB"])).toBe("GBP");
  expect(guessCurrency(["hi"])).toBe("INR");
  expect(guessCurrency(["xx"])).toBeNull();
});
