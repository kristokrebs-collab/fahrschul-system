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

  it("the production config never sets the flag (only the local showroom script does)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, cmd] of Object.entries(pkg.scripts)) expect(/VITE_SHOWROOM=1/.test(cmd), name).toBe(name.startsWith("build:showroom"));
    // the showroom build writes only into its own folder (never `dist/`, which Netlify publishes)
    const showroomScripts = Object.entries(pkg.scripts).filter(([name]) => name.startsWith("build:showroom"));
    expect(showroomScripts.map(([n]) => n)).toEqual(["build:showroom"]);
    for (const [, cmd] of showroomScripts) expect(cmd).toMatch(/--outDir dist-showroom\b/);
  });
});

/**
 * Deploy previews build the real app (the operator's decision: everything must work in the app itself – no „Neu in dieser Version“ panel,
 * no demo banner, no mock backend in anything Netlify publishes). Every build command of `netlify.toml` – production, branch deploys, deploy
 * previews – is the production build; the showroom script stays for local demos only.
 */
describe("no deployed build is the showroom", () => {
  const toml = readFileSync(join(ROOT, "..", "netlify.toml"), "utf8");
  const code = toml
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const PROD = "npm ci && npm run build && npm run build:share";

  it("netlify.toml names no showroom build and no VITE_SHOWROOM anywhere outside comments", () => {
    expect(code).not.toMatch(/showroom/i);
    expect(code).not.toMatch(/VITE_SHOWROOM/);
  });

  it("production and deploy previews run the same command (incl. build:share)", () => {
    const commands = [...code.matchAll(/^\s*command\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThanOrEqual(2);
    for (const c of commands) expect(c).toBe(PROD);
    const preview = code.split("[context.deploy-preview]")[1] ?? "";
    expect(preview).toMatch(/command = "npm ci && npm run build && npm run build:share"/);
    // the base command (production, branch deploys) is untouched
    expect(code.split("[context.")[0]).toMatch(/command = "npm ci && npm run build && npm run build:share"/);
  });

  it("the scripts the deploy runs never switch the showroom on", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const name of ["build", "build:share"]) {
      const cmd = pkg.scripts[name] ?? "";
      expect(cmd, name).not.toMatch(/SHOWROOM|showroom/);
    }
  });

  it.skipIf(!prod)("the release panel „Neu in dieser Version“ is in no file of the published folder (personal and share edition)", () => {
    const hits = files(join(ROOT, "dist")).filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes("Neu in dieser Version") || text.includes("sr-panel") || text.includes("SHOWROOM · Demo-Daten");
    });
    expect(hits.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
