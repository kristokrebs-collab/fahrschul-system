/// <reference types="vitest/config" />
/**
 * Multi-file (web) builds of the journal – Netlify serves both:
 *   npm run build         → dist/          personal edition at `/`        (`__TJ_EDITION__` "personal")
 *   npm run build:share   → dist/teilen/   share edition at `/teilen/`    (`vite build --mode share`, privacy guard)
 *   npm run build:e2e-cloud → dist-e2e-cloud/  personal edition against the Supabase mock of the e2e suite (P14)
 *   npm run build:showroom  → dist-showroom/   Showroom (Paket S): personal edition + `VITE_SHOWROOM=1` – the in-app mock backend, the demo
 *                                              banner and the "Neu in dieser Version" panel; Netlify builds it for deploy previews only
 * Run `build` BEFORE `build:share` (the personal build empties dist/). Dev / vitest use the personal edition;
 * `vite --mode share` serves the share edition at http://localhost:5173/teilen/.
 * The single-file builds live in `vite.single.config.ts`.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { privacyGuard } from "./scripts/privacyGuard.ts";
import { secretGuard } from "./scripts/secretGuard.ts";
import { OCR_URL_ROOT, OCR_VERSION, ocrSources } from "./src/journal/ocr/assets.ts";

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

/**
 * Self-hosted files of the local screenshot reader (OCR): tesseract.js's worker script, the WebAssembly cores and the
 * language data, copied from the pinned packages to `<outDir>/ocr/<version>/` (the list is `src/journal/ocr/assets.ts`;
 * the version in the path makes `Cache-Control: immutable` safe) and served at the same URL by `vite dev`. They are NOT
 * part of any bundle and nothing precaches them: the browser fetches them the first time a screenshot is read.
 * The share edition does not carry a copy – it reads the personal build's `/ocr/` (same site).
 */
function ocrAssets(share: boolean): Plugin {
  const nm = fileURLToPath(new URL("./node_modules", import.meta.url));
  const prefix = `${OCR_URL_ROOT}${OCR_VERSION}/`;
  let outDir = fileURLToPath(new URL("./dist", import.meta.url));
  let command: "build" | "serve" = "build";
  return {
    name: "tj-ocr-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      command = config.command;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        const src = ocrSources().find((s) => `${prefix}${s.to}` === url);
        const file = src ? join(nm, src.from) : "";
        if (!src || !existsSync(file)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.setHeader("Content-Type", src.to.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (share || command !== "build" || !existsSync(outDir)) return;
      for (const s of ocrSources()) {
        const from = join(nm, s.from);
        const to = join(outDir, prefix.replace(/^\//, ""), s.to);
        if (!existsSync(from)) throw new Error(`OCR-Datei fehlt: ${s.from} (npm ci ausführen)`);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
    },
  };
}

/**
 * Offline-tolerant lazy components (Budget-Schnitt follow-up): every `lazy(() => import("…"))` of `src/` gets its `import()`
 * wrapped in `loadChunk` (`src/lib/chunkLoad.ts`) – offline the download waits for `online` (the card stays on its skeleton)
 * instead of failing into the console, and a failed one is tried once more. Only the literal `lazy(() => import("x"))`
 * shape is rewritten (type positions like `typeof import("x")` and imperative imports stay as they are); the wrapped call
 * keeps the `import()` expression, so chunking, preloading and `vi.mock` behave as before.
 */
function offlineTolerantLazy(): Plugin {
  const srcRoot = fileURLToPath(new URL("./src/", import.meta.url));
  return {
    name: "tj-offline-tolerant-lazy",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!file.startsWith(srcRoot) || !/\.[cm]?[jt]sx?$/.test(file) || file.endsWith("/lib/chunkLoad.ts")) return null;
      if (!code.includes("lazy(")) return null;
      let hits = 0;
      const out = code.replace(/(\blazy\(\s*\(\)\s*=>\s*)import\((["'][^"'\n]+["'])\)/g, (_m, head: string, spec: string) => {
        hits += 1;
        return `${head}__tjChunk(() => import(${spec}))`;
      });
      if (!hits) return null;
      return { code: `import { loadChunk as __tjChunk } from "@/lib/chunkLoad";\n${out}`, map: null };
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
  // Showroom (Paket S): `VITE_SHOWROOM=1` (npm run build:showroom, Netlify deploy-preview only). Never in the share edition; a compile-time
  // constant, so without the flag every `if (SHOWROOM)` branch – and the lazy chunks behind it – disappears from the bundle.
  const showroom = !share && process.env.VITE_SHOWROOM === "1";
  return {
    base: share ? SHARE_BASE : "/",
    plugins: [offlineTolerantLazy(), react(), tailwindcss(), secretGuard(), ocrAssets(share), ...(share ? [privacyGuard(), shareAppName()] : [keepLegacyDashboard()])],
    define: {
      __TJ_EDITION__: JSON.stringify(share ? "share" : "personal"),
      __TJ_TARGET__: JSON.stringify("web"),
      __TJ_SHOWROOM__: JSON.stringify(showroom),
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
      // ~8,000 tests share a 2-core CI runner: single render-heavy tests (the whole Aktien page, the position calculator with its
      // lazy cards) take 5–7 s there, vitest's 5 s default made them fail without any defect. A hung test still fails after 20 s.
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
