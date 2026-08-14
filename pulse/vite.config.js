import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest (a custom src/sw.js, precompiled by vite-plugin-pwa)
      // instead of generateSW - needed so the service worker can also handle
      // push/notificationclick events, not just precaching. Mirrors
      // mobile/vite.config.js exactly.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "autoUpdate",
      manifest: {
        name: "LedgerlyPulse",
        short_name: "LedgerlyPulse",
        description: "Track your personal income, spending, and budgets with Ledgerly.",
        theme_color: "#09090b",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        // App-shell caching only - every screen still needs the network for
        // auth/data, so there's no offline data path to cache.
        globPatterns: ["**/*.{js,css,html}"],
      },
      // Registers the service worker under `vite dev` too (off by default) -
      // without this, navigator.serviceWorker.ready never resolves locally.
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    host: true,
    port: 5174,
  },
});
