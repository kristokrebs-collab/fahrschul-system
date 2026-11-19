// @vitest-environment node
/// <reference types="node" />
/**
 * The server side of the purchase flow (B4) against an in-memory Supabase fake and a FAKE Stripe (no network, no real key):
 * the lock (Stripe + the operator's legal texts), both consents with the current wording and their stored evidence, the
 * idempotency key per order, the success / cancel URLs (same origin only), the text beside Stripe's button, the cancel
 * (§ 312k) and withdraw (§ 356a) declarations without a login (stored, mailed, executed only after the link; the same answer for
 * unknown addresses), the 14-day period, the in-app cancellation's confirmation mail. Relative imports only (the functions know no `@/`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { consentSetHash, CONSENT_TEXT, CONSENT_TEXT_VERSION, newOrderId } from "../../src/legal/consentRecord";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { resetPaymentsReportForTests } from "../../netlify/functions/_lib/plan";
import { setStripeApiForTests, checkoutSubmitText, type StripeApi } from "../../netlify/functions/_lib/stripe";
import { assertSameOrigin, legalReady, purchaseGate, returnUrls } from "../../netlify/functions/_lib/purchase";
import { setMailFetchForTests } from "../../netlify/functions/_lib/alertWatch/mail";
import { buildContractMail, formatStamp } from "../../netlify/functions/_lib/contractMail";
import { normalizeEmail } from "../../netlify/functions/_lib/contractRequest";
import checkoutFn from "../../netlify/functions/billing-checkout.mts";
import statusFn from "../../netlify/functions/billing-status.mts";
import portalFn from "../../netlify/functions/billing-portal.mts";
import contractFn from "../../netlify/functions/billing-contract.mts";
import webhookFn from "../../netlify/functions/stripe-webhook.mts";
import subscribeFn from "../../netlify/functions/billing-subscribe.mts";
import Stripe_ from "stripe";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof checkoutFn>[1];
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const EMAIL1 = "trader@example.com";
const WHSEC = "whsec_test_secret";
const sdk = new Stripe_("sk_test_dummy");
const NOW_S = Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------------ Supabase fake */

type Row = Record<string, unknown>;
const UNIQUE: Record<string, string[][]> = {
  profiles: [["id"]],
  subscriptions: [["id"]],
  billing_customers: [["user_id"], ["stripe_customer_id"]],
  referral_codes: [["user_id"], ["code"]],
  stripe_events: [["id"]],
  consents: [["user_id", "order_id", "kind"]],
  contract_requests: [["token_hash"]],
};

interface Db {
  tables: Record<string, Row[] | undefined>;
  seq: number;
  rateLimit: number;
  users: Map<string, { email: string; confirmed: boolean }>;
}

function query(db: Db, table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  let payload: Row | Row[] = {};
  let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  let single = false;
  let wantRows = false;
  let limitN: number | null = null;
  const exec = async (): Promise<{ data: unknown; error: { code: string } | null }> => {
    const rows = db.tables[table];
    if (!rows) return { data: null, error: { code: "PGRST205" } };
    if (op === "insert" || op === "upsert") {
      const made: Row[] = [];
      for (const raw of Array.isArray(payload) ? payload : [payload]) {
        const row: Row = { ...raw };
        if ((table === "consents" || table === "contract_requests") && row.id === undefined) row.id = `00000000-0000-4000-8000-${String(++db.seq).padStart(12, "0")}`;
        row.updated_at ??= new Date(Date.now() + ++db.seq).toISOString();
        row.created_at ??= new Date().toISOString();
        if (op === "upsert" && opts.onConflict) {
          const keys = opts.onConflict.split(",");
          const hit = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (hit) {
            if (!opts.ignoreDuplicates) Object.assign(hit, raw);
            continue;
          }
        }
        for (const keys of UNIQUE[table] ?? []) {
          if (keys.every((k) => row[k] !== undefined && row[k] !== null) && rows.some((r) => keys.every((k) => r[k] === row[k]))) return { data: null, error: { code: "23505" } };
        }
        rows.push(row);
        made.push(row);
      }
      return { data: wantRows ? (single ? { ...made[0] } : made.map((r) => ({ ...r }))) : null, error: null };
    }
    const hits = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      for (const r of hits) Object.assign(r, payload);
      return { data: null, error: null };
    }
    if (op === "delete") {
      db.tables[table] = rows.filter((r) => !hits.includes(r));
      return { data: null, error: null };
    }
    let out = hits.map((r) => ({ ...r }));
    if (limitN !== null) out = out.slice(0, limitN);
    return { data: single ? (out[0] ?? null) : out, error: null };
  };
  const q = {
    select: () => ((wantRows = true), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    lte: (c: string, v: unknown) => (filters.push((r) => r[c] === undefined || r[c] === null || String(r[c]) <= String(v)), q),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
    order: () => q,
    limit: (n: number) => ((limitN = n), q),
    maybeSingle: () => ((single = true), exec()),
    insert: (row: Row | Row[]) => ((op = "insert"), (payload = row), q),
    upsert: (row: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => ((op = "upsert"), (payload = row), (opts = o), q),
    update: (patch: Row) => ((op = "update"), (payload = patch), q),
    delete: () => ((op = "delete"), q),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return q;
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const tokenFor = (sub: string, email?: string) => `eyJhbGciOiJFUzI1NiJ9.${b64url(JSON.stringify({ sub, ...(email ? { email } : {}) }))}.c2ln`;

function fakeDb(): Db {
  const db: Db = {
    tables: {
      profiles: [U1, U2].map((id) => ({ id, plan: "free", plan_status: "none", trial_end: null })),
      subscriptions: [],
      billing_customers: [],
      referral_codes: [],
      referrals: [],
      affiliate_ledger: [],
      stripe_events: [],
      team_seats: [],
      audit_log: [],
      app_config: [],
      consents: [],
      contract_requests: [],
    },
    seq: 0,
    rateLimit: 1,
    users: new Map([
      [U1, { email: EMAIL1, confirmed: true }],
      [U2, { email: "other@example.com", confirmed: true }],
    ]),
  };
  const client = {
    from: (t: string) => query(db, t),
    rpc: async () => ({ data: db.rateLimit, error: null }),
    auth: {
      getClaims: async (jwt: string) => {
        const claims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as { sub: string; email?: string };
        return { data: { claims: { ...claims, role: "authenticated", aal: "aal1" } }, error: null };
      },
      admin: {
        mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }) },
        getUserById: async (id: string) => {
          const u = db.users.get(id);
          return u ? { data: { user: { id, email: u.email, email_confirmed_at: u.confirmed ? "2026-01-01T00:00:00Z" : null } }, error: null } : { data: { user: null }, error: { status: 404 } };
        },
      },
    },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return db;
}

/* ------------------------------------------------------------------ Stripe fake */

const PRICES: Record<string, { amount: number; interval: "month" | "year" }> = {
  price_pro_m: { amount: 1200, interval: "month" },
  price_pro_y: { amount: 12000, interval: "year" },
  price_team_m: { amount: 1900, interval: "month" },
};

function stripeSub(id: string, o: Partial<{ customer: string; status: string; user: string; cancelAtPeriodEnd: boolean }> = {}): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    status: o.status ?? "active",
    customer: o.customer ?? "cus_1",
    currency: "eur",
    metadata: { ...(o.user ? { supabase_user_id: o.user } : {}) },
    cancel_at_period_end: !!o.cancelAtPeriodEnd,
    cancel_at: o.cancelAtPeriodEnd ? NOW_S + 30 * 86400 : null,
    canceled_at: null,
    trial_end: null,
    pause_collection: null,
    default_payment_method: "pm_1",
    default_source: null,
    items: { object: "list", data: [{ id: "si_1", quantity: 1, current_period_end: NOW_S + 30 * 86400, price: { id: "price_pro_m", unit_amount: 1200, currency: "eur", recurring: { interval: "month" }, metadata: {}, lookup_key: null } }] },
  } as unknown as Stripe.Subscription;
}

