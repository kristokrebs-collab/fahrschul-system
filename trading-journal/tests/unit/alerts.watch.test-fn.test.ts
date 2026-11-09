// @vitest-environment node
/// <reference types="node" />
/**
 * `netlify/functions/alert-test.mts` (F21): the status the Alarme card shows and the test mail – sign-in, plan gate,
 * server env, the recipient (the account's own confirmed address, read from Auth, never from the request and never in an
 * answer), the rate limits and the German errors. A fake Supabase admin, a fake Resend; nothing real is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setMailFetchForTests } from "../../netlify/functions/_lib/alertWatch/mail";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import alertTest from "../../netlify/functions/alert-test.mts";
import * as fx from "./alerts.watch.fixtures";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof alertTest>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U = "11111111-1111-4111-8111-111111111111";
const MAIL = "trader@example.test";

let claims: Record<string, unknown> | null;
let factors: { status: string }[];
let hits: Map<string, number>;
let r: fx.ResendFake;

function admin(): SupabaseClient {
  return {
    ...fx.fakeSupabase,
    auth: {
      getClaims: async () => (claims ? { data: { claims }, error: null } : { data: null, error: { message: "bad" } }),
      admin: { ...fx.fakeSupabase.auth.admin, mfa: { listFactors: async () => ({ data: { factors }, error: null }) } },
    },
    // rate_hit counts per key; everything else goes to the settings fake
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "rate_hit") {
        const k = String(args.p_key);
        hits.set(k, (hits.get(k) ?? 0) + 1);
        return { data: hits.get(k), error: null };
      }
      return fx.fakeSupabase.rpc(name, args);
    },
  } as unknown as SupabaseClient;
}

const call = (method: "GET" | "POST" = "POST", auth = true) =>
  alertTest(new Request("https://x.test/api/v1/alerts/test", { method, headers: auth ? { authorization: `Bearer ${JWT}` } : {} }), ctx);

beforeEach(() => {
  fx.resetDb();
  claims = { sub: U, role: "authenticated", aal: "aal1", email: "ignored@example.test" };
  factors = [];
  hits = new Map();
  fx.putUser(U, { email: MAIL, plan: "pro" });
  setSupabaseAdminForTests(admin());
  r = fx.resendFake();
  setMailFetchForTests(r.fetch);
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.ALERT_FROM = "Trading Journal <alerts@example.test>";
  process.env.SITE_ORIGIN = "https://journal.example.test";
  delete process.env.STRIPE_SECRET_KEY;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  setMailFetchForTests(null);
  vi.restoreAllMocks();
  for (const k of ["RESEND_API_KEY", "ALERT_FROM", "SITE_ORIGIN", "STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY"]) delete process.env[k];
});

describe("GET – what the Alarme card shows", () => {
  it("needs a login", async () => {
    expect((await call("GET", false)).status).toBe(401);
  });

  it("says whether the server can mail, whether the plan allows it, whether the account has a confirmed address, and the last run", async () => {
    fx.db.config.set("alert-watch", { at: 1_700_000_000_000, ok: true, code: null, accounts: 3, symbols: 2, mails: 1, source: "binance" });
    const res = await call("GET");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ configured: true, entitled: true, hasEmail: true, emailConfirmed: true, lastRun: { at: 1_700_000_000_000, ok: true, code: null, accounts: 3, symbols: 2, mails: 1, source: "binance" }, intervalMin: 5 });
    expect(JSON.stringify(body)).not.toContain(MAIL);
  });

  it("reports an unconfigured server, a plan without the alarm, an unconfirmed address and no run yet", async () => {
    delete process.env.ALERT_FROM;
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_1";
    fx.putUser(U, { email: MAIL, plan: "free", status: "none", confirmed: false });
    const body = await (await call("GET")).json();
    expect(body).toMatchObject({ configured: false, entitled: false, hasEmail: true, emailConfirmed: false, lastRun: null });
  });

  it("rejects other methods", async () => {
    const res = await alertTest(new Request("https://x.test/api/v1/alerts/test", { method: "DELETE", headers: { authorization: `Bearer ${JWT}` } }), ctx);
    expect(res.status).toBe(405);
  });
});

describe("POST – the test mail", () => {
  it("sends ONE mail to the account's own address, read from Auth – and never echoes it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ to: [MAIL], from: "Trading Journal <alerts@example.test>", subject: "Testmail – E-Mail-Alarm" });
    expect(r.sent[0]!.text).toContain("Keine professionelle Finanzberatung.");
    expect(r.sent[0]!.text).toContain("https://journal.example.test/#markt");
  });

  it("without the server env: an honest 503, nothing sent", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatchObject({ code: "alerts_unavailable", message: "Der E-Mail-Versand ist auf diesem Server nicht eingerichtet." });
    expect(r.requests).toBe(0);
  });

  it("needs the plan feature once payments are set up (402), and a confirmed address (409)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_1";
    fx.putUser(U, { email: MAIL, plan: "free", status: "none" });
    expect((await call()).status).toBe(402);
    fx.putUser(U, { email: MAIL, plan: "pro", confirmed: false });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("email_unconfirmed");
    expect(r.requests).toBe(0);
  });

  it("a password-only session of a 2FA account must enter the code first", async () => {
    factors = [{ status: "verified" }];
    expect((await call()).status).toBe(403);
    expect(r.requests).toBe(0);
  });

  it("3 test mails per 10 minutes, then 429 with Retry-After", async () => {
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(r.sent).toHaveLength(3);
  });

  it("names why the send failed, in German, without the key or the address", async () => {
    r.failWith = [403];
    const res = await call();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toMatchObject({ code: "alerts_send_failed", message: "Der Versanddienst hat den Schlüssel oder die Absender-Domain abgelehnt.", details: { reason: "resend_auth" } });
    expect(text).not.toContain("re_test_key");
    expect(text).not.toContain(MAIL);
  });

  it("an account without any address gets a 422", async () => {
    fx.putUser(U, { email: null });
    const res = await call();
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("no_email");
  });
});
