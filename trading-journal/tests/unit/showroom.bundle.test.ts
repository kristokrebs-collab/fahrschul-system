/**
 * Showroom (Paket S): the production build carries NOTHING of it. Scans the built files of `dist/` (run `npm run build` first; skipped when there is no
 * build) for every marker of the showroom's code and texts, checks that the sources outside `src/showroom/` touch it only at the two flag sites, and – when a
 * showroom build exists (`dist-showroom/`) – that the same scan DOES find the markers there (so the scan cannot pass by looking at nothing).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
/** Things only the showroom's code, texts and styles contain. */
const MARKERS = ["tj-demo-card", "showroom.invalid", "tj2-showroom", "Bestätigungslink simulieren", "Demo-Zahlungsseite", "Demo-Karte – nichts wird gespeichert", "showroom-banner", "SHOWROOM · Demo-Daten", "demo@showroom.test", "Neu in dieser Version", "showroom-demo", "sr-pay", "slide-account"];

function files(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "ocr") continue;
      files(p, out);
    } else if (/\.(m?js|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

function scan(dir: string): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const f of files(dir)) {
    const text = readFileSync(f, "utf8");
    for (const m of MARKERS) if (text.includes(m)) hits.set(m, [...(hits.get(m) ?? []), relative(dir, f)]);
  }
  return hits;
}

const prod = existsSync(join(ROOT, "dist", "index.html"));
const showroom = existsSync(join(ROOT, "dist-showroom", "index.html"));

describe("showroom is not in the production build", () => {
  it.skipIf(!prod)("no marker in any file of dist/ (the flag folds the import away)", () => {
    const hits = scan(join(ROOT, "dist"));
    expect([...hits.entries()].map(([m, f]) => `${m} → ${f.join(", ")}`)).toEqual([]);
    // the lazy chunk and its stylesheet are not emitted at all
    expect(files(join(ROOT, "dist")).filter((f) => /ShowroomHost|install-|showroom/i.test(f))).toEqual([]);
  });

  it.skipIf(!showroom)("the same scan finds the markers in the showroom build", () => {
    const hits = scan(join(ROOT, "dist-showroom"));
    for (const m of ["showroom.invalid", "Bestätigungslink simulieren", "SHOWROOM · Demo-Daten", "Neu in dieser Version"]) expect(hits.has(m), m).toBe(true);
  });
});

describe("the sources reach the showroom only through the flag", () => {
  it("outside src/showroom/ only main.tsx, App.tsx, the define declaration (env.d.ts) and the billing hook name the showroom", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (p.endsWith(join("src", "showroom"))) continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && /showroom/i.test(readFileSync(p, "utf8"))) offenders.push(relative(ROOT, p));
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders.sort()).toEqual(["src/App.tsx", "src/billing/api.ts", "src/env.d.ts", "src/main.tsx"].sort());
    // …and both sites are behind the constant
    expect(readFileSync(join(ROOT, "src", "main.tsx"), "utf8")).toMatch(/if \(__TJ_SHOWROOM__\)[^\n]*import\("@\/showroom\/install"\)/);
    expect(readFileSync(join(ROOT, "src", "App.tsx"), "utf8")).toMatch(/__TJ_SHOWROOM__ \? lazy\(\(\) => import\("@\/showroom\/ui\/ShowroomHost"\)\) : null/);
  });

  it("the production config never sets the flag (only the showroom scripts do)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, cmd] of Object.entries(pkg.scripts)) expect(/VITE_SHOWROOM=1/.test(cmd), name).toBe(name.startsWith("build:showroom"));
    const toml = readFileSync(join(ROOT, "..", "netlify.toml"), "utf8");
    const [before, after] = toml.split("[context.deploy-preview]");
    const code = (before ?? "").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).not.toMatch(/showroom/i);
    expect(after).toMatch(/build:showroom:deploy/);
    // the production command is untouched
    expect(before).toMatch(/command = "npm ci && npm run build && npm run build:share"/);
  });
});
