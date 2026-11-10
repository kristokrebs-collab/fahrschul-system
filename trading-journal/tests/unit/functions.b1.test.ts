// @vitest-environment node
/// <reference types="node" />
/**
 * B1 + C4 server side: deletion vs. subscription end (plan, acknowledgement, verified bucket cleanup), the export's
 * screenshot hash list, recovery codes for the second factor, the emergency switches and the operator status. Fake
 * Supabase / fetch only – nothing talks to a real service (documented in `docs/BETRIEB.md`).
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStripeForTests } from "../../netlify/functions/_lib/billingCleanup";
import { ENV_SPEC } from "../../netlify/functions/_lib/envSpec";
import { probeTesting } from "../../netlify/functions/_lib/opsProbes";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { sendMail, SEND_MESSAGE } from "../../netlify/functions/_lib/alertWatch/mail";
import { assertRunning, switchStates } from "../../netlify/functions/_lib/killswitch";
import { reasonText } from "../../src/domain/alerts/delivery";
import { hashCode, normalizeCode, formatCode } from "../../netlify/functions/_lib/mfaRecovery";
import accountDelete from "../../netlify/functions/account-delete.mts";
import accountExport from "../../netlify/functions/account-export.mts";
import accountMfaRecovery from "../../netlify/functions/account-mfa-recovery.mts";
import billingCheckout from "../../netlify/functions/billing-checkout.mts";
import coachAsk from "../../netlify/functions/coach-ask.mts";
import exchangeConnect from "../../netlify/functions/exchange-connect.mts";
import { runExchangeCron } from "../../netlify/functions/exchange-sync-cron.mts";
import opsFlags, { flagsTesting } from "../../netlify/functions/ops-flags.mts";
import opsStatus, { opsTesting, OPS_MAX_FAILURES } from "../../netlify/functions/ops-status.mts";
import { fakeAdmin, newState, type AdminState } from "./adminFake.harness";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof accountDelete>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const req = (path: string, init: RequestInit = {}) => new Request(`https://x.test${path}`, { ...init, headers: { authorization: `Bearer ${JWT}`, ...(init.headers as Record<string, string> | undefined) } });
const post = (path: string, body: unknown) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let state: AdminState;
function base(over: Partial<AdminState> = {}): AdminState {
  return newState({
    claims: { sub: U1, role: "authenticated", email: "a@b.de", aal: "aal1", session_id: "s1" },
    tables: {
      profiles: [{ id: U1, plan: "free", plan_status: "none", trial_end: null, privacy: {} }],
      journal_docs: [
        { user_id: U1, kind: "trade", id: "t_1", data: { id: "t_1" }, deleted: false },
        { user_id: U1, kind: "trade", id: "t_2", data: { id: "t_2" }, deleted: false },
        { user_id: U1, kind: "day", id: "2026-10-10", data: { note: "x" }, deleted: false },
        { user_id: U2, kind: "trade", id: "t_9", data: { id: "t_9" }, deleted: false },
      ],
      audit_log: [],
      app_config: [],
      mfa_recovery_codes: [],
      app_errors: [],
      exchange_connections: [],
    },
    storage: { screenshots: [{ name: `${U1}/t_1/a.png`, body: "png" }, { name: `${U2}/b.png`, body: "png" }], backups: [{ name: `${U1}/2026-10-01.json`, body: "{}" }] },
    ...over,
  });
}

const ENV_NAMES = ENV_SPEC.map((e) => e.name);
beforeEach(() => {
  for (const n of ENV_NAMES) vi.stubEnv(n, "");
  state = base();
  fakeAdmin(state);
  opsTesting.clear();
  flagsTesting.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  setStripeForTests(null);
  probeTesting.fetch = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------------ deletion vs. subscription end (tests 5, 6) */

