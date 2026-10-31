/**
 * Every function of the register stands where it says it stands – checked statically, page by page: the anchor (a `data-testid` or
 * the start of a card heading) must be written in a file that the PAGE ITSELF reaches through its imports (static and `import()`),
 * not just anywhere in the app. `tests/e2e/funktionen-anker.spec.ts` then finds each anchor in the DOM of the page; this test
 * catches the common slip earlier – a function filed under the wrong page, or an anchor renamed in the card.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURE_REGISTRY } from "@/app/features";
import type { Page } from "@/store/uiStore";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");

/** The module each page starts from (`src/app/pages.ts`: the four static pages and the lazy chunks). */
const PAGE_ROOT: Record<Page, string> = {
  overview: "views/overview/index.ts",
  trades: "views/trades/index.ts",
  setups: "views/setups/index.ts",
  settings: "app/SettingsPage.tsx",
  markt: "views/markt/MarktView.tsx",
  analyse: "views/analyse/AnalyseView.tsx",
  risiko: "views/risiko/RisikoView.tsx",
  coach: "views/coach/CoachView.tsx",
  berichte: "views/berichte/BerichteView.tsx",
  labor: "views/labor/LaborView.tsx",
  wachstum: "views/wachstum/WachstumView.tsx",
  community: "views/community/CommunityView.tsx",
  cockpit: "views/cockpit/CockpitView.tsx",
  konto: "views/konto/KontoPage.tsx",
  preise: "views/preise/PreiseView.tsx",
  funktionen: "views/funktionen/FunktionenView.tsx",
  studio: "views/studio/StudioView.tsx",
  plan: "views/plan/PlanView.tsx",
  aktien: "views/aktien/AktienView.tsx",
};

const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (/\.(ts|tsx)$/.test(c) && existsSync(c)) return c;
  }
  return null;
}

const closures = new Map<string, string>();
/** All text of the modules a page reaches. */
function closureText(page: Page): string {
  const cached = closures.get(page);
  if (cached !== undefined) return cached;
  const seen = new Set<string>();
  const stack = [join(SRC, PAGE_ROOT[page])];
  const out: string[] = [];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    out.push(text);
    for (const m of text.matchAll(IMPORT)) {
      const next = resolve(m[1]!, file);
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  const all = out.join("\n");
  closures.set(page, all);
  return all;
}

describe("the register's pages and anchors, page by page", () => {
  it("has a root module for every page that exists", () => {
    for (const [page, file] of Object.entries(PAGE_ROOT)) expect(existsSync(join(SRC, file)), `${page}: ${relative(SRC, join(SRC, file))}`).toBe(true);
  });

  it("writes every anchor in a module that its own page reaches", () => {
    const misses: string[] = [];
    for (const f of FEATURE_REGISTRY) {
      const a = f.anchor;
      if (!a) continue;
      const text = closureText(f.page);
      if (a.testid && !text.includes(`"${a.testid}"`) && !text.includes(`'${a.testid}'`) && !text.includes(`\`${a.testid}`)) misses.push(`${f.id}: test id "${a.testid}" is not reachable from page ${f.page}`);
      if (a.heading && !text.includes(a.heading)) misses.push(`${f.id}: heading "${a.heading}" is not reachable from page ${f.page}`);
    }
    expect(misses).toEqual([]);
  });

  it("gives every function without an anchor a sheet or a way, and says on which page the way starts", () => {
    for (const f of FEATURE_REGISTRY) {
      if (f.anchor) continue;
      expect(!!f.action || !!f.path, f.id).toBe(true);
    }
  });
});
