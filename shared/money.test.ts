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

  test.each([
    ["(2+3)*4", 20],
    ["-5+8", 3],
    ["10-2-3", 5],
    ["100/8/5", 2.5],
    ["2+3*4-6/2", 11],
    ["1.5e2+1", 151],
    ["249.50", 249.5],
  ] as const)("%s is %d", (expr, want) => {
    expect(evaluateExpression(expr)).toBe(want);
  });

  test.each(["5+", "abc", "", "(2+3", "2+3)", "5(3)", "2**3", "1/0", "*5"])("%j is not an amount", (expr) => {
    expect(evaluateExpression(expr)).toBeNull();
  });

  test("it never builds code from the text: the site's Content-Security-Policy forbids that, and every amount came back empty", () => {
    const real = globalThis.Function;
    globalThis.Function = (() => { throw new EvalError("blocked by Content-Security-Policy"); }) as never;
    try {
      expect(evaluateExpression("120+45.50")).toBe(165.5);
    } finally {
      globalThis.Function = real;
    }
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

test("currency words and Dr/Cr marks around a number are not read as decimal points", () => {
  expect(parseNumber("Rs.1,500")).toBe(1500);
  expect(parseNumber("Rs. 1,234.00")).toBe(1234);
  expect(parseNumber("1,500.00 Dr.")).toBe(1500);
  expect(parseNumber("1.234,56")).toBe(1234.56);
  expect(parseNumber("12,50")).toBe(12.5);
  expect(parseNumber("(500.00)")).toBe(-500);
});
