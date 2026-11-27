/**
 * The order window – since Paket V the payment window of the reference recording (step band, card left, form right) – in its hand-over
 * mode (no publishable key here, Stripe Tax on): the VIS-05/06/07 sums, the hand-over to Stripe Checkout with the button's orbs and the way
 * back after a failed order, and the result page's glow that belongs to the SERVER-confirmed state only. Mocked fetch: this proves the
 * browser flow, not a Stripe account. The order paid in the app has its own file (`billing.payWindow.test.tsx`).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRedirectForTests } from "@/billing/api";
import type { BillingStatus, SubscriptionSummary } from "@/billing/contract";
import type { OrderDraft } from "@/billing/purchase/order";
import { openOrder, resetBilling, setReturned, useBilling } from "@/billing/store";
import { BillingHost } from "@/billing/ui";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const CONFIG: BillingStatus["config"] = { enabled: true, trialDays: 0, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"], purchaseOpen: true, automaticTax: true, mailReady: true };
const SUB: SubscriptionSummary = { id: "sub_1", plan: "premium", status: "active", interval: "year", seats: 1, currentPeriodEnd: "2027-11-12T08:00:00Z", cancelAtPeriodEnd: false, cancelAt: null, trialEnd: null, pausedUntil: null, amount: 24_000, currency: "eur", hasPaymentMethod: true };
const account = (sub: SubscriptionSummary | null) => ({ userId: USER.id, plan: sub ? { plan: sub.plan, status: sub.status, trialEnd: null } : { plan: "free" as const, status: "none" as const, trialEnd: null }, subscription: sub, invoices: [], hasCustomer: !!sub, trialUsed: false, team: null });

let checkout: "hang" | "fail" | "ok" = "ok";
const posts: string[] = [];
const redirects: string[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  posts.length = 0;
  redirects.length = 0;
  checkout = "ok";
  fx.reduced = false;
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedIn", user: USER });
  resetBilling();
  setRedirectForTests((u) => redirects.push(u));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "https://journal.test");
      posts.push(url.pathname);
      if (url.pathname.endsWith("/checkout")) {
        if (checkout === "hang") return new Promise<Response>(() => undefined);
        if (checkout === "fail") return Response.json({ code: "boom", message: "Stripe antwortet nicht." }, { status: 502 });
        return Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_1", sessionId: "cs_test_1" });
      }
      const st = useBilling.getState();
      return Response.json({ config: st.config ?? CONFIG, plan: st.account?.plan ?? null, subscription: st.account?.subscription ?? null, invoices: [], hasCustomer: !!st.account?.hasCustomer, trialUsed: false, team: null });
    }),
  );
});
afterEach(() => {
  setCloudEnabledForTests(null);
  setRedirectForTests(null);
  resetCloudSession();
  resetBilling();
  vi.unstubAllGlobals();
});

const wrap = () => render(<MotionRoot><BillingHost /></MotionRoot>);
async function openTheOrder(draft: OrderDraft = { plan: "premium", interval: "year", seats: 1 }) {
  useBilling.setState({ config: CONFIG });
  wrap();
  act(() => openOrder(draft));
  return screen.findByTestId("order-sheet", {}, { timeout: 10_000 });
}
const tick = () => {
  fireEvent.click(within(screen.getByTestId("order-terms")).getByRole("checkbox"));
  fireEvent.click(within(screen.getByTestId("order-immediate")).getByRole("checkbox"));
};

describe("Paket V: the payment window in its hand-over mode", () => {
  it("step band, card left, summary with price, renewal and cancellation, the button with its fixed words – the card fields are Stripe's own page", async () => {
    await openTheOrder({ plan: "premium", interval: "year", seats: 1 });
    expect(screen.getByTestId("order-sheet")).toHaveAttribute("data-source", "redirect");
    expect(screen.getByTestId("order-steps")).toHaveTextContent(/Auswahl.*Konto.*3.*Zahlung/);
    expect(screen.getByTestId("pay-card")).toBeInTheDocument();
    expect(screen.getByTestId("order-handover")).toHaveTextContent("im nächsten Schritt bei Stripe");
    expect(screen.queryByTestId("pay-number")).toBeNull();
    // the result page's plan card is another component: the window's card never claims a confirmed state
    expect(screen.queryByTestId("plan-card-art")).toBeNull();
    expect(screen.getByTestId("order-total")).toHaveTextContent("240 €");
    expect(screen.getByTestId("order-renewal")).toHaveTextContent("verlängert sich automatisch");
    expect(screen.getByTestId("order-cancel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zahlungspflichtig bestellen" })).toBeInTheDocument();
  });
});

describe("VIS-05/06/07: the summary names what follows the trial – and the Team arithmetic is pinned", () => {
  const TRIAL: BillingStatus["config"] = { ...CONFIG, trialDays: 14 };
  const openWithTrial = async (draft: OrderDraft) => {
    useBilling.setState({ config: TRIAL });
    wrap();
    act(() => openOrder(draft));
    return screen.findByTestId("order-sheet", {}, { timeout: 10_000 });
  };

  it("Team, 2 Sitze × 190 € = 380 € pro Jahr: summary and first payment say the same sum", async () => {
    await openWithTrial({ plan: "team", interval: "year", seats: 2 });
    expect(screen.getByTestId("order-seats")).toHaveTextContent("2 Sitze × 190 € pro Jahr");
    expect(screen.getByTestId("order-total")).toHaveTextContent("380 €");
    expect(screen.getByTestId("order-first")).toHaveTextContent(/14 Tage kostenlos testen – heute zahlst du nichts\. Am .* beginnt die Zahlung: 380 € pro Jahr\./);
    // the minimum is two seats: one seat less is not offered
    expect(screen.getByRole("button", { name: "Einen Sitz weniger" })).toBeDisabled();
  });

  it("Pro jährlich: 14 Tage kostenlos, heute nichts, danach 120 € pro Jahr", async () => {
    await openWithTrial({ plan: "pro", interval: "year", seats: 1 });
    expect(screen.getByTestId("order-first")).toHaveTextContent(/14 Tage kostenlos testen – heute zahlst du nichts\. Am .* beginnt die Zahlung: 120 € pro Jahr\./);
  });
});

describe("the hand-over to Stripe Checkout", () => {
  it("click → the button shows its orbs, a second click sends nothing more; nothing is claimed", async () => {
    checkout = "hang";
    const sheet = await openTheOrder();
    tick();
    const pay = screen.getByTestId("order-pay");
    fireEvent.click(pay);
    await waitFor(() => expect(pay).toHaveAttribute("data-phase", "confirming"));
    fireEvent.click(pay);
    expect(pay.querySelector('[data-testid="button-orbs"]')).not.toBeNull();
    expect(screen.queryByTestId("pay-stage")).toBeNull();
    expect(sheet).not.toHaveTextContent(/\bPaid\b|Abo ist aktiv/i);
    expect(posts.filter((p) => p.endsWith("/checkout"))).toHaveLength(1);
    expect(redirects).toEqual([]);
  });

  it("the server answers → 'Weiter zu Stripe …' and the browser leaves", async () => {
    await openTheOrder();
    tick();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(redirects).toEqual(["https://checkout.stripe.com/c/pay/cs_test_1"]));
    expect(screen.getByTestId("order-pay")).toHaveAttribute("data-phase", "redirecting");
  });

  it("a failed order: the reason stands in the sheet, the choice is unchanged, the button is free again", async () => {
    checkout = "fail";
    await openTheOrder({ plan: "team", interval: "year", seats: 3 });
    tick();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(screen.getByTestId("order-error")).toBeInTheDocument());
    const sheet = screen.getByTestId("order-sheet");
    expect(sheet).toHaveAttribute("data-plan", "team");
    expect(sheet).toHaveAttribute("data-seats", "3");
    expect(screen.getByTestId("order-pay")).toHaveAttribute("data-phase", "idle");
    expect(screen.getByTestId("order-pay")).toHaveTextContent("Zahlungspflichtig bestellen");
    // the boxes keep their state (the person ticked them for THIS order)
    expect(within(screen.getByTestId("order-terms")).getByRole("checkbox")).toBeChecked();
    expect(redirects).toEqual([]);
  });
});

describe("the result page: the glow belongs to the server-confirmed state only", () => {
  const show = async (server: SubscriptionSummary | null) => {
    sessionStorage.setItem("tj2-last-order", JSON.stringify({ orderId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b", draft: { plan: "premium", interval: "year", seats: 1 }, staleSubId: null, at: Date.now() }));
    useBilling.setState({ config: CONFIG, account: account(server) });
    wrap();
    act(() => setReturned({ kind: "success", sessionId: "cs_test_abc123" }));
    return screen.findByTestId("order-result");
  };

  it("pending: the card with the calm halo, no success colour, no 'aktiv'", async () => {
    const r = await show(null);
    expect(r).toHaveAttribute("data-state", "pending");
    const card = await screen.findByTestId("plan-card-art");
    expect(card).toHaveAttribute("data-tone", "working");
    expect(screen.getByTestId("result-title")).not.toHaveTextContent(/aktiv/i);
  });

  it("confirmed (the server says so): ONE success glow on the card, with the amount that runs", async () => {
    const r = await show(SUB);
    await waitFor(() => expect(r).toHaveAttribute("data-state", "confirmed"));
    const card = await screen.findByTestId("plan-card-art");
    expect(card).toHaveAttribute("data-tone", "confirmed");
    expect(card).toHaveTextContent("240 €");
  });

  it("incomplete (a confirmation of the payment is open): no success glow", async () => {
    const r = await show({ ...SUB, status: "incomplete" });
    await waitFor(() => expect(r).toHaveAttribute("data-state", "action"));
    expect(screen.getByTestId("plan-card-art")).toHaveAttribute("data-tone", "idle");
  });

  it("canceled and failed: no card at all", async () => {
    sessionStorage.setItem("tj2-last-order", JSON.stringify({ orderId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b", draft: { plan: "pro", interval: "month", seats: 1 }, staleSubId: null, at: Date.now() }));
    useBilling.setState({ config: CONFIG, account: account(null) });
    wrap();
    act(() => setReturned({ kind: "cancel" }));
    const r = await screen.findByTestId("order-result");
    expect(r).toHaveAttribute("data-state", "canceled");
    expect(screen.queryByTestId("plan-card-art")).toBeNull();
  });
});
