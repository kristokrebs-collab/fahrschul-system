/**
 * The purchase flow's screens (B4) in jsdom against a stubbed `fetch`: the order summary (what §312j Abs. 2 BGB wants in front of
 * the order, the two separate unticked boxes, the button text, the tax sentence by Stripe-Tax state), the order itself, the
 * tariff detail (only what the tariff contract names), the result page in all five states (the URL confirms nothing), the cancel /
 * withdraw pages without a login, the management sheet and the footer link.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRedirectForTests } from "@/billing/api";
import type { BillingStatus, SubscriptionSummary } from "@/billing/contract";
import { closeContract, openContract } from "@/billing/contractStore";
import type { OrderDraft } from "@/billing/purchase/order";
import { resetOrderForm } from "@/billing/purchase/orderState";
import { openDetail, openManage, openOrder, resetBilling, setReturned, useBilling } from "@/billing/store";
import { BillingHost } from "@/billing/ui";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { setLegalConfigForTests, legalConfigOf } from "@/legal/config";
import { LegalLinks } from "@/legal/LegalLinks";
import { MotionRoot } from "@/motion/MotionRoot";
import { useUi } from "@/store/uiStore";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const CONFIG: BillingStatus["config"] = { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"], purchaseOpen: true, automaticTax: true, mailReady: true };
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
  startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};
const account = (sub: SubscriptionSummary | null) => ({
  userId: USER.id,
  plan: sub ? { plan: sub.plan, status: sub.status, trialEnd: sub.trialEnd } : { plan: "free" as const, status: "none" as const, trialEnd: null },
  subscription: sub,
  invoices: [],
  hasCustomer: !!sub,
  trialUsed: false,
  team: null,
});

const posts: { path: string; body: Record<string, unknown> | null }[] = [];
let answer: (path: string, body: Record<string, unknown> | null) => unknown;
const redirects: string[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  posts.length = 0;
  redirects.length = 0;
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedIn", user: USER });
  resetBilling();
  setRedirectForTests((u) => redirects.push(u));
  answer = () => ({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://journal.test");
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      posts.push({ path: url.pathname, body });
      const custom = answer(url.pathname, body);
      if (custom !== undefined && Object.keys(custom as object).length) return Response.json(custom);
      const st = useBilling.getState();
      return Response.json({ config: st.config ?? CONFIG, plan: st.account?.plan ?? null, subscription: st.account?.subscription ?? null, invoices: [], hasCustomer: !!st.account?.hasCustomer, trialUsed: false, team: null });
    }),
  );
});

afterEach(() => {
  setCloudEnabledForTests(null);
  setRedirectForTests(null);
  setLegalConfigForTests(null);
  resetCloudSession();
  resetBilling();
  closeContract();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode = <BillingHost />) => render(<MotionRoot>{ui}</MotionRoot>);

async function openTheOrder(draft: OrderDraft = { plan: "pro", interval: "year", seats: 1 }, config: BillingStatus["config"] = CONFIG) {
  useBilling.setState({ config });
  wrap();
  act(() => openOrder(draft));
  return screen.findByTestId("order-sheet", {}, { timeout: 10_000 }); // the first import of the lazy purchase chunk is slow in jsdom
}

describe("order summary (§ 312j Abs. 2 BGB: everything in front of the order)", () => {
  it("names plan, interval, total, the price after the trial with its date, the renewal, the cancellation and the tax", async () => {
    const sheet = await openTheOrder();
    expect(within(sheet).getByTestId("order-plan")).toHaveTextContent("Trade Journal Pro");
    expect(within(sheet).getByTestId("order-total")).toHaveTextContent("120 €"); // the rolling digits carry the amount as sr-only text
    expect(within(sheet).getByTestId("order-total")).toHaveTextContent("pro Jahr");
    expect(within(sheet).getByTestId("order-first")).toHaveTextContent(/14 Tage kostenlos testen – heute zahlst du nichts\. Am \d\d\.\d\d\.\d{4} beginnt die Zahlung: 120 € pro Jahr\./);
    expect(within(sheet).getByTestId("order-renewal")).toHaveTextContent(/verlängert sich automatisch am \d\d\.\d\d\.\d{4} und danach jedes Jahr um 120 €, bis du kündigst/);
    expect(within(sheet).getByTestId("order-cancel")).toHaveTextContent(/jederzeit kündigen.*keine Kündigungsfrist/);
    expect(within(sheet).getByTestId("order-cancel")).toHaveTextContent("Verträge hier kündigen");
    expect(within(sheet).getByTestId("order-tax-note")).toHaveTextContent("inklusive gesetzlicher Umsatzsteuer");
    expect(sheet).not.toHaveTextContent("0,00");
    expect(sheet).toHaveTextContent("Keine professionelle Finanzberatung.");
  });

  it("the tax sentence follows the Stripe Tax switch – honest in both cases", async () => {
    const sheet = await openTheOrder(undefined, { ...CONFIG, automaticTax: true });
    expect(within(sheet).getByTestId("order-tax")).toHaveTextContent("Steuer wird im nächsten Schritt von Stripe berechnet.");
  });

  it("Stripe Tax off: it says that Stripe adds no tax, never the sentence that would be false", async () => {
    const sheet = await openTheOrder(undefined, { ...CONFIG, automaticTax: false });
    expect(within(sheet).getByTestId("order-tax")).toHaveTextContent("Stripe Tax ist beim Betreiber nicht eingeschaltet");
    expect(within(sheet).getByTestId("order-tax")).not.toHaveTextContent("Steuer wird im nächsten Schritt von Stripe berechnet");
  });

  it("Team: seats × price per seat; the stepper changes the total and a new order id", async () => {
    const sheet = await openTheOrder({ plan: "team", interval: "month", seats: 3 });
    expect(within(sheet).getByTestId("order-total")).toHaveTextContent("57 €");
    const before = (await import("@/billing/purchase/orderState")).useOrderForm.getState().orderId;
    fireEvent.click(within(sheet).getByRole("button", { name: "Einen Sitz mehr" }));
    await waitFor(() => expect(screen.getByTestId("order-total")).toHaveTextContent("76 €"));
    expect((await import("@/billing/purchase/orderState")).useOrderForm.getState().orderId).not.toBe(before);
  });
});

describe("the two boxes and the button", () => {
  it("the button reads exactly 'Zahlungspflichtig bestellen'; both boxes are separate and NOT pre-ticked", async () => {
    const sheet = await openTheOrder();
    const pay = within(sheet.closest("[role=dialog]") as HTMLElement).getByRole("button", { name: "Zahlungspflichtig bestellen" });
    expect(pay).toBeInTheDocument();
    expect(pay).toHaveAttribute("data-testid", "order-pay");
    const terms = within(screen.getByTestId("order-terms")).getByRole("checkbox");
    const immediate = within(screen.getByTestId("order-immediate")).getByRole("checkbox");
    expect(terms).not.toBeChecked();
    expect(immediate).not.toBeChecked();
    expect(screen.getByTestId("order-immediate")).toHaveTextContent("Ich verlange ausdrücklich, dass der Anbieter vor Ablauf der Widerrufsfrist mit der Bereitstellung meines Tarifs beginnt.");
    expect(screen.getByTestId("order-terms")).toHaveTextContent("Ich akzeptiere die AGB des Betreibers");
    expect(screen.getByTestId("order-legal-links")).toHaveTextContent("AGBWiderrufsbelehrungDatenschutzerklärung");
    expect(document.body).not.toHaveTextContent(/Tage gratis testen|Jetzt abonnieren/);
  });

  it("nothing is sent while a box is open: the missing one is named; with both ticked ONE request goes out and the browser leaves for Stripe", async () => {
    answer = (path) => (path.endsWith("/checkout") ? { url: "https://checkout.stripe.com/c/pay/cs_test_9", sessionId: "cs_test_9" } : {});
    const sheet = await openTheOrder();
    const dialog = sheet.closest("[role=dialog]") as HTMLElement;
    fireEvent.click(within(dialog).getByTestId("order-pay"));
    expect(posts.filter((p) => p.path.endsWith("/checkout"))).toHaveLength(0);
    expect(await screen.findByText("Bitte bestätige zuerst die AGB.")).toBeInTheDocument();
    expect(screen.getByText(/Bitte bestätige den sofortigen Beginn/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("order-terms")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByTestId("order-immediate")).getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("order-pay"));
      fireEvent.click(within(dialog).getByTestId("order-pay"));
    });
    await waitFor(() => expect(redirects).toEqual(["https://checkout.stripe.com/c/pay/cs_test_9"]));
    const sent = posts.filter((p) => p.path.endsWith("/checkout"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ plan: "pro", interval: "year", consents: { terms: true, immediateStart: true } });
    expect(sent[0]!.body!.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0]!.body!.consentHash).toMatch(/^[0-9a-f]{64}$/);
    // the width of the button does not change while it works: both labels share one grid cell
    expect(within(dialog).getByTestId("order-pay").querySelector(".pay-swap")).not.toBeNull();
  });

  it("locked purchase flow: no boxes, no way to order, the reason in words", async () => {
    const sheet = await openTheOrder(undefined, { ...CONFIG, purchaseOpen: false, purchaseBlockedBy: ["legal"] });
    expect(within(sheet).getByTestId("order-closed")).toHaveTextContent("Impressum, AGB und Datenschutz des Betreibers fehlen noch");
    expect(screen.queryByTestId("order-consents")).toBeNull();
    expect(within(sheet.closest("[role=dialog]") as HTMLElement).getByTestId("order-pay")).toBeDisabled();
  });

  it("signed out the button leads to the login and back to THIS order (returnTo) – it does not say 'Zahlungspflichtig bestellen'", async () => {
    useCloudSession.setState({ phase: "signedOut", user: null });
    const sheet = await openTheOrder({ plan: "premium", interval: "month", seats: 1 });
    const pay = within(sheet.closest("[role=dialog]") as HTMLElement).getByTestId("order-pay");
    expect(pay).toHaveTextContent("Anmelden und weiter");
    fireEvent.click(pay);
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signin" });
    const { peekReturnTo } = await import("@/store/returnTo");
    expect(peekReturnTo()).toMatchObject({ target: { kind: "order", order: "premium.month.1" } });
  });
});

describe("tariff detail", () => {
  it("shows the benefit, what is included, the limits of the contract and what the purchase unlocks – no planned limit as a promise", async () => {
    useBilling.setState({ config: CONFIG });
    wrap();
    act(() => openDetail("pro"));
    const sheet = await screen.findByTestId("detail-sheet");
    expect(sheet).toHaveTextContent("Trade Journal Pro");
    expect(within(sheet).getByTestId("detail-included")).toHaveTextContent("Automatischer Börsen-Sync");
    expect(within(sheet).getByTestId("detail-limits")).toHaveTextContent("Screenshot-Speicher");
    expect(within(sheet).getByTestId("detail-limits")).toHaveTextContent("2.048 MB");
    // "geplant" limits (TradingView connections, simulations) are not shown; the alert channels and phone calls became live with the alert package (A1/C2)
    expect(within(sheet).getByTestId("detail-limits")).not.toHaveTextContent(/TradingView|Simulationen/);
    expect(within(sheet).getByTestId("detail-unlocks")).toBeInTheDocument();
    expect(within(sheet).getByTestId("detail-price")).toHaveTextContent("120 € pro Jahr");
    expect(within(sheet).getByTestId("detail-price")).toHaveTextContent("Jährlich −17 % gegenüber 12 Monatszahlungen");
  });
});

describe("result page: the five states (the return URL confirms nothing)", () => {
  const sub = (status: SubscriptionSummary["status"], over: Partial<SubscriptionSummary> = {}): SubscriptionSummary => ({ ...SUB, status, ...over });
  const show = async (kind: "success" | "cancel", server: SubscriptionSummary | null) => {
    useBilling.setState({ config: CONFIG, account: account(server) });
    answer = () => ({ config: CONFIG, plan: server ? { plan: "pro", status: server.status, trialEnd: null } : { plan: "free", status: "none", trialEnd: null }, subscription: server, invoices: [], hasCustomer: !!server, trialUsed: false, team: null });
    wrap();
    act(() => setReturned(kind === "success" ? { kind: "success", sessionId: "cs_test_abc123" } : { kind: "cancel" }));
    return screen.findByTestId("order-result");
  };

  it("bestätigt: only when the server state says the subscription runs", async () => {
    const r = await show("success", sub("active"));
    await waitFor(() => expect(r).toHaveAttribute("data-state", "confirmed"));
    expect(screen.getByTestId("result-title")).toHaveTextContent("Dein Abo ist aktiv");
  });

  it("in Bearbeitung: back from Stripe but the server has heard nothing – no 'aktiv', it asks again", async () => {
    const r = await show("success", null);
    expect(r).toHaveAttribute("data-state", "pending");
    expect(screen.getByTestId("result-title")).not.toHaveTextContent(/aktiv/i);
    await waitFor(() => expect(posts.some((p) => p.path.endsWith("/billing/status"))).toBe(true), { timeout: 3000 });
    expect(r).toHaveAttribute("data-state", "pending");
  });

  it("Bestätigung nötig: the subscription is incomplete – the payment must be confirmed, with the way to do it", async () => {
    const r = await show("success", sub("incomplete"));
    await waitFor(() => expect(r).toHaveAttribute("data-state", "action"));
    expect(screen.getByTestId("result-pay")).toHaveTextContent("Zahlung abschließen");
  });

  it("abgebrochen: nothing was charged, no contract; the order can be reopened", async () => {
    sessionStorage.setItem("tj2-last-order", JSON.stringify({ orderId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b", draft: { plan: "pro", interval: "month", seats: 1 }, staleSubId: null, at: Date.now() }));
    const r = await show("cancel", null);
    expect(r).toHaveAttribute("data-state", "canceled");
    expect(screen.getByTestId("result-text")).toHaveTextContent("Es wurde nichts berechnet und kein Vertrag geschlossen");
    expect(screen.getByTestId("result-retry")).toBeInTheDocument();
  });

  it("fehlgeschlagen: the server says the payment failed – no active subscription is claimed", async () => {
    const r = await show("success", sub("unpaid"));
    await waitFor(() => expect(r).toHaveAttribute("data-state", "failed"));
    expect(screen.getByTestId("result-text")).toHaveTextContent("kein aktives Abo");
    expect(screen.getByTestId("result-title")).not.toHaveTextContent("Dein Abo ist aktiv");
  });
});

describe("cancel / withdraw without a login", () => {
  beforeEach(() => {
    useCloudSession.setState({ phase: "signedOut", user: null });
  });

  it("Kündigung: form → confirmation page with 'Jetzt kündigen' → receipt with date and time and the mail note; no reason or offer on the way", async () => {
    answer = (path) => (path.endsWith("/billing/contract") ? { kind: "cancel", receivedAt: "2026-11-07T13:32:05.000Z", mail: "sent", next: "check" } : {});
    useBilling.setState({ config: CONFIG });
    wrap();
    act(() => openContract("cancel"));
    const sheet = await screen.findByTestId("contract-sheet");
    expect(sheet).toHaveAttribute("data-step", "form");
    fireEvent.change(screen.getByTestId("contract-email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByTestId("contract-next"));
    expect(await screen.findByText("Bitte gib eine gültige E-Mail-Adresse an.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("contract-email"), { target: { value: "t@example.com" } });
    fireEvent.click(screen.getByTestId("contract-next"));
    await waitFor(() => expect(screen.getByTestId("contract-sheet")).toHaveAttribute("data-step", "confirm"));
    expect(screen.getByTestId("contract-sheet")).not.toHaveTextContent(/pausieren|Grund|Angebot/);
    expect(screen.getByRole("button", { name: "Jetzt kündigen" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("contract-confirm"));
    });
    await waitFor(() => expect(screen.getByTestId("contract-sheet")).toHaveAttribute("data-step", "done"));
    expect(screen.getByTestId("contract-received")).toHaveTextContent("Eingegangen am 07.11.2026, 14:32:05 Uhr.");
    expect(screen.getByTestId("contract-after")).toHaveTextContent("Link in der E-Mail");
    // no Authorization header: the page needs no login
    expect(posts.find((p) => p.path.endsWith("/billing/contract"))?.body).toEqual({ kind: "cancel", email: "t@example.com" });
  });

  it("without a mail service the page says so instead of promising a mail", async () => {
    answer = (path) => (path.endsWith("/billing/contract") ? { kind: "cancel", receivedAt: "2026-11-07T13:32:05.000Z", mail: "unavailable", next: "check" } : {});
    useBilling.setState({ config: CONFIG });
    wrap();
    act(() => openContract("cancel"));
    await screen.findByTestId("contract-sheet");
    fireEvent.change(screen.getByTestId("contract-email"), { target: { value: "t@example.com" } });
    fireEvent.click(screen.getByTestId("contract-next"));
    await waitFor(() => expect(screen.getByTestId("contract-sheet")).toHaveAttribute("data-step", "confirm"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("contract-confirm"));
    });
    await waitFor(() => expect(screen.getByTestId("contract-after")).toHaveTextContent("E-Mail-Versand noch nicht eingerichtet"));
  });

  it("Widerruf: name is required; 'Widerruf bestätigen' is the button of the confirmation page", async () => {
    useBilling.setState({ config: CONFIG });
    wrap();
    act(() => openContract("withdraw"));
    await screen.findByTestId("contract-sheet");
    fireEvent.change(screen.getByTestId("contract-email"), { target: { value: "t@example.com" } });
    fireEvent.click(screen.getByTestId("contract-next"));
    expect(await screen.findByText("Bitte gib deinen Namen an.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("contract-name"), { target: { value: "Erika Muster" } });
    fireEvent.click(screen.getByTestId("contract-next"));
    await waitFor(() => expect(screen.getByTestId("contract-sheet")).toHaveAttribute("data-step", "confirm"));
    expect(screen.getByRole("button", { name: "Widerruf bestätigen" })).toBeInTheDocument();
  });

  it("the link of the mail: one more click executes; the result names the end", async () => {
    answer = (path) => (path.endsWith("/confirm") ? { kind: "cancel", status: "done", endsAt: "2026-12-07T00:00:00.000Z", confirmedAt: "2026-11-07T13:40:00.000Z" } : {});
    useBilling.setState({ config: CONFIG });
    wrap();
    act(() => openContract("cancel", "T".repeat(43)));
    const sheet = await screen.findByTestId("contract-sheet");
    expect(sheet).toHaveAttribute("data-step", "link");
    await act(async () => {
      fireEvent.click(screen.getByTestId("contract-link-confirm"));
    });
    const res = await screen.findByTestId("contract-result");
    expect(res).toHaveAttribute("data-status", "done");
    expect(res).toHaveTextContent("Er endet am 07.12.2026.");
    expect(posts.find((p) => p.path.endsWith("/confirm"))?.body).toEqual({ token: "T".repeat(43) });
  });

  it("the footer / menu links open it without a login", () => {
    setLegalConfigForTests(legalConfigOf({}));
    useBilling.setState({ config: CONFIG });
    render(
      <MotionRoot>
        <LegalLinks />
      </MotionRoot>,
    );
    fireEvent.click(screen.getByTestId("contract-link-cancel"));
    expect(screen.getByTestId("contract-link-cancel")).toHaveTextContent("Verträge hier kündigen");
    expect(screen.getByTestId("contract-link-withdraw")).toHaveTextContent("Vertrag widerrufen");
    expect(screen.getByTestId("contract-link-cancel")).toHaveAttribute("href", "?kuendigen");
  });

  it("the shell footer carries the cancel link on every page except the start page and the cockpit (their pixels stay)", () => {
    useUi.setState({ page: "overview" });
    const kinds = (page: string) => {
      useUi.setState({ page: page as never });
      const { unmount } = render(
        <MotionRoot>
          <LegalLinks extended={false} contract={page !== "overview" && page !== "cockpit"} />
        </MotionRoot>,
      );
      const has = !!screen.queryByTestId("contract-link-cancel");
      unmount();
      return has;
    };
    expect(kinds("overview")).toBe(false);
    expect(kinds("cockpit")).toBe(false);
    expect(kinds("trades")).toBe(true);
  });
});

describe("management (Konto → Abo verwalten)", () => {
  it("plan, interval, price, next payment; cancel button always; withdraw only within 14 days; portal for the switch", async () => {
    useBilling.setState({ config: CONFIG, account: account(SUB) });
    wrap();
    act(() => openManage());
    const sheet = await screen.findByTestId("manage-sheet");
    expect(within(sheet).getByTestId("manage-facts")).toHaveTextContent("Trade Journal Pro");
    expect(within(sheet).getByTestId("manage-facts")).toHaveTextContent("12 € pro Monat");
    expect(within(sheet).getByTestId("manage-next")).toHaveTextContent("Verlängert sich am 12.11.2026.");
    expect(within(sheet).getByTestId("manage-cancel")).toHaveTextContent("Verträge hier kündigen");
    expect(within(sheet).getByTestId("manage-withdraw")).toHaveTextContent("Vertrag widerrufen");
    expect(within(sheet).getByTestId("manage-switch")).toHaveTextContent("Auf jährlich wechseln");
    expect(within(sheet).getByTestId("manage-switch")).toHaveTextContent("Auf jährlich wechseln");
  });

  it("after the 14 days the withdraw button is gone (the public page still answers 'late')", async () => {
    useBilling.setState({ config: CONFIG, account: account({ ...SUB, startedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }) });
    wrap();
    act(() => openManage());
    const sheet = await screen.findByTestId("manage-sheet");
    expect(within(sheet).queryByTestId("manage-withdraw")).toBeNull();
    expect(within(sheet).getByTestId("manage-cancel")).toBeInTheDocument();
  });

  it("no running subscription: says so", async () => {
    useBilling.setState({ config: CONFIG, account: account(null) });
    wrap();
    act(() => openManage());
    expect(await screen.findByTestId("manage-none")).toHaveTextContent("Du hast kein laufendes Abo.");
  });
});

describe("resetting an order", () => {
  it("every opening is a new order: new id, both boxes open again", async () => {
    const { useOrderForm, setTerms } = await import("@/billing/purchase/orderState");
    resetOrderForm();
    const first = useOrderForm.getState().orderId;
    setTerms(true);
    resetOrderForm();
    expect(useOrderForm.getState()).toMatchObject({ terms: false, immediate: false, phase: "idle" });
    expect(useOrderForm.getState().orderId).not.toBe(first);
  });
});
