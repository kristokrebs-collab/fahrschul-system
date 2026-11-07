// @vitest-environment node
/// <reference types="node" />
/**
 * Vier Alarme (C2) – the delivery worker (`netlify/functions/_lib/alerts/deliver.ts`) against an in-memory store and a fake Twilio / fake Resend.
 * No network. The heart of it: a crash in the middle of a job never makes a second call and never a second mail.
 *
 *   - e-mail: sent with an idempotency key; failures are retried with back-off; the last one ends in the dead letter
 *   - phone: committed before dialed; a job taken over after a crash does not dial again; 429 is rolled back and retried, 5xx / network is
 *     "unclear" and never retried; month / day / server limits, the plan, the opt-out and the quiet hours stop a call before it exists
 *   - status callbacks move a call forward only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAlertPrefs, type AlertPrefs } from "@/domain/alerts/config";
import { LEASE_SEC } from "@/domain/alerts/delivery";
import { reconcileCalls, runWorker, emptyWorkerSummary, type DeliverDeps } from "../../netlify/functions/_lib/alerts/deliver";
import { createCall, setTwilioFetchForTests, twilioSignature, validTwilioSignature, verifyStart, type TwilioConfig } from "../../netlify/functions/_lib/alerts/twilio";
import * as fx from "./alerts.watch.fixtures";
import { memoryStore, MIN, twilioFake, type MemoryStore, type TwilioFake } from "./alerts.fakes";

const U = "u-1";
const NUMBER = "+491701234567";
const TW: TwilioConfig = { sid: `AC${"0".repeat(32)}`, token: "secret-token", from: "+4930123456", verifySid: `VA${"0".repeat(32)}` };
const NOON = Date.UTC(2026, 10, 2, 11, 0, 0); // 12:00 Berlin

let store: MemoryStore;
let tw: TwilioFake;
let resend: fx.ResendFake;

function prefs(over: Partial<AlertPrefs> = {}, phone = true, email = true): AlertPrefs {
  const p = defaultAlertPrefs();
  const on = { green_warn: true, green_confirm: true, red_warn: true, red_confirm: true };
  return { ...p, channels: { browser: p.channels.browser, email: email ? on : p.channels.email, phone: phone ? on : p.channels.phone }, ...over };
}

function setup(o: { prefs?: AlertPrefs; verified?: boolean } = {}): void {
  store.users.set(U, { prefs: o.prefs ?? prefs(), tz: "Europe/Berlin" });
  if (o.verified !== false) store.secrets.set(U, { numberEnc: `enc:${NUMBER}`, verified: true });
}

function deps(over: Partial<DeliverDeps> = {}): DeliverDeps {
  return {
    store,
    now: () => store.clock.now,
    mail: { apiKey: "re_key", from: "Alarm <alerts@example.test>" },
    twilio: TW,
    recipient: async () => ({ email: "trader@example.test", confirmed: true }),
    plan: async () => "premium",
    decryptNumber: (_u, blob) => blob.replace("enc:", ""),
    appUrl: "https://journal.example.test",
    brakes: { userDayMax: 5, globalDayMax: 50 },
    sendFetch: resend.fetch,
    ...over,
  };
}

/** An event with its deliveries and jobs, the way the engine run writes it. */
async function fire(channels: ("email" | "phone")[], over: { event?: "green_warn" | "green_confirm" | "red_warn" | "red_confirm"; key?: string; market?: string } = {}): Promise<string> {
  const id = await store.enqueue({
    userId: U,
    dedupKey: over.key ?? `k-${store.events.length}`,
    source: "industry",
    marketKey: "industry:Chips",
    market: over.market ?? "Elektronik und Chips",
    event: over.event ?? "green_confirm",
    value: null,
    detail: "Datenstand 30.09.2026",
    suppressed: null,
    occurredAt: store.clock.now,
    deliveries: channels.map((channel) => ({ channel, status: "queued", reason: null, runAt: store.clock.now })),
  });
  return id!;
}

const dlv = (channel: "email" | "phone") => store.deliveriesOf(U, channel)[0]!;
const job = (channel: "email" | "phone") => [...store.jobs.values()].find((j) => store.deliveries.get(j.deliveryId)!.channel === channel)!;

