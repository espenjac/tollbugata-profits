import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/tollbugata-profits/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icons/favicon-32.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-maskable-512.png",
      ],
      manifest: {
        id: "/tollbugata-profits/",
        name: "Tollbugata Profits",
        short_name: "Tollbugata",
        description:
          "Oppdatert handelsrapport for Oslo Børs med manuell handelsplan og handelsdagbok.",
        lang: "nb",
        dir: "ltr",
        start_url: "/tollbugata-profits/",
        scope: "/tollbugata-profits/",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "portrait-primary",
        background_color: "#080d19",
        theme_color: "#080d19",
        categories: ["finance", "productivity"],
        icons: [
          {
            src: "/tollbugata-profits/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/tollbugata-profits/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/tollbugata-profits/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        importScripts: ["push-sw.js"],
        navigateFallback: "/tollbugata-profits/index.html",
        navigateFallbackDenylist: [/^\/tollbugata-profits\/auth/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern:
              /^https:\/\/[^/]+\.supabase\.co\/(?:functions|rest|auth)\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
