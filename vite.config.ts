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
      // our own worker (src/sw.ts), so it can receive files shared from other apps
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"] },
      includeAssets: ["icon.svg", "favicon.ico", "apple-touch-icon-180x180.png"],
      manifest: {
        id: "/",
        name: "UnMoney",
        short_name: "UnMoney",
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
        // Android: UnMoney shows up in the share menu for spreadsheets, so Money Manager's
        // "Export to Excel" can hand its file straight over. src/sw.ts receives the POST.
        share_target: {
          action: "/import/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            files: [{
              name: "file",
              accept: [
                ".xlsx", ".xls", ".csv", ".tsv",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
                "text/csv",
                "text/tab-separated-values",
                "application/octet-stream",
              ],
            }],
          },
        },
        shortcuts: [
          { name: "Add transaction", short_name: "Add", url: "/t/new", icons: [{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" }] },
          { name: "Stats", url: "/stats", icons: [{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" }] },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rollupOptions: {
      output: {
        // React and Convex only change when they are upgraded: in chunks of their own they stay in the
        // service worker's cache across deploys, so an update downloads the app's code and little else.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return "react";
          if (/[\\/]node_modules[\\/](convex|@convex-dev|@auth)[\\/]/.test(id)) return "convex";
        },
      },
    },
  },
});
