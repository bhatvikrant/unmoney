import { defineConfig } from "@vite-pwa/assets-generator/config";

// `npm run icons` regenerates the app icons in public/ from public/icon.svg.
// The glyph already sits inside the maskable safe zone, so maskable and Apple icons need no
// padding: only the rounded corners are filled with the icon's own background so the OS can
// apply its own mask (iOS would otherwise paint transparent corners black).
export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, "favicon.ico"]] },
    maskable: { sizes: [512], padding: 0, resizeOptions: { background: "#171717" } },
    apple: { sizes: [180], padding: 0, resizeOptions: { background: "#171717" } },
  },
  images: ["public/icon.svg"],
});
