/**
 * In-process fake of the P10 billing functions + the Stripe-hosted pages, WITHOUT any transport (Paket S: extracted from
 * `tests/e2e/mocks/billing.ts`, which is now the Playwright adapter around it; the Showroom's in-app interceptor and its simulated payment
 * page are the other).
 *
 * - `handle()` answers `/api/v1/billing/status|checkout|portal|contract|code|referral` from `MockBilling.state` (the plan of the signed-in
 *   mock user is never taken from the client – a checkout only becomes a plan when the fake Stripe page "pays");
 * - `completeCheckout()` is the fake Stripe page's "Jetzt abonnieren" (as the webhook would: the subscription lands according to `outcome`),
 *   `cancelCheckout()` its "Zurück"; both return the URL the real Stripe would redirect to (`success_url` / `cancel_url`);
 * - `portalUrl` helpers give the fake Customer Portal its "Zurück zum Journal".
 *
 * Nothing in here is Stripe, nothing is a payment: every state is a number in memory.
 */
import type { BillingConfig, BillingStatus, CheckoutRequest, CodeLookup, ContractDeclaration, InvoiceSummary, PortalRequest, SubscriptionSummary } from "../../billing/contract";
import type { PlanInfo } from "../../billing/types";
import { fnRes, type MockReq, type MockRes } from "./http";

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
  /** Showroom: whose state a request reads / writes (default: one shared state, as in the e2e suite). */
  userKey?: (req: MockReq) => string;
  /** Showroom: the state of accounts that exist up front, by `userKey`. */
  initial?: Record<string, Partial<BillingState>>;
  /** Showroom: the state of an earlier page load (`snapshot()`). */
  restore?: BillingSnapshot;
  /** Showroom: called after every change of the state (the host saves a snapshot). */
  onChange?: () => void;
}

export interface BillingState {
  plan: PlanInfo;
  subscription: SubscriptionSummary | null;
  invoices: InvoiceSummary[];
  hasCustomer: boolean;
  trialUsed: boolean;
}

export interface MockBilling {
  state: BillingState;
  checkouts: CheckoutRequest[];
  portals: PortalRequest[];
  /** B4: declarations of the public cancel / withdraw pages and the links confirmed. */
  contracts: ContractDeclaration[];
  confirmed: string[];
  calls: string[];
}

export interface BillingSnapshot {
  states: Array<[string, BillingState]>;
  checkouts: CheckoutRequest[];
  sessions: Array<[string, string]>;
  pending: { req: CheckoutRequest; origin: string; key: string } | null;
}

