// @vitest-environment node
/**
 * Security round 11, package C – no server secret in the client bundle.
 * - `checkPublicKey` / `cloudConfig`: only `sb_publishable_…` and `anon` JWTs are public keys;
 * - `scripts/secretGuard.ts`: unit checks of the variable and bundle scans, and REAL Vite builds of a tiny page – a `service_role`
 *   key in `VITE_SUPABASE_PUBLISHABLE_KEY`, a secret-named `VITE_` variable and a secret literal in the code all abort the build,
 *   a publishable key builds.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { checkPublicKey, jwtPayload } from "@/cloud/publicKey";
import { cloudConfig } from "@/cloud/env";
import { checkViteEnv, findSecrets, secretGuard } from "../../scripts/secretGuard.ts";

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ iss: "supabase", ref: "abcdefghij", role, exp: 2_000_000_000 })}.c2lnbmF0dXJlc2lnbmF0dXJl`;
const SERVICE_ROLE = jwt("service_role");
const ANON = jwt("anon");
const SB_SECRET = "sb_secret_" + "a1B2c3D4e5F6g7H8i9J0";

describe("public key check", () => {
  it("accepts the publishable key and the legacy anon JWT, refuses everything else", () => {
    expect(checkPublicKey("sb_publishable_AbC123_-x")).toEqual({ ok: true });
    expect(checkPublicKey(ANON)).toEqual({ ok: true });
    expect(checkPublicKey(SB_SECRET)).toMatchObject({ ok: false });
    expect(checkPublicKey(SERVICE_ROLE)).toMatchObject({ ok: false });
    expect(checkPublicKey(jwt("authenticated"))).toMatchObject({ ok: false });
    expect(checkPublicKey("")).toMatchObject({ ok: false });
    expect(checkPublicKey("p")).toMatchObject({ ok: false });
    expect(checkPublicKey("sb_publishable_ has space")).toMatchObject({ ok: false });
    expect(jwtPayload("a.b")).toBeNull();
    expect(jwtPayload("x.@@@.y")).toBeNull();
    expect(jwtPayload(SERVICE_ROLE)).toMatchObject({ role: "service_role" });
  });

  it("cloudConfig never hands a secret key to the Supabase client (cloud stays off)", () => {
    const url = "https://abc.supabase.co";
    expect(cloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" })).toEqual({ url, publishableKey: "sb_publishable_x" });
    expect(cloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: ANON })).toMatchObject({ url });
    expect(cloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: SB_SECRET })).toBeNull();
    expect(cloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: SERVICE_ROLE })).toBeNull();
  });
});

describe("secret scans", () => {
  it("findSecrets knows the shapes (and not a bare prefix in an error message)", () => {
    expect(findSecrets(`const k="${SB_SECRET}"`)).toHaveLength(1);
    expect(findSecrets(`x="${SERVICE_ROLE}"`)).toEqual(['Supabase-JWT mit der Rolle „service_role“']);
    expect(findSecrets(`x="${ANON}"`)).toEqual([]);
    expect(findSecrets("sk_live_" + "A".repeat(24))).toHaveLength(1);
    expect(findSecrets("whsec_" + "b".repeat(24))).toHaveLength(1);
    expect(findSecrets("-----BEGIN " + "PRIVATE KEY-----")).toHaveLength(1);
    expect(findSecrets("sk-ant-" + "api03-" + "x".repeat(40))).toHaveLength(1);
    expect(findSecrets('"Schlüssel beginnt mit sb_secret_ – nie ins Frontend", "ANTHROPIC_API_KEY", sk_live_')).toEqual([]);
  });

  it("checkViteEnv names the variable, never prints the value", () => {
    expect(checkViteEnv({ VITE_SUPABASE_URL: "https://a.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", MODE: "production" })).toEqual([]);
    const p = checkViteEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: SERVICE_ROLE, VITE_STRIPE_SECRET_KEY: "x", VITE_FOO: SB_SECRET, VITE_LEGAL_PRIVATE_NOTE: "n" });
    expect(p).toHaveLength(4);
    expect(p.join("\n")).not.toContain(SERVICE_ROLE);
    expect(p.join("\n")).not.toContain(SB_SECRET);
    expect(p[0]).toMatch(/^VITE_SUPABASE_PUBLISHABLE_KEY:/);
    // an unset / empty publishable key is "cloud off", not a leak
    expect(checkViteEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: "" })).toEqual([]);
  });
});

describe("real Vite builds of a tiny page", () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

  /** Builds a one-file page with the guard; `env` goes into a `.env` file, `code` into the module. Resolves on success, rejects with the guard's message. */
  async function buildPage(env: Record<string, string>, code = 'console.log("hello");'): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), "tj-secret-guard-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "index.html"), '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>');
    writeFileSync(join(root, "src", "main.js"), code);
    writeFileSync(join(root, ".env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
    await build({ root, configFile: false, logLevel: "silent", mode: "production", plugins: [secretGuard()], build: { write: false, minify: false } });
  }

  it("builds with a publishable key and with no key at all", async () => {
    await expect(buildPage({ VITE_SUPABASE_URL: "https://a.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ok" }, 'console.log(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);')).resolves.toBeUndefined();
    await expect(buildPage({})).resolves.toBeUndefined();
  }, 60_000);

  it("a service_role key in VITE_SUPABASE_PUBLISHABLE_KEY aborts the build (and the message does not print it)", async () => {
    const err = await buildPage({ VITE_SUPABASE_URL: "https://a.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: SERVICE_ROLE }, "console.log(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);").then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toMatch(/Secret-Guard/);
    expect(err?.message).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(err?.message).not.toContain(SERVICE_ROLE);
  }, 60_000);

  it("a secret-named VITE_ variable aborts the build", async () => {
    await expect(buildPage({ VITE_SUPABASE_SECRET_KEY: "whatever" })).rejects.toThrow(/VITE_SUPABASE_SECRET_KEY/);
  }, 60_000);

  it("a secret that reaches the bundle another way (a literal in the code) aborts the build and names the file", async () => {
    const err = await buildPage({}, `export const k = "${SB_SECRET}";\nconsole.log(k);`).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toMatch(/Secret-Guard/);
    expect(err?.message).toMatch(/assets\/.*\.js/);
    expect(err?.message).not.toContain(SB_SECRET);
  }, 60_000);
});