describe("account-delete: plan first, subscription acknowledged, bucket verified", () => {
  it("GET answers the plan: no subscription → state none, the data it would touch, the confirm word", async () => {
    const r = await accountDelete(req("/api/v1/account/delete"), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ confirmWord: "LÖSCHEN", subscription: { state: "none", plan: "free" }, data: { trades: 2, hyblock: 0, days: 1, screenshots: 1, backups: 1 } });
  });

  it("GET needs a signed-in user", async () => {
    const r = await accountDelete(new Request("https://x.test/api/v1/account/delete"), ctx);
    expect(r.status).toBe(401);
  });

  it("a running subscription is `running`, one already cancelled is `ending` with the period end, a failed payment is `issue`", async () => {
    const sub = (over: object) => ({ id: "sub_1", user_id: U1, status: "active", plan: "pro", current_period_end: "2026-12-01T00:00:00Z", cancel_at_period_end: false, updated_at: "2026-10-01T00:00:00Z", ...over });
    state.tables.subscriptions = [sub({})];
    expect((await (await accountDelete(req("/api/v1/account/delete"), ctx)).json()).subscription).toMatchObject({ state: "running", plan: "pro", cancelAtPeriodEnd: false });
    state.tables.subscriptions = [sub({ cancel_at_period_end: true })];
    expect((await (await accountDelete(req("/api/v1/account/delete"), ctx)).json()).subscription).toMatchObject({ state: "ending", currentPeriodEnd: "2026-12-01T00:00:00Z", cancelAtPeriodEnd: true });
    state.tables.subscriptions = [sub({ status: "past_due" })];
    expect((await (await accountDelete(req("/api/v1/account/delete"), ctx)).json()).subscription.state).toBe("issue");
    state.tables.subscriptions = [sub({ status: "canceled" })];
    expect((await (await accountDelete(req("/api/v1/account/delete"), ctx)).json()).subscription.state).toBe("none");
  });

  it("the server refuses to delete a running subscription without the acknowledgement – nothing is touched", async () => {
    state.tables.subscriptions = [{ id: "sub_1", user_id: U1, status: "active", plan: "pro", current_period_end: null, cancel_at_period_end: false, updated_at: "x" }];
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx);
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("subscription_ack_required");
    expect(state.deleted).toEqual([]);
    expect(state.storage.screenshots).toHaveLength(2);
  });

  it("deletes completely: both buckets empty, recovery codes gone, auth user deleted, nothing left over", async () => {
    state.tables.app_config = [{ key: `mfa-recovery:${U1}`, value: { v: 1 }, updated_at: "x" }, { key: `mfa-recovery:${U2}`, value: { v: 1 }, updated_at: "x" }];
    state.tables.mfa_recovery_codes = [{ user_id: U1, codes: [] }, { user_id: U2, codes: [] }];
    state.storage.screenshots!.push({ name: `${U1}/t_2/deep/b.webp`, body: "x" });
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "löschen" }), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ deleted: true, files: { screenshots: 2, backups: 1 }, leftovers: {} });
    expect(state.storage.screenshots!.map((o) => o.name)).toEqual([`${U2}/b.png`]);
    expect(state.storage.backups).toEqual([]);
    expect(state.tables.app_config!.map((r) => r.key)).toEqual([`mfa-recovery:${U2}`]);
    expect(state.tables.mfa_recovery_codes!.map((r) => r.user_id)).toEqual([U2]);
    expect(state.deleted).toEqual([U1]);
    expect(state.tables.journal_docs!.every((r) => r.user_id === U2)).toBe(true);
  });

  it("a stuck file stops the deletion: the account stays, the answer says so (never 'erased' half-way)", async () => {
    state.stuck = [`${U1}/t_1/a.png`];
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx);
    expect(r.status).toBe(502);
    expect((await r.json()).error.code).toBe("storage_cleanup_incomplete");
    expect(state.deleted).toEqual([]);
    expect(state.tables.journal_docs!.some((r) => r.user_id === U1)).toBe(true);
  });

  it("rows that survive the cascade are reported (a hole in the cascade is visible)", async () => {
    // the fake's deleteUser only knows `user_id` / `id` / `owner_id`; a table keyed differently stays behind
    state.tables.referrals = [{ referrer_id: U1, code: "X" }];
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx);
    expect(r.status).toBe(200);
    expect((await r.json()).leftovers).toEqual({ referrals: 1 });
  });
});

