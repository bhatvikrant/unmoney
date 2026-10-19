/** Money is an integer in minor units. `decimals` comes from the currency. */

export type CurrencyFormat = {
  symbol: string;
  symbolPosition: "before" | "after";
  decimals: number;
};

export function toMinor(major: number | string, decimals: number): number {
  const n = typeof major === "string" ? Number(String(major).replace(/[^0-9.-]/g, "")) : major;
  if (!Number.isFinite(n)) return 0;
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

/** Evaluate a simple calculator expression ("12.5+3*2") to a major-unit number. */
export function evaluateExpression(expr: string): number | null {
  const clean = expr.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/[^0-9+\-*/.()]/g, "");
  if (!clean) return null;
  try {
    // Only digits and operators survive the regex above, so this is a safe arithmetic evaluation.
    const value = Function(`"use strict"; return (${clean});`)() as number;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