interface FakeStripe {
  api: StripeApi;
  subs: Map<string, Stripe.Subscription>;
  sessions: { params: Stripe.Checkout.SessionCreateParams; key?: string; id: string }[];
  byKey: Map<string, { json: string; id: string }>;
  customers: { email?: string; id: string; metadata?: Record<string, string> }[];
  updates: { id: string; params: Stripe.SubscriptionUpdateParams }[];
  canceled: string[];
}

function fakeStripe(): FakeStripe {
  const f: FakeStripe = { api: null as unknown as StripeApi, subs: new Map(), sessions: [], byKey: new Map(), customers: [], updates: [], canceled: [] };
  let n = 0;
  f.api = {
    customers: {
      create: async (params) => {
        const id = `cus_${++n}`;
        f.customers.push({ id, email: params.email, metadata: params.metadata as Record<string, string> });
        return { id };
      },
      createBalanceTransaction: async () => ({ id: "cbtxn_1" }),
      list: async (params) => ({ data: f.customers.filter((c) => c.email === params.email) as unknown as Stripe.Customer[] }),
    },
    checkout: {
      sessions: {
        create: async (params, options) => {
          const key = options?.idempotencyKey;
          const json = JSON.stringify(params);
          if (key && f.byKey.has(key)) {
            const hit = f.byKey.get(key)!;
            if (hit.json !== json) throw Object.assign(new Error("idempotency"), { type: "StripeIdempotencyError" });
            return { id: hit.id, url: `https://checkout.stripe.com/c/pay/${hit.id}` };
          }
          const id = `cs_test_${++n}`;
          f.sessions.push({ params, key, id });
          if (key) f.byKey.set(key, { json, id });
          return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
        },
      },
    },
    billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.com/p/session/1" }) } },
    subscriptions: {
      retrieve: async (id) => {
        const s = f.subs.get(id);
        if (!s) throw Object.assign(new Error("missing"), { code: "resource_missing" });
        return s;
      },
      update: async (id, params) => {
        f.updates.push({ id, params });
        const s = f.subs.get(id)!;
        const next = { ...s } as Stripe.Subscription & Record<string, unknown>;
        if (params.cancel_at_period_end !== undefined) {
          next.cancel_at_period_end = params.cancel_at_period_end;
          next.cancel_at = params.cancel_at_period_end ? NOW_S + 30 * 86400 : null;
        }
        f.subs.set(id, next);
        return next;
      },
      list: async (params) => ({ data: [...f.subs.values()].filter((s) => s.customer === params.customer) }),
      cancel: async (id) => {
        f.canceled.push(id);
        const s = { ...f.subs.get(id)!, status: "canceled" } as Stripe.Subscription;
        f.subs.set(id, s);
        return s;
      },
    },
    invoicePayments: { list: async () => ({ data: [] }) },
    invoices: { list: async () => ({ data: [] }) },
    promotionCodes: { list: async () => ({ data: [] }) },
    prices: { retrieve: async (id) => ({ id, active: true, unit_amount: PRICES[id]?.amount ?? 0, currency: "eur", recurring: { interval: PRICES[id]?.interval ?? "month" } }) as unknown as Stripe.Price },
    webhooks: sdk.webhooks,
  };
  setStripeApiForTests(f.api);
  return f;
}

/* ------------------------------------------------------------------ helpers */

