/**
 * P10 billing UI: PlanCard states (no cloud / closed / signed out / Pro with the § 312k button / trial countdown),
 * UpgradeTeaser → UpgradeSheet (via BillingHost), LimitMeter, the dunning banner, the in-app cancellation flow and the
 * pricing page (h1, four plans, comparison table, honest states).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingStatus, SubscriptionSummary } from "@/billing/contract";
import { resetBilling, useBilling } from "@/billing/store";
import { BillingBanner, BillingHost, LimitMeter, PlanCard, UpgradeTeaser } from "@/billing/ui";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";
import { PreiseView } from "@/views/preise";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const CONFIG: BillingStatus["config"] = { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"] };
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
const ACCOUNT = (sub: SubscriptionSummary | null, plan = sub ? { plan: sub.plan, status: sub.status, trialEnd: sub.trialEnd } : { plan: "free" as const, status: "none" as const, trialEnd: null }) => ({
  userId: USER.id,
  plan,
  subscription: sub,
  invoices: [],
  hasCustomer: !!sub,
  trialUsed: false,
  team: null,
});

const posts: { path: string; body: unknown }[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  posts.length = 0;
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedOut" });
  resetBilling();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://journal.test");
      const body = init.body ? JSON.parse(String(init.body)) : null;
      posts.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/portal")) {
        const cur = useBilling.getState().account?.subscription ?? SUB;
        const next = body.action === "cancel" ? { ...cur, cancelAtPeriodEnd: true, cancelAt: cur.currentPeriodEnd } : { ...cur, cancelAtPeriodEnd: false, cancelAt: null };
        return Response.json({ subscription: next, plan: { plan: "pro", status: "active", trialEnd: null } });
      }
      const st = useBilling.getState();
      return Response.json({ config: st.config ?? CONFIG, plan: st.account?.plan ?? null, subscription: st.account?.subscription ?? null, invoices: [], hasCustomer: !!st.account?.hasCustomer, trialUsed: false, team: null });
    }),
  );
});

afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetBilling();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => render(<MotionRoot>{ui}</MotionRoot>);

describe("PlanCard", () => {
  it("renders nothing without cloud", () => {
    setCloudEnabledForTests(false);
    const { container } = wrap(<PlanCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("closed shop: the honest notice", () => {
    useBilling.setState({ config: { ...CONFIG, enabled: false, reason: "stripe_missing" } });
    wrap(<PlanCard />);
    expect(screen.getByTestId("billing-closed")).toHaveTextContent("Zahlungen noch nicht eingerichtet");
  });

  it("signed out: sign in, and the pricing page when navigation is wired", () => {
    useBilling.setState({ config: CONFIG });
    const nav = vi.fn();
    wrap(<PlanCard onNavigate={nav} />);
    expect(screen.getByText("Melde dich an, um ein Abo abzuschließen.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tarife ansehen" }));
    expect(nav).toHaveBeenCalledWith("preise");
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(useCloudSession.getState().sheet.open).toBe(true);
  });

  it("Pro: status, renewal, price and the always-visible cancel button", () => {
    useCloudSession.setState({ phase: "signedIn", user: USER });
    useBilling.setState({ config: CONFIG, account: ACCOUNT(SUB) });
    wrap(<PlanCard usage={{ savedViews: 25 }} />);
    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    expect(screen.getByTestId("plan-next")).toHaveTextContent("Verlängert sich am 12.11.2026.");
    expect(screen.getByText("12 € pro Monat")).toBeInTheDocument();
    expect(screen.getByTestId("limit-savedViews")).toHaveAttribute("data-full");
    fireEvent.click(screen.getByRole("button", { name: "Vertrag hier kündigen" }));
    expect(useBilling.getState().cancelOpen).toBe(true);
  });

  it("trial: days left in rolling digits; cancelled: undo instead of cancel", () => {
    useCloudSession.setState({ phase: "signedIn", user: USER });
    const trialEnd = new Date(Date.now() + 5 * 86_400_000 - 60_000).toISOString();
    useBilling.setState({ config: CONFIG, account: ACCOUNT({ ...SUB, status: "trialing", trialEnd }) });
    const { unmount } = wrap(<PlanCard />);
    expect(screen.getByTestId("plan-trial")).toHaveTextContent("5 Tage");
    unmount();
    useBilling.setState({ account: ACCOUNT({ ...SUB, cancelAtPeriodEnd: true, cancelAt: SUB.currentPeriodEnd }) });
    wrap(<PlanCard />);
    expect(screen.getByRole("button", { name: "Kündigung zurücknehmen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vertrag hier kündigen" })).toBeNull();
  });
});

describe("gates", () => {
  it("UpgradeTeaser opens the UpgradeSheet with the feature and the right plan", async () => {
    useBilling.setState({ config: CONFIG });
    wrap(
      <>
        <UpgradeTeaser feature="coachAi" />
        <BillingHost />
      </>,
    );
    expect(screen.getByTestId("upgrade-teaser")).toHaveTextContent("Ab Premium");
    fireEvent.click(screen.getByRole("button", { name: "Freischalten" }));
    const sheet = await screen.findByTestId("upgrade-sheet");
    expect(sheet).toHaveTextContent("Enthalten in Premium");
    expect(sheet).toHaveTextContent("KI-Coach");
    expect(screen.getByTestId("upgrade-cta")).toHaveTextContent("Anmelden und testen");
  });

  it("LimitMeter: usage against the plan's limit, unlimited without payments", () => {
    useBilling.setState({ config: CONFIG });
    const { unmount } = wrap(<LimitMeter limitKey="savedViews" used={2} />);
    expect(screen.getByTestId("limit-savedViews")).toHaveTextContent("/ 3");
    expect(screen.getByTestId("limit-savedViews")).not.toHaveAttribute("data-full");
    unmount();
    useBilling.setState({ config: { ...CONFIG, enabled: false } });
    wrap(<LimitMeter limitKey="savedViews" used={40} />);
    expect(screen.getByTestId("limit-savedViews")).toHaveTextContent("/ ∞");
  });

  it("dunning banner on a failed payment (dismissable for the session)", async () => {
    useCloudSession.setState({ phase: "signedIn", user: USER });
    useBilling.setState({ config: CONFIG, account: ACCOUNT({ ...SUB, status: "past_due" }) });
    wrap(<BillingBanner />);
    expect(screen.getByTestId("billing-banner")).toHaveTextContent("Die letzte Zahlung ist fehlgeschlagen.");
    fireEvent.click(screen.getByRole("button", { name: "Ausblenden" }));
    await waitFor(() => expect(screen.queryByTestId("billing-banner")).toBeNull());
  });
});

describe("2FA", () => {
  it("BillingHost loads the account again once the code step is done (status answers aal1 like a visitor)", async () => {
    const statusCalls = () => posts.filter((p) => p.path.endsWith("/billing/status")).length;
    useCloudSession.setState({ phase: "signedIn", user: { ...USER, mfaEnrolled: true }, needsMfa: true });
    wrap(<BillingHost />);
    await waitFor(() => expect(statusCalls()).toBe(1));
    act(() => useCloudSession.setState({ user: { ...USER, aal: "aal2", mfaEnrolled: true }, needsMfa: false }));
    await waitFor(() => expect(statusCalls()).toBe(2));
  });
});

describe("cancellation", () => {
  it("reason → offer → confirm → done, the reason reaches the server", async () => {
    useCloudSession.setState({ phase: "signedIn", user: USER });
    useBilling.setState({ config: CONFIG, account: ACCOUNT(SUB), cancelOpen: true });
    wrap(<BillingHost />);
    const sheet = await screen.findByTestId("cancel-sheet");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Zu teuer" }));
    fireEvent.click(screen.getByRole("button", { name: "Weiter zur Kündigung" }));
    await waitFor(() => expect(screen.getByTestId("cancel-sheet")).toHaveTextContent("1 Monat pausieren"));
    fireEvent.click(screen.getByRole("button", { name: "Weiter zur Kündigung" }));
    await waitFor(() => expect(screen.getByTestId("cancel-sheet")).toHaveAttribute("data-step", "confirm"));
    // AnimatePresence "wait": the new step mounts after the old one left
    await waitFor(() => expect(screen.getByTestId("cancel-sheet")).toHaveTextContent("Dein Abo endet am 12.11.2026."));
    await act(async () => {
      fireEvent.click(screen.getByTestId("cancel-now"));
    });
    await waitFor(() => expect(screen.getByTestId("cancel-sheet")).toHaveAttribute("data-step", "done"));
    expect(posts.find((p) => p.path.endsWith("/portal"))?.body).toEqual({ action: "cancel", reason: "too_expensive" });
    expect(useBilling.getState().account?.subscription?.cancelAtPeriodEnd).toBe(true);
  });
});

describe("PreiseView", () => {
  it("h1 Preise, four plans, the full comparison table and the cancel link", () => {
    // a server with ANTHROPIC_API_KEY sells the AI coach
    useBilling.setState({ config: { ...CONFIG, coachAi: true } });
    wrap(<PreiseView />);
    expect(screen.getByRole("heading", { level: 1, name: "Preise" })).toBeInTheDocument();
    for (const p of ["free", "pro", "premium", "team"]) expect(screen.getByTestId(`plan-${p}`)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Alle Funktionen im Vergleich" });
    expect(within(table).getByRole("rowheader", { name: "KI-Coach" })).toBeInTheDocument();
    expect(screen.getByTestId("plan-premium")).toHaveTextContent("KI-Coach mit Wochenanalyse");
    expect(screen.getByTestId("legal-cancel")).toHaveTextContent("Verträge hier kündigen");
    expect(screen.getByTestId("cta-pro")).toHaveTextContent("14 Tage gratis testen");
  });

  it("without an AI key on the server the page never sells the KI-Coach (Review F06)", () => {
    useBilling.setState({ config: CONFIG });
    wrap(<PreiseView />);
    const table = screen.getByRole("table", { name: "Alle Funktionen im Vergleich" });
    expect(within(table).queryByRole("rowheader", { name: "KI-Coach" })).toBeNull();
    expect(within(table).queryByRole("rowheader", { name: "KI-Coach pro Tag" })).toBeNull();
    expect(screen.getByTestId("plan-premium")).not.toHaveTextContent("KI-Coach");
    expect(screen.getByTestId("plan-premium")).toHaveTextContent("Berichte als PDF & eigene Dashboards");
  });

  it("without cloud: plans shown, no checkout, honest line", () => {
    setCloudEnabledForTests(false);
    wrap(<PreiseView />);
    expect(screen.getByTestId("preise-view")).toHaveAttribute("data-mode", "off");
    expect(screen.getByTestId("billing-closed")).toHaveTextContent("Keine Abos in dieser Version");
    expect(screen.queryByTestId("cta-pro")).toBeNull();
    expect(screen.getByTestId("note-pro")).toHaveTextContent("Noch nicht buchbar");
  });
});
