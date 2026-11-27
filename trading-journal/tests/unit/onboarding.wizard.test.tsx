/**
 * Paket B – the setup wizard: at most four steps (Konto · Daten · Verbindung optional · erster Trade), progress is stored, every
 * step but the one decision can be passed, it runs ONCE (armed by a registration, never by a login or a reload), an existing trader
 * is never asked, and a payment in progress goes first.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDemo = vi.hoisted(() => vi.fn());
vi.mock("@/views/demo/demoStore", () => ({ openDemo }));
const fx = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

const { setCloudEnabledForTests } = await import("@/cloud/env");
const { resetCloudSession, useCloudSession } = await import("@/cloud/session");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { SetupWizard, WIZARD } = await import("@/onboarding/wizard/SetupWizard");
const { WizardHost } = await import("@/onboarding/wizard/WizardHost");
const ws = await import("@/onboarding/wizard/wizardStore");
const { useJournal, resetJournal } = await import("@/store/journalStore");
const { useUi } = await import("@/store/uiStore");
const { useBilling, resetBilling } = await import("@/billing/store");
const { clearReturnTo, setReturnTo } = await import("@/store/returnTo");

const USER = { id: "u1", email: "neu@example.com", aal: "aal1" as const, mfaEnrolled: false };
const quiet = { stored: { v: 1, status: "pending", step: 0, data: null, at: "" } as const, signedIn: true, journalLoaded: true, tradeCount: 0, introSettled: true, busy: false };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearReturnTo();
  setCloudEnabledForTests(true);
  resetCloudSession();
  useWizardReset();
  openDemo.mockReset();
});
afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetBilling();
});
function useWizardReset() {
  ws.useWizard.setState({ open: false, step: 0, data: null, loaded: false });
}

describe("decision (pure)", () => {
  it("opens only for a PENDING wizard, signed in, a loaded EMPTY journal, the intro over and a quiet screen", () => {
    expect(ws.wizardDecision(quiet)).toBe("open");
    expect(ws.wizardDecision({ ...quiet, stored: null })).toBe("never"); // never armed: a login or a reload does not start it
    for (const status of ["active", "done", "skipped"] as const) expect(ws.wizardDecision({ ...quiet, stored: { ...quiet.stored, status } }), status).toBe("never");
    expect(ws.wizardDecision({ ...quiet, signedIn: false })).toBe("wait");
    expect(ws.wizardDecision({ ...quiet, journalLoaded: false })).toBe("wait");
    expect(ws.wizardDecision({ ...quiet, introSettled: false })).toBe("wait");
    expect(ws.wizardDecision({ ...quiet, busy: true })).toBe("wait");
  });

  it("an existing trader (a journal with trades) is never asked: they are marked handled", () => {
    expect(ws.wizardDecision({ ...quiet, tradeCount: 3 })).toBe("existing");
    ws.armWizard();
    ws.markWizardExisting();
    expect(ws.readWizard()?.status).toBe("skipped");
  });

  it("is armed once: a second registration does not re-arm a finished or declined wizard", () => {
    ws.armWizard();
    expect(ws.readWizard()).toMatchObject({ status: "pending", step: 0, data: null });
    ws.skipWizard();
    ws.armWizard();
    expect(ws.readWizard()?.status).toBe("skipped");
  });

  it("at most four steps; the stored record survives garbage", () => {
    expect(ws.WIZARD_STEPS).toEqual(["konto", "daten", "verbindung", "start"]);
    localStorage.setItem(ws.WIZARD_KEY, "{not json");
    expect(ws.readWizard()).toBeNull();
    localStorage.setItem(ws.WIZARD_KEY, JSON.stringify({ status: "active", step: 99, data: "x" }));
    expect(ws.readWizard()).toMatchObject({ status: "active", step: 3, data: null });
  });
});

function mountWizard() {
  return render(<MotionRoot><SetupWizard /></MotionRoot>);
}

describe("the sheet", () => {
  beforeEach(() => {
    useCloudSession.setState({ phase: "signedIn", user: USER, emailConfirmed: true });
  });

  it("walks Konto → Daten → Verbindung → Start, saves the place at every step and is skippable where it is optional", async () => {
    ws.armWizard();
    act(() => ws.openWizard(false));
    mountWizard();
    expect(await screen.findByTestId("setup-wizard")).toHaveAttribute("data-step", "konto");
    expect(screen.getByTestId("wizard-account")).toHaveTextContent("neu@example.com");
    expect(screen.getByTestId("wizard-account")).toHaveTextContent("E-Mail bestätigt");
    expect(screen.getByTestId("wizard-rail").querySelectorAll("li")).toHaveLength(4);
    fireEvent.click(screen.getByTestId("wizard-next"));
    await waitFor(() => expect(screen.getByTestId("setup-wizard")).toHaveAttribute("data-step", "daten"));
    expect(ws.readWizard()).toMatchObject({ status: "active", step: 1 });
    // the one decision: without it "Weiter" says why instead of moving on
    fireEvent.click(screen.getByTestId("wizard-next"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wähle eine Startart");
    fireEvent.click(screen.getByRole("radio", { name: /Eigene Daten/ }));
    expect(ws.readWizard()?.data).toBe("own");
    fireEvent.click(screen.getByTestId("wizard-next"));
    await waitFor(() => expect(screen.getByTestId("setup-wizard")).toHaveAttribute("data-step", "verbindung"));
    expect(screen.getByTestId("wizard-step-title")).toHaveTextContent("Verbindung optional – zunächst Demo ausprobieren");
    // the optional step has its own "Später"
    fireEvent.click(screen.getByTestId("wizard-optional-later"));
    await waitFor(() => expect(screen.getByTestId("setup-wizard")).toHaveAttribute("data-step", "start"));
    expect(ws.readWizard()).toMatchObject({ step: 3, data: "own" });
    expect(screen.getByTestId("wizard-finish")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wizard-back"));
    await waitFor(() => expect(screen.getByTestId("setup-wizard")).toHaveAttribute("data-step", "verbindung"));
  });

  it("the first trade is the end of the wizard: it counts as done and opens the editor (own data)", async () => {
    ws.armWizard();
    act(() => ws.openWizard(false));
    ws.chooseWizardData("own");
    act(() => ws.goToWizardStep(3));
    const openEditor = vi.fn();
    const real = useUi.getState().openEditor;
    useUi.setState({ openEditor });
    mountWizard();
    fireEvent.click(await screen.findByTestId("wizard-first-trade"));
    expect(openEditor).toHaveBeenCalled();
    expect(ws.readWizard()?.status).toBe("done");
    useUi.setState({ openEditor: real });
  });

  it("with the demo chosen, the last step offers the demo first – and says it is example data", async () => {
    ws.armWizard();
    act(() => ws.openWizard(false));
    ws.chooseWizardData("demo");
    act(() => ws.goToWizardStep(3));
    mountWizard();
    expect(await screen.findByTestId("wizard-open-demo")).toBeInTheDocument();
    expect(screen.getByText("Die Demo zeigt Beispieldaten, keine echten Ergebnisse.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wizard-open-demo"));
    await waitFor(() => expect(openDemo).toHaveBeenCalled());
    expect(ws.readWizard()?.status).toBe("done");
  });

  it("'Später fortsetzen' keeps the place and it does NOT come back by itself; 'Überspringen' ends it for good", async () => {
    ws.armWizard();
    act(() => ws.openWizard(false));
    act(() => ws.goToWizardStep(2));
    mountWizard();
    fireEvent.click(await screen.findByTestId("wizard-later"));
    await waitFor(() => expect(ws.useWizard.getState().open).toBe(false));
    expect(ws.readWizard()).toMatchObject({ status: "active", step: 2 });
    expect(ws.wizardDecision({ ...quiet, stored: ws.readWizard() })).toBe("never");
    // resumed by hand (the settings card): at the stored step
    act(() => ws.openWizard(true));
    await waitFor(() => expect(screen.getByTestId("setup-wizard")).toHaveAttribute("data-step", "verbindung"));
    fireEvent.click(screen.getByTestId("wizard-skip"));
    await waitFor(() => expect(ws.readWizard()?.status).toBe("skipped"));
  });

  it("signed out with the cloud: the account step offers the registration, honestly; without a cloud it says there is no account", async () => {
    useCloudSession.setState({ phase: "signedOut", user: null });
    act(() => ws.openWizard(false));
    mountWizard();
    expect(await screen.findByTestId("wizard-signup")).toHaveTextContent(WIZARD.konto.create);
    fireEvent.click(screen.getByTestId("wizard-signup"));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signup" });
    expect(ws.useWizard.getState().open).toBe(false);
  });

  it("an unconfirmed address is said plainly, nothing is claimed that did not happen", async () => {
    useCloudSession.setState({ phase: "signedIn", user: USER, emailConfirmed: false });
    act(() => ws.openWizard(false));
    mountWizard();
    expect(await screen.findByTestId("wizard-account")).toHaveTextContent("E-Mail noch nicht bestätigt");
  });
});

describe("the host: once, quiet, never in front of a payment", () => {
  beforeEach(() => {
    resetJournal();
    useJournal.setState({ loaded: true, trades: [] });
    useCloudSession.setState({ phase: "signedIn", user: USER });
  });
  const mountHost = () => render(<MotionRoot><WizardHost /></MotionRoot>);

  it("opens a pending wizard when the screen is quiet – and only then", async () => {
    ws.armWizard();
    mountHost();
    await waitFor(() => expect(ws.useWizard.getState().open).toBe(true));
    expect(ws.readWizard()?.status).toBe("active");
  });

  it("never opens one that nothing armed (a plain login, a reload)", async () => {
    mountHost();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.useWizard.getState().open).toBe(false);
  });

  it("waits while the login sheet, an order or the way back to an order is on screen", async () => {
    ws.armWizard();
    // three things own the screen at once: the login sheet, the way back to an order, the order sheet itself
    useCloudSession.setState({ sheet: { ...useCloudSession.getState().sheet, open: true } });
    setReturnTo({ kind: "order", order: "premium.year.1" }, { on: "signedIn" });
    useBilling.setState((s) => ({ order: { ...s.order, open: true } }));
    mountHost();
    const still = async () => {
      await new Promise((r) => setTimeout(r, 50));
      expect(ws.useWizard.getState().open).toBe(false);
    };
    await still();
    act(() => useCloudSession.setState({ sheet: { ...useCloudSession.getState().sheet, open: false } }));
    await still(); // the way back and the order are still there
    act(() => clearReturnTo());
    await still(); // the order sheet is still open
    act(() => useBilling.setState((s) => ({ order: { ...s.order, open: false } })));
    await waitFor(() => expect(ws.useWizard.getState().open).toBe(true));
  });

  it("an existing trader is marked and never asked", async () => {
    ws.armWizard();
    useJournal.setState({ trades: [{ id: "t1" } as never] });
    mountHost();
    await waitFor(() => expect(ws.readWizard()?.status).toBe("skipped"));
    expect(ws.useWizard.getState().open).toBe(false);
  });
});