const LEGAL_ENV: Record<string, string> = {
  VITE_LEGAL_OPERATOR: "Beispiel Trading UG",
  VITE_LEGAL_ADDRESS: "Beispielweg 1 | 10115 Berlin",
  VITE_LEGAL_EMAIL: "kontakt@example.com",
  VITE_LEGAL_DATENSCHUTZ_URL: "https://example.com/datenschutz",
  VITE_LEGAL_AGB_URL: "/agb.html",
};
const MAIL_ENV: Record<string, string> = { RESEND_API_KEY: "re_test", ALERT_FROM: "Trade Journal <mail@example.com>" };
const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_pro_y",
  STRIPE_PRICE_TEAM_MONTHLY: "price_team_m",
  SITE_ORIGIN: "https://journal.example",
  ...LEGAL_ENV,
  ...MAIL_ENV,
};
const set = (env: Record<string, string>, on: boolean) => {
  for (const [k, v] of Object.entries(env)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
};

function req(path: string, init: { body?: unknown; user?: string; email?: string; headers?: Record<string, string> } = {}): Request {
  const h = new Headers(init.headers);
  if (init.user) h.set("authorization", `Bearer ${tokenFor(init.user, init.email)}`);
  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    h.set("content-type", "application/json");
  }
  return new Request(`https://journal.example${path}`, { method: body ? "POST" : "GET", headers: h, body });
}

async function call(fn: (r: Request, c: typeof ctx) => Promise<Response>, r: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fn(r, ctx);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let db: Db;
let stripe: FakeStripe;
let sent: { to: string[]; subject: string; text: string }[];
let HASH = "";

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetPaymentsReportForTests();
  db = fakeDb();
  stripe = fakeStripe();
  set(ENV, true);
  sent = [];
  setMailFetchForTests(async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)) as (typeof sent)[number]);
    return new Response(JSON.stringify({ id: "mail_1" }), { status: 200 });
  });
  HASH = await consentSetHash();
});

afterEach(() => {
  set(ENV, false);
  setSupabaseAdminForTests(null);
  setStripeApiForTests(null);
  setMailFetchForTests(null);
  vi.restoreAllMocks();
});

const order = (over: Record<string, unknown> = {}) => ({
  plan: "pro",
  interval: "month",
  orderId: newOrderId(),
  consents: { terms: true, immediateStart: true },
  consentHash: HASH,
  ...over,
});
const checkout = (body: unknown, user = U1) => call(checkoutFn, req("/api/v1/billing/checkout", { body, user }));

/* ------------------------------------------------------------------ the lock */

describe("the purchase flow stays LOCKED until Stripe and the operator's legal texts are set up", () => {
  it("legalReady follows the browser's rule (Impressum, Datenschutz, AGB)", () => {
    expect(legalReady()).toBe(true);
    delete process.env.VITE_LEGAL_AGB_URL;
    expect(legalReady()).toBe(false);
    process.env.VITE_LEGAL_AGB_URL = "http://insecure.example"; // not https
    expect(legalReady()).toBe(false);
    process.env.VITE_LEGAL_AGB_URL = "/agb.html";
    delete process.env.VITE_LEGAL_OPERATOR;
    expect(legalReady()).toBe(false);
    process.env.VITE_LEGAL_IMPRESSUM_URL = "https://example.com/impressum"; // an own Impressum page is enough
    expect(legalReady()).toBe(true);
  });

  it("without legal texts: 503 purchase_closed, no consent rows, no Stripe session – a Stripe key alone does not open it", async () => {
    set(LEGAL_ENV, false);
    expect(purchaseGate()).toEqual({ open: false, blockedBy: ["legal"] });
    const res = await checkout(order());
    expect(res.status).toBe(503);
    expect((res.body.error as { code: string }).code).toBe("purchase_closed");
    expect(db.tables.consents).toHaveLength(0);
    expect(stripe.sessions).toHaveLength(0);
  });

  it("without Stripe: 503 billing_unavailable (honest 'nicht eingerichtet'), nothing stored", async () => {
    set(ENV, false);
    set(LEGAL_ENV, true);
    const res = await checkout(order());
    expect(res.status).toBe(503);
    expect((res.body.error as { code: string; message: string }).message).toBe("Zahlungen sind noch nicht eingerichtet.");
    expect(db.tables.consents).toHaveLength(0);
  });

  it("billing-status tells the browser: purchaseOpen, why not, Stripe Tax, the consent hash, mail", async () => {
    const open = (await call(statusFn, req("/api/v1/billing/status"))).body.config as Record<string, unknown>;
    expect(open).toMatchObject({ enabled: true, purchaseOpen: true, automaticTax: false, mailReady: true, consentHash: HASH });
    expect(open.purchaseBlockedBy).toBeUndefined();
    set(LEGAL_ENV, false);
    delete process.env.RESEND_API_KEY;
    process.env.STRIPE_AUTOMATIC_TAX = "true";
    const closed = (await call(statusFn, req("/api/v1/billing/status"))).body.config as Record<string, unknown>;
    expect(closed).toMatchObject({ enabled: true, purchaseOpen: false, purchaseBlockedBy: ["legal"], automaticTax: true, mailReady: false });
    delete process.env.STRIPE_AUTOMATIC_TAX;
  });
});

/* ------------------------------------------------------------------ consents */

