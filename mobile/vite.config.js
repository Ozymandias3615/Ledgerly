import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest (a custom src/sw.js, precompiled by vite-plugin-pwa)
      // instead of the default generateSW - needed so the service worker can
      // also handle push/notificationclick events, not just precaching.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "autoUpdate",
      manifest: {
        name: "LedgerlyGo",
        short_name: "LedgerlyGo",
        description: "Capture receipts, manage inventory, and handle invoices on the go with Ledgerly.",
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
        // auth/capture/extract, so there's no offline data path to cache.
        globPatterns: ["**/*.{js,css,html}"],
      },
      // Registers the service worker under `vite dev` too (off by default) -
      // without this, navigator.serviceWorker.ready never resolves locally,
      // since nothing ever registers a worker to become ready.
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