beforeEach(() => {
  store = memoryStore(NOON);
  tw = twilioFake();
  resend = fx.resendFake();
  setTwilioFetchForTests(tw.fetch);
  delete process.env.STRIPE_SECRET_KEY;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  setTwilioFetchForTests(null);
  vi.restoreAllMocks();
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY"]) delete process.env[k];
});

describe("e-mail", () => {
  it("is sent once with the delivery as idempotency key, and the log says sent", async () => {
    setup();
    await fire(["email"]);
    const t = await runWorker(deps());
    expect(t).toMatchObject({ claimed: 1, sent: 1 });
    expect(resend.sent).toHaveLength(1);
    expect(resend.sent[0]).toMatchObject({ to: ["trader@example.test"] });
    expect(resend.sent[0]!.subject).toBe("Alarm: Grün-Bestätigung · Elektronik und Chips");
    expect(resend.sent[0]!.text).toContain("Keine professionelle Finanzberatung");
    expect(resend.sent[0]!.text).toContain("Datenstand 30.09.2026");
    expect(resend.sent[0]!.key).toMatch(/^[0-9a-f]{40}$/);
    expect(dlv("email")).toMatchObject({ status: "sent", attempts: 1 });
    expect(job("email").status).toBe("done");
  });

  it("English when the account's language is English", async () => {
    setup({ prefs: prefs({ lang: "en" }) });
    await fire(["email"], { event: "red_warn" });
    await runWorker(deps());
    expect(resend.sent[0]!.subject).toBe("Alert: Red early warning · Elektronik und Chips");
    expect(resend.sent[0]!.text).toContain("No professional financial advice");
  });

  it("a failure that can pass is retried with back-off; the next try (after the wait) sends it", async () => {
    setup();
    await fire(["email"]);
    resend.failWith.push(503);
    const t1 = await runWorker(deps());
    expect(t1.retried).toBe(1);
    expect(dlv("email")).toMatchObject({ status: "queued", reason: "resend_5xx", attempts: 1 });
    expect(job("email")).toMatchObject({ status: "queued", runAt: NOON + 60_000, lastCode: "resend_5xx" });
    expect((await runWorker(deps())).claimed).toBe(0); // not before the wait is over
    store.clock.now += 61_000;
    const t2 = await runWorker(deps());
    expect(t2.sent).toBe(1);
    expect(dlv("email")).toMatchObject({ status: "sent", attempts: 2, reason: null });
    expect(resend.sent).toHaveLength(1);
  });

  it("five failed tries end in the dead letter – the log shows it with the reason", async () => {
    setup();
    await fire(["email"]);
    resend.failWith.push(503, 503, 503, 503, 503);
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      await runWorker(deps());
      waits.push(job("email").runAt - store.clock.now);
      store.clock.now = Math.max(store.clock.now, job("email").runAt) + 1;
    }
    expect(waits.slice(0, 4)).toEqual([60_000, 300_000, 900_000, 3_600_000]);
    expect(dlv("email")).toMatchObject({ status: "dead", reason: "resend_5xx", attempts: 5 });
    expect(job("email")).toMatchObject({ status: "dead", lastCode: "resend_5xx" });
    expect(resend.sent).toHaveLength(0);
    expect((await runWorker(deps())).claimed).toBe(0);
  });

  it("a mail the provider refuses for good (invalid) is failed, not retried", async () => {
    setup();
    await fire(["email"]);
    resend.failWith.push(422);
    const t = await runWorker(deps());
    expect(t.failed).toBe(1);
    expect(dlv("email")).toMatchObject({ status: "failed", reason: "resend_invalid" });
    expect(job("email").status).toBe("done");
  });

  it("no address / unconfirmed address / no server configuration are named, not retried", async () => {
    setup();
    await fire(["email"], { key: "a" });
    await runWorker(deps({ recipient: async () => null }));
    expect(dlv("email")).toMatchObject({ status: "failed", reason: "no_recipient" });
    store.deliveries.clear();
    store.jobs.clear();
    await fire(["email"], { key: "b" });
    await runWorker(deps({ recipient: async () => ({ email: "x@example.test", confirmed: false }) }));
    expect(dlv("email")).toMatchObject({ status: "failed", reason: "email_unconfirmed" });
    store.deliveries.clear();
    store.jobs.clear();
    await fire(["email"], { key: "c" });
    await runWorker(deps({ mail: null }));
    expect(dlv("email")).toMatchObject({ status: "failed", reason: "not_configured" });
    expect(resend.requests).toBe(0);
  });

  it("CRASH after the mail went out, before it was logged: the next worker sends again – the provider answers with the first mail, no second one exists", async () => {
    setup();
    await fire(["email"]);
    store.crashAt = { op: "patchDelivery", times: 1 };
    const t1 = await runWorker(deps());
    expect(t1.errors).toBe(1);
    expect(resend.sent).toHaveLength(1);
    expect(dlv("email").status).toBe("queued"); // the log never saw it
    expect((await runWorker(deps())).claimed).toBe(0); // the lease still holds
    store.clock.now += (LEASE_SEC + 1) * 1000;
    const t2 = await runWorker(deps());
    expect(t2.claimed).toBe(1);
    expect(resend.requests).toBe(2); // asked twice …
    expect(resend.sent).toHaveLength(1); // … but exactly one mail exists (same idempotency key)
    expect(dlv("email").status).toBe("sent");
  });

  it("switched off after it was queued: skipped, nothing sent", async () => {
    setup({ prefs: prefs({}, true, false) });
    await fire(["email"]);
    await runWorker(deps());
    expect(dlv("email")).toMatchObject({ status: "skipped", reason: "switched_off" });
    expect(resend.sent).toHaveLength(0);
  });
});

