/** Money is an integer in minor units. `decimals` comes from the currency. */

export type CurrencyFormat = {
  symbol: string;
  symbolPosition: "before" | "after";
  decimals: number;
};

/** The character a number uses before its fraction: "12.50" or "12,50". */
export type DecimalMark = "." | ",";

/**
 * A typed or imported number, in any common format: "1,234.56", "1.234,56", "12,50", "1 200",
 * "1'234.5", "-3", "(4.00)", "₹ 1,200". Both marks present: the last one is the decimal mark. A
 * lone mark is the decimal mark unless it is the other one (not `decimal`) followed by exactly
 * three digits ("1,234" in English, "1.234" in German): that is a thousands separator. Null when
 * there is no number.
 */
export function parseNumber(raw: string, decimal: DecimalMark = "."): number | null {
  let s = raw.trim();
  const negative = /^\(.*\)$/.test(s) || /^[^0-9]*-/.test(s) || /-\s*$/.test(s);
  s = s.replace(/[^0-9.,]/g, "");
  if (!/\d/.test(s)) return null;
  const marks = s.replace(/\d/g, "");
  if (marks.includes(".") && marks.includes(",")) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("").replace(",", ".");
  } else if (marks.length > 1) {
    s = s.split(marks[0]).join(""); // only thousands separators
  } else if (marks.length === 1) {
    const thousands = marks !== decimal && /^\d+[.,]\d{3}$/.test(s);
    s = thousands ? s.replace(marks, "") : s.replace(",", ".");
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

export function toMinor(major: number | string, decimals: number, decimal: DecimalMark = "."): number {
  const n = typeof major === "string" ? parseNumber(major, decimal) : major;
  if (n === null || !Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** decimals);
}

export function toMajor(minor: number, decimals: number): number {
  return minor / 10 ** decimals;
}

export function formatNumber(minor: number, decimals: number, grouping = true): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const s = String(abs).padStart(decimals + 1, "0");
  const int = decimals > 0 ? s.slice(0, -decimals) : s;
  const frac = decimals > 0 ? s.slice(-decimals) : "";
  const grouped = grouping ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  return `${sign}${grouped}${decimals > 0 ? "." + frac : ""}`;
}

export function formatMoney(minor: number, fmt: CurrencyFormat, opts: { sign?: boolean; grouping?: boolean } = {}): string {
  const num = formatNumber(Math.abs(minor), fmt.decimals, opts.grouping ?? true);
  const sign = minor < 0 ? "-" : opts.sign && minor > 0 ? "+" : "";
  return fmt.symbolPosition === "before" ? `${sign}${fmt.symbol} ${num}` : `${sign}${num} ${fmt.symbol}`;
}

/** A currency as a rate shows it. */
export type RateSide = { code: string; symbol: string; symbolPosition: "before" | "after" };

/** A rate's number: four decimals while it's small (1.1225), two after that (96.73, 106,250.5). */
export function rateNumber(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 4 : 2 });
}

/** "$1", "S$1", "RM 4.2", "9.52 kr"; the code instead when the symbol would be ambiguous. */
export function rateAmount(c: RateSide, num: string, useCode = false): string {
  if (useCode || !c.symbol) return `${num} ${c.code}`;
  if (c.symbolPosition === "after") return `${num} ${c.symbol}`;
  return /\p{L}$/u.test(c.symbol) && c.symbol.length > 1 ? `${c.symbol} ${num}` : `${c.symbol}${num}`;
}

/**
 * A rate as one unit of the stronger currency: "$1 = ₹96.73", "€1 = $1.1225". `rate` is units of
 * `sub` per 1 `main`, as stored. Two currencies with the same symbol (kr, Rs) are shown by code.
 */
export function formatRate(main: RateSide, sub: RateSide, rate: number): string {
  if (!(rate > 0)) return "";
  const [big, small, value] = rate >= 1 ? [main, sub, rate] : [sub, main, 1 / rate];
  const byCode = big.symbol === small.symbol;
  return `${rateAmount(big, "1", byCode)} = ${rateAmount(small, rateNumber(value), byCode)}`;
}

/** Evaluate a simple calculator expression ("12.5+3*2", "12,50+3") to a major-unit number. */
export function evaluateExpression(expr: string, decimal: DecimalMark = "."): number | null {
  let bad = false;
  // Each number is read on its own, so "1,234.5" and "12,50" mean what they look like.
  const numbers = expr.replace(/[\s'\u00a0\u202f]/g, "").replace(/[\d.,]+/g, (n) => {
    const v = parseNumber(n, decimal);
    if (v === null) bad = true;
    return String(v);
  });
  if (bad) return null;
  const clean = numbers.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/[^0-9+\-*/.()e]/g, "");
  if (!clean) return null;
  try {
    // Only digits and operators survive the regex above, so this is a safe arithmetic evaluation.
    const value = Function(`"use strict"; return (${clean});`)() as number;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
