/**
 * Paket V – the payment window paid IN the app: the card face follows the fields (brand, „••••“ groups, holder, the turn at the security
 * code), the order runs through our server and the card fields' own confirmation, and „Testphase läuft“ / „Bezahlt“ stands ONLY after
 * `billing/status` (the webhook's word) reports the subscription. A declined card turns back with the message at the field.
 *
 * The window runs here with the dev-only demo fields (they behave like Stripe's: they report `empty` / `complete` / `brand`, never the
 * digits); the Stripe Elements adapter is tested on its own against a mocked `@stripe/stripe-js/pure`. Mocked fetch: this proves the
 * browser flow, not a Stripe account.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRedirectForTests } from "@/billing/api";
import type { BillingStatus, SubscriptionSummary } from "@/billing/contract";
import { resetOrderForm } from "@/billing/purchase/orderState";
import { fieldSource, registerDemoFields, stripeKey } from "@/billing/purchase/pay/fields";
import { resetPayFlow, setPollSleepForTests, usePayFlow, type PayPhase } from "@/billing/purchase/pay/payFlow";
import { openOrder, resetBilling, useBilling } from "@/billing/store";
import { BillingHost } from "@/billing/ui";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";

const loadStripe = vi.fn();
vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: (...a: unknown[]) => loadStripe(...a) }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false, name: "Mara Test" };
const CONFIG: BillingStatus["config"] = { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"], purchaseOpen: true, automaticTax: false, mailReady: true };
const NUMBER = "4242424242424242";

const posts: { path: string; body: Record<string, unknown> | null }[] = [];
let statusCalls = 0;
/** From which status call on the server (the webhook) reports the subscription. */
let liveFrom = 3;
let subStatus: SubscriptionSummary["status"] = "trialing";
let trial = 14;

const sub = (): SubscriptionSummary => ({
  id: "sub_new",
  plan: "pro",
  status: subStatus,
  interval: "year",
  seats: 1,
  currentPeriodEnd: "2027-11-08T08:00:00Z",
  cancelAtPeriodEnd: false,
  cancelAt: null,
  trialEnd: trial ? "2026-11-22T08:00:00Z" : null,
  pausedUntil: null,
  amount: 12000,
  currency: "eur",
  hasPaymentMethod: true,
  startedAt: new Date().toISOString(),
});

const fail = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  posts.length = 0;
  statusCalls = 0;
  liveFrom = 3;
  subStatus = "trialing";
  trial = 14;
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedIn", user: USER });
  resetBilling();
  resetOrderForm();
  resetPayFlow();
  setRedirectForTests(() => {});
  setPollSleepForTests(() => Promise.resolve());
  registerDemoFields(() => import("@/billing/purchase/pay/demoFields").then((m) => m.createDemoFields()));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://journal.test");
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      posts.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/billing/subscribe")) {
        if (body?.setupIntent) return Response.json({ kind: "created", subscriptionId: "sub_new", trialDays: trial, card: { brand: "visa", last4: "4242" } });
        return Response.json(trial ? { kind: "setup", clientSecret: "seti_1_secret_x", trialDays: trial } : { kind: "payment", clientSecret: "pi_1_secret_x", subscriptionId: "sub_new", trialDays: 0 });
      }
      if (url.pathname.endsWith("/billing/demo-confirm")) {
        if (body?.verdict === "declined") return fail(402, "card_declined", "Die Karte wurde abgelehnt. Es wurde nichts berechnet.");
        return Response.json({ intentId: trial ? "seti_1" : "pi_1" });
      }
      statusCalls++;
      const s = statusCalls >= liveFrom ? sub() : null;
      return Response.json({ config: CONFIG, plan: s ? { plan: "pro", status: s.status, trialEnd: s.trialEnd } : null, subscription: s, invoices: [], hasCustomer: !!s, trialUsed: false, team: null });
    }),
  );
});

