/**
 * Font preload (Vite plugin, used by `vite.config.ts`; Runde 13, Funktionsprüfung).
 *
 * The app is rendered by JavaScript and its fonts are self-hosted woff2 files named in the stylesheet (`src/styles/fonts.css`,
 * `font-display: swap`). A browser only fetches a font once text that uses it is on the page – for this app that is AFTER the
 * first-load script ran. Measured on a phone profile (4× CPU, Slow 4G) the Plex Sans file started 0,3 s after the first paint and the
 * Plex Mono files 3,8 s after it (they arrived at ≈ 7 s): every label and number sat in the fallback font for seconds and then jumped.
 * `<link rel="preload" as="font">` starts the download with the page, next to the script (80 KB next to ≈ 660 KB), so the swap is
 * over a moment after the first paint – measured: Sans / Mono 400 / 500 in hand at ≈ 1,3–2,4 s instead of 2,7–7,3 s.
 *
 * Only the faces EVERY page's first view uses are preloaded (body sans + the three mono weights of labels and numbers): a preload the
 * page does not use within a few seconds is a console warning. The dot-matrix face (Doto, hero numerals of the start page only, 5 KB)
 * is left to the stylesheet. The tags come from the emitted bundle (hashed file names), with the build's `base` (`/` or `/teilen/`).
 */
import type { HtmlTagDescriptor, Plugin } from "vite";

/** The faces every first view needs (file name before the content hash). */
export const PRELOAD_FACES = ["IBMPlexSans-wght", "IBMPlexMono-400", "IBMPlexMono-500", "IBMPlexMono-600"] as const;

/** `<link rel="preload" as="font" …>` tags for the emitted font files of `PRELOAD_FACES` (sorted, so the HTML is stable). */
export function fontPreloadTags(emitted: readonly string[], base: string): HtmlTagDescriptor[] {
  const root = base.endsWith("/") ? base : `${base}/`;
  const files = PRELOAD_FACES.flatMap((face) => emitted.filter((f) => new RegExp(`^assets/${face}-[A-Za-z0-9_-]+\\.woff2$`).test(f)).sort());
  return files.map((f) => ({
    tag: "link",
    attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: true, href: `${root}${f}` },
    injectTo: "head" as const,
  }));
}

export function fontPreload(): Plugin {
  let base = "/";
  return {
    name: "tj-font-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        return fontPreloadTags(Object.keys(ctx.bundle ?? {}), base);
      },
    },
  };
}