/* ------------------------------------------------------------------ export: screenshot hash list (test 6) */

describe("account-export: screenshot hash list", () => {
  it("lists every picture with the recorded and the server hash, orphans, missing files and device-only pictures", async () => {
    const png = sha("png");
    state.tables.journal_docs = [
      {
        user_id: U1,
        kind: "trade",
        id: "t_1",
        deleted: false,
        data: {
          id: "t_1",
          screenshots: [
            { id: "s1", store: "cloud", key: `${U1}/t_1/a.png`, sha256: png, bytes: 3, mime: "image/png", originalName: "a.png" },
            { id: "s2", store: "cloud", key: `${U1}/t_1/lost.png`, sha256: sha("x") },
            { id: "s3", store: "idb", key: "local-1", sha256: sha("only on device") },
            { id: "s4", store: "cloud", key: `${U1}/t_1/b.png`, sha256: sha("other bytes") },
          ],
        },
      },
    ];
    state.storage.screenshots = [{ name: `${U1}/t_1/a.png`, body: "png" }, { name: `${U1}/t_1/b.png`, body: "png" }, { name: `${U1}/orphan.png`, body: "z" }];
    const body = await (await accountExport(req("/api/v1/account/export"), ctx)).json();
    const byId = Object.fromEntries((body.screenshots.entries as { shotId: string }[]).map((e) => [e.shotId, e]));
    expect(byId.s1).toMatchObject({ tradeId: "t_1", name: "a.png", recordedSha256: png, serverSha256: png, match: true, inBucket: true, store: "cloud" });
    expect(byId.s2).toMatchObject({ inBucket: false, serverSha256: null, match: null });
    expect(byId.s3).toMatchObject({ store: "idb", inBucket: false, recordedSha256: sha("only on device"), match: null });
    expect(byId.s4).toMatchObject({ match: false, serverSha256: png });
    expect(body.screenshots.orphans).toEqual([`${U1}/orphan.png`]);
    expect(body.screenshots.missing).toEqual([`${U1}/t_1/lost.png`]);
    expect(body.screenshots.hashed).toBe(2);
    expect(JSON.stringify(body)).not.toContain(U2);
  });
});

/* ------------------------------------------------------------------ recovery codes (tests 3, 4) */

