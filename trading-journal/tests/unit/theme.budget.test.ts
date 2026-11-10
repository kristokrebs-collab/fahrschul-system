/**
 * Bundle budget script (P13, `scripts/bundleBudget.mjs`): the first-load set from `index.html`, chunk names, the
 * budget check (totals, named chunks, the generic per-chunk cap, P13 overlays never in the first load).
 */
import { describe, expect, it } from "vitest";
import { checkBudgets, chunkName, initialAssets, kib } from "../../scripts/bundleBudget.mjs";

const B = { initialJs: 100, initialCss: 10, chunk: 50, named: { index: 80, react: 30 } };
const K = 1024;

describe("bundle budget", () => {
  it("reads the first load from index.html: module entry, modulepreloads, local stylesheets", () => {
    const html = `<!doctype html><head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <script type="module" crossorigin src="/assets/index-AbCd1234.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/react-Zz99Yy88.js">
      <link rel="stylesheet" crossorigin href="/assets/index-Qq11Ww22.css">
    </head>`;
    expect(initialAssets(html)).toEqual({ js: ["/assets/index-AbCd1234.js", "/assets/react-Zz99Yy88.js"], css: ["/assets/index-Qq11Ww22.css"] });
  });

  it("chunk names drop the hash", () => {
    expect(chunkName("assets/motion-64tg9sMq.js")).toBe("motion");
    expect(chunkName("assets/GlobalSearch-a_B-c9Xy.js")).toBe("GlobalSearch");
    expect(chunkName("assets/index-Bb-z56q7.css")).toBe("index");
    expect(kib(1536)).toBe(1.5);
  });

  it("passes within budget, names every breach in German", () => {
    const ok = [
      { file: "assets/index-AbCd1234.js", gzip: 60 * K, initial: true },
      { file: "assets/react-Zz99Yy88.js", gzip: 25 * K, initial: true },
      { file: "assets/index-Qq11Ww22.css", gzip: 8 * K, initial: true },
      { file: "assets/client-Xx11Yy22.js", gzip: 40 * K, initial: false },
    ];
    expect(checkBudgets(ok, B).breaches).toEqual([]);
    const bad = [
      { file: "assets/index-AbCd1234.js", gzip: 90 * K, initial: true },
      { file: "assets/react-Zz99Yy88.js", gzip: 31 * K, initial: true },
      { file: "assets/index-Qq11Ww22.css", gzip: 12 * K, initial: true },
      { file: "assets/client-Xx11Yy22.js", gzip: 60 * K, initial: false },
      { file: "assets/GlobalSearch-Gg77Hh66.js", gzip: 4 * K, initial: true },
    ];
    const { breaches, initialJs } = checkBudgets(bad, B);
    expect(kib(initialJs)).toBe(125);
    expect(breaches).toEqual([
      "Erstladung JS 125 KiB > Budget 100 KiB",
      "Erstladung CSS 12 KiB > Budget 10 KiB",
      "Chunk index 90 KiB > Budget 80 KiB",
      "Chunk react 31 KiB > Budget 30 KiB",
      "Chunk client-Xx11Yy22.js 60 KiB > Budget 50 KiB je Chunk",
      "GlobalSearch gehört nicht in die Erstladung (lazy laden)",
    ]);
  });
});
