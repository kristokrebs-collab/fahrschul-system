/// <reference types="vitest/config" />
/**
 * Multi-file (web) builds of the journal – Netlify serves both:
 *   npm run build         → dist/          personal edition at `/`        (`__TJ_EDITION__` "personal")
 *   npm run build:share   → dist/teilen/   share edition at `/teilen/`    (`vite build --mode share`, privacy guard)
 *   npm run build:e2e-cloud → dist-e2e-cloud/  personal edition against the Supabase mock of the e2e suite (P14)
 * Run `build` BEFORE `build:share` (the personal build empties dist/). Dev / vitest use the personal edition;
 * `vite --mode share` serves the share edition at http://localhost:5173/teilen/.
 * The single-file builds live in `vite.single.config.ts`.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { privacyGuard } from "./scripts/privacyGuard.ts";

/**
 * Copies the repo's legacy static dashboard into the out dir (`dist/` on Netlify) so the site keeps serving
 * /dashboard.html. Follows `--outDir` (the e2e cloud build writes `dist-e2e-cloud/`).
 */
function keepLegacyDashboard(): Plugin {
  let outDir = fileURLToPath(new URL("./dist", import.meta.url));
  return {
    name: "keep-legacy-dashboard",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const src = fileURLToPath(new URL("../dashboard.html", import.meta.url));
      if (existsSync(src) && existsSync(outDir)) copyFileSync(src, join(outDir, "dashboard.html"));
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
      // the first load is ONE app chunk by design (see `codeSplitting` below); its size is governed by the gzip budgets
      // of `npm run budget` (scripts/bundleBudget.mjs), not by Vite's raw-size hint
      chunkSizeWarningLimit: 1800,
      rollupOptions: {
        output: {
          // Chunks (P14): the vendor libraries keep their own chunks (lightweight-charts is reached through lazy
          // imports only, recharts is a parallel-loaded vendor chunk, Plan 9.4); everything else the first paint needs
          // – the `$initial` dependency chain of the entry – goes into ONE `app` chunk. Without that group Rolldown
          // splits every module the entry shares with a lazy page (P02–P13 views, hosts) into its own common chunk:
          // ~80 first-load requests and ~30 KiB more gzip (each file compresses alone). The feature pages and the
          // hosts stay lazy chunks of their own (`src/app/pages.ts`, `src/app/DeferredHosts.tsx`).
          codeSplitting: {
            groups: [
              { name: "lwc", test: /node_modules[\\/](lightweight-charts|fancy-canvas)[\\/]/, priority: 30 },
              { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
              { name: "motion", test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/, priority: 30 },
              {
                name: "recharts",
                test: /node_modules[\\/](recharts|victory-vendor|d3-[a-z-]+|internmap|decimal\.js-light|@reduxjs|immer|reselect|react-redux|redux|eventemitter3|es-toolkit|tiny-invariant)[\\/]/,
                priority: 30,
              },
              { name: "app", tags: ["$initial"], priority: 10 },
            ],
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
