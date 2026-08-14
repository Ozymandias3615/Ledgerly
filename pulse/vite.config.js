import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // generateSW (not mobile/'s custom injectManifest) - Pulse has no push
      // notifications yet, so there's no custom service worker to write, just
      // app-shell precaching for installability.
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
    }),
  ],
  server: {
    host: true,
    port: 5174,
  },
});
