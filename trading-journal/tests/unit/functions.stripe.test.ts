// @vitest-environment node
/// <reference types="node" />
/**
 * P10 billing functions (`netlify/functions/billing-*.mts`, `stripe-webhook.mts`, `_lib/stripe.ts`, `_lib/plan.ts`
 * feature gates) against an in-memory Supabase admin fake (tables with unique keys, RPC, auth claims) and a fake Stripe
 * API. Webhook signatures use the REAL Stripe SDK (`generateTestHeaderString`) – nothing goes over the network.
 * Relative imports only (the functions know no `@/` alias).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { paymentsConfigured, requireFeature, requireLimit } from "../../netlify/functions/_lib/plan";
import { EXPORT_TABLES } from "../../netlify/functions/_lib/account";
import {
  assignSeat,
  cancelSubscription,
  mapStatus,
  newRefCode,
  pickCurrent,
  planOfPrice,
  releaseSeat,
  rowFromSubscription,
  setStripeApiForTests,
  type StripeApi,
  type SubscriptionRow,
} from "../../netlify/functions/_lib/stripe";
import statusFn from "../../netlify/functions/billing-status.mts";
import checkoutFn from "../../netlify/functions/billing-checkout.mts";
import portalFn from "../../netlify/functions/billing-portal.mts";
import codeFn from "../../netlify/functions/billing-code.mts";
import referralFn from "../../netlify/functions/billing-referral.mts";
import webhookFn from "../../netlify/functions/stripe-webhook.mts";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof statusFn>[1];
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const WHSEC = "whsec_test_secret";
const sdk = new Stripe("sk_test_dummy");

/* ------------------------------------------------------------------ Supabase fake */

type Row = Record<string, unknown>;
const UNIQUE: Record<string, string[][]> = {
  profiles: [["id"]],
  subscriptions: [["id"]],
  billing_customers: [["user_id"], ["stripe_customer_id"]],
  referral_codes: [["user_id"], ["code"]],
  referrals: [["referred_id"]],
  affiliate_ledger: [["stripe_invoice_id", "kind"]],
  stripe_events: [["id"]],
  team_seats: [["member_id"]],
};

/** Foreign keys to auth.users per table (0002): a write for a deleted user fails with 23503, like Postgres. */
const USER_FKS: Record<string, string[]> = {
  subscriptions: ["user_id"],
  billing_customers: ["user_id"],
  referrals: ["referrer_id", "referred_id"],
  affiliate_ledger: ["referrer_id"],
  team_seats: ["owner_id", "member_id"],
};

interface Db {
  /** Users removed by `auth.admin.deleteUser` (their rows are gone; new rows pointing at them violate the FK). */
  deletedUsers: Set<string>;
  tables: Record<string, Row[] | undefined>;
  seq: number;
  rpcHits: number;
  rateLimit: number;
  /** Users with a verified TOTP factor (`auth.admin.mfa.listFactors`). */
  mfa: Set<string>;
}

