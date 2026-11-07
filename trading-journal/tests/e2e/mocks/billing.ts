/**
 * In-process fake of the P10 billing functions + the Stripe-hosted pages for e2e (additive to `mocks/supabase.ts`;
 * register it AFTER `mockSupabase` – Playwright runs the newest route first, other `/api/v1/*` paths fall back).
 *
 * - `/api/v1/billing/status|checkout|portal|code|referral` answer from `MockBilling.state` (the plan of the signed-in
 *   mock user is never taken from the client – a checkout only becomes a plan when the fake Stripe page "pays");
 * - `https://checkout.stripe.com/**` is a tiny fake Checkout page: "Jetzt abonnieren" completes the subscription (as
 *   the webhook would) and redirects to the `success_url`; "Zurück" goes to the `cancel_url`;
 * - `https://billing.stripe.com/**` is a fake Customer Portal with "Zurück zum Journal" (the `return_url`).
 */
import type { Page, Route } from "@playwright/test";
import type {
  BillingConfig,
  BillingStatus,
  CheckoutRequest,
  CodeLookup,
  ContractDeclaration,
  InvoiceSummary,
  PortalRequest,
  SubscriptionSummary,
} from "../../../src/billing/contract";
import type { PlanInfo } from "../../../src/billing/types";

export interface MockBillingOptions {
  /** Payments set up (default true); false = `config.enabled: false` ("Zahlungen noch nicht eingerichtet"). */
  enabled?: boolean;
  /** Initial plan of the signed-in mock user (default free / none). */
  plan?: PlanInfo;
  subscription?: SubscriptionSummary | null;
  invoices?: InvoiceSummary[];
  /** Valid promotion codes (upper case) → preview. */
  codes?: Record<string, Omit<CodeLookup, "valid" | "code">>;
  /** Valid referral codes → trial days. */
  referrals?: Record<string, number>;
  trialDays?: number;
  /** B4: the purchase flow is open (default true); false = the operator's legal texts are missing (`purchaseOpen: false`, locked). */
  purchaseOpen?: boolean;
  /** B4: Stripe Tax on (default true: "Steuer wird im nächsten Schritt von Stripe berechnet"). */
  automaticTax?: boolean;
  /** B4: contract e-mails are set up (default true). */
  mailReady?: boolean;
  /**
   * What the (fake) WEBHOOK makes of the order once the fake Stripe page "pays": `trialing` (default) / `active` · `incomplete`
   * (payment needs a confirmation) · `unpaid` (failed) · `never` (the server never hears: the result page stays "in Bearbeitung").
   */
  outcome?: "trialing" | "active" | "incomplete" | "unpaid" | "never";
  /** B4: the webhook lands only after this many status requests (the result page polls until then). */
  webhookAfterStatusCalls?: number;
}

export interface MockBilling {
  state: { plan: PlanInfo; subscription: SubscriptionSummary | null; invoices: InvoiceSummary[]; hasCustomer: boolean; trialUsed: boolean };
  checkouts: CheckoutRequest[];
  portals: PortalRequest[];
  /** B4: declarations of the public cancel / withdraw pages and the links confirmed. */
  contracts: ContractDeclaration[];
  confirmed: string[];
  calls: string[];
}

const FREE: PlanInfo = { plan: "free", status: "none", trialEnd: null };
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function config(o: MockBillingOptions): BillingConfig {
  const enabled = o.enabled !== false;
  return {
    enabled,
    ...(enabled ? {} : { reason: "stripe_missing" as const }),
    trialDays: o.trialDays ?? 14,
    referralTrialDays: 30,
    cardless: false,
    prices: enabled
      ? {
          pro: { month: { amount: 1200, currency: "eur", interval: "month" }, year: { amount: 12000, currency: "eur", interval: "year" } },
          premium: { month: { amount: 2400, currency: "eur", interval: "month" }, year: { amount: 24000, currency: "eur", interval: "year" } },
          team: { month: { amount: 1900, currency: "eur", interval: "month" }, year: { amount: 19000, currency: "eur", interval: "year" } },
        }
      : {},
    available: enabled ? ["pro", "premium", "team"] : [],
    purchaseOpen: enabled && o.purchaseOpen !== false,
    ...(enabled && o.purchaseOpen === false ? { purchaseBlockedBy: ["legal" as const] } : {}),
    automaticTax: o.automaticTax !== false,
    consentHash: "a".repeat(64),
    mailReady: o.mailReady !== false,
  };
}

