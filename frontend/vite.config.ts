import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// APP_BASE lets the same app be served at the domain root (dev / LAN :5173, base "/")
// or under a subpath in production (e.g. "/ats_admin/" behind the shared Caddy edge).
// The router reads this via import.meta.env.BASE_URL, and asset URLs are prefixed.
const base = process.env.APP_BASE || "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: { usePolling: true },
  },
  // Serving the production build via `vite preview` behind the domain requires
  // allowing that host (same reason as the mini app).
  preview: {
    allowedHosts: true,
  },
});
