/**
 * Exchange rates from a public feed, kept on this device so the last ones work offline.
 * Everything about the source lives here: swap fetchFromSource to change provider.
 */
import { useSyncExternalStore } from "react";

/** Units of each currency per 1 `base`, as the feed had them when we reached it at `fetchedAt`. */
export type FxRates = { base: string; rates: Record<string, number>; fetchedAt: number };
/** What we know for a base: the last good rates, and whether the latest try to refresh them failed. */
export type FxState = { rates: FxRates | null; failed: boolean };
/** Rates from getRates; `fallback` when the feed couldn't be reached and these are the last saved ones. */
export type FxResult = FxRates & { fallback?: boolean };

/** A fetch younger than this is reused, so quick picks and focus changes don't call the feed again. */
export const FRESH_MS = 5 * 60 * 1000;
/** After a failed try, wait this long before trying again (unless forced, e.g. when back online). */
const RETRY_MS = 30 * 1000;
/** Older than this, rates are shown with their age. */
export const STALE_MS = 24 * 60 * 60 * 1000;

const KEY = "unmoney.fxRates";

async function fetchFromSource(base: string): Promise<Record<string, number>> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Rates: HTTP ${res.status}`);
  const j = await res.json();
  if (j?.result !== "success" || typeof j.rates !== "object") throw new Error("Rates: bad response");
  return j.rates as Record<string, number>;
}

function load(): Record<string, FxRates> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

const saved = load();
const failed = new Map<string, number>();
const inflight = new Map<string, Promise<FxResult | null>>();
const listeners = new Set<() => void>();
const states = new Map<string, FxState>();

function emit() {
  states.clear();
  for (const l of listeners) l();
}

function save(r: FxRates) {
  saved[r.base] = r;
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // storage full or blocked: keep them for this session only
  }
}

export function fxState(base: string): FxState {
  let s = states.get(base);
  if (!s) states.set(base, (s = { rates: saved[base] ?? null, failed: failed.has(base) }));
  return s;
}

/**
 * Latest rates for `base`: reuses a fetch younger than `maxAge`, shares one request between callers,
 * and falls back to the last saved rates (or null) when the feed can't be reached.
 */
export function getRates(base: string, { maxAge = FRESH_MS, force = false }: { maxAge?: number; force?: boolean } = {}): Promise<FxResult | null> {
  const have = saved[base];
  const fallback = () => (saved[base] ? { ...saved[base], fallback: true } : null);
  if (have && Date.now() - have.fetchedAt < maxAge) return Promise.resolve(have);
  const pending = inflight.get(base);
  if (pending) return pending;
  if (!force && Date.now() - (failed.get(base) ?? 0) < RETRY_MS) return Promise.resolve(fallback());
  const p = fetchFromSource(base)
    .then((rates) => {
      const r = { base, rates, fetchedAt: Date.now() };
      save(r);
      failed.delete(base);
      return r;
    })
    .catch(() => {
      failed.set(base, Date.now());
      return fallback();
    })
    .finally(() => {
      inflight.delete(base);
      emit();
    });
  inflight.set(base, p);
  return p;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Saved rates for `base` and whether the last refresh failed; re-renders when either changes. */
export function useFxState(base: string): FxState {
  return useSyncExternalStore(subscribe, () => fxState(base));
}

/** "Rate from 3 days ago", or null while the rates are fresh enough to say nothing. */
export function staleLabel(state: FxState, noun = "Rate", now = Date.now()): string | null {
  const at = state.rates?.fetchedAt;
  if (!at) return state.failed ? `Offline · saved ${noun.toLowerCase()}` : null;
  const age = now - at;
  if (!state.failed && age < STALE_MS) return null;
  const min = Math.floor(age / 60000);
  if (min < 1) return null;
  if (min < 60) return `${noun} from ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${noun} from ${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  return `${noun} from ${d} ${d === 1 ? "day" : "days"} ago`;
}