function query(db: Db, table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  let payload: Row | Row[] = {};
  let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  let orderBy: { col: string; asc: boolean } | null = null;
  let limitN: number | null = null;
  let single = false;
  let head = false;
  const conflictKeys = (row: Row, keys: string[]) => keys.every((k) => row[k] !== undefined && row[k] !== null);
  const clash = (rows: Row[], row: Row, ignore?: Row) =>
    (UNIQUE[table] ?? []).find((keys) => conflictKeys(row, keys) && rows.some((r) => r !== ignore && keys.every((k) => r[k] === row[k])));
  const exec = async (): Promise<{ data: unknown; error: { code: string; message?: string } | null; count?: number }> => {
    const rows = db.tables[table];
    if (!rows) return { data: null, error: { code: "PGRST205", message: "missing" } };
    if (op === "insert" || op === "upsert") {
      for (const raw of Array.isArray(payload) ? payload : [payload]) {
        const row: Row = { ...raw };
        if ((USER_FKS[table] ?? []).some((c) => typeof row[c] === "string" && db.deletedUsers.has(row[c] as string))) return { data: null, error: { code: "23503" } };
        if ((table === "referrals" || table === "affiliate_ledger") && row.id === undefined) row.id = ++db.seq;
        row.updated_at ??= new Date(Date.now() + ++db.seq).toISOString();
        row.created_at ??= new Date().toISOString();
        if (op === "upsert" && opts.onConflict) {
          const keys = opts.onConflict.split(",");
          const hit = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (hit) {
            if (!opts.ignoreDuplicates) Object.assign(hit, raw, { updated_at: row.updated_at });
            continue;
          }
        }
        if (clash(rows, row)) return { data: null, error: { code: "23505" } };
        rows.push(row);
      }
      return { data: null, error: null };
    }
    const hits = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      for (const r of hits) Object.assign(r, payload, { updated_at: new Date(Date.now() + ++db.seq).toISOString() });
      return { data: null, error: null };
    }
    if (op === "delete") {
      db.tables[table] = rows.filter((r) => !hits.includes(r));
      return { data: null, error: null };
    }
    let out = [...hits];
    if (orderBy) {
      const { col, asc } = orderBy;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (limitN !== null) out = out.slice(0, limitN);
    if (head) return { data: null, error: null, count: hits.length };
    return { data: single ? (out[0] ? { ...out[0] } : null) : out.map((r) => ({ ...r })), error: null };
  };
  const q = {
    select: (_cols?: string, o?: { head?: boolean; count?: string }) => ((head = !!o?.head), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    order: (col: string, o?: { ascending?: boolean }) => ((orderBy = { col, asc: o?.ascending !== false }), q),
    limit: (n: number) => ((limitN = n), q),
    range: () => q,
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
const tokenFor = (sub: string, aal: "aal1" | "aal2" = "aal1") => `eyJhbGciOiJFUzI1NiJ9.${b64url(JSON.stringify({ sub, aal }))}.c2ln`;

function fakeDb(): Db {
  const db: Db = {
    deletedUsers: new Set(),
    tables: {
      profiles: [U1, U2, U3].map((id) => ({ id, plan: "free", plan_status: "none", trial_end: null })),
      subscriptions: [],
      billing_customers: [],
      referral_codes: [],
      referrals: [],
      affiliate_ledger: [],
      stripe_events: [],
      team_seats: [],
      audit_log: [],
    },
    seq: 0,
    rpcHits: 0,
    rateLimit: 1,
    mfa: new Set(),
  };
  const client = {
    from: (t: string) => query(db, t),
    rpc: async () => {
      db.rpcHits++;
      return { data: db.rateLimit, error: null };
    },
    auth: {
      getClaims: async (jwt: string) => {
        try {
          const claims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as { sub: string; aal?: string };
          return { data: { claims: { ...claims, role: "authenticated", aal: claims.aal ?? "aal1" } }, error: null };
        } catch {
          return { data: null, error: { message: "bad" } };
        }
      },
      admin: {
        mfa: { listFactors: async ({ userId }: { userId: string }) => ({ data: { factors: db.mfa.has(userId) ? [{ status: "verified" }] : [] }, error: null }) },
      },
    },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return db;
}

/* ------------------------------------------------------------------ Stripe fake */

const NOW = Math.floor(Date.now() / 1000);
const PRICES: Record<string, { amount: number; interval: "month" | "year" }> = {
  price_pro_m: { amount: 1200, interval: "month" },
  price_pro_y: { amount: 12000, interval: "year" },
  price_prem_m: { amount: 2400, interval: "month" },
  price_team_m: { amount: 1900, interval: "month" },
};

function stripeSub(
  id: string,
  o: Partial<{
    customer: string;
    status: string;
    price: string;
    quantity: number;
    user: string;
    trialEnd: number | null;
    cancelAtPeriodEnd: boolean;
    ref: string;
    paused: boolean;
  }> = {},
): Stripe.Subscription {
  const price = o.price ?? "price_pro_m";
  return {
    id,
    object: "subscription",
    status: o.status ?? "trialing",
    customer: o.customer ?? "cus_A",
    currency: "eur",
    metadata: { ...(o.user ? { supabase_user_id: o.user } : {}), ...(o.ref ? { ref: o.ref } : {}) },
    cancel_at_period_end: !!o.cancelAtPeriodEnd,
    cancel_at: o.cancelAtPeriodEnd ? NOW + 30 * 86400 : null,
    canceled_at: null,
    trial_end: o.trialEnd === undefined ? NOW + 14 * 86400 : o.trialEnd,
    pause_collection: o.paused ? { behavior: "void", resumes_at: NOW + 30 * 86400 } : null,
    default_payment_method: "pm_1",
    default_source: null,
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          quantity: o.quantity ?? 1,
          current_period_end: NOW + 30 * 86400,
          price: {
            id: price,
            unit_amount: PRICES[price]?.amount ?? 999,
            currency: "eur",
            recurring: { interval: PRICES[price]?.interval ?? "month" },
            metadata: {},
            lookup_key: null,
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

interface FakeStripe {
  api: StripeApi;
  subs: Map<string, Stripe.Subscription>;
  checkout: Stripe.Checkout.SessionCreateParams[];
  portal: Stripe.BillingPortal.SessionCreateParams[];
  customers: { params: Stripe.CustomerCreateParams; key?: string }[];
  balance: { customer: string; amount: number; key?: string }[];
  updates: { id: string; params: Stripe.SubscriptionUpdateParams }[];
  canceled: string[];
  retrieveFails: boolean;
}

function fakeStripe(): FakeStripe {
  const f: FakeStripe = {
    api: null as unknown as StripeApi,
    subs: new Map(),
    checkout: [],
    portal: [],
    customers: [],
    balance: [],
    updates: [],
    canceled: [],
    retrieveFails: false,
  };
  let n = 0;
  f.api = {
    customers: {
      create: async (params, options) => {
        f.customers.push({ params, key: options?.idempotencyKey });
        return { id: `cus_${++n}` };
      },
      createBalanceTransaction: async (customer, params, options) => {
        f.balance.push({ customer, amount: params.amount, key: options?.idempotencyKey });
        return { id: `cbtxn_${++n}` };
      },
    },
    checkout: {
      sessions: {
        create: async (params) => {
          f.checkout.push(params);
          return { id: `cs_test_${++n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params) => {
          f.portal.push(params);
          return { url: `https://billing.stripe.com/p/session/${++n}` };
        },
      },
    },
    subscriptions: {
      retrieve: async (id) => {
        if (f.retrieveFails) throw Object.assign(new Error("down"), { type: "StripeConnectionError" });
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
          next.cancel_at = params.cancel_at_period_end ? NOW + 30 * 86400 : null;
        }
        if (params.pause_collection === "") next.pause_collection = null;
        else if (params.pause_collection) next.pause_collection = { behavior: "void", resumes_at: params.pause_collection.resumes_at ?? null };
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
    invoices: {
      list: async () => ({
        data: [
          {
            id: "in_2",
            number: "TJ-0002",
            status: "paid",
            total: 1200,
            currency: "eur",
            created: NOW,
            hosted_invoice_url: "https://invoice.stripe.com/i/2",
            invoice_pdf: "https://pay.stripe.com/invoice/2/pdf",
          },
          { id: "in_d", number: null, status: "draft", total: 0, currency: "eur", created: NOW, hosted_invoice_url: null, invoice_pdf: null },
        ] as unknown as Stripe.Invoice[],
      }),
    },
    promotionCodes: {
      list: async (params) => {
        if (params.code?.toUpperCase() !== "TRADER20") return { data: [] };
        return {
          data: [
            {
              id: "promo_1",
              code: "TRADER20",
              active: true,
              expires_at: null,
              max_redemptions: null,
              times_redeemed: 3,
              restrictions: { first_time_transaction: true, minimum_amount: null, minimum_amount_currency: null },
              promotion: {
                type: "coupon",
                coupon: {
                  id: "co_1",
                  valid: true,
                  percent_off: 20,
                  amount_off: null,
                  currency: null,
                  duration: "repeating",
                  duration_in_months: 3,
                  applies_to: undefined,
                },
              },
            } as unknown as Stripe.PromotionCode,
          ],
        };
      },
    },
    prices: {
      retrieve: async (id) =>
        ({
          id,
          active: true,
          unit_amount: PRICES[id]?.amount ?? 0,
          currency: "eur",
          recurring: { interval: PRICES[id]?.interval ?? "month" },
        }) as unknown as Stripe.Price,
    },
    webhooks: sdk.webhooks,
  };
  setStripeApiForTests(f.api);
  return f;
}

/* ------------------------------------------------------------------ helpers */

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_pro_y",
  STRIPE_PRICE_PREMIUM_MONTHLY: "price_prem_m",
  STRIPE_PRICE_TEAM_MONTHLY: "price_team_m",
  SITE_ORIGIN: "https://journal.example",
};
const OPTIONAL_ENV = [
  "STRIPE_TRIAL_CARDLESS",
  "STRIPE_AUTOMATIC_TAX",
  "TRIAL_DAYS",
  "REFERRAL_TRIAL_DAYS",
  "REFERRAL_REWARD_CENTS",
  "STRIPE_PRICE_PREMIUM_YEARLY",
  "STRIPE_PRICE_TEAM_YEARLY",
];

function setEnv(on: boolean): void {
  for (const [k, v] of Object.entries(ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

function req(path: string, init: { method?: string; body?: unknown; user?: string; aal?: "aal1" | "aal2"; headers?: Record<string, string> } = {}): Request {
  const h = new Headers(init.headers);
  if (init.user) h.set("authorization", `Bearer ${tokenFor(init.user, init.aal)}`);
  let body: string | undefined;
  if (init.body !== undefined) {
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    if (!h.has("content-type")) h.set("content-type", "application/json");
  }
  return new Request(`https://journal.example${path}`, { method: init.method ?? (body ? "POST" : "GET"), headers: h, body });
}

async function call(fn: (r: Request, c: typeof ctx) => Promise<Response>, r: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fn(r, ctx);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let evtSeq = 0;
function event(type: string, object: unknown, created = NOW): Stripe.Event {
  return {
    id: `evt_${++evtSeq}`,
    object: "event",
    type,
    created,
    data: { object },
    livemode: false,
    api_version: "2026-09-30.endive",
    pending_webhooks: 1,
    request: null,
  } as unknown as Stripe.Event;
}

async function deliver(ev: Stripe.Event, secret = WHSEC): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify(ev);
  const sig = sdk.webhooks.generateTestHeaderString({ payload, secret });
  return call(webhookFn, req("/api/v1/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": sig } }));
}

const profile = (db: Db, id: string) => db.tables.profiles!.find((p) => p.id === id)!;

let db: Db;
let stripe: FakeStripe;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = fakeDb();
  stripe = fakeStripe();
  setEnv(true);
});

afterEach(() => {
  setEnv(false);
  for (const k of OPTIONAL_ENV) delete process.env[k];
  setSupabaseAdminForTests(null);
  setStripeApiForTests(null);
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ mapping */

describe("mapping", () => {
  it("maps prices via env, metadata and lookup keys", () => {
    expect(planOfPrice({ id: "price_pro_y", metadata: {}, lookup_key: null, recurring: null } as never)).toEqual({ plan: "pro", interval: "year" });
    expect(planOfPrice({ id: "price_x", metadata: { plan: "premium" }, lookup_key: null, recurring: { interval: "month" } } as never)).toEqual({
      plan: "premium",
      interval: "month",
    });
    expect(planOfPrice({ id: "price_y", metadata: {}, lookup_key: "team_yearly", recurring: { interval: "year" } } as never)).toEqual({
      plan: "team",
      interval: "year",
    });
    expect(planOfPrice({ id: "price_z", metadata: {}, lookup_key: null, recurring: null } as never)).toBeNull();
  });

  it("paused collection counts as paused, unknown statuses as incomplete", () => {
    expect(mapStatus("active", true)).toBe("paused");
    expect(mapStatus("past_due", false)).toBe("past_due");
    expect(mapStatus("weird", false)).toBe("incomplete");
  });

  it("builds the row from the SubscriptionItem (period end, seats, amount)", () => {
    const row = rowFromSubscription(stripeSub("sub_1", { price: "price_team_m", quantity: 4, ref: "abcd2345" }), U1, NOW);
    expect(row).toMatchObject({
      plan: "team",
      interval: "month",
      seats: 4,
      amount: 7600,
      stripe_customer_id: "cus_A",
      ref_code: "ABCD2345",
      has_payment_method: true,
    });
    expect(row.current_period_end).toBe(new Date((NOW + 30 * 86400) * 1000).toISOString());
  });

  it("picks the granting subscription over newer canceled ones", () => {
    const base = rowFromSubscription(stripeSub("sub_a"), U1);
    const rows: SubscriptionRow[] = [
      { ...base, id: "sub_old", status: "canceled", plan: "premium", updated_at: "2026-10-12" },
      { ...base, id: "sub_live", status: "active", plan: "pro", updated_at: "2026-09-01" },
    ];
    expect(pickCurrent(rows)?.id).toBe("sub_live");
    expect(pickCurrent([])).toBeNull();
  });

  it("referral codes avoid ambiguous characters", () => {
    const code = newRefCode(new Uint8Array([0, 8, 14, 24, 31, 40, 200, 255]));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it("exports the billing tables without other people's ids", () => {
    const refs = EXPORT_TABLES.find((t) => t.table === "referrals")!;
    expect(refs.columns).not.toMatch(/referred_id|\*/);
    expect(EXPORT_TABLES.map((t) => t.table)).toEqual(
      expect.arrayContaining(["subscriptions", "billing_customers", "referral_codes", "affiliate_ledger", "team_seats"]),
    );
  });
});

/* ------------------------------------------------------------------ status */

describe("GET /api/v1/billing/status", () => {
  it("anonymous without Stripe env: payments not set up, nothing else", async () => {
    setEnv(false);
    const { status, body } = await call(statusFn, req("/api/v1/billing/status"));
    expect(status).toBe(200);
    expect(body.config).toMatchObject({ enabled: false, reason: "stripe_missing", trialDays: 14, prices: {}, available: [] });
    expect(body.plan).toBeNull();
  });

  it("says whether the AI coach can answer – the pricing page only sells it with a key (Review F06)", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect((await call(statusFn, req("/api/v1/billing/status"))).body.config).toMatchObject({ coachAi: false });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect((await call(statusFn, req("/api/v1/billing/status"))).body.config).toMatchObject({ coachAi: true });
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  });

  it("reports the real Stripe prices and the buyable plans", async () => {
    const { body } = await call(statusFn, req("/api/v1/billing/status"));
    const config = body.config as { enabled: boolean; prices: Record<string, Record<string, { amount: number }>>; available: string[] };
    expect(config.enabled).toBe(true);
    expect(config.prices.pro?.month?.amount).toBe(1200);
    expect(config.prices.pro?.year?.amount).toBe(12000);
    expect(config.available).toEqual(["pro", "premium", "team"]);
  });

  it("signed in: plan from profiles, the current subscription and invoices (drafts hidden)", async () => {
    stripe.subs.set("sub_1", stripeSub("sub_1", { status: "active", user: U1, trialEnd: null }));
    await deliver(event("customer.subscription.created", stripe.subs.get("sub_1")));
    const { body } = await call(statusFn, req("/api/v1/billing/status?invoices=1", { user: U1 }));
    expect(body.plan).toMatchObject({ plan: "pro", status: "active" });
    expect(body.subscription).toMatchObject({ id: "sub_1", plan: "pro", interval: "month", seats: 1, amount: 1200, cancelAtPeriodEnd: false });
    expect(body.hasCustomer).toBe(true);
    expect((body.invoices as unknown[]).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ checkout */

describe("POST /api/v1/billing/checkout", () => {
  const checkout = (body: unknown, user = U1) => call(checkoutFn, req("/api/v1/billing/checkout", { body, user }));

  it("needs a login", async () => {
    const res = await call(checkoutFn, req("/api/v1/billing/checkout", { body: { plan: "pro", interval: "month" } }));
    expect(res.status).toBe(401);
  });

  it("503 with an honest message while payments are not set up", async () => {
    setEnv(false);
    const res = await checkout({ plan: "pro", interval: "month" });
    expect(res.status).toBe(503);
    expect((res.body.error as { message: string }).message).toBe("Zahlungen sind noch nicht eingerichtet.");
  });

  it("creates a subscription checkout with trial, promo field, metadata and the return URL", async () => {
    const res = await checkout({ plan: "pro", interval: "month", returnTo: "/dev/preise.html#preise" });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const p = stripe.checkout[0]!;
    expect(p).toMatchObject({ mode: "subscription", customer: "cus_1", client_reference_id: U1, locale: "de", allow_promotion_codes: true });
    expect(p.discounts).toBeUndefined();
    expect(p.line_items).toEqual([{ price: "price_pro_m", quantity: 1 }]);
    expect(p.subscription_data).toMatchObject({ trial_period_days: 14, metadata: { supabase_user_id: U1, plan: "pro", interval: "month" } });
    expect(p.success_url).toBe("https://journal.example/dev/preise.html?billing=success&session_id={CHECKOUT_SESSION_ID}#preise");
    expect(p.cancel_url).toBe("https://journal.example/dev/preise.html?billing=cancel#preise");
    // the customer carries the user id (P09's deletion finds it) and is created idempotently, then reused
    expect(stripe.customers[0]).toMatchObject({ params: { metadata: { supabase_user_id: U1 } }, key: `tj-customer-${U1}` });
    expect(db.tables.billing_customers).toEqual([expect.objectContaining({ user_id: U1, stripe_customer_id: "cus_1" })]);
    await checkout({ plan: "pro", interval: "year" });
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.checkout[1]!.customer).toBe("cus_1");
  });

  it("an unsafe returnTo falls back to the pricing page", async () => {
    await checkout({ plan: "pro", interval: "month", returnTo: "//evil.example/x" });
    expect(stripe.checkout[0]!.success_url).toBe("https://journal.example/?billing=success&session_id={CHECKOUT_SESSION_ID}#preise");
  });

  it("a checked promotion code is applied as discounts (never together with allow_promotion_codes)", async () => {
    await checkout({ plan: "pro", interval: "month", code: "trader20" });
    const p = stripe.checkout[0]!;
    expect(p.discounts).toEqual([{ promotion_code: "promo_1" }]);
    expect(p.allow_promotion_codes).toBeUndefined();
    const bad = await checkout({ plan: "pro", interval: "month", code: "NOPE" });
    expect(bad.status).toBe(422);
  });

  it("a referral of someone else gives the longer trial and travels in the metadata; self-referral is ignored", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "ABCD2345" });
    await checkout({ plan: "pro", interval: "month", ref: "abcd2345" });
    expect(stripe.checkout[0]!.subscription_data).toMatchObject({ trial_period_days: 30, metadata: { ref: "ABCD2345" } });
    await checkout({ plan: "pro", interval: "month", ref: "ABCD2345" }, U2);
    expect(stripe.checkout[1]!.subscription_data?.trial_period_days).toBe(14);
    expect(stripe.checkout[1]!.metadata?.ref).toBeUndefined();
  });

  it("no second trial; card-less trial and Stripe Tax by env", async () => {
    db.tables.subscriptions!.push({ ...rowFromSubscription(stripeSub("sub_old", { status: "canceled" }), U1), status: "canceled" });
    await checkout({ plan: "pro", interval: "month" });
    expect(stripe.checkout[0]!.subscription_data?.trial_period_days).toBeUndefined();
    process.env.STRIPE_TRIAL_CARDLESS = "1";
    process.env.STRIPE_AUTOMATIC_TAX = "true";
    await checkout({ plan: "pro", interval: "month" }, U2);
    const p = stripe.checkout[1]!;
    expect(p.payment_method_collection).toBe("if_required");
    expect(p.subscription_data?.trial_settings).toEqual({ end_behavior: { missing_payment_method: "cancel" } });
    expect(p.automatic_tax).toEqual({ enabled: true });
    expect(p.billing_address_collection).toBe("required");
  });

  it("team seats as an adjustable quantity (2–50)", async () => {
    await checkout({ plan: "team", interval: "month", seats: 1 });
    expect(stripe.checkout[0]!.line_items).toEqual([{ price: "price_team_m", quantity: 2, adjustable_quantity: { enabled: true, minimum: 2, maximum: 50 } }]);
  });

  it("409 when a subscription already runs, 503 for an interval without a price", async () => {
    db.tables.subscriptions!.push({ ...rowFromSubscription(stripeSub("sub_live", { status: "active" }), U1) });
    expect((await checkout({ plan: "premium", interval: "month" })).status).toBe(409);
    expect((await checkout({ plan: "premium", interval: "year" }, U2)).status).toBe(503);
  });

  it("validates the body", async () => {
    expect((await checkout({ plan: "free", interval: "month" })).status).toBe(422);
    expect((await checkout({ plan: "pro", interval: "week" })).status).toBe(422);
  });
});

/* ------------------------------------------------------------------ webhook */

describe("POST /api/v1/stripe/webhook", () => {
  it("rejects a bad signature and a missing secret", async () => {
    const ev = event("customer.subscription.created", stripeSub("sub_1", { user: U1 }));
    expect((await deliver(ev, "whsec_wrong")).status).toBe(400);
    const raw = await call(webhookFn, req("/api/v1/stripe/webhook", { method: "POST", body: JSON.stringify(ev) }));
    expect(raw.status).toBe(400);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await deliver(ev)).status).toBe(503);
    expect(db.tables.subscriptions).toHaveLength(0);
  });

  it("checkout.session.completed links the customer, stores the subscription, sets profiles.plan and books the referral", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "ABCD2345" });
    stripe.subs.set("sub_1", stripeSub("sub_1", { customer: "cus_9", user: U1, ref: "ABCD2345" }));
    const res = await deliver(
      event("checkout.session.completed", {
        id: "cs_1",
        object: "checkout.session",
        mode: "subscription",
        client_reference_id: U1,
        customer: "cus_9",
        subscription: "sub_1",
        metadata: { supabase_user_id: U1, ref: "ABCD2345" },
      }),
    );
    expect(res).toMatchObject({ status: 200, body: { received: true, result: "processed" } });
    expect(profile(db, U1)).toMatchObject({ plan: "pro", plan_status: "trialing" });
    expect(profile(db, U1).trial_end).toBeTruthy();
    expect(db.tables.billing_customers).toEqual([expect.objectContaining({ user_id: U1, stripe_customer_id: "cus_9" })]);
    expect(db.tables.referrals).toEqual([expect.objectContaining({ referrer_id: U2, referred_id: U1, status: "trialing" })]);
    expect(db.tables.audit_log!.some((a) => a.action === "billing.checkout")).toBe(true);
  });

  it("is idempotent: a redelivered event is acknowledged without work", async () => {
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1 }));
    const ev = event("customer.subscription.created", stripe.subs.get("sub_1"));
    expect((await deliver(ev)).body.result).toBe("processed");
    profile(db, U1).plan = "tampered";
    expect((await deliver(ev)).body.result).toBe("duplicate");
    expect(profile(db, U1).plan).toBe("tampered");
    expect(db.tables.stripe_events).toEqual([expect.objectContaining({ id: ev.id, processed_at: expect.any(String) })]);
  });

  it("order-safe: the latest state comes from Stripe; a stale snapshot never overwrites a newer one", async () => {
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1, status: "active", trialEnd: null }));
    await deliver(event("customer.subscription.updated", stripe.subs.get("sub_1"), NOW));
    // an OLDER event arrives late while Stripe cannot be read → its snapshot (trialing) is skipped
    stripe.retrieveFails = true;
    await deliver(event("customer.subscription.updated", stripeSub("sub_1", { user: U1, status: "trialing" }), NOW - 600));
    expect(db.tables.subscriptions![0]).toMatchObject({ status: "active" });
    expect(profile(db, U1)).toMatchObject({ plan: "pro", plan_status: "active" });
    // even an old event re-reads the live subscription when Stripe answers
    stripe.retrieveFails = false;
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1, status: "past_due", trialEnd: null }));
    await deliver(event("customer.subscription.updated", stripeSub("sub_1", { user: U1, status: "trialing" }), NOW - 1200));
    expect(profile(db, U1)).toMatchObject({ plan: "pro", plan_status: "past_due" });
  });

  it("deleted → free (status canceled); payment_failed keeps access during dunning", async () => {
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1, status: "past_due", trialEnd: null }));
    await deliver(
      event("invoice.payment_failed", {
        id: "in_1",
        object: "invoice",
        amount_paid: 0,
        attempt_count: 1,
        currency: "eur",
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    );
    expect(profile(db, U1)).toMatchObject({ plan: "pro", plan_status: "past_due" });
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1, status: "canceled", trialEnd: null }));
    await deliver(event("customer.subscription.deleted", stripe.subs.get("sub_1"), NOW + 5));
    expect(profile(db, U1)).toMatchObject({ plan: "free", plan_status: "canceled" });
  });

  it("a subscription it cannot attribute is ignored; unknown event types are acknowledged", async () => {
    stripe.subs.set("sub_x", stripeSub("sub_x", { customer: "cus_unknown" }));
    expect((await deliver(event("customer.subscription.created", stripe.subs.get("sub_x")))).body.result).toBe("ignored");
    expect((await deliver(event("charge.refunded", { id: "ch_1" }))).body.result).toBe("ignored");
  });

  it("events for a deleted account are acknowledged as ignored, never a 502 loop (review MONEY-01)", async () => {
    stripe.subs.set("sub_t", stripeSub("sub_t", { customer: "cus_t", user: U1, price: "price_team_m", quantity: 3, status: "active", trialEnd: null }));
    await deliver(event("customer.subscription.created", stripe.subs.get("sub_t")));
    expect(db.tables.subscriptions).toHaveLength(1);
    // account-delete: Stripe cancelled first, then auth.admin.deleteUser cascades the user's billing rows
    db.deletedUsers.add(U1);
    for (const t of ["subscriptions", "billing_customers", "team_seats"]) db.tables[t] = db.tables[t]!.filter((r) => r.user_id !== U1 && r.owner_id !== U1);
    db.tables.profiles = db.tables.profiles!.filter((p) => p.id !== U1);
    stripe.subs.set("sub_t", stripeSub("sub_t", { customer: "cus_t", user: U1, price: "price_team_m", quantity: 3, status: "canceled", trialEnd: null }));
    const res = await deliver(event("customer.subscription.deleted", stripe.subs.get("sub_t"), NOW + 5));
    expect(res).toMatchObject({ status: 200, body: { received: true, result: "ignored" } });
    expect(db.tables.subscriptions).toHaveLength(0);
    const late = await deliver(
      event("checkout.session.completed", { id: "cs_9", mode: "subscription", client_reference_id: U1, customer: "cus_t", subscription: "sub_t", metadata: {} }),
    );
    expect(late).toMatchObject({ status: 200, body: { result: "ignored" } });
    expect(db.tables.stripe_events!.every((e) => e.processed_at)).toBe(true);
  });

  it("invoice.paid credits the referrer once (Stripe balance, idempotent) and marks the referral paying", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "ABCD2345" });
    db.tables.billing_customers!.push({ user_id: U2, stripe_customer_id: "cus_ref" });
    stripe.subs.set("sub_1", stripeSub("sub_1", { customer: "cus_9", user: U1, status: "active", ref: "ABCD2345", trialEnd: null }));
    await deliver(
      event("checkout.session.completed", {
        id: "cs_1",
        mode: "subscription",
        client_reference_id: U1,
        customer: "cus_9",
        subscription: "sub_1",
        metadata: { ref: "ABCD2345" },
      }),
    );
    const paid = (id: string) =>
      event("invoice.paid", {
        id,
        object: "invoice",
        amount_paid: 1200,
        currency: "eur",
        attempt_count: 1,
        parent: { subscription_details: { subscription: "sub_1" } },
      });
    await deliver(paid("in_1"));
    expect(stripe.balance).toEqual([{ customer: "cus_ref", amount: -1000, key: expect.stringMatching(/^tj-ref-credit-/) }]);
    expect(db.tables.affiliate_ledger).toEqual([expect.objectContaining({ referrer_id: U2, kind: "credit", amount: 1000, status: "applied" })]);
    expect(db.tables.referrals![0]).toMatchObject({ status: "paying", converted_at: expect.any(String) });
    // the next month's invoice earns nothing more for a normal referral
    await deliver(paid("in_2"));
    expect(stripe.balance).toHaveLength(1);
    expect(db.tables.affiliate_ledger).toHaveLength(1);
  });

  it("affiliates earn their commission on every paid invoice (pending, paid out by hand)", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "AFFIL123", commission_pct: 25 });
    stripe.subs.set("sub_1", stripeSub("sub_1", { customer: "cus_9", user: U1, status: "active", trialEnd: null }));
    await deliver(
      event("checkout.session.completed", {
        id: "cs_1",
        mode: "subscription",
        client_reference_id: U1,
        customer: "cus_9",
        subscription: "sub_1",
        metadata: { ref: "AFFIL123" },
      }),
    );
    for (const id of ["in_1", "in_2"])
      await deliver(
        event("invoice.paid", { id, object: "invoice", amount_paid: 2400, currency: "eur", parent: { subscription_details: { subscription: "sub_1" } } }),
      );
    expect(db.tables.affiliate_ledger!.map((l) => [l.kind, l.amount, l.status])).toEqual([
      ["commission", 600, "pending"],
      ["commission", 600, "pending"],
    ]);
    expect(stripe.balance).toHaveLength(0);
  });

  it("invoice.paid before checkout.session.completed still pays the affiliate (Stripe does not order events, review MONEY-02)", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "AFFIL123", commission_pct: 25 });
    // yearly plan without a trial: the first invoice is the only one for 12 months
    stripe.subs.set("sub_1", stripeSub("sub_1", { customer: "cus_9", user: U1, status: "active", trialEnd: null, price: "price_pro_y", ref: "AFFIL123" }));
    const paid = await deliver(
      event("invoice.paid", { id: "in_1", object: "invoice", amount_paid: 2400, currency: "eur", parent: { subscription_details: { subscription: "sub_1" } } }),
    );
    expect(paid.body.result).toBe("processed");
    const done = await deliver(
      event("checkout.session.completed", { id: "cs_1", mode: "subscription", client_reference_id: U1, customer: "cus_9", subscription: "sub_1", metadata: { ref: "AFFIL123" } }),
    );
    expect(done.body.result).toBe("processed");
    expect(db.tables.affiliate_ledger!.map((l) => [l.kind, l.amount, l.status])).toEqual([["commission", 600, "pending"]]);
    expect(db.tables.referrals).toEqual([expect.objectContaining({ referrer_id: U2, referred_id: U1, status: "paying", converted_at: expect.any(String) })]);
  });

  it("a referral credit is booked even when the first invoice is the first event that arrives", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "ABCD2345" });
    db.tables.billing_customers!.push({ user_id: U2, stripe_customer_id: "cus_ref" });
    stripe.subs.set("sub_1", stripeSub("sub_1", { customer: "cus_9", user: U1, status: "active", trialEnd: null, ref: "ABCD2345" }));
    await deliver(event("invoice.paid", { id: "in_1", object: "invoice", amount_paid: 1200, currency: "eur", parent: { subscription_details: { subscription: "sub_1" } } }));
    expect(db.tables.affiliate_ledger).toEqual([expect.objectContaining({ referrer_id: U2, kind: "credit", amount: 1000, status: "applied" })]);
    expect(stripe.balance).toEqual([{ customer: "cus_ref", amount: -1000, key: expect.stringMatching(/^tj-ref-credit-/) }]);
  });

  it("a stored subscription with a code books the referral at invoice.paid even when Stripe cannot be re-read", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "AFFIL123", commission_pct: 25 });
    db.tables.subscriptions!.push({ id: "sub_1", user_id: U1, stripe_customer_id: "cus_9", status: "active", plan: "pro", ref_code: "AFFIL123", updated_at: new Date().toISOString() });
    stripe.retrieveFails = true;
    await deliver(event("invoice.paid", { id: "in_1", object: "invoice", amount_paid: 2400, currency: "eur", parent: { subscription_details: { subscription: "sub_1" } } }));
    expect(db.tables.affiliate_ledger!.map((l) => [l.kind, l.amount])).toEqual([["commission", 600]]);
  });

  it("a credit earned before the referrer had a customer is applied at their first checkout", async () => {
    db.tables.affiliate_ledger!.push({ id: 77, referrer_id: U2, kind: "credit", amount: 1000, currency: "eur", status: "pending", stripe_invoice_id: "in_x" });
    await call(checkoutFn, req("/api/v1/billing/checkout", { body: { plan: "pro", interval: "month" }, user: U2 }));
    expect(stripe.balance).toEqual([{ customer: "cus_1", amount: -1000, key: "tj-ref-credit-77" }]);
    expect(db.tables.affiliate_ledger![0]).toMatchObject({ status: "applied" });
  });

  it("team: members get the team plan through a seat and lose it with the owner's subscription", async () => {
    stripe.subs.set("sub_t", stripeSub("sub_t", { customer: "cus_t", user: U1, price: "price_team_m", quantity: 2, status: "active", trialEnd: null }));
    await deliver(event("customer.subscription.created", stripe.subs.get("sub_t")));
    expect(profile(db, U1)).toMatchObject({ plan: "team" });
    expect(await assignSeat(U1, U2)).toMatchObject({ plan: "team", status: "active" });
    await expect(assignSeat(U1, U3)).rejects.toMatchObject({ status: 409, code: "no_seats" });
    stripe.subs.set("sub_t", stripeSub("sub_t", { customer: "cus_t", user: U1, price: "price_team_m", quantity: 2, status: "canceled", trialEnd: null }));
    await deliver(event("customer.subscription.deleted", stripe.subs.get("sub_t"), NOW + 10));
    expect(profile(db, U2)).toMatchObject({ plan: "free" });
    expect(await releaseSeat(U1, U2)).toMatchObject({ plan: "free" });
    expect(db.tables.team_seats).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ portal */

describe("POST /api/v1/billing/portal", () => {
  const portal = (body: unknown, user = U1) => call(portalFn, req("/api/v1/billing/portal", { body, user }));
  const subscribe = async (o: Parameters<typeof stripeSub>[1] = {}) => {
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1, status: "active", trialEnd: null, ...o }));
    await deliver(event("customer.subscription.created", stripe.subs.get("sub_1")));
  };

  it("404 without a customer", async () => {
    const res = await portal({ flow: "manage" });
    expect(res.status).toBe(404);
    expect((res.body.error as { message: string }).message).toMatch(/kein Abo/);
  });

  it("opens the portal, deep-linked into the cancel / update / payment flows", async () => {
    await subscribe();
    expect((await portal({ flow: "manage", returnTo: "/#konto" })).body.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    expect(stripe.portal[0]).toMatchObject({ customer: "cus_A", locale: "de", return_url: "https://journal.example/?billing=portal#konto" });
    expect(stripe.portal[0]!.flow_data).toBeUndefined();
    await portal({ flow: "cancel" });
    expect(stripe.portal[1]!.flow_data).toMatchObject({
      type: "subscription_cancel",
      subscription_cancel: { subscription: "sub_1" },
      after_completion: { type: "redirect" },
    });
    await portal({ flow: "update" });
    expect(stripe.portal[2]!.flow_data).toEqual({ type: "subscription_update", subscription_update: { subscription: "sub_1" } });
    await portal({ flow: "payment" });
    expect(stripe.portal[3]!.flow_data).toEqual({ type: "payment_method_update" });
  });

  it("in-app cancellation at period end with the reason; undo; pause", async () => {
    await subscribe();
    const res = await portal({ action: "cancel", reason: "too_expensive", comment: "  zu teuer gerade  " });
    expect(res.status).toBe(200);
    expect(stripe.updates[0]).toEqual({
      id: "sub_1",
      params: { cancel_at_period_end: true, cancellation_details: { feedback: "too_expensive", comment: "zu teuer gerade" } },
    });
    expect(res.body.subscription).toMatchObject({ cancelAtPeriodEnd: true, cancelAt: expect.any(String) });
    // still entitled until the period ends
    expect(res.body.plan).toMatchObject({ plan: "pro", status: "active" });
    const undo = await portal({ action: "resume" });
    expect(undo.body.subscription).toMatchObject({ cancelAtPeriodEnd: false });
    const pause = await portal({ action: "pause", months: 2 });
    expect(stripe.updates[2]!.params.pause_collection).toMatchObject({ behavior: "void" });
    expect(pause.body.subscription).toMatchObject({ status: "paused", pausedUntil: expect.any(String) });
    expect(pause.body.plan).toMatchObject({ plan: "free", status: "paused" });
    const resume = await portal({ action: "resume" });
    expect(stripe.updates[3]!.params).toMatchObject({ pause_collection: "" });
    expect(resume.body.plan).toMatchObject({ plan: "pro", status: "active" });
  });

  it("pausing a trial is refused; flow and action together are invalid", async () => {
    await subscribe({ status: "trialing" });
    expect((await portal({ action: "pause" })).status).toBe(409);
    expect((await portal({ action: "cancel", flow: "cancel" })).status).toBe(422);
  });
});