export interface BillingCore extends MockBilling {
  handle(req: MockReq): MockRes;
  /** The order the fake hosted page is about (null when none is open). */
  pendingOrder(): CheckoutRequest | null;
  /** The fake page "pays": the webhook's result lands per `outcome`; returns where Stripe would send the browser (`success_url`). */
  completeCheckout(outcome?: NonNullable<MockBillingOptions["outcome"]>): { location: string } | null;
  /** The fake page's "Zurück": nothing was ordered; returns the `cancel_url`. */
  cancelCheckout(): { location: string } | null;
  /** Showroom: sets the plan state of an account (the panel's "Demo-Konto auf Frei setzen" / "Premium für dieses Konto"). */
  setAccount(key: string, plan: "free" | "premium"): void;
  snapshot(): BillingSnapshot;
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

const err = (status: number, code: string, message: string): MockRes => fnRes(status, { error: { code, message } });

export function createBillingCore(opts: MockBillingOptions = {}): BillingCore {
  const snap = opts.restore;
  const fresh = (): BillingState => ({ plan: { ...FREE }, subscription: null, invoices: [], hasCustomer: false, trialUsed: false });
  const mock: BillingCore = {
    state: {
      plan: opts.plan ?? { ...FREE },
      subscription: opts.subscription ?? null,
      invoices: opts.invoices ?? [],
      hasCustomer: !!opts.subscription,
      trialUsed: !!opts.subscription?.trialEnd,
    },
    checkouts: snap ? [...snap.checkouts] : [],
    portals: [],
    contracts: [],
    confirmed: [],
    calls: [],
    handle: () => err(500, "unset", "unset"),
    pendingOrder: () => null,
    completeCheckout: () => null,
    cancelCheckout: () => null,
    setAccount: () => undefined,
    snapshot: () => ({ states: [], checkouts: [], sessions: [], pending: null }),
  };
  // per account (Showroom) – the default key is `mock.state` itself, so a spec that reads `mock.state` sees what the handlers wrote
  const others = new Map<string, BillingState>();
  for (const [k, st] of snap?.states ?? []) others.set(k, st);
  for (const [k, st] of Object.entries(opts.initial ?? {})) if (!others.has(k)) others.set(k, { ...fresh(), ...st });
  const keyOf = (req: MockReq) => opts.userKey?.(req) ?? "default";
  const read = (k: string): BillingState => (k === "default" ? mock.state : (others.get(k) ?? fresh()));
  const write = (k: string, st: BillingState): void => {
    if (k === "default") mock.state = st;
    else others.set(k, st);
    opts.onChange?.();
  };
  const sessions = new Map<string, string>(snap?.sessions ?? []);
  let statusCalls = 0;
  let held: { key: string; plan: PlanInfo; subscription: SubscriptionSummary } | null = null;
  let pending: { req: CheckoutRequest; origin: string; key: string } | null = snap?.pending ?? null;
  const cfg = config(opts);
  const ret = (origin: string, returnTo: string | undefined, query: string) => {
    const raw = returnTo ?? "/#preise";
    const i = raw.indexOf("#");
    const path = i >= 0 ? raw.slice(0, i) : raw;
    const hash = i >= 0 ? raw.slice(i) : "";
    return `${origin}${path}?${query}${hash}`;
  };

  mock.handle = (req) => {
    const { url, body } = req;
    const authed = /^Bearer\s+\S+/.test(req.headers["authorization"] ?? "");
    const key = keyOf(req);
    mock.calls.push(`${req.method} ${url.pathname}`);
    const send = (status: number, b: unknown): MockRes => fnRes(status, b);
    switch (url.pathname) {
      case "/api/v1/billing/status": {
        statusCalls += 1;
        // the webhook of the fake Stripe lands after N status requests
        if (held && statusCalls > (opts.webhookAfterStatusCalls ?? 0)) {
          write(held.key, { ...read(held.key), plan: held.plan, subscription: held.subscription, hasCustomer: true, trialUsed: true });
          held = null;
        }
        const st = read(key);
        const status: BillingStatus = {
          config: cfg,
          plan: authed ? st.plan : null,
          subscription: authed ? st.subscription : null,
          invoices: authed && url.searchParams.get("invoices") === "1" ? st.invoices : null,
          hasCustomer: authed && st.hasCustomer,
          trialUsed: authed && st.trialUsed,
          team: null,
        };
        return send(200, status);
      }
      case "/api/v1/billing/checkout": {
        if (!authed) return err(401, "unauthenticated", "Bitte melde dich an.");
        if (!cfg.enabled) return err(503, "billing_unavailable", "Zahlungen sind noch nicht eingerichtet.");
        const r = body as unknown as CheckoutRequest;
        if (!cfg.purchaseOpen) return err(503, "purchase_closed", "Die Bestellung ist noch nicht freigeschaltet.");
        // B4: both consents, the order id (idempotency key) – like the real function
        if (!r.consents?.terms || !r.consents?.immediateStart) return err(422, "consent_required", "Bitte bestätige beide Kästchen vor der Bestellung.");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(r.orderId ?? ""))) return err(422, "invalid_body", "Ungültige Bestellung.");
        const known = sessions.get(r.orderId);
        if (known) {
          pending = { req: r, origin: url.origin, key };
          opts.onChange?.();
          return send(200, { url: `https://checkout.stripe.com/c/pay/${known}`, sessionId: known });
        }
        if (r.code && !opts.codes?.[String(r.code).toUpperCase()]) return err(422, "invalid_code", "Dieser Code ist ungültig oder abgelaufen.");
        mock.checkouts.push(r);
        pending = { req: r, origin: url.origin, key };
        const sid = `cs_test_e2e_${mock.checkouts.length}`;
        sessions.set(r.orderId, sid);
        opts.onChange?.();
        return send(200, { url: `https://checkout.stripe.com/c/pay/${sid}`, sessionId: sid });
      }
      case "/api/v1/billing/portal": {
        if (!authed) return err(401, "unauthenticated", "Bitte melde dich an.");
        const r = body as PortalRequest;
        mock.portals.push(r);
        const st = read(key);
        const sub = st.subscription;
        if (r.action) {
          if (!sub) return err(404, "no_subscription", "Es läuft gerade kein Abo.");
          if (r.action === "feedback") return send(200, { subscription: st.subscription, plan: st.plan });
          const next = { ...st };
          if (r.action === "cancel") next.subscription = { ...sub, cancelAtPeriodEnd: true, cancelAt: sub.trialEnd ?? sub.currentPeriodEnd };
          else if (r.action === "resume") {
            next.subscription = { ...sub, cancelAtPeriodEnd: false, cancelAt: null, status: sub.status === "paused" ? "active" : sub.status, pausedUntil: null };
            if (sub.status === "paused") next.plan = { plan: sub.plan, status: "active", trialEnd: null };
          } else if (r.action === "pause") {
            next.subscription = { ...sub, status: "paused", pausedUntil: day(30) };
            next.plan = { plan: "free", status: "paused", trialEnd: null };
          }
          write(key, next);
          return send(200, { subscription: next.subscription, plan: next.plan, ...(r.action === "cancel" ? { mail: cfg.mailReady ? "sent" : "unavailable" } : {}) });
        }
        if (!st.hasCustomer) return err(404, "no_customer", "Du hast noch kein Abo – es gibt nichts zu verwalten.");
        const back = ret(url.origin, r.returnTo, "billing=portal");
        return send(200, { url: `https://billing.stripe.com/p/session/test_e2e?flow=${r.flow ?? "manage"}&return=${encodeURIComponent(back)}` });
      }
      case "/api/v1/billing/contract": {
        const r = body as unknown as ContractDeclaration;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(r.email ?? ""))) return err(422, "invalid_email", "Bitte gib eine gültige E-Mail-Adresse an.");
        mock.contracts.push(r);
        return send(200, { kind: r.kind, receivedAt: new Date().toISOString(), mail: cfg.mailReady ? "sent" : "unavailable", next: authed ? "done" : "check" });
      }
      case "/api/v1/billing/contract/confirm": {
        const token = String(body.token ?? "");
        mock.confirmed.push(token);
        const last = mock.contracts.at(-1);
        return send(200, { kind: last?.kind ?? "cancel", status: "done", endsAt: day(20), confirmedAt: new Date().toISOString() });
      }
      case "/api/v1/billing/code": {
        if (!cfg.enabled) return err(503, "billing_unavailable", "Zahlungen sind noch nicht eingerichtet.");
        const code = String(body.code ?? "")
          .trim()
          .toUpperCase();
        const hit = opts.codes?.[code];
        return send(200, hit ? { valid: true, code, ...hit } : { valid: false, code, message: "Dieser Code ist ungültig oder abgelaufen." });
      }
      case "/api/v1/billing/referral": {
        const code = url.searchParams.get("code");
        if (code !== null) {
          const days = opts.referrals?.[code.toUpperCase()];
          return send(200, { valid: days !== undefined, trialDays: days ?? 0 });
        }
        if (!authed) return err(401, "unauthenticated", "Bitte melde dich an.");
        return send(200, {
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
        return err(404, "not_found", "Nicht gefunden.");
    }
  };

  mock.pendingOrder = () => pending?.req ?? null;

  mock.completeCheckout = (outcomeOverride) => {
    if (!pending) return null;
    const { req, origin, key } = pending;
    pending = null;
    const outcome = outcomeOverride ?? opts.outcome ?? "trialing";
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
      held = { key, plan: planState, subscription: sub };
    } else {
      write(key, { ...read(key), plan: planState, subscription: sub, hasCustomer: true, trialUsed: true });
    }
    write(key, {
      ...read(key),
      invoices: [
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
      ],
    });
    return { location: ret(origin, req.returnTo, `billing=success&session_id=cs_test_e2e_${mock.checkouts.length}`) };
  };

  mock.cancelCheckout = () => {
    if (!pending) return null;
    const { req, origin } = pending;
    pending = null;
    opts.onChange?.();
    return { location: ret(origin, req.returnTo, "billing=cancel") };
  };

  mock.setAccount = (key, plan) => {
    const cur = read(key);
    if (plan === "free") write(key, { ...cur, plan: { ...FREE }, subscription: null, hasCustomer: false, trialUsed: false });
    else
      write(key, {
        ...cur,
        plan: { plan: "premium", status: "active", trialEnd: null },
        subscription: mockSubscription({ id: "sub_demo_1", plan: "premium", status: "active", interval: "year", amount: 24000, trialEnd: null, currentPeriodEnd: day(300) }),
        hasCustomer: true,
        trialUsed: true,
      });
  };

  mock.snapshot = () => ({
    states: [["default", mock.state], ...others.entries()],
    checkouts: [...mock.checkouts],
    sessions: [...sessions.entries()],
    pending,
  });

  return mock;
}
