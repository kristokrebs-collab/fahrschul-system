/**
 * Coach page (P04, `src/views/coach`): the empty journal (honest empty states, no AI button), a journal with a clear
 * edge and leak (hero, questions with evidence and confidence, the honest fallback, leaks & edges, the plan pinned into
 * `settings.coach.plan`), the trade panel, the live watcher (a revenge save → one toast + live alert; a backfill of
 * MAE / MFE is no save) and the pure helpers of the watcher. Reduced motion: answers land at once.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { coachPrefsOf } from "@/domain/coach";
import type { Trade } from "@/domain/types";
import { nowLocalInput } from "@/lib/dates";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { BULK_SAVE, changedIds, CoachView, CoachWatcher, fresh, TradeCoachPanel, useCoachUi, userChanged } from "@/views/coach";
import { COACH_SETTINGS, coachJournal, ct } from "./coach.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const MIN = 60_000;
const local = (ms: number) => nowLocalInput(new Date(ms));

/** OS asks for reduced motion: answers land at once, effects show their end state. */
function reduceMotion() {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduced-motion"),
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderCoach() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <CoachView />
        <CoachWatcher />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

async function load(trades: Trade[]) {
  await act(async () => {
    useJournal.setState({ trades, settings: { ...COACH_SETTINGS } });
  });
}

describe("CoachView", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    useCoachUi.getState().clearChat();
    useCoachUi.getState().dismissAlert();
  });
  afterEach(() => useUi.setState({ acc: "all", toasts: [] }));

  it("empty journal: h1, honest empty states, no AI button, questions without guessing", async () => {
    await load([]);
    renderCoach();
    expect(screen.getByRole("heading", { level: 1, name: "Coach" })).toBeInTheDocument();
    expect(screen.getByTestId("coach-score")).toHaveTextContent("Zu wenig Daten");
    expect(screen.getByTestId("coach-timeline")).toHaveTextContent("Keine Muster");
    expect(screen.getByTestId("coach-chat")).toHaveTextContent("nichts wird geraten");
    fireEvent.change(screen.getByTestId("coach-input"), { target: { value: "Wie ist meine Win-Rate?" } });
    fireEvent.click(screen.getByTestId("coach-ask"));
    const a = await screen.findByTestId("coach-answer");
    expect(a).toHaveAttribute("data-kind", "empty");
    expect(screen.queryByTestId("coach-ai")).toBeNull();
  });

  it("journal: hero, the best setup with evidence and confidence, the honest fallback, leaks and edges", async () => {
    await load(coachJournal(90, 11));
    renderCoach();
    expect(screen.getByTestId("coach-view")).toHaveAttribute("data-n");
    expect(screen.getByTestId("coach-lesson")).toHaveTextContent(/\w/);
    expect(screen.getByTestId("coach-score")).toHaveTextContent("/ 100");

    fireEvent.change(screen.getByTestId("coach-input"), { target: { value: "Was ist mein bestes Setup?" } });
    fireEvent.click(screen.getByTestId("coach-ask"));
    const best = await screen.findByTestId("coach-answer");
    expect(best).toHaveTextContent("Breakout");
    expect(within(best).getByRole("meter", { name: "Konfidenz" })).toBeInTheDocument();
    expect(within(best).getByText("Belege")).toBeInTheDocument();
    expect(best).toHaveTextContent(/klar|Tendenz|zu wenig Daten/);

    fireEvent.change(screen.getByTestId("coach-input"), { target: { value: "Wie wird das Wetter morgen?" } });
    fireEvent.submit(screen.getByTestId("coach-input").closest("form")!);
    await waitFor(() => expect(screen.getAllByTestId("coach-answer")[0]).toHaveAttribute("data-kind", "unknown"));
    expect(screen.getAllByTestId("coach-answer")[0]).toHaveTextContent("nicht verstanden");
    expect(screen.queryByTestId("coach-ai")).toBeNull();

    const edges = screen.getByTestId("coach-edges");
    expect(within(edges).getAllByTestId("coach-leak").length).toBeGreaterThan(0);
    expect(within(edges).getAllByTestId("coach-edge").length).toBeGreaterThan(0);
    expect(edges).toHaveTextContent("Fade");
  });

  it("pins the plan into settings.coach.plan and releases it", async () => {
    await load(coachJournal(90, 11));
    renderCoach();
    const plan = screen.getByTestId("coach-plan");
    expect(plan).toHaveAttribute("data-pinned", "0");
    await act(async () => {
      fireEvent.click(within(plan).getByTestId("coach-plan-accept"));
    });
    await waitFor(() => expect(coachPrefsOf(useJournal.getState().settings).plan?.goals.length).toBeGreaterThan(0));
    expect(useUi.getState().toasts.some((t) => t.title === "Plan gepinnt")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("coach-plan")).toHaveAttribute("data-pinned", "1"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("coach-plan-release"));
    });
    await waitFor(() => expect(coachPrefsOf(useJournal.getState().settings).plan).toBeNull());
  });

  it("the trade panel names the revenge entry and renders nothing for an unknown id", async () => {
    const trades = coachJournal(60, 11);
    await load(trades);
    const revenge = trades.find((t) => t.id.startsWith("r"))!;
    const { container, rerender } = render(
      <MotionRoot>
        <TradeCoachPanel tradeId={revenge.id} />
      </MotionRoot>,
    );
    const panel = screen.getByTestId("trade-coach-panel");
    expect(panel).toHaveTextContent("Verhalten");
    expect(panel).toHaveTextContent("Revenge");
    rerender(
      <MotionRoot>
        <TradeCoachPanel tradeId="nope" />
      </MotionRoot>,
    );
    expect(container.querySelector("[data-testid=trade-coach-panel]")).toBeNull();
  });

  it("live watcher: a sized-up re-entry right after a loss → one toast and the live alert; a MAE/MFE backfill is no save", async () => {
    const now = Date.now();
    const base: Trade[] = [];
    for (let i = 0; i < 12; i++) base.push(ct(local(now - (20 - i) * 86_400_000), { id: `b${i}`, p: i % 3 ? 120 : -100, exitDate: local(now - (20 - i) * 86_400_000 + 60 * MIN) }));
    const loss = ct(local(now - 40 * MIN), { id: "loss", p: -100, exitDate: local(now - 10 * MIN) });
    await load([...base, loss]);
    renderCoach();
    const before = useUi.getState().toasts.length;
    // a save as the store commits it: one record more, stamped now
    await act(async () => {
      useJournal.setState({ trades: [...useJournal.getState().trades, ct(local(now - 3 * MIN), { id: "again", p: 0, risk: 250, status: "open", exit: null, pnlManual: null, emotion: "Revenge", updatedAt: new Date().toISOString() })] });
    });
    await waitFor(() => expect(useCoachUi.getState().alert?.key).toBe("revenge"));
    const toasts = useUi.getState().toasts.slice(before);
    expect(toasts.filter((t) => t.title.startsWith("Coach:"))).toHaveLength(1);
    expect(toasts[0]!.detail).toMatch(/Pause/);
    expect(await screen.findByTestId("coach-live-alert")).toHaveTextContent("Revenge");

    // the backfill writes MAE / MFE on an old trade: no decision, no toast
    useCoachUi.getState().dismissAlert();
    const n = useUi.getState().toasts.length;
    await act(async () => {
      useJournal.setState({ trades: useJournal.getState().trades.map((t) => (t.id === "b3" ? { ...t, mae: 0.5, mfe: 9, maeR: -0.5, mfeR: 9, updatedAt: new Date().toISOString() } : t)) });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(useUi.getState().toasts.length).toBe(n);
    expect(useCoachUi.getState().alert).toBeNull();
  });
});

