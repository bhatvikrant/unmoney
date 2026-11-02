/**
 * Usage counts for the superadmin dashboard (shared/admin.ts, convex/usage.ts): how often the app is
 * opened, for how long, on what, which screens, and roughly how much it downloads and uploads. Only
 * counts and sizes, never what is in the ledger. Each session's running totals are sent now and then;
 * the server adds what grew, so a lost or repeated send costs nothing.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { screenKey } from "../../shared/admin";
import { isStandalone } from "./pwa";

const DEVICE_KEY = "unmoney:deviceId";
/** Back after this long away: a new session, as if opened again. */
const NEW_SESSION_AFTER_MS = 30 * 60_000;
const PING_EVERY_MS = 60_000;

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

type Session = {
  id: string; startedAt: number; day: string; hour: number;
  activeMs: number; visibleSince: number | null;
  bytesDown: number; bytesUp: number; photoFetches: number; opsSent: number;
  screens: Record<string, number>;
};

function newSession(): Session {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    id: uuid(), startedAt: now.getTime(), day, hour: now.getHours(),
    activeMs: 0, visibleSince: document.visibilityState === "visible" ? now.getTime() : null,
    bytesDown: 0, bytesUp: 0, photoFetches: 0, opsSent: 0, screens: {},
  };
}

let session: Session | null = null;
let hiddenAt: number | null = null;
const current = () => (session ??= newSession());

/** The size of a value as sent over the wire, near enough: its JSON. */
function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Counted by the sync store (src/lib/store.tsx) and the service worker (src/sw.ts). */
export const usage = {
  down(value: unknown) { current().bytesDown += sizeOf(value); },
  up(value: unknown) { current().bytesUp += sizeOf(value); },
  upBytes(n: number) { current().bytesUp += n; },
  ops(n: number) { current().opsSent += n; },
  photo() { current().photoFetches += 1; },
};

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) localStorage.setItem(DEVICE_KEY, (id = uuid()));
    return id;
  } catch {
    return "unknown";
  }
}

function device() {
  const ua = navigator.userAgent;
  // iPadOS asks for desktop sites, so it reads as a Mac with a touch screen
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = iPad || /iPhone|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /OPR\//.test(ua) ? "Opera" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Other";
  const formFactor = iPad || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet" as const : /Mobi|iPhone/.test(ua) ? "phone" as const : "desktop" as const;
  return { os, browser, formFactor, standalone: isStandalone() };
}

/** Counts this signed-in session and reports it while the app is open. Rendered once, inside the signed-in app. */
export function useUsageTracking() {
  const convex = useConvex();
  const { pathname } = useLocation();
  const sending = useRef(false);

  useEffect(() => {
    const s = current();
    const key = screenKey(pathname);
    s.screens[key] = (s.screens[key] ?? 0) + 1;
  }, [pathname]);

  useEffect(() => {
    const send = () => {
      if (sending.current || !navigator.onLine) return;
      const s = current();
      const now = Date.now();
      const activeMs = s.activeMs + (s.visibleSince ? now - s.visibleSince : 0);
      sending.current = true;
      convex.mutation(api.usage.ping, {
        sessionId: s.id, deviceId: deviceId(), day: s.day, hour: s.hour, startedAt: s.startedAt,
        tzOffset: -new Date().getTimezoneOffset(), appVersion: import.meta.env.VITE_APP_VERSION ?? "dev", ...device(),
        totals: { activeMs, bytesDown: s.bytesDown, bytesUp: s.bytesUp, photoFetches: s.photoFetches, opsSent: s.opsSent },
        screens: { ...s.screens },
      }).catch(() => { /* counts only: the next ping carries the same totals */ }).finally(() => { sending.current = false; });
    };
    const onVisibility = () => {
      const now = Date.now();
      const s = current();
      if (document.visibilityState === "hidden") {
        if (s.visibleSince) s.activeMs += now - s.visibleSince;
        s.visibleSince = null;
        hiddenAt = now;
        send();
      } else {
        if (hiddenAt && now - hiddenAt > NEW_SESSION_AFTER_MS) session = newSession();
        else s.visibleSince = now;
        hiddenAt = null;
        send();
      }
    };
    const onMessage = (e: MessageEvent) => { if (e.data?.type === "usage:photo") usage.photo(); };
    const first = setTimeout(send, 3000);
    const timer = setInterval(() => { if (document.visibilityState === "visible") send(); }, PING_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [convex]);
}
