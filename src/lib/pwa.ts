/**
 * Installed-app support: registers the service worker (which precaches the app so it opens with
 * no connection), offers new versions with a toast, and tracks whether the app can be installed.
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

  const reload = registerSW({
    onNeedRefresh() {
      // queued changes live in IndexedDB, so reloading never loses them
      toast("A new version of unmoney is ready", { duration: Infinity, action: { label: "Reload", onClick: () => void reload() } });
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // an installed app can stay open for days: look for a new version hourly and when it comes back to the front
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {});
      };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
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
      toast("Install unmoney on your Home Screen", {
        description: "Tap Share, then Add to Home Screen, and it opens full screen and works offline.",
        duration: 12000,
        action: { label: "How", onClick: onHow },
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [onHow]);
}