describe("phone", () => {
  it("is dialed once: the text names the event and the market and says it is not advice; the log shows it queued with the call id", async () => {
    setup();
    await fire(["phone"], { event: "green_warn", market: "Software" });
    const t = await runWorker(deps());
    expect(t.dialed).toBe(1);
    expect(tw.calls).toHaveLength(1);
    expect(tw.calls[0]).toMatchObject({ to: NUMBER, from: TW.from, statusCallback: "https://journal.example.test/api/v1/alerts/twilio/status" });
    expect(tw.calls[0]!.auth).toBe(`Basic ${Buffer.from(`${TW.sid}:${TW.token}`).toString("base64")}`);
    expect(tw.calls[0]!.twiml).toContain("Alarm: Grün-Vorwarnung bei Software. Das ist keine Beratung.");
    expect(tw.calls[0]!.twiml).toContain('language="de-DE"');
    expect(dlv("phone")).toMatchObject({ status: "queued", reason: null });
    expect(dlv("phone").providerRef).toMatch(/^CA[0-9a-f]{32}$/);
    expect(dlv("phone").dialedAt).not.toBeNull();
    expect(job("phone").status).toBe("done");
    // a second worker finds nothing to do
    expect((await runWorker(deps())).claimed).toBe(0);
    expect(tw.calls).toHaveLength(1);
  });

  it("English text for an English account", async () => {
    setup({ prefs: prefs({ lang: "en" }) });
    await fire(["phone"], { event: "red_confirm", market: "BTCUSDT" });
    await runWorker(deps());
    expect(tw.calls[0]!.twiml).toContain("Alert: Red confirmation for BTCUSDT. This is not advice.");
    expect(tw.calls[0]!.twiml).toContain('language="en-US"');
  });

  it("status callbacks: queued → ringing → answered; a late ringing or a failure after answered changes nothing", async () => {
    setup();
    await fire(["phone"]);
    await runWorker(deps());
    const sid = dlv("phone").providerRef!;
    expect(await store.advanceByRef(sid, "ringing", null)).not.toBeNull();
    expect(dlv("phone").status).toBe("ringing");
    expect(await store.advanceByRef(sid, "answered", null)).not.toBeNull();
    expect(await store.advanceByRef(sid, "ringing", null)).toBeNull();
    expect(await store.advanceByRef(sid, "failed", "no_answer")).toBeNull();
    expect(dlv("phone").status).toBe("answered");
  });

  it("an unanswered call is logged failed with the reason", async () => {
    setup();
    await fire(["phone"]);
    await runWorker(deps());
    const sid = dlv("phone").providerRef!;
    await store.advanceByRef(sid, "ringing", null);
    await store.advanceByRef(sid, "failed", "no_answer");
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "no_answer" });
  });

  it("CRASH after the call was dialed, before it was logged: the next worker does NOT dial again – the outcome is logged 'unclear'", async () => {
    setup();
    await fire(["phone"]);
    store.crashAt = { op: "patchDelivery", times: 1 };
    const t1 = await runWorker(deps());
    expect(t1.errors).toBe(1);
    expect(tw.calls).toHaveLength(1);
    expect(dlv("phone").dialedAt).not.toBeNull();
    expect(dlv("phone").providerRef).toBeNull();
    store.clock.now += (LEASE_SEC + 1) * 1000;
    const t2 = await runWorker(deps());
    expect(t2).toMatchObject({ claimed: 1, unclear: 1 });
    expect(tw.calls).toHaveLength(1); // still ONE call
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "unclear" });
    expect(job("phone").status).toBe("done");
    store.clock.now += 3_600_000;
    expect((await runWorker(deps())).claimed).toBe(0);
    expect(tw.calls).toHaveLength(1);
  });

  it("CRASH right after the commitment, before the dial request: the commitment stays, the next worker never dials", async () => {
    setup();
    await fire(["phone"]);
    // crash inside the dial: the fake network breaks after the request was sent – Twilio may have created the call
    tw.callFail.push("network");
    const t = await runWorker(deps());
    expect(t.unclear).toBe(1);
    expect(tw.calls).toHaveLength(1);
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "unclear" });
    expect(dlv("phone").dialedAt).not.toBeNull(); // it still counts against the limits
    store.clock.now += 3_600_000;
    await runWorker(deps());
    expect(tw.calls).toHaveLength(1);
  });

  it("an answer of 5xx may have created the call: unclear, never retried", async () => {
    setup();
    await fire(["phone"]);
    tw.callFail.push(503);
    await runWorker(deps());
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "unclear" });
    store.clock.now += 3_600_000;
    await runWorker(deps());
    expect(tw.calls).toHaveLength(1);
  });

  it("Twilio refuses with 429 (no call exists): the commitment is taken back and the job is retried later – exactly one call in the end", async () => {
    setup();
    await fire(["phone"]);
    tw.callFail.push(429);
    const t1 = await runWorker(deps());
    expect(t1.retried).toBe(1);
    expect(dlv("phone")).toMatchObject({ status: "queued", reason: "twilio_rate", dialedAt: null });
    expect(job("phone")).toMatchObject({ status: "queued", runAt: NOON + 60_000 });
    store.clock.now += 61_000;
    const t2 = await runWorker(deps());
    expect(t2.dialed).toBe(1);
    expect(tw.calls).toHaveLength(2); // two requests, one refused
    expect(store.deliveriesOf(U, "phone").filter((d) => d.dialedAt !== null)).toHaveLength(1); // one commitment counts
    expect(dlv("phone").providerRef).toMatch(/^CA/);
  });

  it("a number or key Twilio refuses (4xx) is failed with the reason, the commitment is taken back, nothing retried", async () => {
    setup();
    await fire(["phone"], { key: "a" });
    tw.callFail.push(400);
    await runWorker(deps());
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "twilio_number", dialedAt: null });
    store.deliveries.clear();
    store.jobs.clear();
    await fire(["phone"], { key: "b" });
    tw.callFail.push(401);
    await runWorker(deps());
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "twilio_auth" });
    expect(tw.calls).toHaveLength(2);
  });

  it("two workers at once: the job is taken by one, ONE call", async () => {
    setup();
    await fire(["phone"]);
    const [a, b] = await Promise.all([runWorker(deps()), runWorker(deps())]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(tw.calls).toHaveLength(1);
  });

  it("never dials the same event twice, whatever the number of jobs", async () => {
    setup();
    const id = await fire(["phone"]);
    // a second job for the same delivery (a bug, a manual re-queue): the commitment stops it
    const d = dlv("phone");
    await runWorker(deps());
    store.jobs.set("job-dup", { id: "job-dup", userId: U, key: `${id}:phone:dup`, deliveryId: d.id, status: "queued", attempts: 0, maxAttempts: 5, runAt: store.clock.now, leaseUntil: null, token: null, lastCode: null });
    await runWorker(deps());
    expect(tw.calls).toHaveLength(1);
  });

  it("the month's limit stops the call before it exists (Premium: 30)", async () => {
    setup();
    store.clock.now = Date.UTC(2026, 10, 25, 10, 0); // late in November: 30 calls were already made earlier this month
    for (let i = 0; i < 30; i++) store.deliveries.set(`old-${i}`, { id: `old-${i}`, userId: U, eventId: null, kind: "alarm", channel: "phone", status: "answered", reason: null, attempts: 1, providerRef: `CA${i}`, dialedAt: Date.UTC(2026, 10, 3 + (i % 20), 8, 0), notBefore: null, updatedAt: NOON - 1 });
    await fire(["phone"]);
    await runWorker(deps({ brakes: { userDayMax: 99, globalDayMax: 999 } }));
    expect(tw.calls).toHaveLength(0);
    const fresh = [...store.deliveries.values()].find((d) => d.eventId !== null)!;
    expect(fresh).toMatchObject({ status: "skipped", reason: "month_limit", dialedAt: null });
  });

  it("the 31st call goes through next month (the count restarts)", async () => {
    setup();
    for (let i = 0; i < 30; i++) store.deliveries.set(`old-${i}`, { id: `old-${i}`, userId: U, eventId: null, kind: "alarm", channel: "phone", status: "answered", reason: null, attempts: 1, providerRef: `CA${i}`, dialedAt: Date.UTC(2026, 9, 3 + (i % 20), 8, 0), notBefore: null, updatedAt: NOON - 1 });
    await fire(["phone"]); // now = 2 November: the 30 calls belong to October
    await runWorker(deps({ brakes: { userDayMax: 99, globalDayMax: 999 } }));
    expect(tw.calls).toHaveLength(1);
  });

  it("the account's day and the server's day (cost brake) stop it too", async () => {
    setup();
    await fire(["phone"], { key: "a" });
    await fire(["phone"], { key: "b" });
    await fire(["phone"], { key: "c" });
    await runWorker(deps({ brakes: { userDayMax: 2, globalDayMax: 50 } }));
    const phones = store.deliveriesOf(U, "phone");
    expect(phones.filter((d) => d.providerRef)).toHaveLength(2);
    expect(phones.filter((d) => d.reason === "user_day_limit")).toHaveLength(1);
    expect(tw.calls).toHaveLength(2);
    store.clock.now += 1; // same day
    await fire(["phone"], { key: "d" });
    await runWorker(deps({ brakes: { userDayMax: 99, globalDayMax: 2 } }));
    expect(tw.calls).toHaveLength(2);
    expect(store.deliveriesOf(U, "phone").filter((d) => d.reason === "global_day_limit")).toHaveLength(1);
  });

  it("a plan without calls (Free, Pro with payments on) never dials", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    setup();
    await fire(["phone"]);
    await runWorker(deps({ plan: async () => "pro" }));
    expect(tw.calls).toHaveLength(0);
    expect(dlv("phone")).toMatchObject({ status: "skipped", reason: "no_plan" });
  });

  it("Team has 60 calls: a Team account with payments on can dial", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    setup();
    await fire(["phone"]);
    await runWorker(deps({ plan: async () => "team" }));
    expect(tw.calls).toHaveLength(1);
  });

  it("opt-out: no verified number → no call, whatever is still queued", async () => {
    setup({ verified: false });
    await fire(["phone"]);
    await runWorker(deps());
    expect(tw.calls).toHaveLength(0);
    expect(dlv("phone")).toMatchObject({ status: "skipped", reason: "phone_opted_out" });
  });

  it("KILL_CALLS (emergency switch): no call, no budget used, the log says 'Notschalter' – and the job is done, not retried; e-mail still goes", async () => {
    setup();
    await fire(["phone", "email"]);
    vi.stubEnv("KILL_CALLS", "true");
    const t = await runWorker(deps());
    vi.unstubAllEnvs();
    expect(tw.calls).toHaveLength(0);
    expect(dlv("phone")).toMatchObject({ status: "skipped", reason: "calls_off", dialedAt: null });
    expect(job("phone").status).toBe("done");
    expect(dlv("email")).toMatchObject({ status: "sent" });
    expect(t.skipped).toBe(1);
    // switched on again: a NEW alarm is dialed as usual (the skipped one is not made up for)
    await fire(["phone"], { key: "k-after" });
    await runWorker(deps());
    expect(tw.calls).toHaveLength(1);
  });

  it("KILL_CALLS is also checked at the last step before Twilio (createCall): no request leaves even if a path forgot the check", async () => {
    vi.stubEnv("KILL_CALLS", "true");
    const res = await createCall(TW, { to: NUMBER, twiml: "<Response/>", statusCallback: null });
    const v = await verifyStart(TW, NUMBER, "de");
    vi.unstubAllEnvs();
    expect(res).toMatchObject({ ok: false, reason: "calls_off", retryable: false });
    expect(v).toEqual({ ok: false, code: "switched_off" });
    expect(tw.calls).toHaveLength(0);
    expect(tw.verifications).toHaveLength(0);
  });

  it("the phone events switched off after the job was queued: skipped", async () => {
    setup({ prefs: prefs({}, false, true) });
    await fire(["phone"]);
    await runWorker(deps());
    expect(tw.calls).toHaveLength(0);
    expect(dlv("phone")).toMatchObject({ status: "skipped", reason: "switched_off" });
  });

  it("a job that waited into the quiet hours is skipped; a test call is not held back by them", async () => {
    setup();
    store.clock.now = Date.UTC(2026, 10, 2, 22, 30); // 23:30 Berlin
    await fire(["phone"]);
    await runWorker(deps());
    expect(tw.calls).toHaveLength(0);
    expect(dlv("phone")).toMatchObject({ status: "skipped", reason: "quiet_hours" });
    const testId = await store.enqueueTest(U, "phone", true);
    await runWorker(deps());
    expect(tw.calls).toHaveLength(1);
    expect(tw.calls[0]!.twiml).toContain("Das ist ein Testanruf");
    expect((await store.delivery(testId))!.providerRef).toMatch(/^CA/);
  });

  it("without Twilio configuration: failed with 'nicht eingerichtet', no request", async () => {
    setup();
    await fire(["phone"]);
    await runWorker(deps({ twilio: null }));
    expect(tw.calls).toHaveLength(0);
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "not_configured" });
  });

  it("a stored number that cannot be decrypted is not dialed", async () => {
    setup();
    await fire(["phone"]);
    await runWorker(deps({ decryptNumber: () => { throw new Error("bad key"); } }));
    expect(tw.calls).toHaveLength(0);
    expect(dlv("phone")).toMatchObject({ status: "failed", reason: "not_configured" });
  });

  it("the number and the token appear in no log line", async () => {
    setup();
    await fire(["phone", "email"]);
    tw.callFail.push(401);
    await runWorker(deps());
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain(NUMBER.slice(3));
    expect(logged).not.toContain(TW.token);
  });
});

