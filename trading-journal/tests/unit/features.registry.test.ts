/**
 * The function register (`src/app/features.ts`) is the one truth for "what can the app do and where is it" – this test
 * keeps it honest: every entry points to a real page and a known sheet, every anchor text really stands in the code of
 * the app, every status is explained, every gate is a real plan feature – and `docs/COVERAGE.md` (one row per F-ID,
 * F01–F74) has each F-ID exactly once, only existing code paths, and nothing the register lists as a function may be
 * marked "fehlt" there.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURE_GROUPS, FEATURE_REGISTRY, PLAN_TIERS, featureById, tierOf, type FeatureAction } from "@/app/features";
import { PAGE_LABELS } from "@/app/Dock";
import { LAZY_PAGES, isLazyPage } from "@/app/pages";
import { FEATURES } from "@/billing/types";
import { PAGES } from "@/store/uiStore";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");

/** All text of the app's source (the register itself excluded) – an anchor must stand there as a literal. */
function sourceText(): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && relative(SRC, p) !== join("app", "features.ts")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(SRC);
  return out.join("\n");
}

interface CoverageRow {
  fid: string;
  status: string;
  code: string[];
  tests: string[];
}

function coverage(): CoverageRow[] {
  const text = readFileSync(join(ROOT, "docs/COVERAGE.md"), "utf8");
  const split = (cell: string): string[] =>
    cell
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x && x !== "–");
  return text
    .split("\n")
    .filter((l) => /^\| F\d\d \|/.test(l))
    .map((l) => {
      const c = l.split("|").map((x) => x.trim());
      // | F01 | Punkt | Status | Code | Daten | Tests | Lücke |
      return { fid: c[1]!, status: c[3]!, code: split(c[4]!), tests: split(c[6]!) };
    });
}

const ACTIONS: readonly FeatureAction[] = ["training", "assistant", "newTrade", "csvImport", "shortcuts"];

