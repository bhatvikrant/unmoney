/**
 * Temporary (2026-11-26): what this device did during a voice entry, sent to the server's log
 * (convex/usage.ts voiceTrace), to find why the iPhone home screen app hears a second sentence and then
 * fills nothing in. Step names, lengths and seconds only, never the words. Remove both once that is fixed.
 */
let steps: string[] = [];
let t0 = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let send: ((trail: string) => void) | null = null;

/** The form hands over the way to reach the server. */
export function setTraceSender(fn: (trail: string) => void) { send = fn; }

/** Notes one step; the steps so far go out once nothing has happened for a moment. */
export function trace(step: string) {
  const now = Date.now();
  if (!steps.length) t0 = now;
  if (steps.length < 80) steps.push(`${((now - t0) / 1000).toFixed(1)}:${step}`);
  clearTimeout(timer);
  timer = setTimeout(() => { const trail = steps.join(" "); steps = []; send?.(trail); }, 2500);
}

// an error anywhere while a trace is being collected belongs in it
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => { if (steps.length) trace(`error:${String(e.message).slice(0, 80)}`); });
  window.addEventListener("unhandledrejection", (e) => { if (steps.length) trace(`rejection:${String((e.reason as Error | undefined)?.message ?? e.reason).slice(0, 80)}`); });
}
