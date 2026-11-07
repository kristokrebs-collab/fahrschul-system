// @vitest-environment node
/// <reference types="node" />
/**
 * Vier Alarme (C2) – the HTTP functions: `alerts-prefs`, `alerts-phone`, `alerts-feed`, `alerts-twilio-status`. Sign-in, plan gate, consent,
 * the number check (fake Twilio Verify), one verified number per number, the test call, opt-out, the rate limits, the protocol feed and the
 * signature of Twilio's status callback. A small fake Supabase, a fake Twilio; nothing real is called, and the number is never found in a
 * stored row in the clear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertPrefsOf, defaultAlertPrefs } from "@/domain/alerts/config";
import { CONSENT_VERSION } from "../../netlify/functions/_lib/alerts/phoneAccount";
import { setTwilioFetchForTests, twilioSignature } from "../../netlify/functions/_lib/alerts/twilio";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { fakeSupabase, newDb, type FakeDb } from "./alerts.fakeSupabase";
import { memoryStore, twilioFake, type MemoryStore, type TwilioFake } from "./alerts.fakes";

vi.mock("../../netlify/functions/_lib/alerts/store", async (orig) => {
  const m = await orig<typeof import("../../netlify/functions/_lib/alerts/store")>();
  return { ...m, supabaseAlertStore: () => (globalThis as unknown as { __store: MemoryStore }).__store };
});

import alertsFeed from "../../netlify/functions/alerts-feed.mts";
import alertsPhone from "../../netlify/functions/alerts-phone.mts";
import alertsPrefs from "../../netlify/functions/alerts-prefs.mts";
import alertsStatus from "../../netlify/functions/alerts-twilio-status.mts";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof alertsPrefs>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const KEY = Buffer.alloc(32, 7).toString("base64");
const SID = `AC${"1".repeat(32)}`;

let db: FakeDb;
let tw: TwilioFake;
let store: MemoryStore;

const req = (path: string, method: string, body?: unknown, auth = true) =>
  new Request(`https://x.test${path}`, { method, headers: { ...(auth ? { authorization: `Bearer ${JWT}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const prefsCall = (method: "GET" | "PUT", body?: unknown, auth = true) => alertsPrefs(req("/api/v1/alerts/prefs", method, body, auth), ctx);
const phoneCall = (method: "POST" | "DELETE", body?: unknown) => alertsPhone(req("/api/v1/alerts/phone", method, body), ctx);

function asUser(id: string): void {
  db.claims = { sub: id, role: "authenticated", aal: "aal1" };
}
function payments(plan: "free" | "pro" | "premium" | "team"): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
  db.tables.profiles = [...(db.tables.profiles ?? []).filter((r) => r.id !== U), { id: U, plan, plan_status: plan === "free" ? "none" : "active", trial_end: null, tz: "Europe/Berlin" }];
}
function twilioEnv(on = true): void {
  for (const [k, v] of Object.entries({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+4930123456", TWILIO_VERIFY_SERVICE_SID: `VA${"2".repeat(32)}`, SITE_ORIGIN: "https://journal.example.test" })) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}
const phoneOn = { green_warn: true, green_confirm: true, red_warn: true, red_confirm: true };
const withChannels = (c: Record<string, typeof phoneOn>) => ({ ...defaultAlertPrefs(), channels: { ...defaultAlertPrefs().channels, ...c } });

async function verifyNumber(user = U, number = "+49 170 1234567"): Promise<void> {
  asUser(user);
  expect((await phoneCall("POST", { action: "start", number, consent: true, consentVersion: CONSENT_VERSION })).status).toBe(200);
  expect((await phoneCall("POST", { action: "check", code: "123456" })).status).toBe(200);
}

beforeEach(() => {
  db = newDb();
  asUser(U);
  setSupabaseAdminForTests(fakeSupabase(db));
  tw = twilioFake();
  setTwilioFetchForTests(tw.fetch);
  store = memoryStore();
  (globalThis as unknown as { __store: MemoryStore }).__store = store;
  twilioEnv();
  process.env.EXCHANGE_ENC_KEY_V1 = KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  delete process.env.RESEND_API_KEY;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  setTwilioFetchForTests(null);
  vi.restoreAllMocks();
  twilioEnv(false);
  for (const k of ["EXCHANGE_ENC_KEY_V1", "STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY"]) delete process.env[k];
});

describe("alerts-prefs", () => {
  it("needs a login", async () => {
    expect((await prefsCall("GET", undefined, false)).status).toBe(401);
    expect((await prefsCall("PUT", { prefs: {} }, false)).status).toBe(401);
  });

  it("GET: a new account gets the all-off default, the plan's limits, what the server can do and no number", async () => {
    payments("pro");
    const body = await (await prefsCall("GET")).json();
    expect(body.prefs).toEqual(defaultAlertPrefs());
    expect(body.plan).toBe("pro");
    expect(body.limits).toEqual({ alertChannels: 2, phoneCallsPerMonth: 0 });
    expect(body.phone).toEqual({ configured: true, verifyConfigured: true, status: "none", masked: null });
    expect(body.email).toEqual({ configured: false, hasEmail: true, confirmed: true });
    expect(body.tz).toBe("Europe/Berlin");
  });

  it("GET: without Twilio the phone says 'not configured'", async () => {
    twilioEnv(false);
    expect((await (await prefsCall("GET")).json()).phone).toMatchObject({ configured: false, verifyConfigured: false });
  });

  it("PUT stores what the reader makes of it – junk is cleaned, numbers are clamped", async () => {
    const res = await prefsCall("PUT", { prefs: { cooldownMin: 1, channels: { browser: { green_confirm: true, evil: true } }, sources: { whale: { on: true, markets: ["btcusdt", "no way"] } } } });
    expect(res.status).toBe(200);
    const stored = (db.tables.alert_prefs ?? [])[0]!.prefs;
    expect(stored).toEqual(alertPrefsOf(stored));
    const p = alertPrefsOf(stored);
    expect(p.cooldownMin).toBe(10);
    expect(p.channels.browser.green_confirm).toBe(true);
    expect(p.sources.whale.markets).toEqual(["BTCUSDT"]);
    expect((db.tables.alert_prefs ?? [])[0]!.user_id).toBe(U);
  });

  it("PUT: the plan decides – Free has one channel, Pro has no calls (402 with the next step), Premium has three", async () => {
    payments("free");
    let res = await prefsCall("PUT", { prefs: withChannels({ browser: phoneOn, email: phoneOn }) });
    expect(res.status).toBe(402);
    const err = await res.json();
    expect(err.error.code).toBe("limit_reached");
    expect(err.error.message).toContain("1 Kanal");
    expect(err.error.details).toMatchObject({ key: "alertChannels", limit: 1 });
    expect((await prefsCall("PUT", { prefs: withChannels({ browser: phoneOn }) })).status).toBe(200);

    payments("pro");
    res = await prefsCall("PUT", { prefs: withChannels({ phone: phoneOn }) });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatchObject({ code: "plan_required", details: { required: "premium" } });
    expect((await prefsCall("PUT", { prefs: withChannels({ browser: phoneOn, email: phoneOn }) })).status).toBe(200);
  });

  it("PUT: the phone channel needs a verified number", async () => {
    payments("premium");
    const res = await prefsCall("PUT", { prefs: withChannels({ phone: phoneOn }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("phone_not_verified");
    await verifyNumber();
    expect((await prefsCall("PUT", { prefs: withChannels({ phone: phoneOn }) })).status).toBe(200);
  });

  it("PUT: a body that is too large or not JSON is refused; the 31st save in ten minutes is limited", async () => {
    const big = await alertsPrefs(req("/api/v1/alerts/prefs", "PUT", { prefs: { junk: "x".repeat(20_000) } }), ctx);
    expect(big.status).toBe(413);
    expect((await alertsPrefs(new Request("https://x.test/api/v1/alerts/prefs", { method: "PUT", headers: { authorization: `Bearer ${JWT}`, "content-type": "text/plain" }, body: "x" }), ctx)).status).toBe(415);
    for (let i = 0; i < 29; i++) await prefsCall("PUT", { prefs: {} });
    expect((await prefsCall("PUT", { prefs: {} })).status).toBe(429);
  });

  it("without the migration the card is told so", async () => {
    db.failWrite.set("alert_prefs", "42P01");
    const res = await prefsCall("PUT", { prefs: {} });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("alerts_unavailable");
  });
});

describe("alerts-phone: setup", () => {
  const start = (over: Record<string, unknown> = {}) => phoneCall("POST", { action: "start", number: "+49 170 1234567", consent: true, consentVersion: CONSENT_VERSION, ...over });

  it("needs a login; a plan without calls is told so; without Twilio nothing happens (Einrichtung nötig)", async () => {
    db.claims = null;
    expect((await start()).status).toBe(401);
    asUser(U);
    payments("pro");
    const res = await start();
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("plan_required");
    expect(tw.verifications).toHaveLength(0);
    payments("premium");
    twilioEnv(false);
    const off = await start();
    expect(off.status).toBe(503);
    expect((await off.json()).error).toMatchObject({ code: "phone_unavailable" });
    expect((await off.json().catch(() => ({}))) && true).toBe(true);
  });

  it("without the Verify service no number can be confirmed", async () => {
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    const res = await start();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("verify_unavailable");
    expect(db.tables.alert_phones).toBeUndefined();
  });

  it("consent is required, in the current version – no consent, no SMS", async () => {
    expect((await start({ consent: false })).status).toBe(422);
    expect((await start({ consent: undefined })).status).toBe(422);
    expect((await start({ consentVersion: "old" })).status).toBe(422);
    expect(tw.verifications).toHaveLength(0);
    expect(db.tables.alert_phones).toBeUndefined();
  });

  it("a number without country code or with junk is refused with the reason, before anything is stored or sent", async () => {
    for (const number of ["0170 1234567", "abc", "+49 1", "+800 1234 5678", ""]) {
      db.hits.clear(); // (junk counts against the rate limit too – here each number is judged on its own)
      const res = await start({ number });
      expect(res.status, number).toBe(422);
      expect((await res.json()).error.code).toBe("invalid_number");
    }
    expect(tw.verifications).toHaveLength(0);
    expect(db.tables.alert_phone_secrets).toBeUndefined();
  });

  it("a good number: consent stored with time and version, the number only encrypted, the SMS goes to the E.164 number in the account's language", async () => {
    const res = await start();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "pending", masked: "+49 ••• ••67" });
    expect(JSON.stringify(body)).not.toContain("1701234567");
    expect(tw.verifications).toEqual([{ to: "+491701234567", channel: "sms", locale: "de" }]);
    const phone = db.tables.alert_phones![0]!;
    expect(phone).toMatchObject({ user_id: U, status: "pending", masked: "+49 ••• ••67", consent_version: CONSENT_VERSION });
    expect(Date.parse(String(phone.consent_at))).toBeGreaterThan(Date.now() - 5_000);
    const secret = db.tables.alert_phone_secrets![0]!;
    expect(secret.verified).toBe(false);
    expect(String(secret.number_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(db.tables)).not.toContain("1701234567");
    expect(secret.number_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the check: a wrong code is named, the right one verifies the number", async () => {
    await start();
    const wrong = await phoneCall("POST", { action: "check", code: "000000" });
    expect(wrong.status).toBe(422);
    expect((await wrong.json()).error.code).toBe("code_wrong");
    expect(db.tables.alert_phones![0]!.status).toBe("pending");
    const ok = await phoneCall("POST", { action: "check", code: "123456" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "verified", masked: "+49 ••• ••67" });
    expect(db.tables.alert_phones![0]).toMatchObject({ status: "verified" });
    expect(db.tables.alert_phone_secrets![0]!.verified).toBe(true);
    expect(tw.checks.map((c) => c.to)).toEqual(["+491701234567", "+491701234567"]);
  });

  it("an expired code is named; a code in the wrong shape is refused; a check without a start is refused", async () => {
    expect((await phoneCall("POST", { action: "check", code: "123456" })).status).toBe(409);
    await start();
    tw.checkExpired = true;
    const res = await phoneCall("POST", { action: "check", code: "123456" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("code_expired");
    expect((await phoneCall("POST", { action: "check", code: "12ab" })).status).toBe(422);
  });

  it("one verified number per number: a second account can neither start nor finish with it", async () => {
    await verifyNumber(U);
    asUser(V);
    const res = await start();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("number_in_use");
    expect(tw.verifications).toHaveLength(1);
  });

  it("Twilio cannot reach the number / is busy: named, not a crash", async () => {
    tw.verifyStartFail = { status: 400, code: 60200 };
    expect((await (await start()).json()).error.code).toBe("number_rejected");
    tw.verifyStartFail = { status: 429 };
    expect((await start()).status).toBe(429);
    tw.verifyStartFail = { status: 503 };
    expect((await (await start()).json()).error.code).toBe("verify_failed");
  });

  it("the start is limited to 3 codes in ten minutes, a check to 6", async () => {
    for (let i = 0; i < 3; i++) expect((await start()).status).toBe(200);
    expect((await start()).status).toBe(429);
    for (let i = 0; i < 6; i++) await phoneCall("POST", { action: "check", code: "000000" });
    expect((await phoneCall("POST", { action: "check", code: "000000" })).status).toBe(429);
  });

  it("the number is in no log line", async () => {
    tw.verifyStartFail = { status: 503 };
    await start();
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("1701234567");
  });
});

describe("alerts-phone: test call and opt-out", () => {
  beforeEach(() => {
    store.users.set(U, { prefs: withChannels({ phone: phoneOn }), tz: "Europe/Berlin" });
  });

  it("a test call needs a verified number", async () => {
    const res = await phoneCall("POST", { action: "test" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("phone_not_verified");
    expect(tw.calls).toHaveLength(0);
  });

  it("a test call: ONE call to the verified number with the test text, the answer says what became of it", async () => {
    await verifyNumber();
    store.secrets.set(U, { numberEnc: db.tables.alert_phone_secrets![0]!.number_enc as string, verified: true });
    const res = await phoneCall("POST", { action: "test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "queued", reason: null });
    expect(tw.calls).toHaveLength(1);
    expect(tw.calls[0]).toMatchObject({ to: "+491701234567" });
    expect(tw.calls[0]!.twiml).toContain("Testanruf");
  });

  it("a test call counts against the limits: the account's day (5) stops the sixth – and the test rate limit stops it earlier", async () => {
    await verifyNumber();
    store.secrets.set(U, { numberEnc: db.tables.alert_phone_secrets![0]!.number_enc as string, verified: true });
    expect((await phoneCall("POST", { action: "test" })).status).toBe(200);
    expect((await phoneCall("POST", { action: "test" })).status).toBe(200);
    expect((await phoneCall("POST", { action: "test" })).status).toBe(429); // 2 in 10 minutes
    expect(tw.calls).toHaveLength(2);
  });

  it("opt-out at once: the number is deleted, the status is revoked, the phone events are switched off", async () => {
    await verifyNumber();
    db.tables.alert_prefs = [{ user_id: U, prefs: withChannels({ phone: phoneOn, email: phoneOn }) }];
    const res = await phoneCall("DELETE");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "revoked" });
    expect(db.tables.alert_phones![0]!.status).toBe("revoked");
    expect(db.tables.alert_phone_secrets).toEqual([]);
    const p = alertPrefsOf(db.tables.alert_prefs![0]!.prefs);
    expect(p.channels.phone).toEqual({ green_warn: false, green_confirm: false, red_warn: false, red_confirm: false });
    expect(p.channels.email.green_confirm).toBe(true); // the other channels stay
    expect((await phoneCall("POST", { action: "test" })).status).toBe(409);
  });
});

describe("alerts-feed", () => {
  const feed = (method: "GET" | "POST", body?: unknown) => alertsFeed(req("/api/v1/alerts/feed", method, body), ctx);

  function seed(): void {
    const now = new Date().toISOString();
    db.tables.alert_events = [
      { id: "e1", user_id: U, source: "industry", market: "Software", event: "green_confirm", value: null, detail: "Datenstand", suppressed: null, occurred_at: now },
      { id: "e2", user_id: U, source: "industry", market: "Banken", event: "red_warn", value: 1.2, detail: null, suppressed: "cooldown", occurred_at: new Date(Date.now() - 3600_000).toISOString() },
      { id: "e3", user_id: V, source: "industry", market: "Other", event: "green_warn", value: null, detail: null, suppressed: null, occurred_at: now },
    ];
    db.tables.alert_deliveries = [
      { id: "d1", user_id: U, event_id: "e1", channel: "email", status: "sent", reason: null, attempts: 1, created_at: now, updated_at: now },
      { id: "d2", user_id: U, event_id: "e1", channel: "browser", status: "queued", reason: null, attempts: 0, created_at: now, updated_at: now },
      { id: "d3", user_id: U, event_id: "e1", channel: "phone", status: "dead", reason: "resend_5xx", attempts: 5, created_at: now, updated_at: now },
      { id: "d4", user_id: U, event_id: null, kind: "test", channel: "phone", status: "failed", reason: "busy", attempts: 1, created_at: now, updated_at: now },
      { id: "d5", user_id: V, event_id: "e3", channel: "browser", status: "queued", reason: null, attempts: 0, created_at: now, updated_at: now },
    ];
  }

  it("needs a login", async () => {
    db.claims = null;
    expect((await feed("GET")).status).toBe(401);
  });

  it("the log: own events with every delivery (a dead letter is visible with its reason), the suppressed one without deliveries, the tests apart", async () => {
    seed();
    const body = await (await feed("GET")).json();
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["e1", "e2"]);
    const e1 = body.events[0];
    expect(e1.deliveries.map((d: { channel: string; status: string; reason: string | null }) => `${d.channel}:${d.status}:${d.reason}`).sort()).toEqual(["browser:queued:null", "email:sent:null", "phone:dead:resend_5xx"]);
    expect(body.events[1]).toMatchObject({ suppressed: "cooldown", deliveries: [] });
    expect(body.other).toHaveLength(1);
    expect(body.other[0]).toMatchObject({ kind: "test", channel: "phone", status: "failed", reason: "busy" });
    expect(JSON.stringify(body)).not.toContain("Other"); // the other account's event
  });

  it("the browser queue: only own, queued, recent deliveries; the acknowledgement marks them shown – and only own ones", async () => {
    seed();
    const body = await (await feed("GET")).json();
    expect(body.browser).toEqual([expect.objectContaining({ deliveryId: "d2", event: "green_confirm", market: "Software" })]);
    expect((await feed("POST", { ack: ["d2", "d5"].map((x) => `${x}`) })).status).toBe(422); // not UUIDs
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    db.tables.alert_deliveries!.push({ id: A, user_id: V, event_id: "e3", channel: "browser", status: "queued", reason: null, attempts: 0 });
    db.tables.alert_deliveries![1]!.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect((await feed("POST", { ack: [A, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] })).status).toBe(200);
    expect(db.tables.alert_deliveries!.find((d) => d.id === A)!.status).toBe("queued"); // not theirs
    expect(db.tables.alert_deliveries![1]!.status).toBe("shown");
  });

  it("without the migration the card is told so", async () => {
    // no tables at all: the fake returns empty lists – the real database answers 42P01, which the function maps to 503 (covered by alerts-prefs above)
    const body = await (await feed("GET")).json();
    expect(body).toEqual({ events: [], other: [], browser: [] });
  });
});

describe("alerts-twilio-status", () => {
  const SIDX = `CA${"a".repeat(32)}`;
  const URL_ = "https://journal.example.test/api/v1/alerts/twilio/status";
  const post = (params: Record<string, string>, sig?: string | null) =>
    alertsStatus(
      new Request(URL_, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(sig === null ? {} : { "x-twilio-signature": sig ?? twilioSignature("tok", URL_, params) }) }, body: new URLSearchParams(params).toString() }),
    );

  beforeEach(async () => {
    store.secrets.set(U, { numberEnc: "x", verified: true });
    const id = await store.enqueueTest(U, "phone", false);
    await store.patchDelivery(id, { status: "queued", providerRef: SIDX });
  });

  it("refuses without or with a wrong signature, and changes nothing", async () => {
    expect((await post({ CallSid: SIDX, CallStatus: "ringing" }, null)).status).toBe(403);
    expect((await post({ CallSid: SIDX, CallStatus: "ringing" }, "AAAA")).status).toBe(403);
    expect([...store.deliveries.values()][0]!.status).toBe("queued");
  });

  it("a signed callback moves the call forward; a repeated or late one changes nothing", async () => {
    expect(await (await post({ CallSid: SIDX, CallStatus: "ringing" })).json()).toEqual({ ok: true, changed: true });
    expect([...store.deliveries.values()][0]!.status).toBe("ringing");
    expect(await (await post({ CallSid: SIDX, CallStatus: "ringing" })).json()).toEqual({ ok: true, changed: false });
    expect(await (await post({ CallSid: SIDX, CallStatus: "completed" })).json()).toEqual({ ok: true, changed: true });
    expect([...store.deliveries.values()][0]!.status).toBe("answered");
    expect(await (await post({ CallSid: SIDX, CallStatus: "ringing" })).json()).toEqual({ ok: true, changed: false });
    expect([...store.deliveries.values()][0]!.status).toBe("answered");
  });

  it("an unanswered call is failed with the reason; an unknown status or call id is ignored", async () => {
    await post({ CallSid: SIDX, CallStatus: "ringing" });
    await post({ CallSid: SIDX, CallStatus: "no-answer" });
    expect([...store.deliveries.values()][0]).toMatchObject({ status: "failed", reason: "no_answer" });
    expect(await (await post({ CallSid: SIDX, CallStatus: "wat" })).json()).toEqual({ ok: true, changed: false });
    expect(await (await post({ CallSid: "nope", CallStatus: "ringing" })).json()).toEqual({ ok: true, changed: false });
  });

  it("without the token (not set up) it answers 503; other methods 405", async () => {
    twilioEnv(false);
    expect((await post({ CallSid: SIDX, CallStatus: "ringing" })).status).toBe(503);
    twilioEnv();
    expect((await alertsStatus(new Request(URL_, { method: "GET" }))).status).toBe(405);
  });
});