afterEach(() => {
  setCloudEnabledForTests(null);
  setRedirectForTests(null);
  setPollSleepForTests(null);
  registerDemoFields(null);
  resetCloudSession();
  resetBilling();
  resetPayFlow();
  vi.unstubAllGlobals();
});

async function openWindow() {
  useBilling.setState({ config: CONFIG });
  render(
    <MotionRoot>
      <BillingHost />
    </MotionRoot>,
  );
  act(() => openOrder({ plan: "pro", interval: "year", seats: 1 }));
  const sheet = await screen.findByTestId("order-sheet", {}, { timeout: 10_000 });
  await screen.findByTestId("demo-number", {}, { timeout: 5_000 });
  return sheet;
}

const type = (id: string, value: string) => fireEvent.input(screen.getByTestId(id), { target: { value } });

function fillCard(number = NUMBER) {
  type("demo-number", number);
  type("demo-expiry", "1230");
  type("demo-cvc", "123");
}

function tickBoth() {
  fireEvent.click(within(screen.getByTestId("order-terms")).getByRole("checkbox"));
  fireEvent.click(within(screen.getByTestId("order-immediate")).getByRole("checkbox"));
}

describe("which fields the window shows", () => {
  it("Stripe Elements with a publishable key, the demo only where a build registered it, Checkout with Stripe Tax or without both", () => {
    expect(fieldSource({ automaticTax: false, key: "pk_test_abcdefghijklmnop" })).toBe("stripe");
    expect(fieldSource({ automaticTax: true, key: "pk_test_abcdefghijklmnop" })).toBe("redirect");
    expect(fieldSource({ automaticTax: false, key: null, demo: true })).toBe("demo");
    expect(fieldSource({ automaticTax: false, key: null, demo: false })).toBe("redirect");
    expect(stripeKey("pk_live_abcdefghijklmnop")).toBe("pk_live_abcdefghijklmnop");
    for (const bad of ["sk_live_abcdefghijklmnop", "rk_test_abcdefghijklmnop", "pk_test_x", "", undefined]) expect(stripeKey(bad)).toBeNull();
  });
});

describe("the card follows the fields", () => {
  it("demo marked, holder from the account, „••••“ groups by empty / typing / complete, the brand from the field, the turn at the security code", async () => {
    const sheet = await openWindow();
    expect(sheet).toHaveAttribute("data-source", "demo");
    expect(screen.getByTestId("pay-demo-badge")).toBeInTheDocument();
    expect(screen.getByTestId("pay-holder")).toHaveValue("Mara Test");
    expect(screen.getByTestId("pay-card-holder")).toHaveTextContent("MARA TEST");
    const groups = () => screen.getByTestId("pay-card-number").getAttribute("data-groups");
    expect(groups()).toBe("0");
    type("demo-number", "4242");
    expect(groups()).toBe("1");
    expect(screen.getByTestId("pay-card-brand")).toHaveTextContent("VISA");
    type("demo-number", NUMBER);
    expect(groups()).toBe("4");
    // the card shows groups, never the digits it was given
    expect(screen.getByTestId("pay-card")).not.toHaveTextContent("4242");
    const flipper = screen.getByTestId("pay-card-flipper");
    expect(flipper).toHaveAttribute("data-flipped", "0");
    fireEvent.focus(screen.getByTestId("demo-cvc"));
    expect(flipper).toHaveAttribute("data-flipped", "1");
    fireEvent.blur(screen.getByTestId("demo-cvc"));
    expect(flipper).toHaveAttribute("data-flipped", "0");
  });

  it("a missing field is named at the field, nothing is ordered", async () => {
    await openWindow();
    tickBoth();
    type("demo-number", NUMBER);
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(screen.getByText("Gib das Ablaufdatum ein.", { exact: false })).toBeInTheDocument());
    expect(posts.some((p) => p.path.endsWith("/billing/subscribe"))).toBe(false);
  });
});

