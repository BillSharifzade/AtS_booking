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
});
