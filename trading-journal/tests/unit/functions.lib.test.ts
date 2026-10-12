// @vitest-environment node
/// <reference types="node" />
/**
 * Netlify functions base library (`netlify/functions/_lib`, Wave-0 contract). Relative imports only – the functions
 * know no `@/` alias. The Supabase admin client is replaced by a fake via `setSupabaseAdminForTests`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { error, errorFrom, handler, HttpError, json, readJson, requireMethod, clientIp } from "../../netlify/functions/_lib/http";
import { env, envBool, envInt, envNumber, envOptional } from "../../netlify/functions/_lib/env";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { bearerToken, optionalUser, requireUser } from "../../netlify/functions/_lib/auth";
import { CryptoError, decrypt, encrypt, keyFromBase64, keyringFromEnv, keyVersionOf, last4, needsReencrypt, secretAad, type Keyring } from "../../netlify/functions/_lib/crypto";
import { enforceRateLimit, rateKey, rateLimit, windowReset } from "../../netlify/functions/_lib/rateLimit";
import { audit, hashIp, scrubMeta } from "../../netlify/functions/_lib/audit";
import { effectivePlan, planOf, requirePlan } from "../../netlify/functions/_lib/plan";

const ctx = {} as Parameters<ReturnType<typeof handler>>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-1111-1111-111111111111";

interface FakeOpts {
  claims?: Record<string, unknown> | null;
  factors?: { status: string }[] | null;
  rpc?: { data: unknown; error: unknown };
  profile?: Record<string, unknown> | null;
  insert?: (table: string, row: unknown) => { error: unknown } | Promise<never>;
}

function fakeAdmin(o: FakeOpts = {}) {
  const inserts: { table: string; row: unknown }[] = [];
  const client = {
    auth: {
      getClaims: vi.fn(async () =>
        o.claims ? { data: { claims: o.claims, header: {}, signature: new Uint8Array() }, error: null } : { data: null, error: { message: "bad jwt" } },
      ),
      admin: { mfa: { listFactors: vi.fn(async () => (o.factors === null ? { data: null, error: { message: "x" } } : { data: { factors: o.factors ?? [] }, error: null })) } },
    },
    rpc: vi.fn(async () => o.rpc ?? { data: 1, error: null }),
    from: (table: string) => ({
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return o.insert ? o.insert(table, row) : { error: null };
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.profile ?? null, error: null }) }) }),
    }),
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return { client, inserts };
}

const authed = (token = JWT): Request => new Request("https://x.test/api/v1/x", { headers: { authorization: `Bearer ${token}` } });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("_lib/http", () => {
  it("json() and error() answer with the shared envelope and no-store headers", async () => {
    const r = json({ a: 1 }, { status: 201, headers: { "x-extra": "1" } });
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-extra")).toBe("1");
    expect(await r.json()).toEqual({ a: 1 });
    const e = error(429, "rate_limited");
    expect(e.status).toBe(429);
    expect(await e.json()).toEqual({ error: { code: "rate_limited", message: "Zu viele Anfragen – bitte kurz warten." } });
  });

  it("handler() maps HttpError to its envelope and hides unexpected errors", async () => {
    const h1 = handler(() => {
      throw new HttpError(405, "method_not_allowed", undefined, undefined, { allow: "POST" });
    });
    const r1 = await h1(new Request("https://x.test"), ctx);
    expect(r1.status).toBe(405);
    expect(r1.headers.get("allow")).toBe("POST");
    const h2 = handler(async () => {
      throw new Error("db password leaked in message");
    });
    const r2 = await h2(new Request("https://x.test"), ctx);
    expect(r2.status).toBe(500);
    expect(JSON.stringify(await r2.json())).not.toContain("password");
    expect((await errorFrom(new HttpError(404, "nope")).json()).error.message).toBe("Nicht gefunden.");
  });

  it("requireMethod() throws 405 with Allow", () => {
    expect(() => requireMethod(new Request("https://x.test", { method: "GET" }), "POST")).toThrow(HttpError);
    expect(() => requireMethod(new Request("https://x.test", { method: "POST" }), "POST")).not.toThrow();
  });

  it("readJson() validates type, size, syntax and schema without echoing values", async () => {
    const schema = z.object({ symbol: z.string(), dryRun: z.boolean().optional() });
    const post = (body: string, type = "application/json") => new Request("https://x.test", { method: "POST", headers: { "content-type": type }, body });
    await expect(readJson(post('{"symbol":"BTCUSDT"}'), schema)).resolves.toEqual({ symbol: "BTCUSDT" });
    await expect(readJson(post("x=1", "application/x-www-form-urlencoded"), schema)).rejects.toMatchObject({ status: 415 });
    await expect(readJson(post("{oops"), schema)).rejects.toMatchObject({ status: 400, code: "invalid_json" });
    await expect(readJson(post(JSON.stringify({ symbol: "x".repeat(100) })), schema, { maxBytes: 50 })).rejects.toMatchObject({ status: 413 });
    const bad = await readJson(post('{"symbol":42,"secret":"s3cr3t"}'), schema).catch((e: unknown) => e as HttpError);
    expect(bad).toMatchObject({ status: 422, code: "invalid_body" });
    expect(JSON.stringify((bad as HttpError).details)).not.toContain("s3cr3t");
  });

  it("clientIp() prefers Netlify's header", () => {
    expect(clientIp(new Request("https://x.test", { headers: { "x-nf-client-connection-ip": "1.2.3.4" } }), { ip: "9.9.9.9" })).toBe("1.2.3.4");
    expect(clientIp(new Request("https://x.test"), { ip: "9.9.9.9" })).toBe("9.9.9.9");
    expect(clientIp(new Request("https://x.test"))).toBeNull();
  });
});

describe("_lib/env", () => {
  it("reads process.env, treats empty as unset and parses numbers / booleans", () => {
    vi.stubEnv("SITE_ORIGIN", "https://journal.test");
    vi.stubEnv("TRIAL_DAYS", "14");
    vi.stubEnv("LOG_SAMPLE_RATE", "0.25");
    vi.stubEnv("SYNC_CRON_ENABLED", "off");
    vi.stubEnv("COACH_MODEL", "");
    expect(env("SITE_ORIGIN")).toBe("https://journal.test");
    expect(envOptional("COACH_MODEL")).toBeUndefined();
    expect(envInt("TRIAL_DAYS", 7)).toBe(14);
    expect(envNumber("LOG_SAMPLE_RATE", 1)).toBe(0.25);
    expect(envBool("SYNC_CRON_ENABLED", true)).toBe(false);
    expect(envBool("COACH_MODEL", true)).toBe(true);
  });

  it("a missing required variable is a 500 without its name in the response", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    let err: unknown;
    try {
      env("STRIPE_SECRET_KEY");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 500, code: "server_misconfigured" });
    expect((err as Error).message).not.toContain("STRIPE");
  });
});

describe("_lib/crypto", () => {
  const ring = (current: number, ...versions: number[]): Keyring => ({ current, keys: new Map(versions.map((v) => [v, new Uint8Array(randomBytes(32))])) });

  it("round-trips with a fresh IV and the version prefix", () => {
    const r = ring(1, 1);
    const aad = secretAad(U1, "c0ffee", "secret");
    const a = encrypt("my-api-secret", aad, r);
    const b = encrypt("my-api-secret", aad, r);
    expect(a).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("my-api-secret");
    expect(decrypt(a, aad, r)).toBe("my-api-secret");
  });

  it("refuses a wrong AAD, a tampered blob and an unknown version", () => {
    const r = ring(1, 1);
    const blob = encrypt("s", secretAad(U1, "c1", "secret"), r);
    expect(() => decrypt(blob, secretAad(U1, "c2", "secret"), r)).toThrow(CryptoError);
    expect(() => decrypt(blob, secretAad(U1, "c1", "api_key"), r)).toThrow(CryptoError);
    const [v, iv, tag, ct] = blob.split(":") as [string, string, string, string];
    const flipped = Buffer.from(ct, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decrypt([v, iv, tag, flipped.toString("base64")].join(":"), secretAad(U1, "c1", "secret"), r)).toThrow(CryptoError);
    expect(() => decrypt(blob.replace(/^v1/, "v7"), secretAad(U1, "c1", "secret"), r)).toThrow(/unknown key version/);
    expect(() => decrypt("garbage", "x", r)).toThrow(/malformed/);
  });

  it("rotates: new blobs use the highest key, old blobs still decrypt", () => {
    const old = ring(1, 1);
    const blob = encrypt("s", "aad", old);
    const both: Keyring = { current: 2, keys: new Map([...old.keys, [2, new Uint8Array(randomBytes(32))]]) };
    expect(decrypt(blob, "aad", both)).toBe("s");
    expect(needsReencrypt(blob, both)).toBe(true);
    const fresh = encrypt("s", "aad", both);
    expect(keyVersionOf(fresh)).toBe(2);
    expect(needsReencrypt(fresh, both)).toBe(false);
  });

  it("builds the keyring from EXCHANGE_ENC_KEY_V<n> and checks the key length", () => {
    vi.stubEnv("EXCHANGE_ENC_KEY_V1", randomBytes(32).toString("base64"));
    vi.stubEnv("EXCHANGE_ENC_KEY_V3", randomBytes(32).toString("base64"));
    const r = keyringFromEnv();
    expect(r.current).toBe(3);
    expect([...r.keys.keys()]).toEqual([1, 3]);
    expect(decrypt(encrypt("x", "a"), "a")).toBe("x");
    expect(() => keyFromBase64(randomBytes(16).toString("base64"))).toThrow(CryptoError);
    vi.stubEnv("EXCHANGE_ENC_KEY_V1", "");
    vi.stubEnv("EXCHANGE_ENC_KEY_V3", "");
    expect(() => keyringFromEnv()).toThrow(CryptoError);
  });

  it("last4 never reveals short secrets", () => {
    expect(last4(" abcdefgh1234 ")).toBe("1234");
    expect(last4("short")).toBe("");
  });
});

describe("_lib/auth", () => {
  it("bearerToken() accepts only a JWT-shaped bearer", () => {
    expect(bearerToken(authed())).toBe(JWT);
    expect(bearerToken(new Request("https://x.test", { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(bearerToken(new Request("https://x.test", { headers: { authorization: "Bearer not-a-jwt" } }))).toBeNull();
    expect(bearerToken(new Request("https://x.test"))).toBeNull();
  });

  it("requireUser() returns the verified user", async () => {
    const { client } = fakeAdmin({ claims: { sub: U1, role: "authenticated", aal: "aal1", email: "a@x.test", session_id: "s1" } });
    await expect(requireUser(authed())).resolves.toEqual({ id: U1, email: "a@x.test", aal: "aal1", sessionId: "s1", jwt: JWT });
    expect(client.auth.getClaims).toHaveBeenCalledWith(JWT);
  });

  it("requireUser() rejects missing, invalid and anon tokens with 401", async () => {
    fakeAdmin({ claims: null });
    await expect(requireUser(new Request("https://x.test"))).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    await expect(requireUser(authed())).rejects.toMatchObject({ status: 401, code: "invalid_token" });
    fakeAdmin({ claims: { sub: "", role: "anon" } });
    await expect(requireUser(authed())).rejects.toMatchObject({ status: 401 });
    await expect(optionalUser(new Request("https://x.test"))).resolves.toBeNull();
  });

  it("aal2: required always, or only when a verified factor exists (fail closed)", async () => {
    fakeAdmin({ claims: { sub: U1, role: "authenticated", aal: "aal1" }, factors: [] });
    await expect(requireUser(authed(), { aal2: true })).rejects.toMatchObject({ status: 403, code: "mfa_required" });
    await expect(requireUser(authed(), { aal2: "ifEnrolled" })).resolves.toMatchObject({ aal: "aal1" });
    fakeAdmin({ claims: { sub: U1, role: "authenticated", aal: "aal1" }, factors: [{ status: "verified" }] });
    await expect(requireUser(authed(), { aal2: "ifEnrolled" })).rejects.toMatchObject({ status: 403 });
    fakeAdmin({ claims: { sub: U1, role: "authenticated", aal: "aal1" }, factors: null });
    await expect(requireUser(authed(), { aal2: "ifEnrolled" })).rejects.toMatchObject({ status: 403 });
    fakeAdmin({ claims: { sub: U1, role: "authenticated", aal: "aal2" }, factors: [{ status: "verified" }] });
    await expect(requireUser(authed(), { aal2: true })).resolves.toMatchObject({ aal: "aal2" });
  });
});

describe("_lib/rateLimit", () => {
  it("windowReset() buckets like rate_hit()", () => {
    expect(windowReset(125_000, 60)).toBe(180_000);
    expect(windowReset(120_000, 60)).toBe(180_000);
    expect(rateKey("exchange-connect", U1)).toBe(`exchange-connect:${U1}`);
  });

  it("counts via rpc and throws 429 with Retry-After when exceeded", async () => {
    const { client } = fakeAdmin({ rpc: { data: 3, error: null } });
    await expect(rateLimit("k", 5, 60, { now: 125_000 })).resolves.toEqual({ ok: true, limit: 5, count: 3, remaining: 2, resetAt: 180_000 });
    expect(client.rpc).toHaveBeenCalledWith("rate_hit", { p_key: "k", p_window_sec: 60 });
    fakeAdmin({ rpc: { data: 6, error: null } });
    const err = await enforceRateLimit("k", 5, 60, { now: 125_000 }).catch((e: unknown) => e as HttpError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", headers: { "retry-after": "55" } });
  });

  it("a database error fails open by default and closed on request", async () => {
    fakeAdmin({ rpc: { data: null, error: { code: "XX000" } } });
    expect((await rateLimit("k", 5, 60)).ok).toBe(true);
    expect((await rateLimit("k", 5, 60, { failClosed: true })).ok).toBe(false);
  });
});

describe("_lib/audit", () => {
  it("scrubs secret-looking keys at any depth and hashes the IP", async () => {
    expect(scrubMeta({ exchange: "bitunix", apiKey: "k", nested: { secret_key: "s", ok: 1 }, list: [{ token: "t" }] })).toEqual({
      exchange: "bitunix",
      apiKey: "[redacted]",
      nested: { secret_key: "[redacted]", ok: 1 },
      list: [{ token: "[redacted]" }],
    });
    expect(hashIp("1.2.3.4")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp(null)).toBeNull();
    const { inserts } = fakeAdmin();
    await audit(U1, "exchange.connect", { exchange: "bitunix", secret: "s" }, "1.2.3.4");
    expect(inserts).toEqual([{ table: "audit_log", row: { user_id: U1, action: "exchange.connect", meta: { exchange: "bitunix", secret: "[redacted]" }, ip_hash: hashIp("1.2.3.4") } }]);
  });

  it("never throws", async () => {
    fakeAdmin({ insert: () => Promise.reject(new Error("db down")) });
    await expect(audit(null, "account.delete")).resolves.toBeUndefined();
  });
});

describe("_lib/plan", () => {
  it("effectivePlan(): a paid plan only counts while its status grants access", () => {
    expect(effectivePlan(null)).toEqual({ plan: "free", status: "none", trialEnd: null });
    expect(effectivePlan({ plan: "pro", plan_status: "trialing", trial_end: "2026-11-01T00:00:00Z" })).toEqual({ plan: "pro", status: "trialing", trialEnd: "2026-11-01T00:00:00Z" });
    expect(effectivePlan({ plan: "premium", plan_status: "canceled", trial_end: null })).toEqual({ plan: "free", status: "canceled", trialEnd: null });
    expect(effectivePlan({ plan: "gold", plan_status: "active", trial_end: null }).plan).toBe("free");
    expect(effectivePlan({ plan: "team", plan_status: "past_due", trial_end: null, seats: 5 })).toEqual({ plan: "team", status: "past_due", trialEnd: null, seats: 5 });
  });

  it("planOf() reads profiles; requirePlan() throws 402", async () => {
    fakeAdmin({ profile: { plan: "pro", plan_status: "active", trial_end: null } });
    await expect(planOf(U1)).resolves.toEqual({ plan: "pro", status: "active", trialEnd: null });
    await expect(requirePlan(U1, ["pro", "premium"])).resolves.toMatchObject({ plan: "pro" });
    await expect(requirePlan(U1, ["premium"])).rejects.toMatchObject({ status: 402, code: "plan_required" });
    fakeAdmin({ profile: null });
    await expect(planOf(U1)).resolves.toMatchObject({ plan: "free" });
  });
});