describe("reconcile: a lost callback", () => {
  it("asks Twilio for calls that are still queued / ringing after a while and moves them forward", async () => {
    setup();
    await fire(["phone"]);
    await runWorker(deps());
    const sid = dlv("phone").providerRef!;
    tw.pollStatus.set(sid, "completed");
    const t = emptyWorkerSummary();
    await reconcileCalls(deps(), t); // just dialed: not old enough
    expect(t.reconciled).toBe(0);
    store.clock.now += 5 * MIN;
    await reconcileCalls(deps(), t);
    expect(t.reconciled).toBe(1);
    expect(dlv("phone").status).toBe("answered");
    expect(tw.polls).toEqual([sid]);
  });
});

describe("Twilio signature (status callback)", () => {
  // the documented example of Twilio's own docs
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { Digits: "1234", To: "+18005551212", From: "+14158675310", Caller: "+14158675310", CallSid: "CA1234567890ABCDE" };

  it("matches the documented vector", () => {
    expect(twilioSignature("12345", url, params)).toBe("GvWf1cFY/Q7PnoempGyD5oXAezc=");
    expect(validTwilioSignature("12345", url, params, "GvWf1cFY/Q7PnoempGyD5oXAezc=")).toBe(true);
  });

  it("refuses a wrong token, a changed field, a changed URL and a missing header", () => {
    expect(validTwilioSignature("other", url, params, "GvWf1cFY/Q7PnoempGyD5oXAezc=")).toBe(false);
    expect(validTwilioSignature("12345", url, { ...params, Digits: "9999" }, "GvWf1cFY/Q7PnoempGyD5oXAezc=")).toBe(false);
    expect(validTwilioSignature("12345", `${url}&x=1`, params, "GvWf1cFY/Q7PnoempGyD5oXAezc=")).toBe(false);
    expect(validTwilioSignature("12345", url, params, null)).toBe(false);
    expect(validTwilioSignature("12345", url, params, "short")).toBe(false);
  });
});
