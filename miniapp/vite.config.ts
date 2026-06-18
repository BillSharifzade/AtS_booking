import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes all asset URLs relative, so the built mini app can be hosted under
// ANY subpath (e.g. https://dchr.koinotinav.com/booking/) without a rebuild.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    watch: { usePolling: true },
    allowedHosts: true,
  },
  // Production: the build is served by `vite preview` behind the recruitment
  // Caddy under /ats/. allowedHosts:true lets the proxied dchr.koinotinav.com
  // host pass (vite 5.4+ blocks unknown hosts otherwise).
  preview: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    allowedHosts: true,
  },
});