describe("both consents, with the wording that was shown, stored BEFORE the Checkout Session exists", () => {
  it("a missing box (either one) is refused: 422, nothing stored, no session", async () => {
    for (const consents of [{ terms: true, immediateStart: false }, { terms: false, immediateStart: true }, { terms: false, immediateStart: false }]) {
      const res = await checkout(order({ consents }));
      expect(res.status).toBe(422);
      expect((res.body.error as { code: string }).code).toBe("consent_required");
    }
    expect(db.tables.consents).toHaveLength(0);
    expect(stripe.sessions).toHaveLength(0);
  });

  it("a wording the server does not know (an old page) is refused as consent_outdated", async () => {
    const res = await checkout(order({ consentHash: "0".repeat(64) }));
    expect(res.status).toBe(409);
    expect((res.body.error as { code: string }).code).toBe("consent_outdated");
    expect(db.tables.consents).toHaveLength(0);
    expect(stripe.sessions).toHaveLength(0);
  });

  it("stores who, when and exactly what: two rows with the wording, its hash and version; the session carries order id, time and hash", async () => {
    const body = order({ plan: "team", interval: "year", seats: 3 });
    // the year price of Team is not configured: use the month plan for the happy path
    const res = await checkout({ ...body, interval: "month" });
    expect(res.status).toBe(200);
    const rows = db.tables.consents!;
    expect(rows.map((r) => r.kind).sort()).toEqual(["immediate_start", "terms"]);
    for (const r of rows) {
      expect(r).toMatchObject({ user_id: U1, order_id: body.orderId, text_version: CONSENT_TEXT_VERSION, plan: "team", interval: "month", seats: 3, checkout_session_id: stripe.sessions[0]!.id });
      expect(r.text_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.consent_text).toBe(CONSENT_TEXT[r.kind as "terms" | "immediate_start"]);
      expect(Date.parse(String(r.given_at))).toBeGreaterThan(Date.now() - 60_000);
    }
    const meta = stripe.sessions[0]!.params.metadata!;
    expect(meta).toMatchObject({ order_id: body.orderId, consent_hash: HASH, supabase_user_id: U1 });
    expect(Date.parse(String(meta.consent_at))).toBeGreaterThan(Date.now() - 60_000);
    expect(stripe.sessions[0]!.params.subscription_data?.metadata).toMatchObject({ order_id: body.orderId, consent_hash: HASH });
  });

  it("fails CLOSED: without the table (migration 0016 not applied) nothing is checked out", async () => {
    delete db.tables.consents;
    const res = await checkout(order());
    expect(res.status).toBe(503);
    expect((res.body.error as { code: string }).code).toBe("consent_unavailable");
    expect(stripe.sessions).toHaveLength(0);
  });

  it("the order id must be a UUID", async () => {
    expect((await checkout(order({ orderId: "abc" }))).status).toBe(422);
    expect((await checkout({ plan: "pro", interval: "month" })).status).toBe(422);
  });

  it("paying plans are NOT unlocked by creating the session – only the webhook writes the plan", async () => {
    await checkout(order());
    expect(db.tables.profiles!.find((p) => p.id === U1)).toMatchObject({ plan: "free", plan_status: "none" });
    expect(db.tables.subscriptions).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ idempotency, redirects, button text */

describe("idempotency per order", () => {
  it("a double click (same order id) returns the SAME session; one Stripe session, the evidence is not written twice", async () => {
    const body = order();
    const [a, b] = await Promise.all([checkout(body), checkout(body)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.sessionId).toBe(b.body.sessionId);
    expect(stripe.sessions).toHaveLength(1);
    expect(stripe.sessions[0]!.key).toBe(`tj-checkout-${U1}-${body.orderId}`);
    expect(db.tables.consents).toHaveLength(2);
  });

  it("a new order (new id) is a new session; the same id with other details is refused, never a second session", async () => {
    const body = order();
    await checkout(body);
    const changed = await checkout({ ...body, interval: "year" });
    expect(changed.status).toBe(409);
    expect((changed.body.error as { code: string }).code).toBe("order_changed");
    expect(stripe.sessions).toHaveLength(1);
    expect((await checkout(order())).status).toBe(200);
    expect(stripe.sessions).toHaveLength(2);
  });

  it("the order id is per user: another account with the same id is its own order", async () => {
    const body = order();
    await checkout(body);
    await checkout(body, U2);
    expect(stripe.sessions).toHaveLength(2);
  });
});

describe("success / cancel URLs: this site's origin only", () => {
  it("hostile returnTo values never leave the origin", async () => {
    for (const bad of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "javascript:alert(1)", "/a b", "/%2F%2Fevil.example", "http://journal.example.evil.example", "/x?next=https://evil.example"]) {
      const { success, cancel } = returnUrls("https://journal.example", bad);
      for (const u of [success, cancel]) expect(new URL(u.replace("{CHECKOUT_SESSION_ID}", "cs_x")).origin, bad).toBe("https://journal.example");
    }
    const ok = returnUrls("https://journal.example", "/dev/preise.html#preise");
    expect(ok.success).toBe("https://journal.example/dev/preise.html?billing=success&session_id={CHECKOUT_SESSION_ID}#preise");
    expect(ok.cancel).toBe("https://journal.example/dev/preise.html?billing=cancel#preise");
  });

  it("an origin that is not the configured SITE_ORIGIN (a forged Host header) is refused", () => {
    expect(() => assertSameOrigin("https://evil.example")).toThrow();
    expect(assertSameOrigin("https://journal.example")).toBe("https://journal.example");
    delete process.env.SITE_ORIGIN;
    expect(assertSameOrigin("http://127.0.0.1:4173")).toBe("http://127.0.0.1:4173");
    expect(() => assertSameOrigin("javascript:alert(1)")).toThrow();
  });

  it("the checkout uses them: a hostile returnTo ends up on the pricing page of this site", async () => {
    await checkout(order({ returnTo: "//evil.example/x" }));
    expect(stripe.sessions[0]!.params.success_url).toBe("https://journal.example/?billing=success&session_id={CHECKOUT_SESSION_ID}#preise");
  });
});

describe("the button text beside Stripe's (§ 312j Abs. 3 BGB)", () => {
  it("submit_type pay + a custom text that says the order creates a payment obligation, the renewal and the cancellation", async () => {
    await checkout(order());
    const p = stripe.sessions[0]!.params;
    expect(p.submit_type).toBe("pay");
    const submit = p.custom_text?.submit;
    const text = submit && typeof submit === "object" ? submit.message : "";
    expect(text).toMatch(/zahlungspflichtige Bestellung/);
    expect(text).toMatch(/Testphase \(14 Tage\)/);
    expect(text).toMatch(/verlängert sich automatisch/);
    expect(text).toMatch(/Verträge hier kündigen/);
    expect(text.length).toBeLessThanOrEqual(1200);
    expect(checkoutSubmitText(0)).not.toMatch(/Testphase/);
  });
});

describe("webhook stays the source of truth (fake signature, no network)", () => {
  it("the plan appears only after the verified event; a wrong signature is 400", async () => {
    const { body } = await checkout(order());
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(db.tables.profiles!.find((p) => p.id === U1)!.plan).toBe("free");
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1 }));
    const payload = JSON.stringify({ id: "evt_a", object: "event", type: "customer.subscription.created", created: NOW_S, data: { object: stripe.subs.get("sub_1") }, livemode: false, api_version: "x", pending_webhooks: 1, request: null });
    const bad = await call(webhookFn, new Request("https://journal.example/api/v1/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" }) } }));
    expect(bad.status).toBe(400);
    expect(db.tables.profiles!.find((p) => p.id === U1)!.plan).toBe("free");
    const good = await call(webhookFn, new Request("https://journal.example/api/v1/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) } }));
    expect(good.status).toBe(200);
    expect(db.tables.profiles!.find((p) => p.id === U1)).toMatchObject({ plan: "pro", plan_status: "active" });
  });
});