describe("function register", () => {
  it("has unique, slug-shaped ids and a name, a benefit sentence and keywords on every entry", () => {
    const ids = FEATURE_REGISTRY.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FEATURE_REGISTRY) {
      expect(f.id, f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f.name.trim().length, f.id).toBeGreaterThan(3);
      expect(f.benefit, f.id).toMatch(/[.“”)]$/);
      expect(f.benefit.length, f.id).toBeLessThan(260);
      expect(f.keywords.length, f.id).toBeGreaterThan(2);
      expect(featureById(f.id)).toBe(f);
    }
  });

  it("points every entry to an existing route, a known group and a known sheet", () => {
    const groups = new Set(FEATURE_GROUPS.map((g) => g.id));
    for (const f of FEATURE_REGISTRY) {
      expect(PAGES as readonly string[], `${f.id}: page ${f.page}`).toContain(f.page);
      expect(PAGE_LABELS[f.page], `${f.id}: a page without a label`).toBeTruthy();
      expect(isLazyPage(f.page) || ["overview", "trades", "setups", "settings"].includes(f.page), f.id).toBe(true);
      expect(groups.has(f.group), `${f.id}: group ${f.group}`).toBe(true);
      if (f.action) expect(ACTIONS, `${f.id}: action ${f.action}`).toContain(f.action);
      if (f.gate) expect(FEATURES as readonly string[], `${f.id}: gate ${f.gate}`).toContain(f.gate);
    }
    // the new page is a lazy chunk of its own
    expect(LAZY_PAGES).toContain("funktionen");
  });

  it("uses every group, and lists the user's groups first", () => {
    for (const g of FEATURE_GROUPS) expect(FEATURE_REGISTRY.some((f) => f.group === g.id), g.id).toBe(true);
    expect(FEATURE_GROUPS.slice(0, 7).map((g) => g.name)).toEqual(["Heute vorbereiten", "Beobachten & Alarme", "Einstieg prüfen", "Testen", "Auswerten & Lernen", "Daten & Import", "Community"]);
  });

  it("explains every 'teilweise' with a note; a way ('So geht’s') only where something lives inside a sheet or dialog", () => {
    for (const f of FEATURE_REGISTRY) {
      if (f.status === "teilweise") expect(f.note?.length ?? 0, `${f.id} is teilweise without a note`).toBeGreaterThan(20);
      if (f.path) expect(f.path, f.id).toMatch(/→|Auch|Karten/);
    }
  });

  it("anchors on text that really stands in the code (test ids and card headings)", () => {
    const src = sourceText();
    for (const f of FEATURE_REGISTRY) {
      const a = f.anchor;
      if (!a) continue;
      expect(a.testid || a.heading, `${f.id}: an empty anchor`).toBeTruthy();
      if (a.testid) {
        expect(a.testid, `${f.id}: test id shape`).toMatch(/^[a-z0-9-]+$/);
        expect(src.includes(`"${a.testid}"`) || src.includes(`data-testid="${a.testid}"`), `${f.id}: test id "${a.testid}" is nowhere in src/`).toBe(true);
      }
      if (a.heading) expect(src.includes(`"${a.heading}`), `${f.id}: heading "${a.heading}" is nowhere in src/`).toBe(true);
    }
  });

  it("derives the plan from the plan table: no gate is free, a gate is the lowest plan that includes it", () => {
    expect(PLAN_TIERS).toEqual(["frei", "pro", "premium", "team"]);
    expect(tierOf(undefined)).toBe("frei");
    expect(tierOf("csvImport")).toBe("frei");
    expect(tierOf("coach")).toBe("pro");
    expect(tierOf("backtestLab")).toBe("premium");
    expect(tierOf("shotExtract")).toBe("premium");
    for (const f of FEATURE_REGISTRY) expect(PLAN_TIERS).toContain(tierOf(f.gate));
  });

  it("names the pages of the user's list: Labor, Bibliothek, Belastungstest, TradingView-Vergleich, Coach, Berichte, Wochenexperiment, Verpasste Chancen, Was wäre wenn, Üben, Bias-Test, Import, Backup, Community", () => {
    const names = FEATURE_REGISTRY.map((f) => f.name).join(" | ");
    for (const part of ["Backtest-Labor", "Strategie-Bibliothek", "Belastungstest", "TradingView-Vergleich", "Coach", "Berichte", "Wochenexperiment", "Verpasste Chancen", "Was wäre wenn", "Üben", "Bias", "Screenshot", "CSV-Import", "Backup", "Rangliste", "Tagesplan", "Schlüsselmarken", "Check-in", "Lage-Ampel", "Einstiegs-Check", "Warum handeln", "Positionsrechner"]) {
      expect(names, part).toContain(part);
    }
  });
});

describe("docs/COVERAGE.md", () => {
  const rows = coverage();

  it("has every F-ID from F01 to F74 exactly once, with a valid status", () => {
    const fids = rows.map((r) => r.fid);
    expect(fids).toEqual(Array.from({ length: 74 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`));
    for (const r of rows) expect(["fertig", "teilweise", "fehlt"], r.fid).toContain(r.status);
  });

  it("cites only code and test paths that exist", () => {
    for (const r of rows) {
      for (const p of [...r.code, ...r.tests]) expect(existsSync(join(ROOT, p)), `${r.fid}: ${p}`).toBe(true);
      if (r.status === "fertig") expect(r.tests.length, `${r.fid} is fertig without a test`).toBeGreaterThan(0);
    }
  });

  it("agrees with the register: a listed F-ID exists there as a row and is not marked 'fehlt'", () => {
    const byFid = new Map(rows.map((r) => [r.fid, r]));
    for (const f of FEATURE_REGISTRY) {
      for (const fid of f.fids) {
        const row = byFid.get(fid);
        expect(row, `${f.id}: ${fid} is not in COVERAGE.md`).toBeTruthy();
        expect(row!.status, `${f.id} lists ${fid}, which COVERAGE.md marks as fehlt`).not.toBe("fehlt");
      }
    }
  });

  it("says 'fehlt' for what the register does not offer: no entry for F13, F19, F21, F23 … F26, F43, F49, F58, F60, F66 … F70", () => {
    const listed = new Set(FEATURE_REGISTRY.flatMap((f) => f.fids));
    for (const r of rows.filter((x) => x.status === "fehlt")) expect(listed.has(r.fid), r.fid).toBe(false);
  });
});
