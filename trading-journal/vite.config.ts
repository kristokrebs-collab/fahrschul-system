/// <reference types="vitest/config" />
/**
 * Multi-file (web) builds of the journal – Netlify serves both:
 *   npm run build         → dist/          personal edition at `/`        (`__TJ_EDITION__` "personal")
 *   npm run build:share   → dist/teilen/   share edition at `/teilen/`    (`vite build --mode share`, privacy guard)
 * Run `build` BEFORE `build:share` (the personal build empties dist/). Dev / vitest use the personal edition;
 * `vite --mode share` serves the share edition at http://localhost:5173/teilen/.
 * The single-file builds live in `vite.single.config.ts`.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { privacyGuard } from "./scripts/privacyGuard.ts";

/** Copies the repo's legacy static dashboard into dist so the Netlify site keeps serving /dashboard.html. */
function keepLegacyDashboard() {
  return {
    name: "keep-legacy-dashboard",
    closeBundle() {
      const src = fileURLToPath(new URL("../dashboard.html", import.meta.url));
      if (existsSync(src)) copyFileSync(src, fileURLToPath(new URL("./dist/dashboard.html", import.meta.url)));
    },
  };
}

/** Base path of the share edition on the Netlify site (see netlify.toml `/teilen/*`). */
export const SHARE_BASE = "/teilen/";

/** App names of the share edition, so an installed share app is told apart from the personal "BTC Trade Journal". */
export const SHARE_APP_NAME = "Trade Journal (Teilen)";
export const SHARE_SHORT_NAME = "Journal (Teilen)";

/**
 * Share edition: the copied `public/manifest.webmanifest` gets its own `name` / `short_name`, and the page's
 * `apple-mobile-web-app-title` / `application-name` follow (the ids already differ: `/` vs `/teilen/`).
 */
function shareAppName(): Plugin {
  return {
    name: "tj-share-app-name",
    apply: "build",
    transformIndexHtml: (html) => html.replace(/(<meta name="(?:apple-mobile-web-app-title|application-name)" content=")[^"]*(")/g, `$1${SHARE_SHORT_NAME}$2`),
    closeBundle() {
      // public/ is copied into the out dir before the bundle is written, so the manifest is there by now
      const file = fileURLToPath(new URL("./dist/teilen/manifest.webmanifest", import.meta.url));
      if (!existsSync(file)) return;
      const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      writeFileSync(file, `${JSON.stringify({ ...manifest, name: SHARE_APP_NAME, short_name: SHARE_SHORT_NAME }, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const share = mode === "share";
  return {
    base: share ? SHARE_BASE : "/",
    plugins: [react(), tailwindcss(), ...(share ? [privacyGuard(), shareAppName()] : [keepLegacyDashboard()])],
    define: {
      __TJ_EDITION__: JSON.stringify(share ? "share" : "personal"),
      __TJ_TARGET__: JSON.stringify("web"),
    },
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: {
      outDir: share ? "dist/teilen" : "dist",
      target: "es2022",
      sourcemap: false,
      rollupOptions: {
        output: {
          // Chart libraries in their own chunks: lightweight-charts is only reached through lazy imports,
          // recharts is a parallel-loaded vendor chunk so the main chunk stays small (Plan 9.4).
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/node_modules\/(lightweight-charts|fancy-canvas)\//.test(id)) return "lwc";
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
            if (/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return "motion";
            if (/node_modules\/(recharts|victory-vendor|d3-[a-z-]+|internmap|decimal\.js-light|@reduxjs|immer|reselect|react-redux|redux|eventemitter3|es-toolkit|tiny-invariant)\//.test(id)) return "recharts";
            return undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "src/**/*.test.ts"],
      setupFiles: ["tests/setup.ts"],
    },
  };
});
