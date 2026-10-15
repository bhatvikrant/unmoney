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
