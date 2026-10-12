#!/usr/bin/env node
/**
 * Bundle budget (P13): run after `npm run build`. Measures what a first visit downloads – the entry script, every
 * `modulepreload` chunk and the stylesheets `dist/index.html` references – plus every lazy chunk, gzip-compressed
 * (level 9, what Netlify serves at the least), and fails when a budget is exceeded.
 *
 *   node scripts/bundleBudget.mjs                 table + exit 1 on a breach
 *   node scripts/bundleBudget.mjs --dist dist/teilen
 *   node scripts/bundleBudget.mjs --json          machine-readable report (still exits 1 on a breach)
 *   node scripts/bundleBudget.mjs --report        table only, never fails (e.g. while a package is half-merged)
 *
 * Budgets are in KiB gzip (`BUDGETS` below). They sit ~10 % above the measured build so a real regression trips them,
 * not a dependency patch. The P13 overlays (search, shortcut sheet, tour, cockpit) must never be part of the
 * first load – they are lazy chunks by design; the check reports them as "nicht im Build" until P14 wires them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * KiB gzip. `initial*` = first load, `chunk` = any other single JS file, `named` = the entry (`index`) and the vendor
 * chunks of `vite.config.ts`. Measured 2026-10-12 (P13 branch, personal edition): first load JS 762.6 / CSS 41.2,
 * index 465.5, recharts 103.3, react 63.3, lwc 55.1, motion 52.8, largest lazy chunk 64.1. P14 re-measures after the
 * merge of all packages and moves these numbers once, deliberately.
 */
export const BUDGETS = {
  initialJs: 840,
  initialCss: 46,
  chunk: 120,
  named: { index: 512, react: 70, motion: 58, recharts: 114, lwc: 62 },
};

/** Lazy P13 chunks (file name prefix) that must stay out of the first load. */
export const LAZY_P13 = ["GlobalSearch", "ShortcutSheet", "OnboardingTour", "CockpitView", "WidgetCatalog"];

export const kib = (bytes) => Math.round((bytes / 1024) * 10) / 10;

/** The first-load files of `index.html`: the module entry, its modulepreloads and the stylesheets (paths as written). */
export function initialAssets(html) {
  const js = new Set();
  const css = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)) js.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)) js.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)) if (!/^https?:/.test(m[1])) css.add(m[1]);
  return { js: [...js], css: [...css] };
}

/** `assets/motion-AbC123.js` → `motion` (Rollup's `[name]-[hash]`). */
export function chunkName(file) {
  return basename(file).replace(/\.(m?js|css)$/, "").replace(/-[\w-]{8}$/, "");
}

/**
 * Pure check: `files` = `[{ file, gzip, initial }]` (bytes). Returns the breaches (German, one line each) and the totals.
 */
export function checkBudgets(files, budgets = BUDGETS) {
  const breaches = [];
  const sum = (pred) => files.filter(pred).reduce((n, f) => n + f.gzip, 0);
  const initialJs = sum((f) => f.initial && /\.m?js$/.test(f.file));
  const initialCss = sum((f) => f.initial && f.file.endsWith(".css"));
  if (kib(initialJs) > budgets.initialJs) breaches.push(`Erstladung JS ${kib(initialJs)} KiB > Budget ${budgets.initialJs} KiB`);
  if (kib(initialCss) > budgets.initialCss) breaches.push(`Erstladung CSS ${kib(initialCss)} KiB > Budget ${budgets.initialCss} KiB`);
  for (const f of files) {
    if (!/\.m?js$/.test(f.file)) continue;
    const name = chunkName(f.file);
    const own = budgets.named[name];
    if (own !== undefined && kib(f.gzip) > own) breaches.push(`Chunk ${name} ${kib(f.gzip)} KiB > Budget ${own} KiB`);
    else if (own === undefined && kib(f.gzip) > budgets.chunk) breaches.push(`Chunk ${basename(f.file)} ${kib(f.gzip)} KiB > Budget ${budgets.chunk} KiB je Chunk`);
    if (f.initial && LAZY_P13.some((p) => name.startsWith(p))) breaches.push(`${name} gehört nicht in die Erstladung (lazy laden)`);
  }
  return { breaches, initialJs, initialCss };
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Measures a build directory. */
export function measure(dist) {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const init = initialAssets(html);
  const initial = new Set([...init.js, ...init.css].map((u) => basename(u)));
  const assets = walk(join(dist, "assets")).filter((p) => /\.(m?js|css)$/.test(p));
  return assets.map((p) => {
    const buf = readFileSync(p);
    return { file: p.slice(dist.length + 1), raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, initial: initial.has(basename(p)) };
  });
}

function main(argv) {
  const at = argv.indexOf("--dist");
  const dist = resolve(at >= 0 ? argv[at + 1] : "dist");
  const report = argv.includes("--report");
  let files;
  try {
    files = measure(dist);
  } catch (e) {
    console.error(`Kein Build unter ${dist} (zuerst \`npm run build\`): ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const { breaches, initialJs, initialCss } = checkBudgets(files);
  const present = new Set(files.map((f) => chunkName(f.file)));
  const lazy = LAZY_P13.map((p) => ({ chunk: p, status: [...present].some((n) => n.startsWith(p)) ? "lazy" : "nicht im Build" }));
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ dist, budgets: BUDGETS, initialJs: kib(initialJs), initialCss: kib(initialCss), files: files.map((f) => ({ ...f, gzipKiB: kib(f.gzip) })), lazy, breaches }, null, 2));
  } else {
    const rows = [...files].sort((a, b) => Number(b.initial) - Number(a.initial) || b.gzip - a.gzip);
    console.log(`Bundle-Budget ${dist}`);
    for (const f of rows.slice(0, 24)) console.log(`${f.initial ? "●" : "○"} ${kib(f.gzip).toFixed(1).padStart(7)} KiB gz  ${kib(f.raw).toFixed(1).padStart(8)} KiB  ${f.file}`);
    if (rows.length > 24) console.log(`  … ${rows.length - 24} weitere Dateien`);
    console.log(`Erstladung: JS ${kib(initialJs)} / ${BUDGETS.initialJs} KiB · CSS ${kib(initialCss)} / ${BUDGETS.initialCss} KiB (gzip)`);
    console.log(`P13 lazy: ${lazy.map((l) => `${l.chunk} ${l.status}`).join(" · ")}`);
    console.log(breaches.length ? `Budget überschritten:\n  - ${breaches.join("\n  - ")}` : "Alle Budgets eingehalten.");
  }
  return breaches.length && !report ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) process.exit(main(process.argv.slice(2)));