describe("account-mfa-recovery", () => {
  const factorOn = () => (state.factors = [{ id: "f1", status: "verified", factor_type: "totp" }]);
  const aal2 = () => (state.claims = { ...state.claims, aal: "aal2" });

  it("generate: needs 2FA on and the code step done; shows 8 codes once and stores only hashes", async () => {
    expect((await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "generate" }), ctx)).status).toBe(403); // aal1
    aal2();
    expect((await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "generate" }), ctx)).status).toBe(409); // no factor
    factorOn();
    const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "generate" }), ctx);
    expect(r.status).toBe(200);
    const { codes } = (await r.json()) as { codes: string[] };
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const stored = JSON.stringify(state.tables.mfa_recovery_codes);
    for (const c of codes) expect(stored).not.toContain(c.replace("-", ""));
    expect(stored).toContain(hashCode(U1, normalizeCode(codes[0]!)!));
    expect(state.tables.audit_log!.at(-1)).toMatchObject({ action: "auth.mfa.recovery.generate" });
    // the status never shows codes
    const s = await (await accountMfaRecovery(req("/api/v1/account/mfa-recovery"), ctx)).json();
    expect(s).toMatchObject({ total: 8, remaining: 8 });
    // a new set replaces the old one
    const again = (await (await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "generate" }), ctx)).json()) as { codes: string[] };
    expect(again.codes).not.toEqual(codes);
    expect(state.tables.mfa_recovery_codes!).toHaveLength(1);
    expect(state.tables.app_config).toEqual([]); // nothing lands in the old place once the table exists
  });

  it("migration path: a set in the old app_config row still works (consumed there); a NEW set goes to the table and removes the old row", async () => {
    aal2();
    factorOn();
    const old = ["ABCDEFGHJK", "LMNPQRSTUV"];
    const mk = (c: string) => ({ h: hashCode(U1, c), usedAt: null });
    state.tables.app_config = [{ key: `mfa-recovery:${U1}`, value: { v: 1, createdAt: "2026-01-01T00:00:00.000Z", codes: old.map(mk) }, updated_at: "2026-01-01T00:00:00.000Z" }];
    expect(await (await accountMfaRecovery(req("/api/v1/account/mfa-recovery"), ctx)).json()).toMatchObject({ total: 2, remaining: 2 });
    state.claims = { ...state.claims, aal: "aal1" };
    const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: "ABCDE-FGHJK" }), ctx);
    expect(r.status).toBe(200);
    expect(state.tables.app_config).toEqual([]); // the rest of the set is dropped with the reset
    // new set: table, old row gone
    state.tables.app_config = [{ key: `mfa-recovery:${U1}`, value: { v: 1, createdAt: "x", codes: old.map(mk) }, updated_at: "x" }];
    factorOn();
    aal2();
    await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "generate" }), ctx);
    expect(state.tables.mfa_recovery_codes).toHaveLength(1);
    expect(state.tables.app_config).toEqual([]);
  });

  it("migration pending (table missing): generate and redeem keep working through app_config", async () => {
    state.tables.mfa_recovery_codes = undefined;
    const codes = await setUp();
    expect(state.tables.app_config).toHaveLength(1);
    const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[0]! }), ctx);
    expect(r.status).toBe(200);
    expect(state.tables.app_config).toEqual([]);
  });

  async function setUp(): Promise<string[]> {
    aal2();
    factorOn();
    const codes = ((await (await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "generate" }), ctx)).json()) as { codes: string[] }).codes;
    state.claims = { ...state.claims, aal: "aal1" }; // the phone is gone: only the password session is left
    return codes;
  }

  it("redeem: a code works once with the password session, ends the factor, drops the set, and is audited", async () => {
    const codes = await setUp();
    const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[2]!.toLowerCase() }), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ factorsRemoved: 1 });
    expect(state.factors).toEqual([]);
    expect(state.tables.mfa_recovery_codes).toEqual([]);
    expect(state.tables.audit_log!.at(-1)).toMatchObject({ action: "auth.mfa.recovery.used", meta: { factorsRemoved: 1 } });
    // 2FA is off now: the same code (or any) answers "not active", the account works with the password
    const again = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[2]! }), ctx);
    expect(again.status).toBe(409);
  });

  it("redeem: a used code, a wrong code and junk all get the same generic answer; the set stays", async () => {
    const codes = await setUp();
    const ok = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[0]! }), ctx);
    expect(ok.status).toBe(200);
    // re-create a set with 2FA on to test misses against a live set
    aal2();
    factorOn();
    const set2 = ((await (await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "generate" }), ctx)).json()) as { codes: string[] }).codes;
    state.claims = { ...state.claims, aal: "aal1" };
    const answers: string[] = [];
    for (const code of ["AAAAA-AAAAA", "x", "ÄÖÜ", "12345-67890", ...[set2[0]!.slice(0, 9) + "Z"]]) {
      const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code }), ctx);
      answers.push(`${r.status}:${(await r.json()).error.code}`);
    }
    expect(new Set(answers)).toEqual(new Set(["422:invalid_code"]));
    expect(state.factors).toHaveLength(1);
    expect(JSON.stringify(state.tables.audit_log)).not.toContain(set2[0]!);
    // …and the real one still works
    expect((await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: set2[0]! }), ctx)).status).toBe(200);
  });

  it("redeem: a used code cannot be used twice (single use even when the factor is back)", async () => {
    const codes = await setUp();
    // consume, then put a factor back WITHOUT a new set: the old set was deleted with the reset, so nothing matches
    await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[1]! }), ctx);
    factorOn();
    const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[3]! }), ctx);
    expect(r.status).toBe(422);
  });

  it("redeem is rate limited and fails closed (guessing is hopeless, and a broken limiter does not open the door)", async () => {
    const codes = await setUp();
    state.rate = 6;
    const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[0]! }), ctx);
    expect(r.status).toBe(429);
    expect(state.factors).toHaveLength(1);
    expect(state.rateKeys.some((k) => k.startsWith("mfa-recovery-redeem:"))).toBe(true);
  });

  it("when the factor cannot be removed the code is given back and the user hears about it", async () => {
    const codes = await setUp();
    state.failFactorDelete = true;
    const r = await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: codes[4]! }), ctx);
    expect(r.status).toBe(502);
    aal2();
    expect((await accountMfaRecovery(req("/api/v1/account/mfa-recovery"), ctx).then((x) => x.json())).remaining).toBe(8);
  });

  it("junk bodies are refused by the schema, and an unauthenticated call by the auth check", async () => {
    expect((await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "x" }), ctx)).status).toBe(422);
    expect((await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: "x".repeat(200) }), ctx)).status).toBe(422);
    state.claims = null;
    expect((await accountMfaRecovery(post("/api/v1/account/mfa-recovery", { action: "redeem", code: "AAAAA-AAAAA" }), ctx)).status).toBe(401);
  });

  it("format helpers round-trip", () => {
    expect(normalizeCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normalizeCode("ABCDE-FGHJ0")).toBeNull();
    expect(formatCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });
});