/* ------------------------------------------------------------------ cancel / withdraw without a login */

function subscribe(user = U1, createdDaysAgo = 1, over: Partial<Parameters<typeof stripeSub>[1]> = {}): void {
  const sub = stripeSub("sub_1", { user, ...over });
  stripe.subs.set("sub_1", sub);
  stripe.customers.push({ id: "cus_1", email: db.users.get(user)!.email, metadata: { supabase_user_id: user } });
  db.tables.subscriptions!.push({
    id: "sub_1",
    user_id: user,
    stripe_customer_id: "cus_1",
    status: over.status ?? "active",
    plan: "pro",
    price_id: "price_pro_m",
    interval: "month",
    seats: 1,
    amount: 1200,
    currency: "eur",
    current_period_end: new Date((NOW_S + 30 * 86400) * 1000).toISOString(),
    cancel_at_period_end: !!over.cancelAtPeriodEnd,
    cancel_at: null,
    canceled_at: null,
    trial_end: null,
    pause_resumes_at: null,
    has_payment_method: true,
    ref_code: null,
    last_event_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date(Date.now() - createdDaysAgo * 86_400_000).toISOString(),
  });
}
const declare = (body: Record<string, unknown>, user?: string, email?: string) => call(contractFn, req("/api/v1/billing/contract", { body, user, email }));
const confirm = (token: string) => call(contractFn, req("/api/v1/billing/contract/confirm", { body: { token } }));
const tokenOfMail = (m: { text: string }) => /\?(?:kuendigen|widerruf)=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;

describe("Kündigung ohne Login (§ 312k BGB)", () => {
  it("the page asks for no login: the declaration is stored with its receipt time and mailed a link; NOTHING changes before the link is opened", async () => {
    subscribe();
    const res = await declare({ kind: "cancel", email: " Trader@Example.com " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "cancel", mail: "sent", next: "check" });
    expect(Date.parse(res.body.receivedAt as string)).toBeGreaterThan(Date.now() - 60_000);
    expect(stripe.updates).toHaveLength(0);
    expect(db.tables.contract_requests).toHaveLength(1);
    const rec = db.tables.contract_requests![0]!;
    expect(rec).toMatchObject({ kind: "cancel", user_id: U1, status: "received" });
    expect(String(rec.email_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rec)).not.toContain("example.com"); // the address itself is not stored
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([EMAIL1]);
    expect(sent[0]!.text).toMatch(/Kündigung für „Trade Journal Pro \(monatlich\)“ am \d\d\.\d\d\.\d{4}, \d\d:\d\d:\d\d Uhr/);
    expect(sent[0]!.text).toContain("https://journal.example/?kuendigen=");
  });

  it("the link executes it once: cancel at the end of the period (cancel_at_period_end), the confirmation mail names content, date + time and the end", async () => {
    subscribe();
    await declare({ kind: "cancel", email: EMAIL1 });
    const token = tokenOfMail(sent[0]!);
    const res = await confirm(token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "cancel", status: "done" });
    expect(res.body.endsAt).toBeTruthy();
    expect(stripe.updates).toEqual([{ id: "sub_1", params: expect.objectContaining({ cancel_at_period_end: true }) }]);
    expect(stripe.canceled).toHaveLength(0);
    expect(db.tables.contract_requests![0]).toMatchObject({ status: "executed", token_hash: null });
    const done = sent[1]!;
    expect(done.subject).toBe("Bestätigung: Kündigung eingegangen");
    expect(done.text).toMatch(/Inhalt: Kündigung des Vertrags „Trade Journal Pro \(monatlich\)“/);
    expect(done.text).toMatch(/Eingegangen: \d\d\.\d\d\.\d{4}, \d\d:\d\d:\d\d Uhr/);
    expect(done.text).toMatch(/Der Vertrag endet am \d\d\.\d\d\.\d{4}/);
    expect(done.text).not.toMatch(/Angebot|Rabatt|Sonderpreis/);
    // the link works once
    const again = await confirm(token);
    expect(again.status).toBe(404);
    expect((again.body.error as { code: string }).code).toBe("unknown_link");
  });

  it("the answer is the same for an address without a contract – and no mail goes out (nobody can probe who has a contract)", async () => {
    subscribe();
    const known = await declare({ kind: "cancel", email: EMAIL1 });
    const unknown = await declare({ kind: "cancel", email: "nobody@example.com" });
    const shape = (r: { body: Record<string, unknown> }) => ({ ...r.body, receivedAt: "x" });
    expect(shape(unknown)).toEqual(shape(known));
    expect(sent).toHaveLength(1); // only the real account got a mail
    expect(db.tables.contract_requests!.find((r) => r.status === "unknown")).toBeTruthy();
  });

  it("a stranger cannot end a contract by typing its address: without the link nothing is executed, a guessed token finds nothing", async () => {
    subscribe();
    await declare({ kind: "cancel", email: EMAIL1 });
    expect((await confirm("A".repeat(43))).status).toBe(404);
    expect((await confirm("short")).status).toBe(422);
    expect(stripe.updates).toHaveLength(0);
  });

  it("a link older than 24 hours is expired and executes nothing", async () => {
    subscribe();
    await declare({ kind: "cancel", email: EMAIL1 });
    db.tables.contract_requests![0]!.received_at = new Date(Date.now() - 25 * 3_600_000).toISOString();
    const res = await confirm(tokenOfMail(sent[0]!));
    expect(res.body).toMatchObject({ status: "expired" });
    expect(stripe.updates).toHaveLength(0);
    expect(db.tables.contract_requests![0]!.status).toBe("expired");
  });

  it("signed in as that address: executed at once (no mail step), the confirmation mail follows", async () => {
    subscribe();
    const res = await declare({ kind: "cancel", email: EMAIL1 }, U1, EMAIL1);
    expect(res.body).toMatchObject({ next: "done", mail: "sent" });
    expect(stripe.updates).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Bestätigung: Kündigung eingegangen");
    // a login of ANOTHER account does not count for this address
    const other = await declare({ kind: "cancel", email: EMAIL1 }, U2, "other@example.com");
    expect(other.body.next).toBe("check");
  });

  it("without a mail service the page is honest: stored, 'unavailable', nothing promised, nothing executed for a visitor", async () => {
    set(MAIL_ENV, false);
    subscribe();
    const res = await declare({ kind: "cancel", email: EMAIL1 });
    expect(res.body).toMatchObject({ mail: "unavailable", next: "check" });
    expect(sent).toHaveLength(0);
    expect(stripe.updates).toHaveLength(0);
    expect(db.tables.contract_requests).toHaveLength(1);
  });

  it("validates the address, rate-limits per address (fail closed) and loses nothing when the record cannot be written", async () => {
    expect((await declare({ kind: "cancel", email: "not-an-email" })).status).toBe(422);
    expect((await declare({ kind: "pause", email: EMAIL1 })).status).toBe(422);
    db.rateLimit = 99;
    expect((await declare({ kind: "cancel", email: EMAIL1 })).status).toBe(429);
    db.rateLimit = 1;
    subscribe();
    delete db.tables.contract_requests;
    const res = await declare({ kind: "cancel", email: EMAIL1 });
    expect(res.status).toBe(503); // never "received" when it was not stored
    expect(normalizeEmail(" A@B.CO ")).toBe("a@b.co");
  });
});

