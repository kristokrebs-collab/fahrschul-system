/**
 * Build-time privacy guard for the "zum Teilen" edition (Vite plugin, used by `vite.config.ts --mode share` and
 * `vite.single.config.ts --mode share`).
 *
 * After the bundle is generated (hook order "post", before anything is written to disk) every chunk and asset is
 * scanned for personal strings and numbers; one hit fails the build with the list of leaks. The markers are:
 * - every string in `src/domain/edition/personal.ts` (≥ 6 chars) that does not also exist in `share.ts`
 *   (strategy setups, checklists, rules, copy) – in plain, JSON-escaped and `\uXXXX`-escaped spelling;
 * - the personal trigger levels / backtest numbers (`85900`, `0.6215`, …) in their minified spellings;
 * - `EXTRA_MARKERS`: fragments of personal copy that other modules may still carry as literals.
 * The edition modules are read as TEXT (string and number literals), not imported: the Vite config stays loadable
 * by the native config loader (no extension-less TS imports). Pure `findLeaks(text)` is exported for the unit test.
 */
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Fragments that identify personal copy anywhere in the bundle (also outside the edition modules). */
export const EXTRA_MARKERS: readonly string[] = [
  "82.829", "85.900", "84.500", "85.300", "81.500", "87.200", "62,15", "62,09", "214er", "214 Signale",
  "MegaWhale", "Philosophie", "Leg-Up-Ladder", "Lower-High-Bruch", "Neckline-Short", "Makro-Cash", "21. Nov",
  "Ziel 66.000", "89.000–90.000", "82.000–81.500", "7.834–7.840",
];

/** `src/domain/edition/` next to this script (vitest may hand out a non-`file:` `import.meta.url`: fall back to cwd). */
const EDITION_DIR = import.meta.url.startsWith("file:")
  ? resolve(dirname(fileURLToPath(import.meta.url)), "../src/domain/edition")
  : resolve(process.cwd(), "src/domain/edition");

/** String and number literals of a TS source (comments removed; strings are double-quoted JSON-compatible literals). */
export function literalsOf(source: string): { strings: Set<string>; numbers: Set<number> } {
  const strings = new Set<string>();
  const numbers = new Set<number>();
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
  const rest = code.replace(/"(?:[^"\\\n]|\\.)*"/g, (lit) => {
    try {
      strings.add(JSON.parse(lit) as string);
    } catch {
      /* not a JSON string literal – ignore */
    }
    return '""';
  });
  for (const m of rest.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g)) numbers.add(Number(m[0]));
  return { strings, numbers };
}

function editionValues(...files: string[]): { strings: Set<string>; numbers: Set<number> } {
  const strings = new Set<string>();
  const numbers = new Set<number>();
  for (const f of files) {
    const lit = literalsOf(readFileSync(resolve(EDITION_DIR, f), "utf8"));
    lit.strings.forEach((x) => strings.add(x));
    lit.numbers.forEach((x) => numbers.add(x));
  }
  return { strings, numbers };
}

const p = editionValues("personal.ts");
const s = editionValues("share.ts", "mtf.ts");

/**
 * Generic methodology texts that a personal checklist happens to share with app code both editions use
 * (`domain/fallingKnife.ts` – the Falling-Knife filter, not a personal level or strategy).
 */
export const GENERIC_TEXTS: ReadonlySet<string> = new Set(["Erster Higher Low oder BOS auf 1H/4H"]);

/**
 * Personal texts (≥ 6 chars with a space, not shared with the share edition). Ids (`s_ladder`), colours (`#6f9dc9`)
 * and symbols are not text: the palette and ids legitimately exist elsewhere in the bundle.
 */
export const PERSONAL_STRINGS: readonly string[] = [...p.strings].filter(
  (x) => x.length >= 6 && /\s/.test(x.trim()) && !s.strings.has(x) && !GENERIC_TEXTS.has(x),
);

/**
 * Personal numbers that are distinctive enough to grep a minified bundle for: levels ≥ 10 000 that are not round
 * thousands (timeouts and limits use those) and 4-digit fractions (backtest).
 */
export const PERSONAL_NUMBERS: readonly number[] = [...p.numbers].filter(
  (n) => !s.numbers.has(n) && ((Math.abs(n) >= 10_000 && n % 1000 !== 0) || (Math.abs(n) < 1 && /\.\d{4,}$/.test(String(n)))),
);

const asciiEscape = (x: string) => x.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Every spelling a minifier may give a number (`85900`, `859e2`, `.6215`, `-.0931`). */
function numberSpellings(n: number): string[] {
  const out = new Set<string>([String(n)]);
  if (Number.isInteger(n)) {
    for (let e = 1; e <= 3; e++) if (n % 10 ** e === 0) out.add(`${n / 10 ** e}e${e}`);
  } else {
    out.add(String(n).replace(/^(-?)0\./, "$1."));
  }
  return [...out];
}

/** Regex that matches a number token (not part of a longer number or identifier). */
function numberPattern(spelling: string): RegExp {
  const esc = spelling.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(?<![\\w.])${esc}(?![\\w.])`);
}

const NUMBER_PATTERNS = PERSONAL_NUMBERS.flatMap((n) => numberSpellings(n).map((sp) => ({ label: String(n), re: numberPattern(sp) })));

/** All personal markers found in `text` (empty = clean). */
export function findLeaks(text: string): string[] {
  const leaks = new Set<string>();
  for (const m of EXTRA_MARKERS) if (text.includes(m)) leaks.add(m);
  for (const str of PERSONAL_STRINGS) {
    const json = JSON.stringify(str).slice(1, -1);
    if (text.includes(str) || text.includes(json) || text.includes(asciiEscape(json))) leaks.add(str);
  }
  for (const { label, re } of NUMBER_PATTERNS) if (re.test(text)) leaks.add(label);
  return [...leaks];
}

/** Vite plugin: fails a share build that carries any personal marker (nothing is written to disk). */
export function privacyGuard(): Plugin {
  return {
    name: "tj-privacy-guard",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_opts, bundle) {
        const found = new Map<string, string[]>();
        for (const [name, file] of Object.entries(bundle)) {
          const text = file.type === "chunk" ? file.code : typeof file.source === "string" ? file.source : "";
          const leaks = findLeaks(text);
          if (leaks.length) found.set(name, leaks);
        }
        if (found.size) {
          const lines = [...found].map(([name, leaks]) => `  ${name}: ${leaks.slice(0, 12).join(" | ")}${leaks.length > 12 ? ` (+${leaks.length - 12})` : ""}`);
          this.error(`privacy guard: the share edition contains personal strings\n${lines.join("\n")}`);
        }
      },
    },
  };
}