describe("watcher helpers", () => {
  const t = ct("2026-03-02T10:00", { id: "x", p: 50, updatedAt: "2026-03-02T10:00:00.000Z" });
  it("userChanged ignores what the app writes on its own", () => {
    expect(userChanged(t, { ...t, mae: 1, mfe: 2, maeR: -1, mfeR: 2, atrPct: 0.4, annotations: [], updatedAt: "x" } as Trade)).toBe(false);
    expect(userChanged(t, { ...t, stop: 98 })).toBe(true);
    expect(userChanged(t, { ...t, setups: [...t.setups] })).toBe(false);
    expect(userChanged(t, { ...t, setups: ["s_bad"] })).toBe(true);
  });
  it("changedIds: new or edited records only; fresh = saved within five minutes", () => {
    const edited = { ...t, stop: 98, updatedAt: "2026-03-02T10:05:00.000Z" };
    const n = ct("2026-03-02T11:00", { id: "n" });
    expect(changedIds([t], [edited, n])).toEqual(["x", "n"]);
    expect(changedIds([t], [t])).toEqual([]);
    expect(fresh({ updatedAt: new Date(1_000_000).toISOString() }, 1_000_000 + 4 * MIN)).toBe(true);
    expect(fresh({ updatedAt: new Date(1_000_000).toISOString() }, 1_000_000 + 6 * MIN)).toBe(false);
    expect(BULK_SAVE).toBe(3);
  });
});