describe("Widerruf ohne Login (§ 356a BGB)", () => {
  it("within 14 days: the link ends the contract at once; the mail names name, contract, receipt and that the refund is settled separately", async () => {
    subscribe(U1, 3);
    await declare({ kind: "withdraw", email: EMAIL1, name: "Erika Muster", contract: "Pro, bestellt am 04.11." });
    expect(stripe.canceled).toHaveLength(0);
    const res = await confirm(tokenOfMail(sent[0]!));
    expect(res.body).toMatchObject({ kind: "withdraw", status: "done" });
    expect(stripe.canceled).toEqual(["sub_1"]);
    expect(db.tables.profiles!.find((p) => p.id === U1)).toMatchObject({ plan: "free" });
    const mail = sent[1]!.text;
    expect(mail).toMatch(/Inhalt: Widerruf des Vertrags/);
    expect(mail).toContain("Name: Erika Muster");
    expect(mail).toContain("Angabe zum Vertrag: Pro, bestellt am 04.11.");
    expect(mail).toMatch(/Eingegangen: \d\d\.\d\d\.\d{4}, \d\d:\d\d:\d\d Uhr/);
    expect(mail).toMatch(/Den Betrag teilen wir dir getrennt mit/);
  });

  it("after 14 days: 'late' – the contract continues, nothing is cancelled, the mail says so and points to the cancellation", async () => {
    subscribe(U1, 20);
    await declare({ kind: "withdraw", email: EMAIL1, name: "E. M." });
    const res = await confirm(tokenOfMail(sent[0]!));
    expect(res.body).toMatchObject({ status: "late" });
    expect(stripe.canceled).toHaveLength(0);
    expect(stripe.updates).toHaveLength(0);
    expect(sent[1]!.text).toMatch(/Widerrufsfrist von 14 Tagen seit Vertragsschluss ist abgelaufen/);
    expect(sent[1]!.text).toMatch(/Verträge hier kündigen/);
  });

  it("a running contract is required: none → status none, no mail", async () => {
    subscribe(U1, 2, { status: "canceled" });
    await declare({ kind: "withdraw", email: EMAIL1, name: "E. M." });
    expect(sent).toHaveLength(1); // the link mail only – an ended contract has nothing to confirm
    const res = await confirm(tokenOfMail(sent[0]!));
    expect(res.body.status).toBe("none");
    expect(sent).toHaveLength(1);
  });
});

describe("in-app cancellation (signed in): a record and the confirmation mail (§ 312k Abs. 4)", () => {
  it("billing-portal cancel answers with the mail state and leaves a record", async () => {
    subscribe();
    const res = await call(portalFn, req("/api/v1/billing/portal", { body: { action: "cancel" }, user: U1, email: EMAIL1 }));
    expect(res.status).toBe(200);
    expect(res.body.mail).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([EMAIL1]);
    expect(sent[0]!.text).toMatch(/Der Vertrag endet am/);
    expect(db.tables.contract_requests![0]).toMatchObject({ kind: "cancel", user_id: U1, status: "executed" });
  });

  it("without mail it says 'unavailable' (the cancellation itself happened)", async () => {
    set(MAIL_ENV, false);
    subscribe();
    const res = await call(portalFn, req("/api/v1/billing/portal", { body: { action: "cancel" }, user: U1, email: EMAIL1 }));
    expect(res.body.mail).toBe("unavailable");
    expect(stripe.updates).toHaveLength(1);
  });

  it("the reason comes AFTER: 'feedback' only works once cancelled and changes nothing about the cancellation", async () => {
    subscribe();
    const early = await call(portalFn, req("/api/v1/billing/portal", { body: { action: "feedback", reason: "too_expensive" }, user: U1, email: EMAIL1 }));
    expect(early.status).toBe(409);
    await call(portalFn, req("/api/v1/billing/portal", { body: { action: "cancel" }, user: U1, email: EMAIL1 }));
    const late = await call(portalFn, req("/api/v1/billing/portal", { body: { action: "feedback", reason: "too_expensive", comment: "zu teuer" }, user: U1, email: EMAIL1 }));
    expect(late.status).toBe(200);
    const last = stripe.updates.at(-1)!.params;
    expect(last.cancel_at_period_end).toBeUndefined();
    expect(last.cancellation_details).toMatchObject({ feedback: "too_expensive", comment: "zu teuer" });
  });
});