/* ------------------------------------------------------------------ emergency switches (test 40) */

describe("emergency switches", () => {
  it("KILL_CHECKOUT closes new purchases with a German 503 – before any Stripe call", async () => {
    vi.stubEnv("KILL_CHECKOUT", "true");
    const r = await billingCheckout(post("/api/v1/billing/checkout", { plan: "pro", interval: "month" }), ctx);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: { code: "switched_off", message: expect.stringContaining("Käufe") } });
  });

  it("KILL_SYNC stops connecting an exchange and the cron (the cron reports enabled: false, touches nothing)", async () => {
    vi.stubEnv("KILL_SYNC", "1");
    const r = await exchangeConnect(post("/api/v1/exchange/connect", { exchange: "bitunix", apiKey: "k", secret: "s", journalAccount: "scalp", readOnlyConfirmed: true }), ctx);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("switched_off");
    expect(await runExchangeCron()).toMatchObject({ enabled: false, considered: 0 });
  });

  it("KILL_AI says 'enabled: false' on the GET and refuses the POST", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    expect(await (await coachAsk(req("/api/v1/coach/ask"), ctx)).json()).toEqual({ enabled: true });
    vi.stubEnv("KILL_AI", "true");
    expect(await (await coachAsk(req("/api/v1/coach/ask"), ctx)).json()).toEqual({ enabled: false });
    const r = await coachAsk(post("/api/v1/coach/ask", { title: "t", text: "x", facts: [], confidence: "low" }), ctx);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("switched_off");
  });

  it("KILL_MAIL (Runde 11): no outgoing mail leaves – sendMail answers `mail_off` before any request, the alarm job is skipped with its reason", async () => {
    const calls: string[] = [];
    const fetchSpy = async (url: string) => (calls.push(url), new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    const cfg = { apiKey: "re_x", from: "Test <a@b.de>" };
    vi.stubEnv("KILL_MAIL", "true");
    expect(await sendMail(cfg, { to: "u@example.com", subject: "s", text: "t" }, fetchSpy as never)).toEqual({ ok: false, code: "mail_off", status: null });
    expect(calls).toEqual([]);
    vi.stubEnv("KILL_MAIL", "false");
    expect((await sendMail(cfg, { to: "u@example.com", subject: "s", text: "t" }, fetchSpy as never)).ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(SEND_MESSAGE.mail_off).toMatch(/abgeschaltet/);
    expect(reasonText("mail_off")).toMatch(/Notschalter \(E-Mail\)/);
  });

  it("KILL_MAIL is one of the five switches: the test mail function and the status page show it", async () => {
    expect(switchStates()).toEqual({ sync: false, calls: false, ai: false, checkout: false, mail: false });
    vi.stubEnv("KILL_MAIL", "1");
    expect(switchStates().mail).toBe(true);
    expect(() => assertRunning("mail")).toThrowError(/E-Mails werden gerade nicht verschickt/);
  });

  it("anything but a true-ish value leaves the area running; /api/v1/flags is public and shows the five states", async () => {
    vi.stubEnv("KILL_SYNC", "nein");
    vi.stubEnv("KILL_CALLS", "yes");
    const r = await opsFlags(new Request("https://x.test/api/v1/flags"), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ switches: { sync: false, calls: true, ai: false, checkout: false, mail: false } });
    expect(r.headers.get("cache-control")).toContain("max-age=60");
  });

  it("the public flags endpoint limits one address per instance", async () => {
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await opsFlags(new Request("https://x.test/api/v1/flags"), ctx)).status;
    expect(last).toBe(429);
  });
});