describe("the order in the app", () => {
  it("trial: subscribe → the card fields confirm → complete → „Testphase läuft“ only once the server reports the subscription", async () => {
    const seen: { phase: PayPhase; live: boolean }[] = [];
    const off = usePayFlow.subscribe((s) => seen.push({ phase: s.phase, live: useBilling.getState().account?.subscription?.status === "trialing" }));
    await openWindow();
    tickBoth();
    fillCard();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(screen.getByTestId("pay-status-title")).toHaveTextContent("Testphase läuft"), { timeout: 5_000 });
    off();
    const order = posts.filter((p) => !p.path.endsWith("/billing/status")).map((p) => p.path.replace(/^.*\/billing\//, ""));
    expect(order).toEqual(["subscribe", "demo-confirm", "subscribe"]);
    expect(posts.find((p) => p.path.endsWith("/billing/subscribe") && p.body?.setupIntent)?.body?.setupIntent).toBe("seti_1");
    expect(statusCalls).toBeGreaterThanOrEqual(liveFrom);
    // the browser never concluded on its own: „confirmed“ only came with the server's subscription
    expect(seen.filter((s) => s.phase === "confirmed").every((s) => s.live)).toBe(true);
    expect(seen.some((s) => s.phase === "waiting" && !s.live)).toBe(true);
    expect(screen.getByTestId("order-sheet")).toHaveAttribute("data-pay-phase", "confirmed");
  });

  it("the card number never leaves the browser: our server and the demo server get the order and a verdict, no digits", async () => {
    await openWindow();
    tickBoth();
    fillCard();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(usePayFlow.getState().phase).toBe("confirmed"), { timeout: 5_000 });
    const sent = JSON.stringify(posts.map((p) => p.body));
    expect(sent).not.toContain(NUMBER);
    expect(sent).not.toContain("4242 4242");
    expect(posts.find((p) => p.path.endsWith("/billing/demo-confirm"))?.body).toEqual({ clientSecret: "seti_1_secret_x", kind: "setup", verdict: "ok" });
  });

  it("without a trial: the first invoice is paid (payment intent), „Bezahlt …“ after the server's word", async () => {
    trial = 0;
    subStatus = "active";
    await openWindow();
    tickBoth();
    fillCard();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(screen.getByTestId("pay-status-title")).toHaveTextContent(/^Bezahlt /), { timeout: 5_000 });
    expect(posts.find((p) => p.path.endsWith("/billing/demo-confirm"))?.body?.kind).toBe("payment");
    expect(posts.filter((p) => p.path.endsWith("/billing/subscribe"))).toHaveLength(1);
  });

  it("a declined card: back to the form, the message at the number field, nothing shown as paid, no subscription asked for", async () => {
    await openWindow();
    tickBoth();
    fillCard("4000000000000002");
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(screen.getByTestId("pay-number-error")).toHaveTextContent("Die Karte wurde abgelehnt"), { timeout: 5_000 });
    expect(usePayFlow.getState().phase).toBe("failed");
    expect(screen.getByTestId("order-sheet")).toHaveAttribute("data-pay-phase", "failed");
    expect(screen.getByTestId("pay-status-title")).not.toHaveTextContent(/Bezahlt|Testphase läuft/);
    expect(posts.filter((p) => p.path.endsWith("/billing/subscribe"))).toHaveLength(1); // no second step
  });

  it("the payment fails after the check (the webhook reports it unpaid): failed, never „Bezahlt“", async () => {
    trial = 0;
    subStatus = "unpaid";
    await openWindow();
    tickBoth();
    fillCard();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(usePayFlow.getState().phase).toBe("failed"), { timeout: 5_000 });
    expect(screen.getByTestId("pay-number-error")).toHaveTextContent("Die Zahlung hat nicht geklappt");
  });
});

