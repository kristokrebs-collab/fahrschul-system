/**
 * Single-file builds of the journal: ONE self-contained HTML file per edition, opened straight from disk (file://).
 *
 *   npx vite build --config vite.single.config.ts --mode personal   → dist-single/personal/index.html  ("persönlich")
 *   npx vite build --config vite.single.config.ts --mode share      → dist-single/share/index.html     ("zum Teilen")
 *   npm run build:single   (scripts/build-single.mjs: both editions → release/trade-journal-{persoenlich,teilen}.html)
 *
 * How everything ends up in one file without extra dependencies:
 * - `codeSplitting: false` (rolldown) inlines the lazy imports (MiniTradeChart, NothingCandleChart, lightweight-charts)
 *   into the entry chunk; `cssCodeSplit: false` gives one stylesheet; no image/font assets are imported by the app.
 * - `singleFile()` replaces the entry <script src> / <link rel=stylesheet> with inline <script type="module"> / <style>
 *   in `generateBundle` with hook order "post" (after vite:build-import-analysis has resolved `__VITE_PRELOAD__`).
 * - The Google-Fonts <link> is replaced by the vendored latin woff2 subsets in single/fonts as data: URIs (offline,
 *   no third-party request from a shared file).
 * - The share edition runs the privacy guard (scripts/privacyGuard.ts): a personal string in the bundle fails the build.
 * `__TJ_TARGET__` is "file" here ("web" in vite.config.ts), see src/edition.ts.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { privacyGuard } from "./scripts/privacyGuard.ts";

type FileEdition = "personal" | "share";
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const TITLES: Record<FileEdition, string> = {
  personal: "BTC Trade Journal",
  share: "BTC Trade Journal",
};

/** An inline <script> ends at the first `</script`; `<!--` can switch the tokenizer into the escaped state. */
const scriptSafe = (js: string) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const styleSafe = (css: string) => css.replace(/<\/style/gi, "<\\/style");

/**
 * Shown only where the file is opened WITHOUT JavaScript (iOS/Android file previews, mail-client viewers): the
 * `js` class is set by a one-line classic script before first paint, so normal browsers never see it.
 */
const NO_JS_HINT =
  '<script>document.documentElement.classList.add("js")</script>' +
  "<style>.js .tj-nojs{display:none}.tj-nojs{font:15px/1.5 system-ui,sans-serif;color:#d6d6d6;max-width:34em;margin:18vh auto;padding:0 20px}</style>";
const NO_JS_BODY =
  '<div class="tj-nojs"><b>BTC Trade Journal</b><br>Diese Datei ist eine App. Die Vorschau zeigt sie nicht an: ' +
  "öffne sie in Chrome, Safari oder Samsung Internet (Datei antippen → Öffnen mit …).</div>";

/** Vendored fonts (single/fonts/fonts.css + woff2) as one inline <style> with data: URIs. */
function fontStyle(): string {
  const css = readFileSync(here("./single/fonts/fonts.css"), "utf8").replace(/url\(\.\/([^)]+)\)/g, (_m, file: string) => {
    const b64 = readFileSync(here(`./single/fonts/${file}`)).toString("base64");
    return `url(data:font/woff2;base64,${b64})`;
  });
  return `<style>/* IBM Plex Mono/Sans, Doto: SIL Open Font License 1.1 */${css.replace(/\s*\n\s*/g, "")}</style>`;
}

function singleFile(edition: FileEdition): Plugin {
  return {
    name: "tj-single-file",
    apply: "build",
    enforce: "post",
    generateBundle: {
      // must run after Vite's own generateBundle hooks (vite:build-import-analysis rewrites the preload markers there)
      order: "post",
      handler(_opts, bundle) {
        const page = bundle["index.html"];
        if (!page || page.type !== "asset") return this.error("index.html missing from the bundle");
        let html = String(page.source);
        for (const [name, file] of Object.entries(bundle)) {
          if (name === "index.html") continue;
          const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (file.type === "chunk") {
            const tag = new RegExp(`<script type="module" crossorigin src="[^"]*${esc}"></script>`);
            if (!tag.test(html)) return this.error(`chunk ${name} is not the entry – a lazy import was not inlined`);
            html = html.replace(tag, () => `<script type="module">${scriptSafe(file.code)}</script>`);
          } else if (name.endsWith(".css")) {
            const tag = new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${esc}">`);
            if (!tag.test(html)) return this.error(`stylesheet ${name} not referenced by index.html`);
            html = html.replace(tag, () => `<style>${styleSafe(String(file.source))}</style>`);
          } else {
            return this.error(`unexpected asset ${name} – it would be missing next to the single file`);
          }
          delete bundle[name];
        }
        html = html
          .replace(/\s*<link rel="modulepreload"[^>]*>/g, "")
          .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.g[^>]*>/g, "")
          .replace(/<link\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/, () => fontStyle())
          .replace(/<title>[^<]*<\/title>/, `<title>${TITLES[edition]}</title>`)
          .replace("</title>", () => `</title>\n    ${NO_JS_HINT}`)
          .replace('<div id="root"></div>', () => `<div id="root">${NO_JS_BODY}</div>`)
          .replace(
            /(<meta charset="UTF-8" \/>)/,
            (m) => `${m}\n    <meta name="tj-edition" content="${edition}" />\n    <!--\n${readFileSync(here("./public/NOTICE-lightweight-charts.txt"), "utf8").replace(/--/g, "- -")}\n    -->`,
          );
        if (html.includes("__VITE_PRELOAD__")) return this.error("unresolved __VITE_PRELOAD__ marker");
        if (/<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(html)) return this.error("external script/stylesheet left in the file");
        page.source = html;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode !== "personal" && mode !== "share") throw new Error(`--mode personal|share expected, got "${mode}"`);
  const edition: FileEdition = mode;
  return {
    base: "./",
    publicDir: false, // public/ only holds the NOTICE, which travels inside the file
    plugins: [react(), tailwindcss(), singleFile(edition), ...(edition === "share" ? [privacyGuard()] : [])],
    resolve: { alias: { "@": here("./src") } },
    define: { __TJ_EDITION__: JSON.stringify(edition), __TJ_TARGET__: JSON.stringify("file") },
    build: {
      outDir: `dist-single/${edition}`,
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: () => true,
      modulePreload: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 4096,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  };
});
