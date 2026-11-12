#!/usr/bin/env node
/**
 * Builds the two single-file editions and copies them to release/ (gitignored):
 *   release/trade-journal-persoenlich.html   (personal: your setups/levels, same tj2-* storage as the web app)
 *   release/trade-journal-teilen.html        (share: empty journal, neutral defaults, own tj2share-* storage)
 * The share build fails inside Vite when a personal string leaks (scripts/privacyGuard.ts); this script also
 * fails when a file references anything outside itself.
 * Usage: npm run build:single   (or: node scripts/build-single.mjs [outDir])  – outDir defaults to release/
 */
import { build } from "vite";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const configFile = fileURLToPath(new URL("../vite.single.config.ts", import.meta.url));
const outDir = resolve(root, process.argv[2] ?? "release");
const OUT = {
  personal: "trade-journal-persoenlich.html",
  share: "trade-journal-teilen.html",
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

mkdirSync(outDir, { recursive: true });
for (const mode of /** @type {const} */ (["personal", "share"])) {
  await build({ root, configFile, mode, logLevel: "warn" });
  const file = resolve(root, "dist-single", mode, "index.html");
  const html = readFileSync(file, "utf8");
  if (!html.includes(`<meta name="tj-edition" content="${mode}" />`)) throw new Error(`${mode}: edition meta missing`);
  // the HTML shell without the inline code (React DOM itself contains strings like `link[rel="stylesheet"]`)
  const shell = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
  if (/<script[^>]*\ssrc=|<link[^>]*rel="(?:stylesheet|modulepreload)"/.test(shell)) throw new Error(`${mode}: external reference left in the file`);
  const target = resolve(outDir, OUT[mode]);
  copyFileSync(file, target);
  console.log(`${target}  ${kb(statSync(file).size)} (gzip ${kb(gzipSync(html).length)})`);
}
