/**
 * Server errors to PostHog's error tracking, from actions (they can fetch; queries and mutations cannot).
 * Convex's own exception reporting needs its Pro plan, so the catch blocks that matter report here.
 *
 * Off unless POSTHOG_KEY is set on the deployment:
 *   npx convex env set POSTHOG_KEY phc_...
 *   npx convex env set POSTHOG_HOST https://eu.i.posthog.com   # only for an EU project; US is the default
 *
 * Never throws and never waits more than a few seconds: a report failing must not fail the action.
 * `context` holds kinds and names, never mail, amounts or tokens.
 */
/** V8 stack lines ("at fn (file:line:col)" or "at file:line:col") as PostHog's raw frames, outermost call first. */
export function framesOf(stack: string) {
  const frames = [];
  for (const line of stack.split("\n")) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const [, fn, filename, lineno, colno] = m;
    frames.push({
      platform: "node:javascript",
      filename,
      function: fn && fn !== "<anonymous>" ? fn : "?",
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return frames.reverse();
}

export async function reportServerError(
  where: string,
  error: unknown,
  opts: { userId?: string; context?: Record<string, string | number | boolean | undefined> } = {},
): Promise<void> {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;
  const host = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/$/, "");
  const e = error instanceof Error ? error : new Error(String(error));
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        api_key: key,
        event: "$exception",
        // the user's own id, as the app identifies them (src/lib/analytics.ts), or one bucket for server jobs
        distinct_id: opts.userId ?? "convex-server",
        properties: {
          // the shape PostHog's own SDKs send (@posthog/core error-properties-builder)
          $exception_list: [{
            type: e.name || "Error",
            value: e.message,
            mechanism: { type: "generic", handled: true, synthetic: !(error instanceof Error), exception_id: 0 },
            ...(e.stack ? { stacktrace: { type: "raw", frames: framesOf(e.stack) } } : {}),
          }],
          $exception_level: "error",
          source: "convex",
          where,
          stack: e.stack,
          ...(opts.userId ? {} : { $process_person_profile: false }),
          ...opts.context,
        },
      }),
    });
  } catch {
    // reporting is best effort
  } finally {
    clearTimeout(timer);
  }
}