/* ------------------------------------------------------------------ codes + referral */

describe("POST /api/v1/billing/code", () => {
  const code = (c: string) => call(codeFn, req("/api/v1/billing/code", { body: { code: c } }));

  it("previews a valid code with German terms; unknown codes are invalid", async () => {
    const ok = await code(" trader20 ");
    expect(ok.body).toMatchObject({
      valid: true,
      code: "TRADER20",
      percentOff: 20,
      duration: "repeating",
      durationInMonths: 3,
      firstTimeOnly: true,
      message: "−20 % für 3 Monate",
    });
    const bad = await code("NOPE");
    expect(bad.body).toMatchObject({ valid: false, message: "Dieser Code ist ungültig oder abgelaufen." });
  });

  it("rate-limited per IP (fail closed) and 503 without payments", async () => {
    db.rateLimit = 11;
    expect((await code("TRADER20")).status).toBe(429);
    db.rateLimit = 1;
    setEnv(false);
    expect((await code("TRADER20")).status).toBe(503);
  });
});

describe("GET /api/v1/billing/referral", () => {
  it("creates the own code once and reports stats + earnings", async () => {
    const first = await call(referralFn, req("/api/v1/billing/referral", { user: U1 }));
    expect(first.status).toBe(200);
    const code = first.body.code as string;
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(first.body).toMatchObject({ path: `/?ref=${code}`, trialDays: 30, rewardCents: 1000, commissionPct: null, stats: { signups: 0, paying: 0 } });
    const again = await call(referralFn, req("/api/v1/billing/referral", { user: U1 }));
    expect(again.body.code).toBe(code);
    expect(db.tables.referral_codes).toHaveLength(1);
  });

  it("public check: valid codes give the referral trial, nothing about the owner", async () => {
    db.tables.referral_codes!.push({ user_id: U2, code: "ABCD2345" });
    const ok = await call(referralFn, req("/api/v1/billing/referral?code=abcd2345"));
    expect(ok.body).toEqual({ valid: true, trialDays: 30 });
    const bad = await call(referralFn, req("/api/v1/billing/referral?code=ZZZZ0000"));
    expect(bad.body).toEqual({ valid: false, trialDays: 0 });
    expect((await call(referralFn, req("/api/v1/billing/referral"))).status).toBe(401);
  });
});

