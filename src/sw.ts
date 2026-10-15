/// <reference lib="webworker" />
/**
 * The service worker: precaches the app so it opens offline, keeps receipt photos, and receives
 * files shared to UnMoney from other apps (Android share target, see vite.config.ts).
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { SHARE_ACTION, SHARE_CACHE, SHARE_KEY } from "./lib/share";

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// The share target posts here. Handled before Workbox's routes, which only see GET requests.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== SHARE_ACTION) return;
  event.respondWith((async () => {
    let ok = false;
    try {
      const form = await event.request.formData();
      const file = [...form.values()].find((v): v is File => typeof v !== "string" && v.size > 0);
      if (file) {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put(SHARE_KEY, new Response(file, {
          headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || "shared file") },
        }));
        ok = true;
      }
    } catch {
      // fall through: the import page says nothing arrived
    }
    return Response.redirect(ok ? "/import?source=share" : "/import?source=share&empty=1", 303);
  })());
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api/, /\.shortcut$/] }));
// receipt photos: keep what was seen so they still show offline
registerRoute(
  ({ url }) => /\.convex\.cloud$/.test(url.hostname) && url.pathname.startsWith("/api/storage/"),
  new CacheFirst({ cacheName: "photos", plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 })] }),
);

// src/lib/pwa.ts asks before switching to a new version; it sends this when the user says yes.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") void self.skipWaiting();
});
