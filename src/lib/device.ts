/**
 * What the app is running on, as the superadmin dashboard (src/lib/usage.ts) and PostHog
 * (src/lib/analytics.ts) both report it, so the two split devices the same way.
 */

/** Running as the home-screen app rather than in a browser tab. */
export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type FormFactor = "phone" | "tablet" | "desktop";

export function describeDevice(ua: string, maxTouchPoints: number): { os: string; browser: string; formFactor: FormFactor } {
  // iPadOS asks for desktop sites, so it reads as a Mac with a touch screen
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const os = iPad || /iPhone|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /OPR\//.test(ua) ? "Opera" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Other";
  const formFactor: FormFactor = iPad || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet" : /Mobi|iPhone/.test(ua) ? "phone" : "desktop";
  return { os, browser, formFactor };
}

export function device() {
  return { ...describeDevice(navigator.userAgent, navigator.maxTouchPoints), standalone: isStandalone() };
}
