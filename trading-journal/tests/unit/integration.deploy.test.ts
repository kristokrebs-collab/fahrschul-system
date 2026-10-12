/**
 * Deploy configuration (P14): `netlify.toml` at the repo root (functions directory, the Binance proxy rewrites before the
 * SPA fallbacks, the CSP with exactly the hosts the browser talks to, security headers, Node 22), every function routed
 * under `/api/v1` or scheduled in code, and `.env.example` naming every variable the client and the functions read.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs from trading-journal/
const root = process.cwd();
const toml = readFileSync(join(root, "../netlify.toml"), "utf8");
const envExample = readFileSync(join(root, ".env.example"), "utf8");
const fnDir = join(root, "netlify/functions");
const functions = readdirSync(fnDir).filter((f) => f.endsWith(".mts"));

const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)?.[1] ?? "";
const directive = (name: string) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "").split(/\s+/).slice(1);

describe("netlify.toml", () => {
  it("builds both editions from trading-journal with Node 22 and deploys the functions", () => {
    expect(toml).toMatch(/base = "trading-journal"/);
    expect(toml).toMatch(/command = "npm ci && npm run build && npm run build:share"/);
    expect(toml).toMatch(/NODE_VERSION = "22"/);
    expect(toml).toMatch(/\[functions\]\s+directory = "netlify\/functions"/);
  });

  it("keeps the Binance proxy rewrites before the SPA fallbacks", () => {
    const proxy = toml.indexOf('from = "/api/binance/fapi/v1/klines"');
    const share = toml.indexOf('from = "/teilen/*"');
    const spa = toml.indexOf('from = "/*"');
    expect(proxy).toBeGreaterThan(0);
    for (const p of ["futures/data/*", "fapi/v1/time", "fapi/v1/premiumIndex", "fapi/v1/ticker/24hr", "fapi/v1/openInterest", "fapi/v1/fundingRate"]) expect(toml).toContain(`from = "/api/binance/${p}"`);
    expect(proxy).toBeLessThan(share);
    expect(share).toBeLessThan(spa);
  });

  it("CSP: same origin, the public market feeds and Supabase (https + wss, storage images); nothing inline, no frames", () => {
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("script-src")).toEqual(["'self'"]);
    expect(directive("connect-src")).toEqual(expect.arrayContaining(["'self'", "https://fapi.binance.com", "wss://fstream.binance.com", "https://*.supabase.co", "wss://*.supabase.co"]));
    expect(directive("img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:", "https://*.supabase.co"]));
    expect(directive("worker-src")).toEqual(["'self'", "blob:"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    // Stripe / Bitunix / Anthropic are server-side only
    expect(csp).not.toMatch(/stripe|bitunix|anthropic/i);
    expect(toml).toMatch(/Strict-Transport-Security = "max-age=63072000; includeSubDomains"/);
    expect(toml).toMatch(/Permissions-Policy = "camera=\(\), microphone=\(\), geolocation=\(\)"/);
  });

  it("every function is routed under /api/v1 or scheduled in its code, and the toml names the schedules", () => {
    expect(functions.length).toBeGreaterThan(20);
    for (const f of functions) {
      const src = readFileSync(join(fnDir, f), "utf8");
      const cfg = /export const config[^=]*=\s*(\{[\s\S]*?\});/.exec(src)?.[1] ?? "";
      const scheduled = /schedule:\s*"([^"]+)"/.exec(cfg)?.[1];
      if (scheduled) {
        expect(toml, `${f} schedule in netlify.toml`).toContain(f.replace(/\.mts$/, ""));
        continue;
      }
      const paths = [...cfg.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]!);
      expect(paths.length, `${f} has a path`).toBeGreaterThan(0);
      for (const p of paths) expect(p, f).toMatch(/^\/api\/v1\//);
    }
  });
});

describe(".env.example", () => {
  it("names every variable the client build and the functions read", () => {
    const names = new Set<string>();
    const scan = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const u = join(dir, e.name);
        if (e.isDirectory()) scan(u);
        else if (/\.(m?ts|tsx)$/.test(e.name)) {
          const src = readFileSync(u, "utf8");
          for (const m of src.matchAll(/import\.meta\.env\.(VITE_[A-Z_]+)/g)) names.add(m[1]!);
          for (const m of src.matchAll(/\b(?:env|optional|required|num|bool|flag)\w*\(\s*"([A-Z][A-Z0-9_]{3,})"/g)) names.add(m[1]!);
          for (const m of src.matchAll(/"((?:STRIPE|SUPABASE|EXCHANGE|REFERRAL|TRIAL|SYNC|LOG|SITE|ANTHROPIC|COACH)_[A-Z0-9_]+)"/g)) names.add(m[1]!);
        }
      }
    };
    scan(join(root, "src"));
    scan(fnDir);
    expect(names.size).toBeGreaterThan(15);
    const listed = new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
    const missing = [...names].filter((n) => !listed.has(n));
    expect(missing, `missing in .env.example: ${missing.join(", ")}`).toEqual([]);
    // client values are public, server values never carry the VITE_ prefix
    for (const n of listed) if (/SECRET|ENC_KEY|API_KEY/.test(n)) expect(n.startsWith("VITE_"), n).toBe(false);
  });
});
