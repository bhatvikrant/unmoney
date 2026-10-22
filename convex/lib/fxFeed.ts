/**
 * Today's exchange rates from the public feed the app uses on the device (src/lib/fxRates.ts),
 * for mail in a currency the user has no saved rate for. Units of each currency per 1 `base`;
 * null when the feed can't be reached, and the draft then waits for a rate as before.
 */
export async function latestRates(base: string): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base.toUpperCase())}`);
    if (!res.ok) return null;
    const j = await res.json();
    return j?.result === "success" && j.rates && typeof j.rates === "object" ? (j.rates as Record<string, number>) : null;
  } catch {
    return null;
  }
}
