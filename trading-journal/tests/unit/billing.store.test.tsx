/**
 * P10 client billing: the entitlement contract (`useEntitlement`, `useLimit`, `usePlan`, `<Gate>`) across the three
 * modes, the steady per-user cache, and the store flows against a stubbed `fetch` (status, checkout redirect, portal,
 * in-app cancellation, promotion code, referral check).
 */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRedirectForTests } from "@/billing/api";
import type { BillingStatus, SubscriptionSummary } from "@/billing/contract";
import { Gate, useEntitlement, useLimit, usePlan } from "@/billing/entitlements";
import {
  BILLING_CACHE_KEY,
  changeSubscription,
  checkCode,
  effectivePlanOf,
  loadBilling,
  modeOf,
  purchaseOpenOf,
  requestOrder,
  resetBilling,
  useBilling,
  verifyReferral,
} from "@/billing/store";
import { consentSetHash } from "@/legal/consentRecord";
import { readLastOrder, resetOrderForm, setImmediate, setTerms, submitOrder, useOrderForm } from "@/billing/purchase/orderState";
import { peekReturnTo, clearReturnTo } from "@/store/returnTo";
import { REF_KEY } from "@/billing/url";
import { FUNCTIONS_MISSING } from "@/cloud/api";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { useUi } from "@/store/uiStore";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const CONFIG: BillingStatus["config"] = { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"], purchaseOpen: true };
const SUB: SubscriptionSummary = {
  id: "sub_1",
  plan: "pro",
  status: "active",
  interval: "month",
  seats: 1,
  currentPeriodEnd: "2026-11-12T08:00:00Z",
  cancelAtPeriodEnd: false,
  cancelAt: null,
  trialEnd: null,
  pausedUntil: null,
  amount: 1200,
  currency: "eur",
  hasPaymentMethod: true,
};

const status = (p: Partial<BillingStatus> = {}): BillingStatus => ({ config: CONFIG, plan: null, subscription: null, invoices: null, hasCustomer: false, trialUsed: false, team: null, ...p });

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown; html?: boolean };
let handler: Handler;
const calls: { url: URL; body: unknown; auth: string | null }[] = [];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://journal.test");
      const headers = new Headers(init.headers);
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, auth: headers.get("authorization") });
      const r = handler(url, init);
      if (r.html) return new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
}

function signIn() {
  useCloudSession.setState({ phase: "signedIn", user: USER });
}

const redirects: string[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  redirects.length = 0;
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedOut" });
  resetBilling();
  clearReturnTo();
  useUi.setState({ toasts: [] });
  handler = () => ({ body: status() });
  stubFetch();
  setRedirectForTests((u) => redirects.push(u));
});

afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetBilling();
  clearReturnTo();
  setRedirectForTests(null);
  vi.unstubAllGlobals();
});

