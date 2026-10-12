#!/usr/bin/env node
/**
 * codemod-veil (P13) – moves hard-coded dark-palette colours onto theme tokens so the light mode / accents reach them.
 *
 *   node scripts/codemod-veil.mjs [paths…] [--write] [--exclude=a,b] [--json]
 *
 * Default paths: `src`. Without `--write` it is a dry run that prints what it would change plus a report of the
 * literals it cannot move safely (canvas / SVG strings, shadows, near-miss hexes) – the list to fix by hand.
 *
 * Why this is safe for the dark design: a class is only rewritten when the literal is EXACTLY the dark value of the
 * token it maps to (`text-[#ff8a90]` → `text-(--color-danger-text)`, dark value #ff8a90), so the dark computed colour is
 * byte-identical; only `html[data-theme="light"]` / `[data-accent]` (src/styles/themes.css) change it.
 *
 * White / black alphas (`bg-white/[0.06]`, `border-white/40`, `bg-black/70`) need no rewrite at all: Tailwind v4
 * compiles them to `color-mix(… var(--color-white) …)` and `themes.css` swaps `--color-white` / `--color-black` in light
 * mode (the "veil" = maximum-foreground ink). They are counted in the report so nothing is a surprise.
 *
 * Run order (integration.md §4e): P14 runs it once after all merges, then fixes the remaining report by hand and checks
 * both themes on every page. P13 already ran it on the shell and the primitives.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

/** Dark value → token (custom property). Values must equal tokens.css / themes.css `:root` exactly. */
export const TOKEN_OF_HEX = {
  "#ff8a90": "--color-danger-text",
  "#65b488": "--color-win-soft",
  "#d27a7b": "--color-loss-soft",
  "#f2f2f2": "--color-fg",
  "#9b9b9b": "--color-mute",
  "#5f5f5f": "--color-faint",
  "#2c2c2c": "--color-line-2",
  "#1f1f1f": "--color-line",
  "#040404": "--color-ink-950",
  "#0a0a0a": "--color-ink-900",
  "#111": "--color-ink-850",
  "#111111": "--color-ink-850",
  "#161616": "--color-ink-800",
  "#1c1c1c": "--color-ink-750",
  "#242424": "--color-ink-700",
  "#e6e6e6": "--color-steel",
  "#d9d9d9": "--color-teal",
  "#e5202e": "--color-signal",
  "#3ddc84": "--color-win",
  "#ff4d4f": "--color-loss",
  "#ffb020": "--color-warn",
  "#3a3a3a": "--color-chart-ref",
  "#4a4a4a": "--conv-1",
  "#d6d6d6": "--color-primary-btn-to",
  "#ff3b47": "--color-fab-from",
};

const UTILITY = "(?:bg|text|border|border-[trblxy]|ring|outline|from|via|to|fill|stroke|decoration|divide|accent|caret|placeholder|shadow)";
/** `text-[#ff8a90]`, `hover:bg-[#2c2c2c]/50`, `from-[#65b488]` (variants kept by matching only the utility part) */
const CLASS_RE = new RegExp(`(?<![\\w-])(${UTILITY})-\\[(#[0-9a-fA-F]{3,8})\\]`, "g");
const STRING_HEX_RE = /["'`](#[0-9a-fA-F]{3,8})["'`]/g;
const RGB_IN_CLASS_RE = /(?<![\w-])[a-z-]+-\[[^\]\s]*rgba?\([^\]\s]*\]/g;
const VEIL_RE = /(?<![\w-])(?:bg|border|text|ring|outline|from|via|to|divide|decoration)-(?:white|black)(?:\/[\w.[\]]+)?(?![\w-])/g;

const EXT = new Set([".ts", ".tsx"]);

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(join(p, name), out);
    }
  } else if (EXT.has(extname(p)) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx")) out.push(p);
  return out;
}

/** Rewrites the safe classes of one source text; returns the new text and what changed / what was left. */
export function transform(src) {
  const changes = [];
  const left = [];
  const out = src.replace(CLASS_RE, (m, util, hex) => {
    const token = TOKEN_OF_HEX[hex.toLowerCase()];
    if (!token) {
      left.push({ kind: "class", text: m });
      return m;
    }
    const next = `${util}-(${token})`;
    changes.push({ from: m, to: next });
    return next;
  });
  for (const m of out.matchAll(STRING_HEX_RE)) left.push({ kind: "string", text: m[1] });
  for (const m of out.matchAll(RGB_IN_CLASS_RE)) left.push({ kind: "rgb-class", text: m[0] });
  const veils = [...out.matchAll(VEIL_RE)].length;
  return { text: out, changes, left, veils };
}

function main(argv) {
  const write = argv.includes("--write");
  const json = argv.includes("--json");
  const exclude = (argv.find((a) => a.startsWith("--exclude="))?.slice(10) ?? "").split(",").filter(Boolean);
  const roots = argv.filter((a) => !a.startsWith("--"));
  const files = (roots.length ? roots : ["src"]).flatMap((r) => walk(r, []));
  const report = [];
  let changed = 0;
  let veils = 0;
  for (const f of files) {
    const rel = relative(process.cwd(), f);
    if (exclude.some((x) => rel.includes(x))) continue;
    const src = readFileSync(f, "utf8");
    const r = transform(src);
    veils += r.veils;
    if (r.changes.length || r.left.length) report.push({ file: rel, changes: r.changes, left: r.left });
    if (r.changes.length) {
      changed += r.changes.length;
      if (write) writeFileSync(f, r.text);
    }
  }
  if (json) {
    process.stdout.write(JSON.stringify({ write, changed, veils, report }, null, 2) + "\n");
    return;
  }
  for (const r of report) {
    console.log(`\n${r.file}`);
    for (const c of r.changes) console.log(`  ${write ? "✓" : "→"} ${c.from}  ⇒  ${c.to}`);
    const byKind = {};
    for (const l of r.left) (byKind[l.kind] ??= []).push(l.text);
    for (const [k, list] of Object.entries(byKind)) console.log(`  · by hand (${k}): ${[...new Set(list)].join("  ")}`);
  }
  console.log(`\n${write ? "rewrote" : "would rewrite"} ${changed} class(es); ${veils} white/black veil class(es) follow --color-white/--color-black without a rewrite.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
