/**
 * Installed-app support: registers the service worker (which precaches the app so it opens with
 * no connection), offers new versions with a toast, updates on its own once the running copy is a
 * day old and behind (see checkLatest), and tracks whether the app can be installed.
 */
import { useEffect, useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** installed: running as the home-screen app · prompt: the browser can install it for us · ios: Share › Add to Home Screen · manual: from the browser's menu */
export type InstallState = "installed" | "prompt" | "ios" | "manual";

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS() {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return false;
  // iPadOS reports itself as a Mac; touch support gives it away
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function startPwa() {
  installed = isStandalone();
  // Not calling preventDefault keeps Chrome's own install banner on Android; the event is kept so
  // Settings can offer the same prompt later.
  window.addEventListener("beforeinstallprompt", (e) => {
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });

  // what was last typed into, so an update never reloads over a half-filled entry (see safeNow)
  document.addEventListener("input", () => { typedOn = location.pathname; }, true);
  // At launch, not once the worker is registered: when the browser is already fetching a new version, registering
  // waits for that whole download, and the old copy would sit there usable (and typed into) all along.
  void checkLatest();

  registerSW({
    onNeedRefresh: offerUpdate,
    onNeedReload: reloadOnce,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      registration = reg;
      // Workbox only reports one update found after the page has been open a minute (it stops
      // listening once it decides an update came from elsewhere), so an app left open through
      // several deploys never heard about the second one. Watch the registration directly.
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) offerUpdate();
        });
      });
      // an installed app can stay open for days: look for a new version hourly and when it comes back to the front
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {});
        void checkLatest();
      };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      // a day-old copy found while an entry was being typed: update once the user has left the form
      setInterval(() => {
        if (behind && document.visibilityState === "visible" && safeNow()) void applyForced();
      }, 15 * 1000);
    },
  });
}

let reloading = false;
function reloadOnce() {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

/** One toast however many versions arrive while it's up; Reload switches to the newest waiting one. */
function offerUpdate() {
  if (forced.state !== "idle") return;
  toast("A new version of UnMoney is ready", {
    id: "new-version",
    duration: Infinity,
    action: {
      label: "Reload",
      onClick: async () => {
        // queued changes live in IndexedDB, so reloading never loses them
        const waiting = (await navigator.serviceWorker.getRegistration())?.waiting;
        if (!waiting) return reloadOnce();
        navigator.serviceWorker.addEventListener("controllerchange", reloadOnce, { once: true });
        waiting.postMessage({ type: "SKIP_WAITING" });
      },
    },
  });
}

/**
 * Forced updates. A new version is offered with the toast above; once the copy running here is a day
 * old and a newer one is out, UnMoney stops asking and updates itself, covering the screen while it does.
 * It only does so at a safe moment (opening the app, or any screen but a form that has been typed into),
 * never offline, and never in a loop: a version it already tried to switch to this session is left to the toast.
 */
export const FORCE_AFTER = 24 * 60 * 60 * 1000;
const BUILT_AT = Number(import.meta.env.VITE_APP_BUILT_AT ?? 0);
const TRIED_KEY = "unmoney.forcedUpdateTried";

/** current: when the running version was built */
export type ForcedUpdate = { state: "idle" | "updating" | "failed"; current: number };
let forced: ForcedUpdate = { state: "idle", current: BUILT_AT };
let registration: ServiceWorkerRegistration | undefined;
let behind: { version: string; builtAt: number } | null = null;
let typedOn: string | null = null;

function setForced(next: Partial<ForcedUpdate>) {
  forced = { ...forced, ...next };
  emit();
}

/** The entry, payment-method and settings forms: their unsaved fields live only in memory. */
const FORM = /\/(t\/[^/]+|new|edit)$/;
function safeNow() {
  return !(FORM.test(location.pathname) && typedOn === location.pathname);
}

/** Asks the server for the newest version. Offline, or the server can't be reached: nothing happens. */
async function checkLatest() {
  if (!BUILT_AT || !navigator.onLine) return;
  let latest: { version: string; builtAt: number };
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    latest = await res.json();
    if (typeof latest?.builtAt !== "number") return;
  } catch {
    return;
  }
  if (latest.builtAt <= BUILT_AT) return;
  if (Date.now() - BUILT_AT < FORCE_AFTER) return; // newer, but this copy is recent: the toast offers it
  behind = latest;
  if (safeNow()) void applyForced();
}

async function applyForced() {
  const target = behind;
  if (!target || forced.state !== "idle") return;
  try {
    // already switched to this version once and still on the old copy: let the toast handle it rather than loop
    if (sessionStorage.getItem(TRIED_KEY) === target.version) return;
    sessionStorage.setItem(TRIED_KEY, target.version);
  } catch {
    // private mode: no loop guard, but the switch below only reloads once a new worker has taken over
  }
  toast.dismiss("new-version");
  setForced({ state: "updating" });
  if (!(await switchToNewest())) setForced({ state: "failed" });
}

/** "Try again" on the failed screen. */
export async function retryForcedUpdate() {
  setForced({ state: "updating" });
  if (!(await switchToNewest())) setForced({ state: "failed" });
}

/** "Not now" on the failed screen: keep using this copy. Opening the app again tries once more. */
export function skipForcedUpdate() {
  behind = null;
  setForced({ state: "idle" });
}

/** Waits for the new version to finish downloading, then reloads into it. False when it couldn't. */
async function switchToNewest(timeout = 60 * 1000): Promise<boolean> {
  const reg = registration ?? (await navigator.serviceWorker?.getRegistration().catch(() => undefined));
  if (!reg) {
    // no service worker (an old browser): a plain reload already loads the newest version
    reloadOnce();
    return true;
  }
  const waiting = reg.waiting ?? (await nextInstalled(reg, timeout));
  if (!waiting) return false;
  navigator.serviceWorker.addEventListener("controllerchange", reloadOnce, { once: true });
  waiting.postMessage({ type: "SKIP_WAITING" });
  // Chrome can leave the new worker waiting after skipWaiting while this page still holds the old one (seen when it
  // had been waiting a while); reloading lets go of the old one, and the reloaded page is the new version.
  setTimeout(reloadOnce, 5000);
  return true;
}

function nextInstalled(reg: ServiceWorkerRegistration, timeout: number): Promise<ServiceWorker | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (sw: ServiceWorker | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sw);
    };
    const timer = setTimeout(() => done(reg.waiting), timeout);
    const watch = (sw: ServiceWorker | null) => sw?.addEventListener("statechange", () => {
      if (sw.state === "installed") done(sw);
      else if (sw.state === "redundant") done(null);
    });
    watch(reg.installing);
    reg.addEventListener("updatefound", () => watch(reg.installing));
    if (!reg.installing) void reg.update().catch(() => done(null));
  });
}

export function useForcedUpdate(): ForcedUpdate {
  return useSyncExternalStore(subscribe, () => forced);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function installState(): InstallState {
  if (installed) return "installed";
  if (deferred) return "prompt";
  return isIOS() ? "ios" : "manual";
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, installState);
}

/** Shows the browser's install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}

/** iPhones get no install banner from the browser, so say once where installing lives. */
export function useIosInstallHint(onHow: () => void) {
  useEffect(() => {
    if (installState() !== "ios") return;
    const key = "unmoney.installHintShown";
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, "1");
      } catch {
        // private mode: the hint may show again next time
      }
      toast("Install UnMoney on your Home Screen", {
        description: "Tap Share, then Add to Home Screen, and it opens full screen and works offline.",
        duration: 12000,
        action: { label: "How", onClick: onHow },
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [onHow]);
}