describe("modes + entitlements", () => {
  it("pure resolution: off / closed / open, plan from server, else cache, else free", () => {
    expect(modeOf(false, CONFIG, null)).toBe("off");
    expect(modeOf(true, { ...CONFIG, enabled: false }, null)).toBe("closed");
    expect(modeOf(true, null, { userId: null, plan: null, closed: true, at: 0 })).toBe("closed");
    expect(modeOf(true, null, null)).toBe("open");
    const account = { userId: "u1", plan: { plan: "pro" as const, status: "active" as const, trialEnd: null }, subscription: null, invoices: null, hasCustomer: true, trialUsed: false, team: null };
    expect(effectivePlanOf("open", "u1", account, null).plan).toBe("pro");
    expect(effectivePlanOf("open", "u2", account, null).plan).toBe("free");
    expect(effectivePlanOf("open", "u2", null, { userId: "u2", plan: { plan: "premium", status: "trialing", trialEnd: null }, closed: false, at: 0 }).plan).toBe("premium");
    expect(effectivePlanOf("closed", "u1", account, null).plan).toBe("free");
    // reload with a stored login: the cached plan holds until the session is back, never for a signed-out visitor
    const cache = { userId: "u1", plan: { plan: "pro" as const, status: "active" as const, trialEnd: null }, closed: false, at: 0 };
    expect(effectivePlanOf("open", null, null, cache, true).plan).toBe("pro");
    expect(effectivePlanOf("open", null, null, cache, false).plan).toBe("free");
  });

  it("without cloud everything is unlocked", () => {
    setCloudEnabledForTests(false);
    const { result } = renderHook(() => ({ mc: useEntitlement("monteCarlo"), views: useLimit("savedViews"), plan: usePlan() }));
    expect(result.current).toMatchObject({ mc: true, views: Infinity, plan: { plan: "free" } });
  });

  it("payments not set up: unlocked too; open + signed out: Free gates apply", () => {
    useBilling.setState({ config: { ...CONFIG, enabled: false } });
    const { result, rerender } = renderHook(() => ({ mc: useEntitlement("monteCarlo"), sync: useEntitlement("cloudSync"), ex: useLimit("exchangeConnections") }));
    expect(result.current).toEqual({ mc: true, sync: true, ex: Infinity });
    act(() => useBilling.setState({ config: CONFIG }));
    rerender();
    // tariff contract A1: Free holds one read-only exchange connection (manual sync)
    expect(result.current).toEqual({ mc: false, sync: true, ex: 1 });
  });

  it("signed in: the server's plan, kept per user across a reload (cache), never for another user", async () => {
    signIn();
    handler = () => ({ body: status({ plan: { plan: "pro", status: "active", trialEnd: null }, subscription: SUB, hasCustomer: true }) });
    await act(() => loadBilling());
    const { result } = renderHook(() => ({ mc: useEntitlement("monteCarlo"), ai: useEntitlement("coachAi"), plan: usePlan().plan }));
    expect(result.current).toEqual({ mc: true, ai: false, plan: "pro" });
    expect(JSON.parse(localStorage.getItem(BILLING_CACHE_KEY)!)).toMatchObject({ userId: USER.id, plan: { plan: "pro" }, closed: false });
    // "reload": a fresh store reads the cache – still Pro before the next status arrives
    resetBilling();
    expect(useBilling.getState().account).toBeNull();
    const again = renderHook(() => useEntitlement("monteCarlo"));
    expect(again.result.current).toBe(true);
    act(() => useCloudSession.setState({ user: { ...USER, id: "someone-else" } }));
    again.rerender();
    expect(again.result.current).toBe(false);
  });

  it("<Gate> renders the children or the fallback", () => {
    useBilling.setState({ config: CONFIG });
    const { rerender } = render(
      <Gate feature="monteCarlo" fallback={<p>gesperrt</p>}>
        <p>Monte Carlo</p>
      </Gate>,
    );
    expect(screen.getByText("gesperrt")).toBeInTheDocument();
    act(() => useBilling.setState({ config: { ...CONFIG, enabled: false } }));
    rerender(
      <Gate feature="monteCarlo" fallback={<p>gesperrt</p>}>
        <p>Monte Carlo</p>
      </Gate>,
    );
    expect(screen.getByText("Monte Carlo")).toBeInTheDocument();
  });
});

