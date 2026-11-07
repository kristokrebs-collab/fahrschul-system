// @vitest-environment node
/// <reference types="node" />
/**
 * C4: the list of environment variables (`envSpec.ts`) is complete and honest. It must name every variable the code reads,
 * match `.env.example`, produce exactly `docs/ENV.md`, and the evaluator must never call something "bereit" or "eingerichtet"
 * while a variable is missing. `UEBERSICHT_WRITE`-style: run `node scripts/envDoc.mjs --write` after changing the list.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_GROUPS, ENV_SPEC, evaluateEnv, FUNCTION_ENV, groupStatus } from "../../netlify/functions/_lib/envSpec";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(m?ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("the variable list", () => {
  const names = ENV_SPEC.map((e) => e.name);

  it("has no duplicates, every group exists, every function group exists", () => {
    expect(new Set(names).size).toBe(names.length);
    const groups = new Set([...ENV_GROUPS.map((g) => g.id), "switches", "legal"]);
    for (const e of ENV_SPEC) expect(groups.has(e.group), `${e.name}: unknown group ${e.group}`).toBe(true);
    for (const f of FUNCTION_ENV) for (const g of f.groups) expect(ENV_GROUPS.some((x) => x.id === g), `${f.fn}: unknown group ${g}`).toBe(true);
    for (const g of ENV_GROUPS) for (const n of [...g.all, ...(g.anyOf ?? []).flat()]) expect(names, `${g.id}: ${n} not in the list`).toContain(n);
  });

  it("server secrets never carry the VITE_ prefix, client values are never secret", () => {
    for (const e of ENV_SPEC) {
      if (e.secret) expect(e.name.startsWith("VITE_"), e.name).toBe(false);
      if (e.scope === "client") expect(e.secret, e.name).toBe(false);
    }
  });

  it("names every variable the code reads (functions and client)", () => {
    const used = new Set<string>();
    for (const f of [...walk("netlify/functions"), ...walk("src")]) {
      const s = read(f);
      for (const m of s.matchAll(/import\.meta\.env\.(VITE_[A-Z_]+)/g)) used.add(m[1]!);
      for (const m of s.matchAll(/\b(?:env|envOptional|envInt|envNumber|envBool)\(\s*"([A-Z][A-Z0-9_]{3,})"/g)) used.add(m[1]!);
    }
    // the Stripe price ids are built from a pattern (`STRIPE_PRICE_<PLAN>_<INTERVAL>`), the key ring from `EXCHANGE_ENC_KEY_V<n>`
    for (const p of ["PRO", "PREMIUM", "TEAM"]) for (const i of ["MONTHLY", "YEARLY"]) used.add(`STRIPE_PRICE_${p}_${i}`);
    used.add("EXCHANGE_ENC_KEY_V1");
    used.add("STRIPE_TRIAL_CARDLESS");
    const missing = [...used].filter((n) => !names.includes(n) && !["VITE_"].includes(n));
    expect(missing, "read by the code but not in envSpec.ts / docs/ENV.md").toEqual([]);
  });

  it("every entry that is not marked planned is read by the code (no dead documentation)", () => {
    const code = [...walk("netlify/functions"), ...walk("src")].map(read).join("\n");
    const dead = ENV_SPEC.filter((e) => !e.planned && !code.includes(e.name) && !/^STRIPE_PRICE_/.test(e.name)).map((e) => e.name);
    expect(dead).toEqual([]);
  });

  it(".env.example lists exactly the entries that are not planned-only, SETUP.md mentions each", () => {
    const listed = new Set([...read(".env.example").matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
    const setup = read("SETUP.md");
    const missing = ENV_SPEC.filter((e) => !listed.has(e.name) && !(e.planned && e.group === "phone")).map((e) => e.name);
    expect(missing, "in envSpec.ts but not in .env.example").toEqual([]);
    const extra = [...listed].filter((n) => !names.includes(n));
    expect(extra, "in .env.example but not in envSpec.ts").toEqual([]);
    for (const n of ["OPS_TOKEN", "KILL_SYNC", "KILL_CALLS", "KILL_AI", "KILL_CHECKOUT"]) expect(setup).toContain(n);
  });

  it("docs/ENV.md is the generated file", () => {
    const res = spawnSync(process.execPath, [join(root, "scripts/envDoc.mjs")], { encoding: "utf8" });
    expect(res.status, res.stderr).toBe(0);
    expect(read("docs/ENV.md").trimEnd()).toBe(res.stdout.trimEnd());
  });
});

describe("evaluateEnv", () => {
  const get = (vars: Record<string, string>) => (n: string) => vars[n];
  const core = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_SECRET_KEY: "k", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "p", SITE_ORIGIN: "https://s.test" };

  it("nothing set is 'nicht eingerichtet' – never 'bereit'", () => {
    const r = evaluateEnv(get({}));
    expect(r.verdict).toBe("nicht eingerichtet");
    expect(r.groups.every((g) => g.state === "nicht eingerichtet")).toBe(true);
    const needing = r.functions.filter((f) => FUNCTION_ENV.find((x) => x.fn === f.fn)!.groups.length);
    expect(needing.length).toBeGreaterThan(30);
    expect(needing.every((f) => f.state === "nicht eingerichtet")).toBe(true);
  });

  it("whitespace-only values count as missing", () => {
    expect(groupStatus(ENV_GROUPS.find((g) => g.id === "ops")!, get({ OPS_TOKEN: "   " })).state).toBe("nicht eingerichtet");
  });

  it("the core alone is 'bereit'; optional areas stay 'nicht eingerichtet' (they do not run), a half-set area is 'unvollständig'", () => {
    expect(evaluateEnv(get(core)).verdict).toBe("bereit");
    expect(evaluateEnv(get({ ...core, RESEND_API_KEY: "x" })).verdict).toBe("unvollständig");
    const half = evaluateEnv(get({ ...core, STRIPE_SECRET_KEY: "x", STRIPE_PRICE_PRO_MONTHLY: "price_1" }));
    expect(half.groups.find((g) => g.id === "billing")).toMatchObject({ state: "teilweise", missing: ["STRIPE_WEBHOOK_SECRET"] });
    const full = evaluateEnv(get({ ...core, STRIPE_SECRET_KEY: "x", STRIPE_WEBHOOK_SECRET: "w", STRIPE_PRICE_TEAM_YEARLY: "price_2" }));
    expect(full.groups.find((g) => g.id === "billing")?.state).toBe("eingerichtet");
    expect(full.functions.find((f) => f.fn === "billing-checkout")?.state).toBe("eingerichtet");
  });

  it("a function is blocked by every group it needs and shows its switch", () => {
    const r = evaluateEnv(get({ ...core, KILL_CHECKOUT: "true" }));
    const f = r.functions.find((x) => x.fn === "billing-checkout")!;
    expect(f).toMatchObject({ state: "teilweise", blockedBy: ["billing"], switchedOff: true });
    expect(r.functions.find((x) => x.fn === "stock-quote")).toMatchObject({ state: "eingerichtet", blockedBy: [] });
  });

  it("typos of our names are reported; foreign names (SDK variables) are not", () => {
    const r = evaluateEnv(get({}), ["STRIPE_SECRET_KY", "SUPABASE_SECRT_KEY", "ANTHROPIC_BASE_URL", "PATH", "HOME", "EXCHANGE_ENC_KEY_V2", "OPS_TOKEN"]);
    expect(r.unknown).toEqual(["STRIPE_SECRET_KY", "SUPABASE_SECRT_KEY"]);
  });
});
