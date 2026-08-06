import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
      workbox: {
        // App-shell caching only - every screen still needs the network for
        // auth/capture/extract, so there's no offline data path to cache.
        globPatterns: ["**/*.{js,css,html}"],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