/* ------------------------------------------------------------------ operator status (test 40) */

describe("ops-status", () => {
  const TOKEN = "t".repeat(32);
  const call = (path = "/api/v1/ops/status", token: string | null = TOKEN) => opsStatus(new Request(`https://x.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), ctx);

  it("without OPS_TOKEN (or a short one) it answers 'nicht eingerichtet' and shows nothing", async () => {
    let r = await call();
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("ops_not_configured");
    vi.stubEnv("OPS_TOKEN", "short");
    r = await call();
    expect(r.status).toBe(503);
  });

  it("a missing or wrong token is the same 401, constant text; 10 wrong tries lock the address", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    const a = await call("/api/v1/ops/status", null);
    const b = await call("/api/v1/ops/status", "x".repeat(32));
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    for (let i = 0; i < OPS_MAX_FAILURES; i++) await call("/api/v1/ops/status", "y".repeat(32));
    // even the right token is refused while the address is locked
    expect((await call()).status).toBe(429);
  });

  it("an empty environment is 'nicht eingerichtet' – never 'bereit', every missing name listed, no value anywhere", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    const r = await call();
    const body = await r.json();
    expect(body.verdict).toBe("nicht eingerichtet");
    expect(body.verdictNote).toContain("nicht: er ist frei");
    const supabase = body.groups.find((g: { id: string }) => g.id === "supabase");
    expect(supabase).toMatchObject({ state: "nicht eingerichtet" });
    expect(supabase.missing).toEqual(expect.arrayContaining(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]));
    const checkout = body.functions.find((f: { fn: string }) => f.fn === "billing-checkout");
    expect(checkout).toMatchObject({ state: "nicht eingerichtet", blockedBy: expect.arrayContaining(["supabase", "billing"]) });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("everything set → 'bereit'; a half-set group (Stripe key without webhook secret) → 'unvollständig'", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    for (const [n, v] of Object.entries({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_abc", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SITE_ORIGIN: "https://site.test" })) vi.stubEnv(n, v);
    expect((await (await call()).json()).verdict).toBe("bereit");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secretvalue");
    const half = await (await call()).json();
    expect(half.verdict).toBe("unvollständig");
    expect(half.groups.find((g: { id: string }) => g.id === "billing")).toMatchObject({ state: "teilweise", missing: expect.arrayContaining(["STRIPE_WEBHOOK_SECRET"]) });
    expect(JSON.stringify(half)).not.toContain("sk_test_secretvalue");
  });

  it("PRODUCTION without Stripe or without IP_HASH_PEPPER is never 'bereit': the page says the functions run closed (Runde 11)", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    for (const [n, v] of Object.entries({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_abc", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SITE_ORIGIN: "https://site.test" })) vi.stubEnv(n, v);
    expect((await (await call()).json()).production).toEqual([]); // not production: no remark, 'bereit'
    vi.stubEnv("CONTEXT", "production");
    const closed = await (await call()).json();
    expect(closed.verdict).toBe("unvollständig");
    expect(closed.production).toHaveLength(2);
    expect(closed.production.join(" ")).toMatch(/GESCHLOSSEN/);
    expect(closed.production.join(" ")).toMatch(/IP_HASH_PEPPER fehlt/);
    // the operator's deliberate decision and the pepper clear both
    vi.stubEnv("ALLOW_UNGATED", "true");
    vi.stubEnv("IP_HASH_PEPPER", "p".repeat(32));
    const ok = await (await call()).json();
    expect(ok.production).toEqual([]);
    expect(ok.verdict).toBe("bereit");
  });

  it("names that look like ours but are not in the list are reported (typos)", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    vi.stubEnv("STRIPE_SECRET_KY", "oops");
    const body = await (await call()).json();
    expect(body.unknown).toContain("STRIPE_SECRET_KY");
  });

  it("shows the switches the running functions see", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    vi.stubEnv("KILL_AI", "true");
    const body = await (await call()).json();
    expect(body.switches).toEqual({ sync: false, calls: false, ai: true, checkout: false, mail: false });
    expect(body.functions.find((f: { fn: string }) => f.fn === "coach-ask").switchedOff).toBe(true);
  });

  it("probes only configured services: unconfigured ones are 'nicht geprüft', a 401 is 'reachable, not authorized'", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secretvalue");
    vi.stubEnv("RESEND_API_KEY", "re_secretvalue");
    const seen: string[] = [];
    probeTesting.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      seen.push(new URL(u).host);
      return new Response("{}", { status: u.includes("stripe") ? 200 : 401 });
    }) as typeof fetch;
    const body = await (await call("/api/v1/ops/status?probe=1")).json();
    const by = Object.fromEntries((body.probes as { service: string }[]).map((p) => [p.service, p]));
    expect(by.supabase).toMatchObject({ configured: false, reachable: null, note: expect.stringContaining("nicht eingerichtet") });
    expect(by.twilio).toMatchObject({ configured: false, reachable: null });
    expect(by.stripe).toMatchObject({ configured: true, reachable: true, authorized: true, host: "api.stripe.com" });
    expect(by.resend).toMatchObject({ configured: true, reachable: true, authorized: false, note: expect.stringContaining("Sende-Schlüsseln") });
    expect(seen.sort()).toEqual(["api.resend.com", "api.stripe.com"]);
    expect(JSON.stringify(body)).not.toContain("secretvalue");
  });

  it("a probe that cannot connect says 'nicht erreichbar', not 'ok'", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    probeTesting.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const body = await (await call("/api/v1/ops/status?probe=1")).json();
    expect(body.probes.find((p: { service: string }) => p.service === "stripe")).toMatchObject({ reachable: false, authorized: null });
  });

  it("stats count the last 24 h; a table that does not exist yet (jobs) is 'unbekannt', never 0", async () => {
    vi.stubEnv("OPS_TOKEN", TOKEN);
    const now = new Date();
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    state.tables.profiles = [{ id: "a", created_at: ago(1) }, { id: "b", created_at: ago(30) }, { id: "c", created_at: ago(24 * 6) }];
    state.tables.sync_runs = [{ id: 1, started_at: ago(2), status: "ok" }, { id: 2, started_at: ago(3), status: "error" }, { id: 3, started_at: ago(40), status: "error" }];
    state.tables.stripe_events = [{ id: "evt_1", received_at: ago(1), error: null }, { id: "evt_2", received_at: ago(2), error: "boom" }];
    state.tables.subscriptions = [{ id: "s1", status: "past_due" }, { id: "s2", status: "active" }];
    state.tables.app_errors = [{ id: 1, at: ago(1) }];
    const body = await (await call("/api/v1/ops/status?stats=1")).json();
    expect(body.stats.registrations).toMatchObject({ available: true, n: 1, last7d: 3 });
    expect(body.stats.syncRuns).toMatchObject({ total: 2, errors: 1 });
    expect(body.stats.webhooks).toMatchObject({ received: 2, failed: 1 });
    expect(body.stats.billing).toMatchObject({ pastDueOrUnpaid: 1 });
    expect(body.stats.appErrors).toMatchObject({ n: 1 });
    expect(body.stats.jobs).toMatchObject({ available: false, total: null });
    expect(body.stats.jobs.note).toContain("nicht null");
  });
});