/* ------------------------------------------------------------------ 2FA */

describe("2FA: a password-only session (aal1) of a 2FA account reaches no billing data (review SEC-01)", () => {
  beforeEach(async () => {
    stripe.subs.set("sub_1", stripeSub("sub_1", { user: U1, status: "active", trialEnd: null }));
    await deliver(event("customer.subscription.created", stripe.subs.get("sub_1")));
    db.mfa.add(U1);
  });

  it("billing/status answers like for a visitor until the code is entered", async () => {
    const aal1 = await call(statusFn, req("/api/v1/billing/status?invoices=1", { user: U1 }));
    expect(aal1.status).toBe(200);
    expect(aal1.body).toMatchObject({ plan: null, subscription: null, invoices: null, hasCustomer: false, team: null });
    expect((aal1.body.config as { enabled: boolean }).enabled).toBe(true);
    const aal2 = await call(statusFn, req("/api/v1/billing/status?invoices=1", { user: U1, aal: "aal2" }));
    expect(aal2.body.plan).toMatchObject({ plan: "pro", status: "active" });
    expect((aal2.body.invoices as unknown[]).length).toBe(1);
  });

  it("portal, in-app cancel, checkout and the referral info need aal2", async () => {
    for (const r of [
      req("/api/v1/billing/portal", { body: { flow: "manage" }, user: U1 }),
      req("/api/v1/billing/portal", { body: { action: "cancel", reason: "too_expensive" }, user: U1 }),
      req("/api/v1/billing/checkout", { body: { plan: "premium", interval: "month" }, user: U1 }),
      req("/api/v1/billing/referral", { user: U1 }),
    ]) {
      const fn = r.url.includes("portal") ? portalFn : r.url.includes("checkout") ? checkoutFn : referralFn;
      const res = await call(fn, r);
      expect(res.status, r.url).toBe(403);
      expect((res.body.error as { code: string }).code).toBe("mfa_required");
    }
    expect(stripe.portal).toHaveLength(0);
    expect(stripe.updates).toHaveLength(0);
    expect(stripe.checkout).toHaveLength(0);
    expect(db.tables.referral_codes).toHaveLength(0);
    expect((await call(portalFn, req("/api/v1/billing/portal", { body: { flow: "manage" }, user: U1, aal: "aal2" }))).status).toBe(200);
    expect((await call(referralFn, req("/api/v1/billing/referral", { user: U1, aal: "aal2" }))).status).toBe(200);
  });

  it("an account without 2FA keeps working with aal1", async () => {
    db.mfa.clear();
    expect((await call(portalFn, req("/api/v1/billing/portal", { body: { flow: "manage" }, user: U1 }))).status).toBe(200);
    expect((await call(statusFn, req("/api/v1/billing/status", { user: U1 }))).body.plan).toMatchObject({ plan: "pro" });
  });
});

