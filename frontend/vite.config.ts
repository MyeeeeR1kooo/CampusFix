import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Same-origin API (#48, P0 Baseline §8.2).
 *
 * The deployed shape is one web container that serves the built SPA and reverse-proxies
 * `/api` to FastAPI, so the browser never needs an absolute API URL and the session cookie
 * is first-party. Dev reproduces that: the proxy below is the only thing that knows where
 * the backend is.
 *
 * Default target is the web container's published port, because that is what a fresh
 * `docker compose up` exposes — the API service itself stays on the internal network.
 * Point `VITE_API_TARGET` at a host-run FastAPI (usually :8000) when developing without
 * the containers.
 *
 * Origin is the one thing dev cannot reproduce for free: writes carry the browser's own
 * Origin (`http://localhost:5173` here), while the stack defaults ALLOWED_ORIGINS to the
 * web container's origin. Running the API on the host therefore needs that extra origin,
 * or every write answers 403 ORIGIN_NOT_ALLOWED. That is #45's setting, not something the
 * frontend may work around by hand — see frontend/CONVENTIONS.md §5.
 */
const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  // `npm run preview` serves the production bundle through the same proxy, so the built
  // artefact can be exercised against the real API before shipping.
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    globals: true,
  },
});