describe("the contract mails", () => {
  it("content, date AND time of receipt, end of the contract – and nothing else (no price, no offer)", () => {
    const at = new Date("2026-11-07T13:32:05Z");
    expect(formatStamp(at)).toBe("07.11.2026, 14:32:05 Uhr (Europe/Berlin)");
    const m = buildContractMail({ kind: "cancel", step: "done", receivedAt: at, confirmedAt: at, endsAt: new Date("2026-12-07T00:00:00Z"), plan: "premium", interval: "year" });
    expect(m.text).toContain("Kündigung des Vertrags „Trade Journal Premium (jährlich)“");
    expect(m.text).toContain("Eingegangen: 07.11.2026, 14:32:05 Uhr (Europe/Berlin)");
    expect(m.text).toContain("Der Vertrag endet am 07.12.2026");
    expect(m.text).toContain("dauerhaften Datenträger");
    expect(m.text).not.toMatch(/€|Angebot|Rabatt/);
    expect(buildContractMail({ kind: "cancel", step: "verify", receivedAt: at, link: "https://x.example/?kuendigen=abc" }).subject).toBe("Bitte bestätige deine Kündigung");
  });
});

describe("Paket B: a preselection that came with a link is only a SUGGESTION – the server validates plan, interval and seats again", () => {
  it("Team seats are clamped to 2…50 whatever the link said; the price is the configured one, never a number from the browser", async () => {
    for (const [asked, quantity] of [
      [1, 2],
      [2, 2],
      [3, 3],
      [500, 50],
    ] as const) {
      const res = await checkout({ ...order({ plan: "team", interval: "month", seats: asked }), price: "price_evil", amount: 1, unit_amount: 1 });
      expect(res.status, `seats ${asked}`).toBe(200);
      const params = stripe.sessions.at(-1)!.params;
      expect(params.line_items?.[0]?.quantity, `seats ${asked}`).toBe(quantity);
      expect(params.line_items?.[0]?.price).toBe("price_team_m");
      expect(JSON.stringify(params)).not.toContain("price_evil");
    }
  });

  it("an unknown or free plan, an unknown interval and absurd seat counts are refused before anything is stored or created", async () => {
    const before = stripe.sessions.length;
    for (const bad of [{ plan: "enterprise" }, { plan: "free" }, { plan: "pro", interval: "week" }, { plan: "team", interval: "month", seats: 100_000 }, { plan: "team", interval: "month", seats: -3 }, { plan: "pro", interval: "month", seats: 1.5 }]) {
      const res = await checkout(order(bad));
      expect([400, 422], JSON.stringify(bad)).toContain(res.status);
    }
    expect(stripe.sessions).toHaveLength(before);
  });
});

/* ------------------------------------------------------------------ Paket V: the order paid inside the app (Stripe Elements) */

interface Embedded {
  intents: Map<string, Stripe.SetupIntent>;
  created: { params: Stripe.SubscriptionCreateParams; key?: string; id: string }[];
}

/** Adds what the embedded order needs to the fake: SetupIntents and `subscriptions.create` (idempotent per key, like Stripe). */
function embedded(): Embedded {
  const e: Embedded = { intents: new Map(), created: [] };
  const byKey = new Map<string, Stripe.Subscription>();
  let n = 0;
  stripe.api.setupIntents = {
    create: async (params, options) => {
      const id = `seti_test${String(++n).padStart(4, "0")}`;
      const si = { id, object: "setup_intent", client_secret: `${id}_secret_abc`, status: "requires_payment_method", customer: params.customer, payment_method: null, metadata: params.metadata, usage: params.usage } as unknown as Stripe.SetupIntent;
      e.intents.set(id, si);
      void options;
      return si;
    },
    retrieve: async (id) => {
      const si = e.intents.get(id);
      if (!si) throw Object.assign(new Error("missing"), { code: "resource_missing", statusCode: 404 });
      return si;
    },
  };
  stripe.api.subscriptions.create = async (params, options) => {
    const key = options?.idempotencyKey;
    if (key && byKey.has(key)) return byKey.get(key)!;
    const id = `sub_emb_${++n}`;
    const trial = !!params.trial_period_days;
    const sub = {
      ...stripeSub(id, { customer: String(params.customer), status: trial ? "trialing" : "incomplete", user: (params.metadata as Record<string, string>).supabase_user_id }),
      metadata: params.metadata,
      latest_invoice: trial ? null : { id: `in_${n}`, object: "invoice", confirmation_secret: { client_secret: `pi_${n}_secret_xyz`, type: "payment_intent" } },
    } as unknown as Stripe.Subscription;
    e.created.push({ params, key, id });
    stripe.subs.set(id, sub);
    if (key) byKey.set(key, sub);
    return sub;
  };
  return e;
}

const subscribeCall = (body: unknown, user = U1) => call(subscribeFn, req("/api/v1/billing/subscribe", { body, user }));
/** What Stripe.js does in the browser between the two calls: the card is confirmed on the intent (we never see it). */
function confirmCard(e: Embedded, secret: string): string {
  const id = secret.split("_secret_")[0]!;
  const si = e.intents.get(id)!;
  e.intents.set(id, { ...si, status: "succeeded", payment_method: { id: "pm_card_visa", object: "payment_method", card: { brand: "visa", last4: "4242" } } } as unknown as Stripe.SetupIntent);
  return id;
}

