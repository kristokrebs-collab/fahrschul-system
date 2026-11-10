/**
 * Konto-Pflicht in the shell (`App` → `useEntryGate`): with the cloud signed out the entry gate (the login window as the page) stands in
 * front of the app – first visit on „Konto erstellen“ (the start page of a first visit: the landing page), a returning browser on
 * „Anmelden“; signed in, the shell; `#preise` read only; the share view public; without the cloud nothing changes. The pages are stubs (as in `app.shell.test.tsx`), the hosts' chunk a stub.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  return { ...actual, ...fakeMarket(actual).overrides };
});
vi.mock("@/chart/NothingCandleChart", () => ({ NothingCandleChart: () => <div data-testid="candle-chart" /> }));
vi.mock("@/chart/MiniTradeChart", () => ({ MiniTradeChart: () => null }));
vi.mock("@/app/pages", async () => {
  const overview = await import("@/views/overview");
  const stub = (name: string) => () => (
    <div data-testid={`page-${name}`}>
      <h1>{name}</h1>
    </div>
  );
  const LAZY_VIEWS = Object.fromEntries(["markt", "analyse", "risiko", "coach", "berichte", "labor", "wachstum", "community", "cockpit", "konto", "preise", "funktionen", "studio", "plan", "aktien"].map((p) => [p, stub(p)]));
  return {
    OverviewView: overview.OverviewView,
    TradesView: () => <div data-testid="page-trades">Alle Trades</div>,
    SetupsView: () => <div data-testid="page-setups">Entscheidungsgrundlagen</div>,
    SettingsView: () => <div data-testid="page-settings">Einstellungen</div>,
    lazyView: (p: string) => LAZY_VIEWS[p],
    LAZY_PAGES: Object.keys(LAZY_VIEWS),
    isLazyPage: (p: string) => p in LAZY_VIEWS,
    PAGE_FEATURE: {},
    preloadPage: () => undefined,
  };
});
vi.mock("@/app/DeferredHosts", () => ({ default: () => <div data-testid="feature-hosts" /> }));
vi.mock("@/app/overlays", () => ({ TradeDetail: () => null, TradeEditor: () => null, SetupEditor: () => null, HyblockForm: () => null }));
// the Supabase chunk is never needed here: nothing is stored, no callback in the URL
vi.mock("@/cloud/runtime", async (orig) => {
  const real = await orig<typeof import("@/cloud/runtime")>();
  return { ...real, ensureCloud: vi.fn(() => new Promise(() => undefined)) };
});
// the gate's billing host is not under test (its own specs); the legal host and the toasts stay real
vi.mock("@/billing/ui/BillingHost", () => ({ BillingHost: () => null }));

import App from "@/App";
import { setCloudEnabledForTests } from "@/cloud/env";
import { closeAuthSheet, resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";
import { useShareRoute } from "@/store/router";
import { useUi } from "@/store/uiStore";

const realAnimate = (Element.prototype as { animate?: unknown }).animate;
const renderApp = () =>
  render(
    <MotionRoot>
      <App />
    </MotionRoot>,
  );

describe("Konto-Pflicht: the gate in front of the shell", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.removeItem("tj2-cloud-known");
    // jsdom has no Web Animations: a finished stand-in (the window's entrance is not under test here)
    (Element.prototype as unknown as { animate: unknown }).animate = () => ({ finished: Promise.resolve(), cancel: () => undefined, effect: null, id: "" });
    resetCloudSession();
  });
  afterEach(() => {
    act(() => {
      resetCloudSession();
      useShareRoute.setState({ token: null });
      useUi.getState().setPage("overview");
    });
    setCloudEnabledForTests(null);
    (Element.prototype as { animate?: unknown }).animate = realAnimate;
  });

  it("without the cloud: the shell, no gate (local / dev / default e2e build)", async () => {
    setCloudEnabledForTests(false);
    renderApp();
    expect(screen.getByRole("toolbar", { name: "Navigation" })).toBeInTheDocument();
    expect(screen.queryByTestId("entry-gate")).toBeNull();
  }, 20_000);

  it("signed out, first visit of the start page: the landing page – no gate, no header, no dock, no page; its buttons open the window over it", async () => {
    setCloudEnabledForTests(true);
    act(() => useCloudSession.setState({ phase: "signedOut" }));
    renderApp();
    const landing = await screen.findByTestId("entry-landing", {}, { timeout: 12_000 });
    expect(screen.queryByTestId("entry-gate")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Navigation" })).toBeNull();
    expect(screen.queryByTestId("page-overview")).toBeNull();
    // one h1: the claim; the plans are on the page
    expect(within(landing).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(landing).getByRole("heading", { level: 1 })).toHaveTextContent("Hör auf zu raten. Fang an zu messen.");
    expect(within(landing).getByTestId("landing-plans")).toBeInTheDocument();
    // the public links under the page
    expect(within(landing).getByTestId("gate-foot")).toContainElement(within(within(landing).getByTestId("gate-foot")).getByTestId("legal-impressum"));
    // „Kostenlos starten“: the registration as a dialog over the page (it can be closed – the page stays)
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(landing).getByTestId("landing-start"));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signup", source: "card" });
    expect(await screen.findByRole("dialog", { name: "Konto erstellen" }, { timeout: 8_000 })).toBeInTheDocument();
    expect(screen.getByTestId("entry-landing")).toBeInTheDocument();
    // „Anmelden“ at the end of the page
    act(() => closeAuthSheet());
    fireEvent.click(within(landing).getByTestId("landing-signin"));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signin" });
  }, 40_000);

  it("signed out, first visit by a deep link: the gate on „Konto erstellen“ – no header, no dock, no page", async () => {
    setCloudEnabledForTests(true);
    act(() => {
      useCloudSession.setState({ phase: "signedOut" });
      useUi.getState().setPage("trades");
    });
    renderApp();
    const gate = await screen.findByTestId("entry-gate", {}, { timeout: 8_000 });
    expect(gate).toHaveAttribute("data-gate-view", "signup");
    expect(await screen.findByRole("dialog", { name: "Konto erstellen" }, { timeout: 8_000 })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Navigation" })).toBeNull();
    expect(screen.queryByTestId("page-trades")).toBeNull();
    expect(screen.queryByTestId("entry-landing")).toBeNull();
    // the public links under the card
    expect(screen.getByTestId("legal-impressum")).toBeInTheDocument();
    expect(screen.getByTestId("contract-link-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("gate-link-preise")).toBeInTheDocument();
    // no way to close the gate
    expect(screen.queryByRole("button", { name: "Schließen" })).toBeNull();
  }, 20_000);

  it("a returning browser opens on „Anmelden“; signing in mounts the shell; signing out brings the gate back", async () => {
    setCloudEnabledForTests(true);
    localStorage.setItem("tj2-cloud-known", "1");
    act(() => useCloudSession.setState({ phase: "signedOut" }));
    renderApp();
    expect(await screen.findByRole("dialog", { name: "Anmelden" }, { timeout: 8_000 })).toBeInTheDocument();
    act(() => useCloudSession.setState({ phase: "signedIn", user: { id: "u1", email: "t@example.com", aal: "aal1", mfaEnrolled: false } }));
    await waitFor(() => expect(screen.getByRole("toolbar", { name: "Navigation" })).toBeInTheDocument(), { timeout: 8_000 });
    expect(screen.queryByTestId("entry-gate")).toBeNull();
    act(() => useCloudSession.setState({ phase: "signedOut", user: null }));
    expect(await screen.findByTestId("entry-gate", {}, { timeout: 8_000 })).toHaveAttribute("data-gate-view", "signin");
    expect(screen.queryByRole("toolbar", { name: "Navigation" })).toBeNull();
  }, 30_000);

  it("the 2FA code missing: still the gate, on the code step", async () => {
    setCloudEnabledForTests(true);
    act(() => useCloudSession.setState({ phase: "signedIn", needsMfa: true, user: { id: "u1", email: "t@example.com", aal: "aal1", mfaEnrolled: true } }));
    renderApp();
    expect(await screen.findByRole("dialog", { name: "Zwei-Faktor-Code" }, { timeout: 8_000 })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Navigation" })).toBeNull();
  }, 20_000);

  it("public: #preise read only (the pricing page in its own frame) and the share view (the shell, no gate)", async () => {
    setCloudEnabledForTests(true);
    act(() => {
      useCloudSession.setState({ phase: "signedOut" });
      useUi.getState().setPage("preise");
    });
    const { unmount } = renderApp();
    expect(await screen.findByTestId("public-pricing", {}, { timeout: 8_000 })).toBeInTheDocument();
    expect(await screen.findByTestId("page-preise", {}, { timeout: 8_000 })).toBeInTheDocument();
    expect(screen.queryByTestId("entry-gate")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Navigation" })).toBeNull();
    unmount();
    act(() => {
      useUi.getState().setPage("overview");
      useShareRoute.setState({ token: "abcdefghijklmnopqrstuv" });
    });
    renderApp();
    expect(screen.queryByTestId("entry-gate")).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Navigation" })).toBeInTheDocument();
  }, 30_000);

  it("a stored login being restored: a quiet splash – neither the gate nor the app flashes", async () => {
    setCloudEnabledForTests(true);
    localStorage.setItem("tj2-sb-auth", "{}");
    try {
      act(() => useCloudSession.setState({ phase: "loading" }));
      renderApp();
      expect(screen.getByTestId("entry-pending")).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByTestId("entry-gate")).toBeNull();
      expect(screen.queryByRole("toolbar", { name: "Navigation" })).toBeNull();
    } finally {
      localStorage.removeItem("tj2-sb-auth");
    }
  }, 20_000);
});
