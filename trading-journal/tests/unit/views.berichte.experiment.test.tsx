/**
 * F37 in the Berichte page: the Wochenreview card (four findings, evidence trades open as rows) and the Wochenexperiment
 * card – ONE hypothesis for the next week with target value, minimum sample and evidence; accepting and declining are
 * the user's clicks (and can be taken back); the experiment of a week is read automatically in that week's report.
 * The clock is pinned to Wed 2026-06-03, just after the 90-day coach journal ends (last finished week = KW 22).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { experimentStateOf } from "@/domain/reports";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { BerichteView, useBerichteUi } from "@/views/berichte";
import { COACH_SETTINGS, coachJournal } from "./coach.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

function reduceMotion() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

function renderView() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <BerichteView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

describe("Wochenreview und Wochenexperiment", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    useBerichteUi.getState().reset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 3, 12));
    await act(async () => {
      useJournal.setState({ trades: coachJournal(90, 11), settings: { ...COACH_SETTINGS } });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    useUi.setState({ acc: "all", toasts: [] });
  });

  it("shows the four findings; the evidence of a finding opens as trade rows", async () => {
    renderView();
    const card = await screen.findByTestId("week-review");
    expect(card).toHaveAttribute("data-level", "tragfähig");
    const f = within(card).getAllByTestId("review-finding");
    expect(f.map((x) => x.getAttribute("data-finding"))).toEqual(["result", "setups", "discipline", "uncertainty"]);
    expect(f[0]).toHaveTextContent("nach Gebühren und Funding");
    expect(f[3]).toHaveTextContent("80 %-Intervall");
    const toggle = within(f[0]!).getAllByTestId("review-evidence-toggle")[0]!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(f[0]!.querySelectorAll("[data-trade-id]").length).toBeGreaterThanOrEqual(1);
  });

  it("proposes ONE hypothesis for next week with target, minimum and evidence – accepting is a click", async () => {
    renderView();
    const key = screen.getByTestId("berichte-view").getAttribute("data-key")!;
    expect(key).toBe("2026-W22");
    const card = await screen.findByTestId("week-experiment");
    const proposal = await within(card).findByTestId("experiment-proposal");
    expect(proposal).toHaveAttribute("data-declined", "0");
    expect(within(proposal).getByTestId("experiment-target")).toHaveTextContent(/^Nächste Woche: .+ – bei mindestens 5 Trades\.$/);
    expect(proposal).toHaveTextContent("Annahme dahinter, in einer Woche nicht prüfbar");
    expect(within(card).getAllByTestId("experiment-accept")).toHaveLength(1);
    // nothing is stored before the click
    expect(experimentStateOf(useJournal.getState().settings).experiments).toEqual([]);

    await act(async () => {
      fireEvent.click(within(card).getByTestId("experiment-accept"));
    });
    await waitFor(() => expect(within(card).getByTestId("experiment-accepted")).toBeInTheDocument());
    const stored = experimentStateOf(useJournal.getState().settings).experiments;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ weekKey: "2026-W23", sourceWeek: "2026-W22", minTrades: 5 });
    expect(stored[0]!.acceptedAt).toMatch(/^2026-06-03T/);

    await act(async () => {
      fireEvent.click(within(card).getByTestId("experiment-withdraw"));
    });
    await waitFor(() => expect(within(card).getByTestId("experiment-proposal")).toBeInTheDocument());
    expect(experimentStateOf(useJournal.getState().settings).experiments).toEqual([]);
  });

  it("declining is stored, shown, and can be reopened", async () => {
    renderView();
    const card = await screen.findByTestId("week-experiment");
    await within(card).findByTestId("experiment-proposal");
    await act(async () => {
      fireEvent.click(within(card).getByTestId("experiment-decline"));
    });
    await waitFor(() => expect(within(card).getByTestId("experiment-proposal")).toHaveAttribute("data-declined", "1"));
    expect(experimentStateOf(useJournal.getState().settings).declined).toHaveLength(1);
    expect(within(card).queryByTestId("experiment-accept")).toBeNull();
    await act(async () => {
      fireEvent.click(within(card).getByTestId("experiment-undecline"));
    });
    await waitFor(() => expect(within(card).getByTestId("experiment-proposal")).toHaveAttribute("data-declined", "0"));
    expect(experimentStateOf(useJournal.getState().settings).declined).toEqual([]);
  });

  it("reads the accepted experiment in the report of its week (still running → „läuft“)", async () => {
    renderView();
    const card = await screen.findByTestId("week-experiment");
    await within(card).findByTestId("experiment-proposal");
    await act(async () => {
      fireEvent.click(within(card).getByTestId("experiment-accept"));
    });
    await waitFor(() => expect(within(card).getByTestId("experiment-accepted")).toBeInTheDocument());
    // next week = the running week 23 (no trades yet in the journal)
    fireEvent.click(screen.getByTestId("report-next"));
    await waitFor(() => expect(screen.getByTestId("berichte-view")).toHaveAttribute("data-key", "2026-W23"));
    const now = await screen.findByTestId("week-experiment");
    const result = within(now).getByTestId("experiment-result");
    expect(result).toHaveAttribute("data-status", "läuft");
    expect(within(now).getByTestId("experiment-text")).toHaveTextContent("Die Woche läuft noch");
    // a week without trades has no report to build a second hypothesis on
    expect(within(now).queryByTestId("experiment-next")).toBeNull();
  });

  it("has no experiment card for other report kinds", async () => {
    renderView();
    await screen.findByTestId("week-experiment");
    fireEvent.click(screen.getByRole("radio", { name: "Monat" }));
    await waitFor(() => expect(screen.getByTestId("berichte-view")).toHaveAttribute("data-kind", "month"));
    expect(screen.queryByTestId("week-experiment")).toBeNull();
    expect(screen.queryByTestId("week-review")).toBeNull();
  });

  it("a finished week without an experiment leaves no gap: no card, no chip, the review takes the whole row", async () => {
    renderView();
    await screen.findByTestId("week-experiment");
    // a week that is long over (no accepted experiment, the next week is over too): nothing to propose
    await act(async () => {
      useBerichteUi.getState().setPeriod("2026-W19", "down");
    });
    await waitFor(() => expect(screen.getByTestId("berichte-view")).toHaveAttribute("data-key", "2026-W19"));
    const review = await screen.findByTestId("week-review");
    expect(screen.queryByTestId("week-experiment")).toBeNull();
    expect(review.closest(".lg\\:col-span-12")).not.toBeNull();
    expect(review.closest(".lg\\:col-span-7")).toBeNull();
  });
});