/** A subscription summary as the status endpoint reports it (defaults: Pro, monthly, trialing 14 days). */
export function mockSubscription(p: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    id: "sub_e2e_1",
    plan: "pro",
    status: "trialing",
    interval: "month",
    seats: 1,
    currentPeriodEnd: day(14),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    trialEnd: day(14),
    pausedUntil: null,
    amount: 1200,
    currency: "eur",
    hasPaymentMethod: true,
    ...p,
  };
}

const page404 = (route: Route) =>
  route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Nicht gefunden." } }) });

export async function mockBilling(page: Page, opts: MockBillingOptions = {}): Promise<MockBilling> {
  const mock: MockBilling = {
    state: {
      plan: opts.plan ?? { ...FREE },
      subscription: opts.subscription ?? null,
      invoices: opts.invoices ?? [],
      hasCustomer: !!opts.subscription,
      trialUsed: !!opts.subscription?.trialEnd,
    },
    checkouts: [],
    portals: [],
    contracts: [],
    confirmed: [],
    calls: [],
  };
  const sessions = new Map<string, string>();
  let statusCalls = 0;
  let held: { plan: PlanInfo; subscription: SubscriptionSummary } | null = null;
  let pending: { req: CheckoutRequest; origin: string } | null = null;
  const cfg = config(opts);
  const send = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const ret = (origin: string, returnTo: string | undefined, query: string) => {
    const raw = returnTo ?? "/#preise";
    const i = raw.indexOf("#");
    const path = i >= 0 ? raw.slice(0, i) : raw;
    const hash = i >= 0 ? raw.slice(i) : "";
    return `${origin}${path}?${query}${hash}`;
  };

  await page.route(/\/api\/v1\/billing\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const authed = /^Bearer\s+\S+/.test(req.headers()["authorization"] ?? "");
    mock.calls.push(`${req.method()} ${url.pathname}`);
    const body = (() => {
      try {
        return (req.postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    switch (url.pathname) {
      case "/api/v1/billing/status": {
        statusCalls += 1;
        // the webhook of the fake Stripe lands after N status requests
        if (held && statusCalls > (opts.webhookAfterStatusCalls ?? 0)) {
          mock.state = { ...mock.state, plan: held.plan, subscription: held.subscription, hasCustomer: true, trialUsed: true };
          held = null;
        }
        const status: BillingStatus = {
          config: cfg,
          plan: authed ? mock.state.plan : null,
          subscription: authed ? mock.state.subscription : null,
          invoices: authed && url.searchParams.get("invoices") === "1" ? mock.state.invoices : null,
          hasCustomer: authed && mock.state.hasCustomer,
          trialUsed: authed && mock.state.trialUsed,
          team: null,
        };
        return send(route, 200, status);
      }
      case "/api/v1/billing/checkout": {
        if (!authed) return send(route, 401, { error: { code: "unauthenticated", message: "Bitte melde dich an." } });
        if (!cfg.enabled) return send(route, 503, { error: { code: "billing_unavailable", message: "Zahlungen sind noch nicht eingerichtet." } });
        const r = body as unknown as CheckoutRequest;
        if (!cfg.purchaseOpen) return send(route, 503, { error: { code: "purchase_closed", message: "Die Bestellung ist noch nicht freigeschaltet." } });
        // B4: both consents, the order id (idempotency key) – like the real function
        if (!r.consents?.terms || !r.consents?.immediateStart) return send(route, 422, { error: { code: "consent_required", message: "Bitte bestätige beide Kästchen vor der Bestellung." } });
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(r.orderId ?? "")))
          return send(route, 422, { error: { code: "invalid_body", message: "Ungültige Bestellung." } });
        const known = sessions.get(r.orderId);
        if (known) {
          pending = { req: r, origin: url.origin };
          return send(route, 200, { url: `https://checkout.stripe.com/c/pay/${known}`, sessionId: known });
        }
        if (r.code && !opts.codes?.[String(r.code).toUpperCase()])
          return send(route, 422, { error: { code: "invalid_code", message: "Dieser Code ist ungültig oder abgelaufen." } });
        mock.checkouts.push(r);
        pending = { req: r, origin: url.origin };
        const sid = `cs_test_e2e_${mock.checkouts.length}`;
        sessions.set(r.orderId, sid);
        return send(route, 200, { url: `https://checkout.stripe.com/c/pay/${sid}`, sessionId: sid });
      }
      case "/api/v1/billing/portal": {
        if (!authed) return send(route, 401, { error: { code: "unauthenticated", message: "Bitte melde dich an." } });
        const r = body as PortalRequest;
        mock.portals.push(r);
        const sub = mock.state.subscription;
        if (r.action) {
          if (!sub) return send(route, 404, { error: { code: "no_subscription", message: "Es läuft gerade kein Abo." } });
          if (r.action === "feedback") return send(route, 200, { subscription: mock.state.subscription, plan: mock.state.plan });
          if (r.action === "cancel") mock.state.subscription = { ...sub, cancelAtPeriodEnd: true, cancelAt: sub.trialEnd ?? sub.currentPeriodEnd };
          else if (r.action === "resume") {
            mock.state.subscription = {
              ...sub,
              cancelAtPeriodEnd: false,
              cancelAt: null,
              status: sub.status === "paused" ? "active" : sub.status,
              pausedUntil: null,
            };
            if (sub.status === "paused") mock.state.plan = { plan: sub.plan, status: "active", trialEnd: null };
          } else if (r.action === "pause") {
            mock.state.subscription = { ...sub, status: "paused", pausedUntil: day(30) };
            mock.state.plan = { plan: "free", status: "paused", trialEnd: null };
          }
          return send(route, 200, { subscription: mock.state.subscription, plan: mock.state.plan, ...(r.action === "cancel" ? { mail: cfg.mailReady ? "sent" : "unavailable" } : {}) });
        }
        if (!mock.state.hasCustomer)
          return send(route, 404, { error: { code: "no_customer", message: "Du hast noch kein Abo – es gibt nichts zu verwalten." } });
        const back = ret(url.origin, r.returnTo, "billing=portal");
        return send(route, 200, { url: `https://billing.stripe.com/p/session/test_e2e?flow=${r.flow ?? "manage"}&return=${encodeURIComponent(back)}` });
      }
      case "/api/v1/billing/contract": {
        const r = body as unknown as ContractDeclaration;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(r.email ?? ""))) return send(route, 422, { error: { code: "invalid_email", message: "Bitte gib eine gültige E-Mail-Adresse an." } });
        mock.contracts.push(r);
        return send(route, 200, { kind: r.kind, receivedAt: new Date().toISOString(), mail: cfg.mailReady ? "sent" : "unavailable", next: authed ? "done" : "check" });
      }
      case "/api/v1/billing/contract/confirm": {
        const token = String(body.token ?? "");
        mock.confirmed.push(token);
        const last = mock.contracts.at(-1);
        return send(route, 200, { kind: last?.kind ?? "cancel", status: "done", endsAt: day(20), confirmedAt: new Date().toISOString() });
      }
      case "/api/v1/billing/code": {
        if (!cfg.enabled) return send(route, 503, { error: { code: "billing_unavailable", message: "Zahlungen sind noch nicht eingerichtet." } });
        const code = String(body.code ?? "")
          .trim()
          .toUpperCase();
        const hit = opts.codes?.[code];
        return send(route, 200, hit ? { valid: true, code, ...hit } : { valid: false, code, message: "Dieser Code ist ungültig oder abgelaufen." });
      }
      case "/api/v1/billing/referral": {
        const code = url.searchParams.get("code");
        if (code !== null) {
          const days = opts.referrals?.[code.toUpperCase()];
          return send(route, 200, { valid: days !== undefined, trialDays: days ?? 0 });
        }
        if (!authed) return send(route, 401, { error: { code: "unauthenticated", message: "Bitte melde dich an." } });
        return send(route, 200, {
          code: "TRADE24X",
          path: "/?ref=TRADE24X",
          trialDays: 30,
          rewardCents: 1000,
          commissionPct: null,
          currency: "eur",
          stats: { signups: 3, paying: 1 },
          earned: { pending: 0, applied: 1000 },
          ledger: [{ id: 1, kind: "credit", amount: 1000, currency: "eur", status: "applied", createdAt: day(-3) }],
        });
      }
      default:
        return page404(route);
    }
  });

  // fake Stripe Checkout
  await page.route(/^https:\/\/checkout\.stripe\.com\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/__e2e/complete" && pending) {
      const { req, origin } = pending;
      pending = null;
      const outcome = opts.outcome ?? "trialing";
      const sub = mockSubscription({
        plan: req.plan,
        interval: req.interval,
        seats: req.seats ?? 1,
        amount: req.plan === "premium" ? 2400 : req.plan === "team" ? 1900 * (req.seats ?? 2) : 1200,
        status: outcome === "never" ? "trialing" : outcome,
        ...(outcome === "trialing" ? {} : { trialEnd: null }),
      });
      const planState: PlanInfo = outcome === "incomplete" || outcome === "unpaid" ? { plan: "free", status: outcome, trialEnd: null } : { plan: req.plan, status: sub.status, trialEnd: sub.trialEnd };
      if (outcome === "never") {
        /* the webhook never arrives: the server state stays as it was */
      } else if ((opts.webhookAfterStatusCalls ?? 0) > 0) {
        statusCalls = 0;
        held = { plan: planState, subscription: sub };
      } else {
        mock.state = { ...mock.state, plan: planState, subscription: sub, hasCustomer: true, trialUsed: true };
      }
      mock.state.invoices = [
        {
          id: "in_e2e_1",
          number: "TJ-0001",
          status: "paid",
          total: 0,
          currency: "eur",
          created: new Date().toISOString(),
          hostedUrl: "https://invoice.stripe.com/i/e2e_1",
          pdfUrl: "https://pay.stripe.com/invoice/e2e_1/pdf",
        },
      ];
      return route.fulfill({
        status: 302,
        headers: { location: ret(origin, req.returnTo, `billing=success&session_id=cs_test_e2e_${mock.checkouts.length}`) },
      });
    }
    if (url.pathname === "/__e2e/cancel" && pending) {
      const { req, origin } = pending;
      pending = null;
      return route.fulfill({ status: 302, headers: { location: ret(origin, req.returnTo, "billing=cancel") } });
    }
    const plan = pending?.req.plan ?? "pro";
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Stripe Checkout (Test)</title></head><body style="background:#fff;font-family:sans-serif;padding:40px"><h1>Stripe Checkout (Test)</h1><p data-plan="${plan}">Trade Journal ${plan}</p><a href="https://checkout.stripe.com/__e2e/complete">Jetzt abonnieren</a> · <a href="https://checkout.stripe.com/__e2e/cancel">Zurück</a></body></html>`,
    });
  });

  // fake Customer Portal
  await page.route(/^https:\/\/billing\.stripe\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const back = url.searchParams.get("return") ?? "/";
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Stripe Kundenportal (Test)</title></head><body style="background:#fff;font-family:sans-serif;padding:40px"><h1>Kundenportal (Test)</h1><p data-flow="${url.searchParams.get("flow") ?? ""}">Flow</p><a href="${back}">Zurück zum Journal</a></body></html>`,
    });
  });

  return mock;
}
