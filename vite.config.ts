import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // src/lib/pwa.ts registers the worker and asks before reloading into a new version
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icon.svg", "favicon.ico", "apple-touch-icon-180x180.png"],
      manifest: {
        id: "/",
        name: "unmoney",
        short_name: "unmoney",
        description: "Track income, expenses and transfers across every account.",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        categories: ["finance", "productivity"],
        // icons in public/ come from `npm run icons` (pwa-assets.config.ts)
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Add transaction", short_name: "Add", url: "/t/new", icons: [{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" }] },
          { name: "Stats", url: "/stats", icons: [{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" }] },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // receipt photos: keep what was seen so they still show offline
            urlPattern: ({ url }) => /\.convex\.cloud$/.test(url.hostname) && url.pathname.startsWith("/api/storage/"),
            handler: "CacheFirst",
            options: { cacheName: "photos", expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
