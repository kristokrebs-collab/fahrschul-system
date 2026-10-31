/**
 * Wachstum page (P08, `src/views/wachstum`): the empty journal (honest empty states), a seeded journal (streaks, goals,
 * trackers, diary, skills, bests), the check-in sheet writing the day journal, the pre-trade check (checklist → ready,
 * the P05 pause), the goal sheet, the challenge deck, habits, the post-trade review (manual and the host's automatic
 * prompt after a closing save), the Wave-0 `addGoalFromDraft` through the real store, the once-only sheet owner and the
 * "Ziel erreicht" transition.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addGoalFromDraft, growthOf } from "@/domain/growth";
import { checkinOf } from "@/domain/psych";
import type { DayNote, DayNotes, Settings, Trade } from "@/domain/types";
import { localDateKey, nowLocalInput } from "@/lib/dates";
import { UNREACHABLE_SELECTOR } from "@/motion/a11y";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { useRiskGuardStore } from "@/views/risiko/guard";
import { __resetTransitions, PostTradeReviewHost, PostTradeReviewSheet, useGrowthUi, WachstumView, WACHSTUM_WIDGETS } from "@/views/wachstum";
import { mkTrade } from "./domain.fixtures";
import { pinMidday } from "./midday.fixture";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const DAY = 86_400_000;
const MIN = 60_000;
const local = (ms: number) => nowLocalInput(new Date(ms));
const key = (ms: number) => localDateKey(new Date(ms));

function trade(p: Partial<Trade> & { id: string; date: string }): Trade {
  return mkTrade({ entry: 100, stop: 99, target: 103, size: 10_000, leverage: 2, setups: ["s_bo"], reason: "Plan", followedPlan: true, notes: "Sauber.", exit: 102, ...p });
}

interface Seed {
  trades: Trade[];
  days: DayNotes;
  settings: Settings;
}

function seed(now: number, opts: { reached?: boolean; pause?: boolean } = {}): Seed {
  const trades: Trade[] = [];
  const days: DayNotes = {};
  for (let d = 30; d >= 1; d--) {
    const at = now - d * DAY;
    const wd = new Date(at).getDay();
    if (wd === 0 || wd === 6) continue;
    const win = d % 3 !== 0;
    trades.push(trade({ id: `t${d}`, date: local(at - 3 * 3_600_000), exitDate: local(at - 2 * 3_600_000), exit: win ? 102 : 99, psych: { stress: win ? 2 : 4 } }));
    if (wd === 3) {
      trades.push(trade({ id: `l${d}`, date: local(at - 90 * MIN), exitDate: local(at - 60 * MIN), exit: 99 }));
      trades.push(trade({ id: `r${d}`, date: local(at - 45 * MIN), exitDate: local(at - 30 * MIN), exit: 98.8, emotion: "Revenge", followedPlan: false }));
    }
    days[key(at)] = { note: "", updatedAt: "", mood: win ? 4 : 2, checkin: { stress: win ? 2 : 4, energy: 4, sleep: win ? 8 : 5.5, emotions: win ? ["Fokussiert"] : ["Gereizt"], habits: { h_move: true } } } as DayNote;
  }
  trades.push(trade({ id: "u1", date: local(now - 30 * 3_600_000), exitDate: local(now - 29 * 3_600_000), notes: "" }));
  trades.push(trade({ id: "live", status: "open", date: local(now - 60 * MIN), exit: null, notes: "" }));
  if (opts.pause) {
    trades.push(trade({ id: "p1", date: local(now - 40 * MIN), exitDate: local(now - 20 * MIN), exit: 99, size: 2000 }));
    trades.push(trade({ id: "p2", date: local(now - 15 * MIN), exitDate: local(now - 5 * MIN), exit: 99, size: 2000 }));
  }
  const created = new Date(now - 40 * DAY).toISOString();
  const settings = {
    ...useJournal.getState().settings,
    growth: {
      goals: [
        { id: "g_rev", title: "Jeden Trade reviewen", kind: "process", metric: "journalRate", target: 0.6, comparator: "atLeast", period: "week", source: { kind: "coach" }, createdAt: created, status: "active", hold: opts.reached ? 2 : 12 },
        { id: "g_revenge", title: "Kein Revenge-Trade", kind: "process", metric: "behavior", scope: { behavior: "revenge" }, target: 0, comparator: "atMost", period: "week", source: { kind: "user" }, createdAt: created, status: "active" },
      ],
      challenges: [{ id: "c_stop", template: "stop14", title: "Stop immer", start: key(now - 3 * DAY), createdAt: new Date(now - 3 * DAY).toISOString(), status: "active" }],
      habits: [
        { id: "auto:checkin", title: "Täglicher Check-in", auto: "checkin", createdAt: created },
        { id: "h_move", title: "Bewegung", createdAt: created },
      ],
    },
  } as unknown as Settings;
  return { trades, days, settings };
}

async function load(s: Seed | null) {
  await act(async () => {
    const st = useJournal.getState();
    await st.replaceAll(s ? { trades: s.trades, settings: s.settings, hyblock: [], days: s.days } : { trades: [], settings: st.settings, hyblock: [], days: {} });
  });
}

function renderPage() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <WachstumView />
        <PostTradeReviewHost />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

// "now" at midday (`Date` only, flowing): the seed's "today" – the pause's losses 20 and 5 min ago – is today at any
// hour the suite runs (CI: UTC; at 00:10 the first loss fell on yesterday: "1 Verlust" instead of "2 Verluste in Folge")
beforeEach(pinMidday);
afterEach(() => vi.useRealTimers());

describe("WachstumView", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    localStorage.clear();
    await bootFixtureJournal();
    __resetTransitions();
    useRiskGuardStore.setState({ marks: {}, override: null });
    useGrowthUi.setState({ checkinOpen: false, goalOpen: false, reviewId: null, queue: [], skipped: [], wipe: null, reviewAuto: true, pretrade: { day: "", ticked: {} }, seen: { init: false, streaks: {}, bests: {}, skills: {} }, levelUp: null, newBests: [] });
  });
  afterEach(() => useUi.setState({ editor: { open: false, fromFab: false }, detail: { id: null, source: null } }));

  it("leeres Journal: h1, Abschnitte und ehrliche Leerzustände", async () => {
    await load(null);
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Wachstum" })).toBeInTheDocument();
    for (const t of ["Heute", "Serien", "Ziele", "Challenges & Gewohnheiten", "Psyche", "Fortschritt"]) expect(screen.getByRole("heading", { level: 2, name: t })).toBeInTheDocument();
    expect(screen.getByTestId("growth-checkin")).toHaveAttribute("data-has", "0");
    expect(screen.getByTestId("growth-reviews")).toHaveAttribute("data-open", "0");
    expect(screen.getByTestId("growth-goals")).toHaveAttribute("data-n", "0");
    expect(screen.getByTestId("tracker-quiet")).toBeInTheDocument();
    expect(screen.getByTestId("mood-empty")).toBeInTheDocument();
    expect(screen.getByTestId("growth-skills")).toHaveAttribute("data-level", "0");
    expect(screen.getByTestId("growth-diary")).toHaveAttribute("data-n", "0");
    expect(screen.getByTestId("challenge-done")).toHaveAttribute("data-n", "0");
  });

  it("gefülltes Journal: Serien, Ziele, Tracker, Tagebuch, Skills, Bestleistungen", async () => {
    await load(seed(Date.now()));
    renderPage();
    const streaks = screen.getByTestId("growth-streaks");
    for (const k of ["journal", "checkin", "green", "discipline"]) expect(within(streaks).getByTestId(`streak-${k}`)).toBeInTheDocument();
    expect(Number(within(streaks).getByTestId("streak-checkin").getAttribute("data-best"))).toBeGreaterThan(3);
    expect(screen.getAllByTestId("goal-card")).toHaveLength(2);
    expect(screen.getByTestId("growth-trackers")).toHaveAttribute("data-top", "revenge");
    expect(screen.getByTestId("growth-reviews")).toHaveAttribute("data-open", "1");
    expect(screen.getByTestId("growth-diary")).not.toHaveAttribute("data-n", "0");
    expect(screen.getByTestId("growth-skills")).not.toHaveAttribute("data-level", "0");
    expect(screen.getAllByTestId("best").length).toBeGreaterThan(0);
    expect(screen.getByTestId("growth-mood")).not.toHaveAttribute("data-factor", "");
    expect(screen.getAllByTestId("habit-row")).toHaveLength(2);
    expect(screen.getAllByTestId("challenge-running")).toHaveLength(1);
  });

  it("Check-in: Stimmung, Regler per Tastatur, Wort → Tagesjournal; Checkliste → Bereit", async () => {
    await load(seed(Date.now()));
    renderPage();
    fireEvent.click(screen.getByTestId("wachstum-checkin"));
    const sheet = await screen.findByTestId("checkin-sheet");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Gut" }));
    const stress = within(sheet).getByTestId("ci-stress");
    fireEvent.keyDown(stress, { key: "Home" });
    fireEvent.keyDown(stress, { key: "ArrowRight" });
    expect(stress).toHaveAttribute("aria-valuenow", "2");
    fireEvent.keyDown(within(sheet).getByTestId("ci-energy"), { key: "End" });
    const sleep = within(sheet).getByTestId("ci-sleep");
    fireEvent.keyDown(sleep, { key: "End" });
    fireEvent.keyDown(sleep, { key: "PageDown" });
    expect(sleep).toHaveAttribute("aria-valuetext", "11 h");
    fireEvent.click(within(within(sheet).getByTestId("checkin-emotions")).getByRole("button", { name: "Fokussiert" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-save"));
    });
    const today = useJournal.getState().days[key(Date.now())];
    expect(today?.mood).toBe(4);
    expect(checkinOf(today)).toMatchObject({ stress: 2, energy: 5, sleep: 11, emotions: ["Fokussiert"] });
    await waitFor(() => expect(screen.getByTestId("growth-checkin")).toHaveAttribute("data-has", "1"));
    // the sheet has left (the page behind it is isolated while a dialog is open) …
    await waitFor(() => expect(screen.queryByTestId("checkin-sheet")).toBeNull(), { timeout: 3000 });
    // … and has released the page: the session ends in a passive effect of the exit's commit, which React's scheduler
    // may run one task after the commit that removed the sheet – on a loaded runner after the wait above resolved
    // (CI: "Unable to find an accessible element with the role checkbox")
    const ready = screen.getByTestId("growth-ready");
    await waitFor(() => expect(ready.closest(UNREACHABLE_SELECTOR)).toBeNull());
    for (const box of within(within(ready).getByTestId("growth-ready-checklist")).getAllByRole("checkbox")) fireEvent.click(box);
    await waitFor(() => expect(ready).toHaveAttribute("data-state", "ready"));
    expect(within(ready).getByTestId("growth-ready-label")).toHaveTextContent("Bereit");
  });

  it("Pause: zwei Verluste gerade geschlossen → die P05-Pause stoppt den Bereitschafts-Check", async () => {
    await load(seed(Date.now(), { pause: true }));
    renderPage();
    const ready = screen.getByTestId("growth-ready");
    expect(ready).toHaveAttribute("data-state", "pause");
    expect(within(ready).getByTestId("growth-ready-reasons")).toHaveTextContent("2 Verluste in Folge");
    // "Limit überschreiben" (P05 guard) turns the pause into a warning – the tilt pattern of today stays a stop
    act(() => useRiskGuardStore.getState().overrideUntil(Date.now() + 3_600_000));
    await waitFor(() => expect(within(ready).getByTestId("growth-ready-reasons")).toHaveTextContent("Pause überschrieben"));
    expect(within(ready).getByTestId("growth-ready-reasons")).not.toHaveTextContent("Pause bis");
    expect(within(ready).getByTestId("growth-ready-reasons")).toHaveTextContent("Tilt");
  });

  it("Ziel aus Vorlage anlegen und entfernen", async () => {
    await load(seed(Date.now()));
    renderPage();
    fireEvent.click(screen.getByTestId("goal-add"));
    const sheet = await screen.findByTestId("goal-sheet");
    fireEvent.click(within(within(sheet).getByTestId("goal-templates")).getByRole("button", { name: /Kein Regelverstoß/ }));
    expect(within(sheet).getByTestId("goal-title")).toHaveValue("Kein Regelverstoß");
    await act(async () => {
      fireEvent.click(screen.getByTestId("goal-save"));
    });
    await waitFor(() => expect(screen.getAllByTestId("goal-card")).toHaveLength(3));
    const g = growthOf(useJournal.getState().settings).goals.find((x) => x.title === "Kein Regelverstoß")!;
    expect(g).toMatchObject({ metric: "ruleBreaks", comparator: "atMost", target: 0, status: "active", source: { kind: "user" } });
    const card = screen.getAllByTestId("goal-card").find((c) => c.getAttribute("data-goal") === g.id)!;
    fireEvent.click(within(card).getByTestId("goal-drop"));
    await act(async () => {
      fireEvent.click(within(card).getByTestId("goal-drop-yes"));
    });
    await waitFor(() => expect(screen.getAllByTestId("goal-card")).toHaveLength(2));
    expect(growthOf(useJournal.getState().settings).goals.find((x) => x.id === g.id)!.status).toBe("dropped");
  });

  it("Challenge-Deck: ziehen, andere Karte, annehmen", async () => {
    await load(seed(Date.now()));
    renderPage();
    fireEvent.click(screen.getByTestId("challenge-draw"));
    const drawn = await screen.findByTestId("challenge-drawn", undefined, { timeout: 3000 });
    expect(drawn).toHaveTextContent("Ruhige Hand");
    fireEvent.click(screen.getByTestId("challenge-other"));
    await waitFor(() => expect(screen.getByTestId("challenge-drawn")).not.toHaveTextContent("Ruhige Hand"), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(screen.getByTestId("challenge-accept"));
    });
    await waitFor(() => expect(screen.getAllByTestId("challenge-running")).toHaveLength(2));
    expect(growthOf(useJournal.getState().settings).challenges.filter((c) => c.status === "active")).toHaveLength(2);
  });

  it("Gewohnheit anlegen und heute abhaken", async () => {
    await load(seed(Date.now()));
    renderPage();
    fireEvent.click(screen.getByTestId("habit-add"));
    fireEvent.change(screen.getByTestId("habit-input"), { target: { value: "Atemübung" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("habit-save"));
    });
    const row = await waitFor(() => screen.getAllByTestId("habit-row").find((r) => r.textContent?.includes("Atemübung"))!);
    const id = row.getAttribute("data-habit")!;
    await act(async () => {
      fireEvent.click(within(row).getByTestId("habit-today"));
    });
    expect(checkinOf(useJournal.getState().days[key(Date.now())])?.habits[id]).toBe(true);
  });

  it("Post-Trade-Review: manuell und automatisch nach dem Schließen", async () => {
    await load(seed(Date.now()));
    renderPage();
    fireEvent.click(screen.getByTestId("growth-review-open"));
    const review = await screen.findByTestId("post-trade-review");
    expect(review).toHaveAttribute("data-trade", "u1");
    fireEvent.change(within(review).getByTestId("post-trade-note"), { target: { value: "Geduldig gewartet." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("post-trade-save"));
    });
    expect(useJournal.getState().trades.find((t) => t.id === "u1")!.psych?.postNote).toBe("Geduldig gewartet.");
    await waitFor(() => expect(screen.getByTestId("growth-reviews")).toHaveAttribute("data-open", "0"));

    // a real closing save → the host asks by itself
    const live = useJournal.getState().trades.find((t) => t.id === "live")!;
    await act(async () => {
      await useJournal.getState().saveTrade({ ...live, status: "closed", exit: 102, updatedAt: new Date().toISOString() });
    });
    await waitFor(() => expect(screen.getByTestId("post-trade-review")).toHaveAttribute("data-trade", "live"), { timeout: 4000 });
    fireEvent.click(screen.getByTestId("post-trade-later"));
    expect(useGrowthUi.getState().skipped).toContain("live");
  });

  it("die Review-Sheet erscheint nur einmal, auch mit zwei Instanzen", async () => {
    await load(seed(Date.now()));
    render(
      <MotionRoot>
        <PostTradeReviewSheet />
        <PostTradeReviewSheet />
      </MotionRoot>,
    );
    act(() => useGrowthUi.getState().openReview("u1"));
    await waitFor(() => expect(screen.getAllByTestId("post-trade-review")).toHaveLength(1));
  });

  it("erreichtes Ziel → Status done + Wipe „Ziel erreicht“", async () => {
    await load(seed(Date.now(), { reached: true }));
    renderPage();
    await waitFor(() => expect(growthOf(useJournal.getState().settings).goals.find((g) => g.id === "g_rev")!.status).toBe("done"));
    expect(useGrowthUi.getState().wipe?.titles).toEqual(["Jeden Trade reviewen"]);
    expect(await screen.findByTestId("goal-wipe")).toHaveTextContent("2 Wochen in Folge gehalten");
  });

  it("addGoalFromDraft (Wave 0) schreibt über den echten Journal-Store", async () => {
    await load(seed(Date.now()));
    const g = await addGoalFromDraft({ title: "Nach Plan traden", kind: "process", metric: "planAdherence", target: 0.9, comparator: "atLeast", period: "week", source: { kind: "coach", ref: "plan" } });
    expect(g).not.toBeNull();
    expect(growthOf(useJournal.getState().settings).goals.map((x) => x.title)).toContain("Nach Plan traden");
    // the same measurement again (the coach's journaling goal is already active) → the existing goal, no duplicate
    const dup = await addGoalFromDraft({ title: "Jeden Trade mit Review abschließen", kind: "process", metric: "journalRate", target: 0.9, comparator: "atLeast", period: "week", source: { kind: "coach", ref: "journal" } });
    expect(dup!.id).toBe("g_rev");
    // the journal store persisted it (local adapter)
    expect(JSON.parse(localStorage.getItem("tj2-settings")!).growth.goals.some((x: { id: string }) => x.id === g!.id)).toBe(true);
  });

  it("Cockpit-Widgets rendern ohne Props", async () => {
    await load(seed(Date.now()));
    for (const w of WACHSTUM_WIDGETS) {
      const C = w.component;
      const { unmount } = render(
        <MotionRoot>
          <C />
        </MotionRoot>,
      );
      unmount();
    }
    expect(WACHSTUM_WIDGETS.map((w) => w.id)).toEqual(["growth-checkin", "growth-ready", "growth-streaks"]);
  });
});
