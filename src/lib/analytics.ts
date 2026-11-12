/**
 * Product analytics, error tracking and session replay through PostHog (posthog.com, free tier).
 *
 * Off unless VITE_POSTHOG_KEY is set, so local dev and previews without it send nothing. The SDK is
 * fetched after the app has started, in a chunk of its own, so a cold start does not wait for it; what
 * is reported before it arrives is sent once it has.
 *
 * What this is allowed to see, for a money app: which screens are used and what is clicked, never what
 * is on them. Text and inputs are masked in replays and clicks, photos and canvases are left out of
 * replays, query strings (search text, filters) are cut from every URL, and the person is known by their
 * user id alone. Errors carry the message and stack, never a change's arguments.
 */
import type { PostHog, CaptureResult } from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
/** Same-origin by default: vercel.json passes /ingest on to PostHog, so ad blockers leave it alone. */
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "/ingest";
/** Where "open in PostHog" links in the toolbar point, as /ingest is not PostHog's own site. */
const UI_HOST = (import.meta.env.VITE_POSTHOG_UI_HOST as string | undefined) ?? "https://us.posthog.com";

let loading: Promise<PostHog | null> | null = null;

/** The URL without its query string or hash: search text and filters live there. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

const URL_KEY = /(url|referrer)$/i;

function scrub(props: Record<string, unknown> | undefined) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string" && URL_KEY.test(k)) props[k] = stripQuery(v);
  }
}

/** Every event's URLs lose their query strings, including the ones set on the person. */
export function beforeSend(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  scrub(event.properties);
  scrub(event.$set as Record<string, unknown> | undefined);
  scrub(event.$set_once as Record<string, unknown> | undefined);
  return event;
}

/** Starts PostHog once, after the first render. Safe to call more than once. */
export function startAnalytics(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null);
  return (loading ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host: HOST,
      ui_host: UI_HOST,
      // a person profile only once signed in (identifyUser); the sign-in screen stays anonymous
      person_profiles: "identified_only",
      // react-router changes the URL without a page load
      capture_pageview: "history_change",
      capture_pageleave: true,
      capture_exceptions: true,
      // localStorage only: no cookie for every request to carry
      persistence: "localStorage",
      respect_dnt: true,
      // clicks are recorded without the clicked element's text or attributes (amounts, payees, notes)
      mask_all_text: true,
      mask_all_element_attributes: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        // receipt photos, the photo viewer and anything drawn
        blockSelector: "img, video, canvas, picture, input[type=file]",
      },
      before_send: beforeSend,
      loaded: (ph) => { ph.register({ app_version: import.meta.env.VITE_APP_VERSION ?? "dev" }); },
    });
    return posthog;
  }).catch(() => null));
}

function withPostHog(fn: (ph: PostHog) => void) {
  if (!KEY) return;
  void startAnalytics().then((ph) => { if (ph) fn(ph); });
}

/** Ties this device's events to the signed-in user, by id only. */
export function identifyUser(userId: string) {
  withPostHog((ph) => { if (ph.get_distinct_id() !== userId) ph.identify(userId); });
}

/** On sign-out: the next person on this device starts as someone new. */
export function resetAnalytics() {
  withPostHog((ph) => ph.reset());
}

/** A handled error worth knowing about. `context` must hold no ledger data: kinds and names, not values. */
export function reportError(error: unknown, context?: Record<string, string | number | boolean | undefined>) {
  withPostHog((ph) => ph.captureException(error instanceof Error ? error : new Error(String(error)), context));
}

/** A product event. Keep properties to kinds and counts, never amounts, names or notes. */
export function track(event: string, properties?: Record<string, string | number | boolean | undefined>) {
  withPostHog((ph) => ph.capture(event, properties));
}