describe("Stripe Elements adapter (mocked Stripe.js)", () => {
  type Handler = (e: Record<string, unknown>) => void;
  function fakeStripe(confirm: Record<string, unknown>) {
    const els: Record<string, { on: Record<string, Handler>; mounted: HTMLElement | null; destroyed: boolean; opts: Record<string, unknown> }> = {};
    const create = vi.fn((type: string, opts: Record<string, unknown>) => {
      const el = { on: {} as Record<string, Handler>, mounted: null as HTMLElement | null, destroyed: false, opts };
      els[type] = el;
      return {
        on: (ev: string, fn: Handler) => void (el.on[ev] = fn),
        mount: (t: HTMLElement) => void (el.mounted = t),
        update: vi.fn(),
        focus: vi.fn(),
        destroy: () => void (el.destroyed = true),
      };
    });
    const stripe = { elements: vi.fn(() => ({ create })), confirmCardSetup: vi.fn(async () => confirm), confirmCardPayment: vi.fn(async () => confirm) };
    loadStripe.mockResolvedValue(stripe);
    return { stripe, els, create };
  }
  const style = { color: "#111", placeholder: "#777", danger: "#c00", fontFamily: "mono", fontSize: "16px" };
  const targets = () => ({ number: document.createElement("div"), expiry: document.createElement("div"), cvc: document.createElement("div") });

  it("three separate elements in Stripe's frames; we only get empty / complete / brand / focus, Stripe confirms the setup itself", async () => {
    const { stripe, els } = fakeStripe({ setupIntent: { id: "seti_9", status: "succeeded" } });
    const { createStripeFields } = await import("@/billing/purchase/pay/stripeFields");
    const f = await createStripeFields("pk_test_abcdefghijklmnop");
    expect(loadStripe).toHaveBeenCalledWith("pk_test_abcdefghijklmnop", { locale: "de" });
    const on = { change: vi.fn(), focus: vi.fn(), blur: vi.fn() };
    const t = targets();
    f.mount(t, on, style);
    expect(Object.keys(els).sort()).toEqual(["cardCvc", "cardExpiry", "cardNumber"]);
    expect(els.cardNumber!.mounted).toBe(t.number);
    els.cardNumber!.on.change!({ empty: false, complete: true, brand: "visa" });
    expect(on.change).toHaveBeenCalledWith("number", { empty: false, complete: true, error: null }, "visa");
    els.cardCvc!.on.focus!({});
    expect(on.focus).toHaveBeenCalledWith("cvc");
    const r = await f.confirm("setup", "seti_9_secret_y", { name: "Mara Test" });
    expect(r).toEqual({ ok: true, intentId: "seti_9" });
    expect(stripe.confirmCardSetup).toHaveBeenCalledWith("seti_9_secret_y", { payment_method: { card: expect.anything(), billing_details: { name: "Mara Test" } } });
    expect(stripe.confirmCardPayment).not.toHaveBeenCalled();
    f.destroy();
    expect(els.cardNumber!.destroyed && els.cardExpiry!.destroyed && els.cardCvc!.destroyed).toBe(true);
  });

  it("a refused payment (3-D Secure included) comes back as a German message at the right field", async () => {
    fakeStripe({ error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." } });
    const { createStripeFields, confirmMessage, fieldOfError } = await import("@/billing/purchase/pay/stripeFields");
    const f = await createStripeFields("pk_test_abcdefghijklmnop");
    f.mount(targets(), { change: vi.fn(), focus: vi.fn(), blur: vi.fn() }, style);
    const r = await f.confirm("payment", "pi_1_secret_x", { name: "M" });
    expect(r).toEqual({ ok: false, code: "insufficient_funds", message: "Die Karte ist nicht ausreichend gedeckt. Es wurde nichts berechnet.", field: "number" });
    expect(confirmMessage({ type: "invalid_request_error", code: "payment_intent_authentication_failure", message: "x" })).toMatch(/3-D Secure/);
    expect(fieldOfError({ type: "card_error", code: "incorrect_cvc" })).toBe("cvc");
    expect(fieldOfError({ type: "card_error", code: "expired_card" })).toBe("expiry");
  });
});
