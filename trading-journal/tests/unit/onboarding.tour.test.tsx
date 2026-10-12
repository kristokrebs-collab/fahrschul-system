/**
 * First-run tour (P13) end to end in jsdom: auto start on an empty journal, the five steps with real writes (capital
 * and currency into the settings, a process goal through P08's `addGoalFromDraft`), the honest exchange hint without
 * the cloud, stepping aside for the setup editor and coming back, the final hold, and no auto start for a journal
 * that already has trades.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { OnboardingHost } from "@/onboarding/OnboardingHost";
import { ONBOARDING_KEY, readOnboarding, useOnboarding } from "@/onboarding/onboardingStore";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

function mount() {
  return render(
    <MotionRoot>
      <OnboardingHost />
    </MotionRoot>,
  );
}

const step = () => screen.getByTestId("onboarding").getAttribute("data-step");
const next = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("tour-next"));
  });
};

describe("Onboarding tour", () => {
  beforeAll(async () => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    await import("@/onboarding/OnboardingTour");
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.removeItem(ONBOARDING_KEY);
    useOnboarding.setState({ open: false, step: 0, source: "manual", paused: false, loaded: false });
  });

  it("an existing trader (journal with trades) is marked seen and never interrupted", async () => {
    expect(useJournal.getState().trades.length).toBeGreaterThan(0);
    mount();
    await waitFor(() => expect(readOnboarding()?.status).toBe("seen"));
    expect(useOnboarding.getState().open).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Einführung" })).toBeNull();
  });

  it("empty journal: starts by itself, walks the five steps with real writes and ends with the hold", async () => {
    await act(async () => {
      useJournal.setState({ trades: [] });
    });
    mount();
    const dialog = await screen.findByRole("dialog", { name: "Einführung" });
    expect(step()).toBe("start");
    expect(within(dialog).getByRole("list", { name: "Fortschritt der Einführung" })).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "Schritt 1 von 5" })).toBeInTheDocument();

    // 2 Konten: invalid input blocks, a valid one is saved
    await next();
    expect(step()).toBe("konten");
    fireEvent.change(await screen.findByLabelText(/Startkapital Makro/), { target: { value: "abc" } });
    await next();
    expect(step()).toBe("konten");
    expect(await screen.findByText("Bitte eine Zahl ab 0 eintragen.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Startkapital Makro/), { target: { value: "12.500" } });
    fireEvent.change(screen.getByLabelText(/Startkapital Scalp/), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("radio", { name: "EUR" }));
    await next();
    expect(step()).toBe("setups");
    await waitFor(() => expect(useJournal.getState().settings.capital).toMatchObject({ makro: 12500, scalp: 2500 }));
    expect(useJournal.getState().settings.currency).toBe("EUR");

    // 3 Setups: stepping aside for the editor and coming back on the same step
    const add = await screen.findByRole("button", { name: /Eigene Grundlage anlegen/ });
    await act(async () => {
      fireEvent.click(add);
    });
    expect(useOnboarding.getState().paused).toBe(true);
    expect(useUi.getState().setupEditor.open).toBe(true);
    await act(async () => {
      useUi.getState().closeSetupEditor();
    });
    await waitFor(() => expect(useOnboarding.getState().open).toBe(true));
    expect(useOnboarding.getState().step).toBe(2);

    // 4 Börse: no cloud in this build → the honest hint
    await next();
    expect(step()).toBe("boerse");
    expect(await screen.findByTestId("tour-exchange-off")).toHaveTextContent("Du trägst Trades selbst ein");

    // 5 Ziel: pick the trade limit, hold to start (assistive-tech path: arm, confirm)
    await next();
    expect(step()).toBe("ziel");
    fireEvent.click(await screen.findByRole("radio", { name: /Höchstens 3 Trades am Tag/ }));
    const hold = await screen.findByTestId("tour-finish");
    await act(async () => {
      fireEvent.click(hold);
    });
    await act(async () => {
      fireEvent.click(hold);
    });
    await waitFor(() => expect(readOnboarding()?.status).toBe("done"));
    await waitFor(() => {
      const goals = (useJournal.getState().settings as unknown as { growth?: { goals?: { metric: string; source: { kind: string } }[] } }).growth?.goals ?? [];
      expect(goals.some((g) => g.metric === "tradesPerDay" && g.source.kind === "onboarding")).toBe(true);
    });
    expect(useUi.getState().toasts.some((t) => t.title === "Startklar")).toBe(true);
  });

  it("skip closes and remembers; Zurück goes back a step", async () => {
    await act(async () => {
      useJournal.setState({ trades: [] });
    });
    mount();
    await screen.findByRole("dialog", { name: "Einführung" });
    await next();
    expect(step()).toBe("konten");
    await act(async () => {
      fireEvent.click(screen.getByTestId("tour-back"));
    });
    expect(step()).toBe("start");
    await act(async () => {
      fireEvent.click(screen.getByTestId("tour-skip"));
    });
    expect(readOnboarding()?.status).toBe("skipped");
    expect(useOnboarding.getState().open).toBe(false);
  });
});