/* ------------------------------------------------------------------ gates + helpers */

describe("server-side feature gates", () => {
  it("free users get 402 for paid features once payments are set up", async () => {
    expect(paymentsConfigured()).toBe(true);
    await expect(requireFeature(U1, "exchangeSync")).rejects.toMatchObject({
      status: 402,
      code: "plan_required",
      details: { feature: "exchangeSync", required: "pro" },
    });
    await expect(requireFeature(U1, "cloudSync")).resolves.toMatchObject({ plan: "free" });
    await expect(requireLimit(U1, "savedViews", 3)).rejects.toMatchObject({ status: 402, code: "limit_reached" });
    await expect(requireLimit(U1, "savedViews", 2)).resolves.toBe(3);
  });

  it("paid plans pass; nothing is gated while payments are not set up", async () => {
    Object.assign(profile(db, U1), { plan: "premium", plan_status: "active" });
    await expect(requireFeature(U1, "coachAi")).resolves.toMatchObject({ plan: "premium" });
    Object.assign(profile(db, U1), { plan: "premium", plan_status: "canceled" });
    await expect(requireFeature(U1, "coachAi")).rejects.toMatchObject({ status: 402 });
    setEnv(false);
    await expect(requireFeature(U1, "coachAi")).resolves.toMatchObject({ plan: "free" });
  });

  it("cancelSubscription (account deletion helper) cancels every open subscription at once", async () => {
    db.tables.billing_customers!.push({ user_id: U1, stripe_customer_id: "cus_A" });
    stripe.subs.set("sub_1", stripeSub("sub_1", { status: "active" }));
    stripe.subs.set("sub_2", stripeSub("sub_2", { status: "canceled" }));
    expect(await cancelSubscription(U1)).toBe(1);
    expect(stripe.canceled).toEqual(["sub_1"]);
    expect(await cancelSubscription(U3)).toBe(0);
  });
});
