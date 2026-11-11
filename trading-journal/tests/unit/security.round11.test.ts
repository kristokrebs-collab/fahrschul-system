// @vitest-environment node
/// <reference types="node" />
/**
 * Sicherheits-Fixpaket Runde 11, Paket A: the parts that need no HTTP harness of their own – the versioned pepper ring (recovery codes and
 * hashes survive a rotation, production never keys anything with a public constant), key rotation over EVERY table of the key family
 * (phone numbers and TradingView-MCP tokens, not only the exchange keys), the server-wide daily budgets (fail closed) and the phone number
 * rules (allowlist, premium ranges). Each test names what the review found; the HTTP-level behaviour sits next to the function's own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCountryList, parsePhone, DEFAULT_PHONE_COUNTRIES } from "@/domain/alerts/phone";
import { alertLimits } from "../../netlify/functions/_lib/alerts/limits";
import { exchangePlanState } from "../../netlify/functions/_lib/exchanges/api";
import { hashIp, pepperConfigured, pepperRing, purposeKey, purposeKeys } from "../../netlify/functions/_lib/audit";
import { AI_DAILY_DEFAULT, budgetMax, enforceBudget, SMS_DAILY_DEFAULT } from "../../netlify/functions/_lib/budget";
import { decrypt, encrypt, keyringFromEnv } from "../../netlify/functions/_lib/crypto";
import { consumeRecovery, generateRecovery, hashCode } from "../../netlify/functions/_lib/mfaRecovery";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { fakeAdmin, newState, type AdminState } from "./adminFake.harness";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const KEY1 = Buffer.alloc(32, 1).toString("base64");
const KEY2 = Buffer.alloc(32, 2).toString("base64");

let state: AdminState;
beforeEach(() => {
  state = newState({ tables: { mfa_recovery_codes: [], app_config: [] } });
  fakeAdmin(state);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  for (const k of ["IP_HASH_PEPPER", "IP_HASH_PEPPER_V2", "IP_HASH_PEPPER_V3", "SUPABASE_SECRET_KEY", "CONTEXT", "ALLOW_UNGATED"]) vi.stubEnv(k, "");
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the pepper ring (Linse 3 #9)", () => {
  it("outside production the fixed local key is the last resort; IN production it never exists – a public constant must key nothing", () => {
    expect(pepperRing()).toEqual(["tj-local-only"]);
    vi.stubEnv("CONTEXT", "production");
    expect(pepperRing()).toEqual([]);
    expect(pepperConfigured()).toBe(false);
    // no key at all in production: pseudonyms are refused (500 server_misconfigured), never made with a guessable key
    expect(() => hashIp("1.2.3.4")).toThrowError(/nicht vollständig eingerichtet/);
    expect(() => purposeKey("mfa-recovery")).toThrow();
  });

  it("versions: V<n> newest first, then V1 (IP_HASH_PEPPER), then the key derived from the Supabase secret (to CHECK old codes only)", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    vi.stubEnv("IP_HASH_PEPPER", "pepper-one");
    vi.stubEnv("IP_HASH_PEPPER_V2", "pepper-two");
    vi.stubEnv("IP_HASH_PEPPER_V3", "pepper-three");
    const ring = pepperRing();
    expect(ring.slice(0, 3)).toEqual(["pepper-three", "pepper-two", "pepper-one"]);
    expect(ring).toHaveLength(5); // + derived + local (not production)
    expect(pepperConfigured()).toBe(true);
    expect(purposeKeys("trial-email")).toHaveLength(5);
    expect(purposeKeys("trial-email")[0]).toBe(purposeKey("trial-email")); // new hashes use the newest
    expect(new Set(purposeKeys("trial-email")).size).toBe(5);
    // the pseudonym of an address follows the newest key
    const a = hashIp("1.2.3.4");
    vi.stubEnv("IP_HASH_PEPPER_V3", "");
    expect(hashIp("1.2.3.4")).not.toBe(a);
  });
});

describe("2FA recovery codes survive a pepper rotation (Linse 3 #9)", () => {
  it("codes made under V1 still work after V2 is added; new sets are made under V2; removing V1 later is the operator's informed decision", async () => {
    vi.stubEnv("IP_HASH_PEPPER", "pepper-one");
    const first = await generateRecovery(U1);
    expect(first.codes).toHaveLength(8);
    vi.stubEnv("IP_HASH_PEPPER_V2", "pepper-two");
    // an old code is accepted (single use) …
    expect(await consumeRecovery(U1, first.codes[0]!)).toBe(true);
    expect(await consumeRecovery(U1, first.codes[0]!)).toBe(false); // … and only once
    // a NEW set is hashed with V2: its hash is not the V1 one
    const second = await generateRecovery(U1);
    const stored = (state.tables.mfa_recovery_codes![0]!.codes as { h: string }[])[0]!.h;
    expect(stored).toBe(hashCode(U1, second.codes[0]!.replace("-", "")));
    vi.stubEnv("IP_HASH_PEPPER_V2", "");
    expect(hashCode(U1, second.codes[0]!.replace("-", ""))).not.toBe(stored); // under V1 alone it would not match any more
    vi.stubEnv("IP_HASH_PEPPER_V2", "pepper-two");
    expect(await consumeRecovery(U1, second.codes[1]!)).toBe(true);
  });

  it("codes made BEFORE any explicit pepper (key derived from the Supabase secret) keep working once IP_HASH_PEPPER is set", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const legacy = await generateRecovery(U1); // no IP_HASH_PEPPER yet: the old way
    vi.stubEnv("IP_HASH_PEPPER", "pepper-new");
    expect(await consumeRecovery(U1, legacy.codes[2]!)).toBe(true);
    // while a stranger's code of the same shape never matches
    expect(await consumeRecovery(U1, "AAAAA-BBBBB")).toBe(false);
  });

  it("IN PRODUCTION there are no NEW codes without the operator's own pepper (a derived key would die with a Supabase secret rotation)", async () => {
    vi.stubEnv("CONTEXT", "production");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    await expect(generateRecovery(U1)).rejects.toMatchObject({ status: 503, code: "recovery_unavailable" });
    expect(state.tables.mfa_recovery_codes).toEqual([]);
    vi.stubEnv("IP_HASH_PEPPER", "pepper-one");
    const ok = await generateRecovery(U1);
    expect(ok.codes).toHaveLength(8);
    // and old codes made without a pepper are still checkable in production through the derived key
    expect(await consumeRecovery(U1, ok.codes[0]!)).toBe(true);
  });
});

describe("key rotation covers phone numbers and TradingView tokens, not only the exchange keys (Linse 3 #2)", () => {
  const aad = { phone: (u: string) => `${u}:alert-phone:number`, tvAccess: (u: string) => `${u}:tv-mcp:access`, tvRefresh: (u: string) => `${u}:tv-mcp:refresh` };

  beforeEach(() => {
    vi.stubEnv("EXCHANGE_ENC_KEY_V1", KEY1);
    vi.stubEnv("EXCHANGE_ENC_KEY_V2", "");
    vi.doMock("../../netlify/functions/_lib/exchanges/store", () => ({ rotateStaleConnections: async () => ({ rotated: 1, failed: 0, remaining: 0 }) }));
  });
  afterEach(() => vi.doUnmock("../../netlify/functions/_lib/exchanges/store"));

  it("everything on the old key moves to the new one, `remaining` counts ALL tables – only 0 means V1 may go; afterwards V1 alone is no longer needed", async () => {
    state.tables.alert_phone_secrets = [
      { user_id: U1, number_enc: encrypt("+491701234567", aad.phone(U1)), verified: true },
      { user_id: U2, number_enc: encrypt("+491709999999", aad.phone(U2)), verified: true },
    ];
    state.tables.tv_mcp_connections = [{ user_id: U1, access_enc: encrypt("at", aad.tvAccess(U1)), refresh_enc: encrypt("rt", aad.tvRefresh(U1)), status: "active" }];
    const { rotateAllStaleSecrets } = await import("../../netlify/functions/_lib/keyRotation");
    vi.stubEnv("EXCHANGE_ENC_KEY_V2", KEY2);
    // before the sweep: the old sweep would have reported remaining 0 (exchange keys only) – the phone / TV rows still sit on V1
    const sweep = await rotateAllStaleSecrets(50);
    expect(sweep).toEqual({ rotated: 1 + 2 + 1, failed: 0, remaining: 0 });
    for (const r of state.tables.alert_phone_secrets!) expect(String(r.number_enc)).toMatch(/^v2:/);
    const tv = state.tables.tv_mcp_connections![0]!;
    expect(String(tv.access_enc)).toMatch(/^v2:/);
    expect(String(tv.refresh_enc)).toMatch(/^v2:/);
    // V1 removed: everything still opens with its own AAD
    vi.stubEnv("EXCHANGE_ENC_KEY_V1", "");
    const ring = keyringFromEnv();
    expect(decrypt(String(state.tables.alert_phone_secrets![0]!.number_enc), aad.phone(U1), ring)).toBe("+491701234567");
    expect(decrypt(String(tv.refresh_enc), aad.tvRefresh(U1), ring)).toBe("rt");
  });

  it("a blob that no longer opens (its key is gone) is counted as failed and stays – never overwritten, never guessed; the batch limit leaves the rest for the next run", async () => {
    const { rotateAllStaleSecrets } = await import("../../netlify/functions/_lib/keyRotation");
    state.tables.alert_phone_secrets = [
      { user_id: U1, number_enc: encrypt("+491701234567", aad.phone(U1)), verified: true },
      { user_id: U2, number_enc: "v7:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA", verified: true },
    ];
    state.tables.tv_mcp_connections = [];
    vi.stubEnv("EXCHANGE_ENC_KEY_V2", KEY2);
    const one = await rotateAllStaleSecrets(1);
    expect(one.rotated + one.failed).toBeGreaterThanOrEqual(2); // the exchange mock's 1 plus one phone row
    const sweep = await rotateAllStaleSecrets(50);
    expect(sweep.failed).toBe(1);
    expect(sweep.remaining).toBe(1); // the undecryptable one is still on an old version: V-old must NOT be removed yet
    expect(String(state.tables.alert_phone_secrets![1]!.number_enc)).toBe("v7:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA");
  });

  it("a row whose AAD does not fit (copied to another user) fails closed, it is not re-encrypted under the wrong binding", async () => {
    const { rotateAllStaleSecrets } = await import("../../netlify/functions/_lib/keyRotation");
    state.tables.alert_phone_secrets = [{ user_id: U2, number_enc: encrypt("+491701234567", aad.phone(U1)), verified: true }]; // sealed for U1, sits in U2's row
    state.tables.tv_mcp_connections = [];
    vi.stubEnv("EXCHANGE_ENC_KEY_V2", KEY2);
    const sweep = await rotateAllStaleSecrets(50);
    expect(sweep.failed).toBe(1);
    expect(String(state.tables.alert_phone_secrets![0]!.number_enc)).toMatch(/^v1:/);
  });
});

describe("server-wide daily budgets fail closed (Linse 1 #3, Linse 3 #1)", () => {
  it("defaults: 2000 AI calls and 100 verification SMS a day; the environment sets them; 0 shuts the area", () => {
    expect(budgetMax("ai")).toBe(AI_DAILY_DEFAULT);
    expect(budgetMax("sms")).toBe(SMS_DAILY_DEFAULT);
    vi.stubEnv("AI_DAILY_MAX", "10");
    vi.stubEnv("ALERT_SMS_DAILY_MAX", "0");
    expect(budgetMax("ai")).toBe(10);
    expect(budgetMax("sms")).toBe(0);
  });

  it("the n-th use of the day passes, the one after is 503 with Retry-After to the next UTC day; the counter is ONE key over all accounts", async () => {
    vi.stubEnv("AI_DAILY_MAX", "2");
    const now = Date.parse("2026-11-07T20:00:00Z");
    state.rate = 2;
    await expect(enforceBudget("ai", now)).resolves.toBeUndefined();
    state.rate = 3;
    await expect(enforceBudget("ai", now)).rejects.toMatchObject({ status: 503, code: "budget_exhausted", headers: { "retry-after": String(4 * 3600) } });
    expect(new Set(state.rateKeys)).toEqual(new Set(["budget-ai-day"]));
  });

  it("if the counter cannot be read the use is refused (fail closed), unlike an ordinary rate limit", async () => {
    const client = fakeAdmin(state);
    client.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(enforceBudget("sms")).rejects.toMatchObject({ status: 503, code: "budget_exhausted" });
  });
});

describe("phone numbers: allowlist and premium ranges (Linse 1 #7, Linse 3 #1)", () => {
  it("the default list is DACH, the EU / EEA, the UK and North America; the operator's list replaces it; junk entries are ignored", () => {
    expect(parseCountryList(undefined)).toBe(DEFAULT_PHONE_COUNTRIES);
    expect(parseCountryList("")).toBe(DEFAULT_PHONE_COUNTRIES);
    expect(parseCountryList("garbage, ++, 0, 12345")).toBe(DEFAULT_PHONE_COUNTRIES);
    expect(parseCountryList("49, +43 ;41, 0041, 1234567")).toEqual(["49", "43", "41"]);
    for (const c of ["49", "43", "41", "33", "39", "44", "1", "353"]) expect(DEFAULT_PHONE_COUNTRIES).toContain(c);
    for (const c of ["7", "81", "86", "234", "55", "91"]) expect(DEFAULT_PHONE_COUNTRIES).not.toContain(c);
  });

  it("without a list every country parses (the browser's pre-check); with the server's list only the allowed ones do", () => {
    expect(parsePhone("+81 3 1234 5678")).toEqual({ ok: true, e164: "+81312345678" });
    expect(parsePhone("+81 3 1234 5678", { countries: DEFAULT_PHONE_COUNTRIES })).toEqual({ ok: false, problem: "country" });
    expect(parsePhone("+49 170 1234567", { countries: DEFAULT_PHONE_COUNTRIES })).toEqual({ ok: true, e164: "+491701234567" });
    expect(parsePhone("+43 664 1234567", { countries: ["49"] })).toEqual({ ok: false, problem: "country" });
    // a calling code is matched as a prefix of the digits (codes are prefix-free, so this is exact)
    expect(parsePhone("+351 912 345 678", { countries: ["351"] })).toMatchObject({ ok: true });
    expect(parsePhone("+351 912 345 678", { countries: ["49", "43"] })).toEqual({ ok: false, problem: "country" });
  });

  it.each([
    ["+49 900 1234567", "Germany 0900"],
    ["+49 137 1234567", "Germany 0137 mass traffic"],
    ["+49 180 1234567", "Germany 0180 shared cost"],
    ["+49 700 12345678", "Germany personal numbers"],
    ["+44 909 8790000", "UK 09xx"],
    ["+44 870 1234567", "UK 087x"],
    ["+43 900 123456", "Austria 0900"],
    ["+41 900 123 456", "Switzerland 0900"],
    ["+33 891 123 456", "France 089x"],
    ["+39 899 123456", "Italy 899"],
    ["+34 806 123456", "Spain 806"],
    ["+31 900 1234567", "Netherlands 0900"],
    ["+1 900 555 0123", "NANP 900"],
    ["+1 876 555 0123", "Jamaica"],
    ["+1 809 555 0123", "Dominican Republic"],
    ["+1 787 555 0123", "Puerto Rico"],
    ["+1 671 555 0123", "Guam"],
  ])("refuses %s (%s) in every case, with or without the allowlist", (number) => {
    expect(parsePhone(number)).toEqual({ ok: false, problem: "premium" });
    expect(parsePhone(number, { countries: DEFAULT_PHONE_COUNTRIES })).toEqual({ ok: false, problem: "premium" });
  });

  it("ordinary mobile and landline numbers of the allowed countries are not caught by the premium list", () => {
    for (const n of ["+49 170 1234567", "+49 30 1234567", "+49 89 1234567", "+43 664 1234567", "+41 79 123 45 67", "+44 7700 900123", "+33 6 12 34 56 78", "+1 415 555 2671", "+1 212 555 0100", "+1 416 555 0100", "+31 6 12345678", "+34 612 345 678"]) {
      expect(parsePhone(n, { countries: DEFAULT_PHONE_COUNTRIES }), n).toMatchObject({ ok: true });
    }
  });
});

describe("a production deploy without Stripe closes the phone and the exchange gates too (Linse 1 #10)", () => {
  const profile = { plan: "free", plan_status: "none", trial_end: null };
  beforeEach(() => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: profile, error: null }) };
    setSupabaseAdminForTests({ from: () => q } as never);
    for (const k of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PREMIUM_MONTHLY"]) vi.stubEnv(k, "");
  });

  it("development / preview without Stripe: calls follow Premium's limits (the app is open); production: the real plan (Free: no calls, one channel)", () => {
    expect(alertLimits("free")).toEqual({ alertChannels: 3, phoneCallsPerMonth: 30 });
    vi.stubEnv("CONTEXT", "production");
    expect(alertLimits("free")).toEqual({ alertChannels: 1, phoneCallsPerMonth: 0 });
    expect(alertLimits("premium").phoneCallsPerMonth).toBe(30);
    vi.stubEnv("ALLOW_UNGATED", "true");
    expect(alertLimits("free").phoneCallsPerMonth).toBe(30); // the operator's deliberate decision
  });

  it("the exchange page state is gated in production without Stripe (one connection, no background sync), open elsewhere", async () => {
    expect(await exchangePlanState(U1)).toMatchObject({ gated: false, autoSync: true, limit: null });
    vi.stubEnv("CONTEXT", "production");
    expect(await exchangePlanState(U1)).toMatchObject({ gated: true, entitled: true, autoSync: false, limit: 1 });
  });
});