describe("store flows", () => {
  it("functions missing (SPA page instead of JSON) → closed, honestly", async () => {
    handler = () => ({ body: null, html: true });
    await act(() => loadBilling());
    expect(useBilling.getState().config).toMatchObject({ enabled: false, reason: "functions_missing" });
    expect(FUNCTIONS_MISSING).toMatch(/nicht eingerichtet/);
  });

  it("an order signed out: noted for returnTo (exactly this choice) and the registration opens; nothing is posted", async () => {
    useBilling.setState({ config: CONFIG });
    requestOrder({ plan: "team", interval: "year", seats: 4 });
    expect(peekReturnTo()).toMatchObject({ target: { kind: "order", order: "team.year.4" }, wait: { on: "signedIn" } });
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signup" });
    expect(useBilling.getState().order.open).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("the purchase flow is LOCKED while the server does not say purchaseOpen (legal texts missing, or an older server): honest toast, no sheet", async () => {
    signIn();
    for (const config of [{ ...CONFIG, purchaseOpen: false, purchaseBlockedBy: ["legal" as const] }, { ...CONFIG, purchaseOpen: undefined }]) {
      useBilling.setState({ config, order: { open: false, draft: null, loaded: false, openedAt: 0 } });
      requestOrder({ plan: "pro", interval: "month" });
      expect(useBilling.getState().order.open).toBe(false);
    }
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: "info", title: "Zahlungen noch nicht eingerichtet" });
    expect(purchaseOpenOf({ ...CONFIG, purchaseOpen: false, purchaseBlockedBy: ["legal"] }, "open")).toEqual({ open: false, blockedBy: ["legal"] });
    expect(purchaseOpenOf(CONFIG, "closed")).toEqual({ open: false, blockedBy: ["stripe"] });
    expect(purchaseOpenOf(CONFIG, "open")).toEqual({ open: true, blockedBy: [] });
  });

  it("an order asked for while the configuration is still loading waits for it – no false „Zahlungen noch nicht eingerichtet“ (QA Runde 13)", async () => {
    signIn();
    const toastsBefore = useUi.getState().toasts.length;
    // right after the sign-in: nothing loaded yet
    useBilling.setState({ config: null, configState: "loading", order: { open: false, draft: null, loaded: false, openedAt: 0 } });
    requestOrder({ plan: "premium", interval: "year" });
    expect(useBilling.getState().order.open).toBe(false);
    expect(useUi.getState().toasts).toHaveLength(toastsBefore); // nothing is claimed about Stripe
    // the server answers: payments are open → the order window opens with exactly this choice
    act(() => useBilling.setState({ config: CONFIG, configState: "ready" }));
    await waitFor(() => expect(useBilling.getState().order).toMatchObject({ open: true, draft: { plan: "premium", interval: "year", seats: 1 } }));
    expect(useUi.getState().toasts).toHaveLength(toastsBefore);
  });

  it("… and when the answer says payments are closed, the honest toast comes then (once), not before", async () => {
    signIn();
    const toastsBefore = useUi.getState().toasts.length;
    useBilling.setState({ config: null, configState: "loading", order: { open: false, draft: null, loaded: false, openedAt: 0 } });
    requestOrder({ plan: "pro", interval: "month" });
    expect(useUi.getState().toasts).toHaveLength(toastsBefore);
    act(() => useBilling.setState({ config: { ...CONFIG, purchaseOpen: false, purchaseBlockedBy: ["legal" as const] }, configState: "ready" }));
    await waitFor(() => expect(useUi.getState().toasts).toHaveLength(toastsBefore + 1));
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: "info", title: "Zahlungen noch nicht eingerichtet" });
    expect(useBilling.getState().order.open).toBe(false);
  });

  it("an order signed in opens the order sheet with exactly the choice (Team seats clamped)", () => {
    signIn();
    useBilling.setState({ config: CONFIG });
    requestOrder({ plan: "team", interval: "month", seats: 1 });
    expect(useBilling.getState().order).toMatchObject({ open: true, loaded: true, draft: { plan: "team", interval: "month", seats: 2 } });
    expect(calls).toHaveLength(0);
  });

  it("submitOrder: nothing is sent while a box is open; with both: code + referral + return path + order id + consents + hash, then Stripe only", async () => {
    signIn();
    useBilling.setState({ config: CONFIG, promo: { valid: true, code: "TRADER20", percentOff: 20 } });
    localStorage.setItem(REF_KEY, JSON.stringify({ code: "FRIEND30", at: Date.now() }));
    window.history.replaceState(null, "", "/#preise");
    handler = () => ({ body: { url: "https://checkout.stripe.com/c/pay/cs_test_1", sessionId: "cs_test_1" } });
    const draft = { plan: "pro" as const, interval: "month" as const, seats: 1 };
    resetOrderForm();
    setTerms(true);
    expect(await submitOrder(draft)).toBe("blocked");
    expect(useOrderForm.getState().tried).toBe(true);
    expect(calls).toHaveLength(0);
    setImmediate(true);
    expect(await submitOrder(draft)).toBe("redirect");
    expect(calls[0]!.url.pathname).toBe("/api/v1/billing/checkout");
    expect(calls[0]!.body).toEqual({
      plan: "pro",
      interval: "month",
      code: "TRADER20",
      ref: "FRIEND30",
      returnTo: "/#preise",
      orderId: useOrderForm.getState().orderId,
      consents: { terms: true, immediateStart: true },
      consentHash: await consentSetHash(),
    });
    expect(redirects).toEqual(["https://checkout.stripe.com/c/pay/cs_test_1"]);
    expect(readLastOrder()).toMatchObject({ orderId: useOrderForm.getState().orderId, draft: { plan: "pro", interval: "month" } });
    // a non-Stripe URL is never followed
    useBilling.setState({ busy: null });
    resetOrderForm();
    setTerms(true);
    setImmediate(true);
    handler = () => ({ body: { url: "https://evil.example/pay", sessionId: "x" } });
    expect(await submitOrder(draft)).toBe("failed");
    expect(redirects).toHaveLength(1);
    expect(useOrderForm.getState()).toMatchObject({ phase: "idle", error: "Unerwartete Weiterleitung – abgebrochen." });
  });

  it("a double click sends ONE request (and the id is the server's idempotency key)", async () => {
    signIn();
    useBilling.setState({ config: CONFIG });
    resetOrderForm();
    setTerms(true);
    setImmediate(true);
    handler = () => ({ body: { url: "https://checkout.stripe.com/c/pay/cs_test_1", sessionId: "cs_test_1" } });
    const draft = { plan: "pro" as const, interval: "year" as const, seats: 1 };
    const [a, b] = await Promise.all([submitOrder(draft), submitOrder(draft)]);
    expect([a, b].sort()).toEqual(["blocked", "redirect"]);
    expect(calls.filter((c) => c.url.pathname.endsWith("/checkout"))).toHaveLength(1);
  });

  it("503 purchase_closed / billing_unavailable close the shop in the browser; 409 already_subscribed reloads the account; consent_outdated says so", async () => {
    signIn();
    const ready = () => {
      resetOrderForm();
      setTerms(true);
      setImmediate(true);
    };
    const draft = { plan: "pro" as const, interval: "month" as const, seats: 1 };
    useBilling.setState({ config: CONFIG });
    ready();
    handler = (u) => (u.pathname.endsWith("/checkout") ? { status: 503, body: { error: { code: "purchase_closed", message: "x" } } } : { body: status() });
    await submitOrder(draft);
    expect(useBilling.getState().config).toMatchObject({ enabled: true, purchaseOpen: false, purchaseBlockedBy: ["legal"] });
    useBilling.setState({ config: CONFIG, busy: null });
    ready();
    handler = (u) => (u.pathname.endsWith("/checkout") ? { status: 503, body: { error: { code: "billing_unavailable", message: "Zahlungen sind noch nicht eingerichtet." } } } : { body: status() });
    await submitOrder(draft);
    expect(useBilling.getState().config?.enabled).toBe(false);
    useBilling.setState({ config: CONFIG, busy: null });
    ready();
    handler = (u) => (u.pathname.endsWith("/checkout") ? { status: 409, body: { error: { code: "consent_outdated", message: "x" } } } : { body: status() });
    await submitOrder(draft);
    expect(useOrderForm.getState().error).toMatch(/aktualisiert/);
    useBilling.setState({ config: CONFIG, busy: null });
    ready();
    handler = (u) =>
      u.pathname.endsWith("/checkout")
        ? { status: 409, body: { error: { code: "already_subscribed", message: "x" } } }
        : { body: status({ plan: { plan: "pro", status: "active", trialEnd: null }, subscription: SUB, hasCustomer: true }) };
    await submitOrder(draft);
    await waitFor(() => expect(useBilling.getState().account?.plan.plan).toBe("pro"));
  });

  it("in-app cancellation updates the account at once", async () => {
    signIn();
    handler = (u) =>
      u.pathname.endsWith("/portal")
        ? { body: { subscription: { ...SUB, cancelAtPeriodEnd: true, cancelAt: SUB.currentPeriodEnd }, plan: { plan: "pro", status: "active", trialEnd: null } } }
        : { body: status({ plan: { plan: "pro", status: "active", trialEnd: null }, subscription: SUB, hasCustomer: true }) };
    await act(() => loadBilling());
    expect(await changeSubscription("cancel", { reason: "too_expensive" })).toBe(true);
    expect(calls.at(-1)!.body).toEqual({ action: "cancel", reason: "too_expensive" });
    expect(useBilling.getState().account?.subscription).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it("promotion code preview and referral check", async () => {
    handler = (u) =>
      u.pathname.endsWith("/code")
        ? { body: { valid: true, code: "TRADER20", percentOff: 20, message: "−20 % für 3 Monate" } }
        : { body: { valid: u.searchParams.get("code") === "FRIEND30", trialDays: 30 } };
    expect(await checkCode("trader20")).toMatchObject({ valid: true, percentOff: 20 });
    expect(useBilling.getState().promo?.code).toBe("TRADER20");
    localStorage.setItem(REF_KEY, JSON.stringify({ code: "FRIEND30", at: Date.now() }));
    await verifyReferral();
    expect(useBilling.getState().referral).toEqual({ code: "FRIEND30", valid: true, trialDays: 30 });
    expect(calls.at(-1)!.auth).toBeNull();
    localStorage.setItem(REF_KEY, JSON.stringify({ code: "NOPE1234", at: Date.now() }));
    await verifyReferral();
    expect(useBilling.getState().referral).toBeNull();
    expect(localStorage.getItem(REF_KEY)).toBeNull();
  });
});
