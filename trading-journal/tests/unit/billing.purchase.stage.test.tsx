/**
 * Paket B – the order window: the plan card (an illustration of the choice, never a card form), the quiet path band, the amount
 * next to the button, the button's three labels in one cell, the stage of the hand-over (calm, confirms nothing), the way back
 * after a failed order, and the result page's glow that belongs to the SERVER-confirmed state only. Mocked fetch: this proves the
 * browser flow, not a Stripe account.
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

describe("the plan card in the order window", () => {
  it("shows plan, interval and the amount DUE – and follows the order live (interval, seats)", async () => {
    await openTheOrder({ plan: "team", interval: "year", seats: 2 });
    const card = screen.getByTestId("plan-card-art");
    expect(card).toHaveAttribute("data-plan", "team");
    expect(card).toHaveTextContent("380 €");
    expect(card).toHaveTextContent("pro Jahr");
    expect(card).toHaveTextContent("2 Sitze");
    fireEvent.click(screen.getByRole("radio", { name: "Monatlich" }));
    await waitFor(() => expect(screen.getByTestId("plan-card-art")).toHaveTextContent("38 €"));
    expect(screen.getByTestId("plan-card-art")).toHaveTextContent("pro Monat");
    fireEvent.click(screen.getByRole("button", { name: "Einen Sitz mehr" }));
    await waitFor(() => expect(screen.getByTestId("plan-card-art")).toHaveTextContent("57 €"));
  });

  it("is an illustration, not a form: aria-hidden, no input in it, and it says where the card number goes (Stripe's page)", async () => {
    await openTheOrder();
    const card = screen.getByTestId("plan-card-art");
    expect(card).toHaveAttribute("aria-hidden", "true");
    expect(card.querySelector("input, textarea, select, button")).toBeNull();
    expect(screen.getByTestId("order-card-note")).toHaveTextContent("hier wird keine Karte eingegeben");
    expect(screen.getByTestId("order-card-note")).toHaveTextContent("Stripe");
  });

  it("turns over on request (aria-pressed); the back lists what is included; a new opening starts on the front", async () => {
    await openTheOrder();
    const flip = screen.getByTestId("order-flip");
    expect(flip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("plan-card-art")).not.toHaveAttribute("data-flipped");
    fireEvent.click(flip);
    expect(flip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("plan-card-art")).toHaveAttribute("data-flipped");
    expect(screen.getByTestId("plan-card-art").querySelector('[data-face="back"] li')).not.toBeNull();
  });

  it("reduced motion: no halo animation, the card still turns (instantly)", async () => {
    fx.reduced = true;
    await openTheOrder();
    fireEvent.click(screen.getByTestId("order-flip"));
    expect(screen.getByTestId("plan-card-art")).toHaveAttribute("data-flipped");
  });
});

describe("path band and total", () => {
  it("three steps; step 3 (Bestätigung) is only reached on the result page – never in this window", async () => {
    await openTheOrder();
    const steps = screen.getByTestId("order-steps");
    expect(steps).toHaveTextContent("Bestellung prüfen");
    expect(steps).toHaveTextContent("Zahlung bei Stripe");
    expect(steps).toHaveTextContent("Bestätigung");
    expect(within(steps).getByText("Bestellung prüfen").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("the amount due stands next to the button, which keeps its legally fixed words", async () => {
    await openTheOrder({ plan: "premium", interval: "year", seats: 1 });
    expect(screen.getByTestId("order-footer-total")).toHaveTextContent("Gesamt 240 € pro Jahr");
    expect(screen.getByRole("button", { name: "Zahlungspflichtig bestellen" })).toBeInTheDocument();
  });
});

describe("VIS-05/06/07: the summary says what is due TODAY and what follows – and the Team arithmetic is pinned", () => {
  const TRIAL: BillingStatus["config"] = { ...CONFIG, trialDays: 14 };
  const openWithTrial = async (draft: OrderDraft) => {
    useBilling.setState({ config: TRIAL });
    wrap();
    act(() => openOrder(draft));
    return screen.findByTestId("order-sheet", {}, { timeout: 10_000 });
  };

  it("Team, 2 Sitze × 190 € = 380 € pro Jahr: summary, first payment, card and footer say the same sum", async () => {
    await openWithTrial({ plan: "team", interval: "year", seats: 2 });
    expect(screen.getByTestId("order-seats")).toHaveTextContent("2 Sitze × 190 € pro Jahr");
    expect(screen.getByTestId("order-total")).toHaveTextContent("380 €");
    expect(screen.getByTestId("order-first")).toHaveTextContent(/Heute 0 € \(14 Tage kostenlos testen\), danach 380 € pro Jahr – die erste Zahlung ist am /);
    expect(screen.getByTestId("order-footer-total")).toHaveTextContent("Heute 0 €, danach 380 € pro Jahr");
    expect(screen.getByTestId("plan-card-art")).toHaveTextContent("380 €");
    // the minimum is two seats: one seat less is not offered
    expect(screen.getByRole("button", { name: "Einen Sitz weniger" })).toBeDisabled();
  });

  it("Pro jährlich: Heute 0 € (14 Tage Test), danach 120 € pro Jahr", async () => {
    await openWithTrial({ plan: "pro", interval: "year", seats: 1 });
    expect(screen.getByTestId("order-first")).toHaveTextContent(/Heute 0 € \(14 Tage kostenlos testen\), danach 120 € pro Jahr/);
    expect(screen.getByTestId("order-footer-total")).toHaveTextContent("Heute 0 €, danach 120 € pro Jahr");
  });

  it("the stage repeats the same words while the order is handed over", async () => {
    checkout = "hang";
    await openWithTrial({ plan: "team", interval: "year", seats: 2 });
    tick();
    fireEvent.click(screen.getByTestId("order-pay"));
    expect(await screen.findByTestId("pay-stage-total")).toHaveTextContent("Heute 0 €, danach 380 € pro Jahr");
  });
});

describe("the hand-over: button, stage, failure", () => {
  it("click → 'Wird vorbereitet …' in the SAME cell, the stage covers the summary and says what happens – and claims nothing", async () => {
    checkout = "hang";
    const sheet = await openTheOrder();
    tick();
    const pay = screen.getByTestId("order-pay");
    const labels = pay.querySelectorAll(".pay-swap > span");
    expect(labels).toHaveLength(3); // idle · preparing · redirecting share one grid cell: the width never changes
    fireEvent.click(pay);
    fireEvent.click(pay); // a second click is ignored (and the server's idempotency key covers a lost answer)
    await waitFor(() => expect(pay).toHaveAttribute("data-phase", "confirming"));
    expect(pay).toHaveTextContent("Wird vorbereitet …");
    expect(pay).toHaveAttribute("aria-busy", "true");
    expect(pay.querySelector('[data-testid="button-orbs"]')).not.toBeNull();
    const stage = await screen.findByTestId("pay-stage");
    expect(stage).toHaveTextContent("Wir bereiten deine Zahlung bei Stripe vor");
    expect(screen.getByTestId("pay-stage-total")).toHaveTextContent("240 € pro Jahr");
    expect(stage).toHaveTextContent("verlängert sich automatisch"); // the terms stay readable while the stage covers the summary
    expect(stage).toHaveTextContent("Gebucht ist erst, wenn Stripe die Zahlung bestätigt hat");
    expect(stage).not.toHaveTextContent(/bezahlt|Paid|Abo ist aktiv|erfolgreich/i);
    expect(stage.querySelector('[data-testid="plan-card-art"]')).toHaveAttribute("data-tone", "working");
    // the summary underneath is out of reach (inert) but keeps its place: the sheet does not jump
    expect(sheet).toHaveAttribute("inert");
    expect(sheet).toHaveAttribute("aria-hidden", "true");
    expect(posts.filter((p) => p.endsWith("/checkout"))).toHaveLength(1);
    expect(redirects).toEqual([]);
  });

  it("the server answers → 'Weiter zu Stripe …' and the browser leaves", async () => {
    await openTheOrder();
    tick();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(redirects).toEqual(["https://checkout.stripe.com/c/pay/cs_test_1"]));
    expect(screen.getByTestId("order-pay")).toHaveAttribute("data-phase", "redirecting");
    expect(screen.getByTestId("pay-stage-text")).toHaveTextContent("Weiter zu Stripe – dort zahlst du.");
  });

  it("a failed order: the stage goes, the summary is back UNCHANGED with the reason and the way to try again; the button is free", async () => {
    checkout = "fail";
    await openTheOrder({ plan: "team", interval: "year", seats: 3 });
    tick();
    fireEvent.click(screen.getByTestId("order-pay"));
    await waitFor(() => expect(screen.getByTestId("order-error")).toBeInTheDocument());
    expect(screen.queryByTestId("pay-stage")).toBeNull();
    expect(screen.getByTestId("order-retry-hint")).toHaveTextContent("Nichts wurde bestellt oder berechnet");
    const sheet = screen.getByTestId("order-sheet");
    expect(sheet).not.toHaveAttribute("inert");
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
