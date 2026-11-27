/**
 * Runde 13 (Funktionsprüfung): the self-hosted fonts are preloaded from `index.html` (`scripts/fontPreload.ts`). Without it a browser
 * fetches a font only after the first-load script rendered text that uses it – 4 s after the first paint on a phone profile.
 */
import { describe, expect, it } from "vitest";
import { fontPreload, fontPreloadTags, PRELOAD_FACES } from "../../scripts/fontPreload";

const BUNDLE = [
  "assets/index-DHrX6VWl.js",
  "assets/index-D03b041n.css",
  "assets/Doto-wght-CQXw7rFU.woff2",
  "assets/IBMPlexSans-wght-DUFm7O0P.woff2",
  "assets/IBMPlexMono-600-B-bvjugR.woff2",
  "assets/IBMPlexMono-500-CnYqRl-E.woff2",
  "assets/IBMPlexMono-400-DKvbA5cB.woff2",
  "assets/IBMPlexSerif-400-AAAAAAAA.woff2",
  "index.html",
];

describe("fontPreloadTags", () => {
  it("preloads the body sans and the three mono weights, in that order – not the dot-matrix face, no other file", () => {
    const tags = fontPreloadTags(BUNDLE, "/");
    expect(tags.map((t) => t.attrs?.href)).toEqual([
      "/assets/IBMPlexSans-wght-DUFm7O0P.woff2",
      "/assets/IBMPlexMono-400-DKvbA5cB.woff2",
      "/assets/IBMPlexMono-500-CnYqRl-E.woff2",
      "/assets/IBMPlexMono-600-B-bvjugR.woff2",
    ]);
    expect(PRELOAD_FACES).not.toContain("Doto-wght");
  });

  it("a font preload needs `as=font`, the type and `crossorigin` (fonts are fetched in CORS mode even from the same origin), and goes into the head", () => {
    for (const t of fontPreloadTags(BUNDLE, "/")) {
      expect(t.tag).toBe("link");
      expect(t.attrs).toMatchObject({ rel: "preload", as: "font", type: "font/woff2", crossorigin: true });
      expect(t.injectTo).toBe("head");
    }
  });

  it("follows the build's base: the share edition lives under /teilen/", () => {
    expect(fontPreloadTags(BUNDLE, "/teilen/").map((t) => t.attrs?.href)).toContain("/teilen/assets/IBMPlexSans-wght-DUFm7O0P.woff2");
    expect(fontPreloadTags(BUNDLE, "/teilen").map((t) => t.attrs?.href)).toContain("/teilen/assets/IBMPlexSans-wght-DUFm7O0P.woff2");
  });

  it("a build without those files (or an inlined-font build) adds nothing", () => {
    expect(fontPreloadTags(["assets/index-A.js", "index.html"], "/")).toEqual([]);
    expect(fontPreloadTags([], "/")).toEqual([]);
  });
});

describe("fontPreload plugin", () => {
  it("is a build-only post transform that reads the emitted bundle", () => {
    const plugin = fontPreload();
    expect(plugin.apply).toBe("build");
    const hook = plugin.transformIndexHtml as { order: string; handler: (html: string, ctx: { bundle?: Record<string, unknown> }) => unknown };
    expect(hook.order).toBe("post");
    (plugin.configResolved as (c: { base: string }) => void)({ base: "/teilen/" });
    const out = hook.handler("<html></html>", { bundle: Object.fromEntries(BUNDLE.map((f) => [f, {}])) }) as { attrs: { href: string } }[];
    expect(out).toHaveLength(4);
    expect(out[0]?.attrs.href).toBe("/teilen/assets/IBMPlexSans-wght-DUFm7O0P.woff2");
    expect(hook.handler("<html></html>", {})).toEqual([]);
  });
});