describe("Paket V: billing-subscribe (the card goes from the browser to Stripe, never through us)", () => {
  it("trial: a SetupIntent first – NO subscription before the card is confirmed; the evidence is stored the same way as for Checkout", async () => {
    const e = embedded();
    const body = order();
    const res = await subscribeCall(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "setup", trialDays: 14, subscriptionId: null });
    expect(String(res.body.clientSecret)).toMatch(/^seti_\w+_secret_/);
    const si = [...e.intents.values()][0]!;
    expect(si.metadata).toMatchObject({ tj_kind: "tj_subscription", price: "price_pro_m", seats: "1", trial_days: "14", order_id: body.orderId, supabase_user_id: U1, consent_hash: HASH });
    expect(e.created).toHaveLength(0);
    expect(db.tables.consents!.map((r) => r.kind).sort()).toEqual(["immediate_start", "terms"]);
    expect(stripe.sessions).toHaveLength(0);
    // nothing is unlocked by it
    expect(db.tables.profiles!.find((p) => p.id === U1)).toMatchObject({ plan: "free", plan_status: "none" });
  });

  it("trial, second step: only a SUCCEEDED intent of THIS user and order makes the subscription (trial, the card as default) – once", async () => {
    const e = embedded();
    const body = order();
    const first = await subscribeCall(body);
    const id = String(first.body.clientSecret).split("_secret_")[0]!;
    const early = await subscribeCall({ ...body, setupIntent: id });
    expect(early.status).toBe(409);
    expect((early.body.error as { code: string }).code).toBe("card_unconfirmed");
    confirmCard(e, String(first.body.clientSecret));
    expect((await subscribeCall({ ...body, setupIntent: id }, U2)).status).toBe(404); // another account
    expect((await subscribeCall({ ...body, orderId: newOrderId(), setupIntent: id })).status).toBe(404); // another order
    const done = await subscribeCall({ ...body, setupIntent: id });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ kind: "created", trialDays: 14, card: { brand: "visa", last4: "4242" } });
    expect(e.created).toHaveLength(1);
    expect(e.created[0]!.params).toMatchObject({ default_payment_method: "pm_card_visa", trial_period_days: 14, items: [{ price: "price_pro_m", quantity: 1 }] });
    expect(e.created[0]!.key).toBe(`tj-sub-${U1}-${body.orderId}`);
    // a lost answer: the same call again gives the same subscription
    const again = await subscribeCall({ ...body, setupIntent: id });
    expect(again.body.subscriptionId).toBe(done.body.subscriptionId);
  });

  it("the webhook (setup_intent.succeeded) makes the same subscription if the app's second step never arrives", async () => {
    const e = embedded();
    const body = order();
    const first = await subscribeCall(body);
    const id = confirmCard(e, String(first.body.clientSecret));
    const payload = JSON.stringify({ id: "evt_seti", object: "event", type: "setup_intent.succeeded", created: NOW_S, data: { object: { ...e.intents.get(id)!, payment_method: "pm_card_visa" } }, livemode: false, api_version: "x", pending_webhooks: 1, request: null });
    const res = await call(webhookFn, new Request("https://journal.example/api/v1/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) } }));
    expect(res.status).toBe(200);
    expect(e.created).toHaveLength(1);
    expect(e.created[0]!.key).toBe(`tj-sub-${U1}-${body.orderId}`);
    // and the app's late second step gets that one back, not a second subscription
    await subscribeCall({ ...body, setupIntent: id });
    expect(new Set(e.created.map((c) => c.id)).size).toBe(1);
  });

  it("no trial: the subscription waits for its first payment (default_incomplete) and hands back only the invoice's client secret", async () => {
    process.env.TRIAL_DAYS = "0";
    const e = embedded();
    const body = order({ interval: "year" });
    const res = await subscribeCall(body);
    delete process.env.TRIAL_DAYS;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "payment", trialDays: 0 });
    expect(String(res.body.clientSecret)).toMatch(/^pi_\w+_secret_/);
    expect(e.created[0]!.params).toMatchObject({ payment_behavior: "default_incomplete", items: [{ price: "price_pro_y", quantity: 1 }] });
    expect(e.created[0]!.params.expand).toEqual(["latest_invoice.confirmation_secret"]);
    expect(e.intents.size).toBe(0);
    // `incomplete` grants nothing: the plan stays free until the webhook says otherwise
    expect(db.tables.profiles!.find((p) => p.id === U1)).toMatchObject({ plan: "free" });
  });

  it("same guards as Checkout: both boxes, the current wording, a UUID order id; Stripe Tax on → 409 embedded_unavailable before anything is stored", async () => {
    embedded();
    expect((await subscribeCall(order({ consents: { terms: true, immediateStart: false } }))).status).toBe(422);
    expect((await subscribeCall(order({ consentHash: "0".repeat(64) }))).status).toBe(409);
    expect((await subscribeCall(order({ orderId: "abc" }))).status).toBe(422);
    process.env.STRIPE_AUTOMATIC_TAX = "true";
    const taxed = await subscribeCall(order());
    delete process.env.STRIPE_AUTOMATIC_TAX;
    expect(taxed.status).toBe(409);
    expect((taxed.body.error as { code: string }).code).toBe("embedded_unavailable");
    expect(db.tables.consents).toHaveLength(0);
  });

  it("the request schema has no field for card data: an order body with a card number is the same order, the number is dropped", async () => {
    const e = embedded();
    const res = await subscribeCall({ ...order(), number: "4242424242424242", card: { number: "4242424242424242", cvc: "123" } });
    expect(res.status).toBe(200);
    const stored = JSON.stringify({ consents: db.tables.consents, intents: [...e.intents.values()], audit: db.tables.audit_log });
    expect(stored).not.toContain("4242424242424242");
  });
});

