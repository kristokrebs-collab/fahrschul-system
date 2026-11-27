/**
 * F61 daily check-in on the real journal store with an injected clock: the dialog at the first open of the day
 * (`DailyCheckinHost`), "Später" / "Heute überspringen" / "Erledigt", no second prompt on the same day (the outcome is in
 * the synced day entry – a second device that has synced sees it), the next local day asks again (also across midnight and
 * a clock change), never over an editor / before sync / before the tour, a late fill marked "nachgetragen", the settings
 * (fields, own question, reminder, zone) and the evaluation card with its disclaimer.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { patchSyncStatus, resetSyncStatus } from "@/cloud/sync/status";
import { checkinConfigOf, dayKeyIn, deviceTimeZone } from "@/domain/checkin";
import { checkinOf, checkinRawOf, checkinStatusOf, hasCheckin } from "@/domain/psych";
import { defaultSettings } from "@/domain/defaults";
import { enrichTrades } from "@/domain/enrich";
import type { DayNote, DayNotes, Settings } from "@/domain/types";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { CheckInCard, CheckInInsights, DailyCheckinHost, DAILY, resetSnooze, setCheckinClock, setDevicePrompt, useGrowthUi } from "@/views/wachstum";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { mkTrade } from "./domain.fixtures";

const TZ = deviceTimeZone();
/** a Monday morning, local wall clock of the runner */
const T0 = new Date(2026, 9, 12, 8, 0).getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;
const key = (ms: number): string => dayKeyIn(ms, TZ);

let clock = T0;
const mount = (props: { graceMs?: number } = {}) =>
  render(
    <MotionRoot>
      <MorphDialogProvider>
        <DailyCheckinHost now={() => clock} everyMs={25} graceMs={props.graceMs ?? 100} />
      </MorphDialogProvider>
    </MotionRoot>,
  );
const sheet = () => screen.queryByTestId("checkin-sheet");
const today = () => useJournal.getState().days[key(clock)];

async function load(days: DayNotes = {}, settings?: Settings) {
  await act(async () => {
    const st = useJournal.getState();
    await st.replaceAll({ trades: st.trades, settings: settings ?? st.settings, hyblock: [], days });
  });
}
const answered = (k: string, extra: Record<string, unknown> = {}): DayNotes => ({ [k]: { note: "", updatedAt: "", checkin: { stress: 2, emotions: [], habits: {}, status: "done", ...extra } } as unknown as DayNote });

describe("Täglicher Check-in", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    localStorage.clear();
    clock = T0;
    setCheckinClock(() => clock);
    await bootFixtureJournal();
    resetSnooze();
    setDevicePrompt(true);
    resetSyncStatus();
    useGrowthUi.setState({ checkinOpen: false, checkinDay: null, checkinDaily: false, goalOpen: false, reviewId: null });
  });
  afterEach(() => {
    setCheckinClock(null);
    useUi.setState({ editor: { open: false, fromFab: false }, detail: { id: null, source: null } });
  });

  it("beim ersten Öffnen des Tages fragt der Dialog – mit Später, Heute überspringen und Erledigt", async () => {
    mount();
    const s = await screen.findByTestId("checkin-sheet");
    expect(s).toHaveAttribute("data-daily", "1");
    expect(screen.getByTestId("checkin-later")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-skip")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-done")).toBeInTheDocument();
    // nothing is pre-filled: every value starts unset
    expect(within(s).getByTestId("ci-stress")).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByTestId("checkin-clear")).toBeNull();
    expect(useGrowthUi.getState().checkinDay).toBe(key(T0));
  });

  it("Erledigt schreibt den Tag (Status, firstAt, editedAt) – danach fragt kein Gerät mehr, der nächste Tag fragt wieder", async () => {
    const { unmount } = mount();
    const s = await screen.findByTestId("checkin-sheet");
    const stress = within(s).getByTestId("ci-stress");
    fireEvent.keyDown(stress, { key: "Home" });
    fireEvent.keyDown(stress, { key: "ArrowRight" });
    const focus = within(s).getByTestId("ci-focus");
    fireEvent.keyDown(focus, { key: "End" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-done"));
    });
    const raw = checkinRawOf(today())!;
    expect(raw).toMatchObject({ status: "done", stress: 2, focus: 5 });
    expect(raw.firstAt).toBe(new Date(T0).toISOString());
    expect(raw.editedAt).toBe(raw.firstAt);
    expect(raw.late).toBeUndefined();
    expect(checkinOf(today())).not.toBeNull();
    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 3000 });

    // "second device": a fresh mount over the same synced journal asks nothing the same day …
    unmount();
    clock = T0 + 10 * HOUR;
    mount();
    await new Promise((r) => setTimeout(r, 150));
    expect(sheet()).toBeNull();
    // … and 23:59 is still the same day
    clock = new Date(2026, 9, 12, 23, 59).getTime();
    await new Promise((r) => setTimeout(r, 100));
    expect(sheet()).toBeNull();
    // the next local day asks again
    clock = new Date(2026, 9, 13, 0, 1).getTime();
    expect(await screen.findByTestId("checkin-sheet", {}, { timeout: 3000 })).toHaveAttribute("data-daily", "1");
    expect(useGrowthUi.getState().checkinDay).toBe("2026-10-13");
  });

  it("Heute überspringen: der Tag ist erledigt, aber kein Check-in und kein guter Zustand", async () => {
    mount();
    await screen.findByTestId("checkin-sheet");
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-skip"));
    });
    expect(checkinStatusOf(today())).toBe("skipped");
    expect(hasCheckin(today())).toBe(false);
    expect(checkinOf(today())).toBeNull();
    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 120));
    expect(sheet()).toBeNull();
    // the Wachstum card says it plainly
    render(
      <MotionRoot>
        <CheckInCard today={{ key: key(clock), note: today(), checkin: null, mood: null, unreviewed: [], week: [] }} />
      </MotionRoot>,
    );
    expect(screen.getByTestId("growth-checkin")).toHaveAttribute("data-skipped", "1");
    expect(screen.getByTestId("growth-checkin")).toHaveAttribute("data-has", "0");
    expect(screen.getByText(DAILY.skippedNote)).toBeInTheDocument();
  });

  it("Später: dieses Gerät fragt erst nach zwei Stunden wieder, der Tag bleibt offen", async () => {
    mount();
    await screen.findByTestId("checkin-sheet");
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-later"));
    });
    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 3000 });
    expect(checkinStatusOf(today())).toBeNull();
    clock = T0 + HOUR;
    await new Promise((r) => setTimeout(r, 120));
    expect(sheet()).toBeNull();
    clock = T0 + 2 * HOUR + 1000;
    expect(await screen.findByTestId("checkin-sheet", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("Später bis zur Erinnerungszeit, wenn eine gesetzt ist", async () => {
    const st = useJournal.getState();
    await act(async () => {
      await st.saveSettings({ ...st.settings, checkin: { v: 1, reminder: "13:00", timeZone: TZ } } as unknown as Settings);
    });
    mount();
    await screen.findByTestId("checkin-sheet");
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-later"));
    });
    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 3000 });
    clock = new Date(2026, 9, 12, 12, 59).getTime();
    await new Promise((r) => setTimeout(r, 120));
    expect(sheet()).toBeNull();
    clock = new Date(2026, 9, 12, 13, 0, 5).getTime();
    expect(await screen.findByTestId("checkin-sheet", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("fragt nicht vor dem Sync (Cloud-Login), nicht über einem Editor und nicht, wenn der Nutzer es abgeschaltet hat", async () => {
    patchSyncStatus({ phase: "syncing" });
    mount({ graceMs: 600 });
    await new Promise((r) => setTimeout(r, 200));
    expect(sheet()).toBeNull();
    // the first sync lands with today's answer from the other device: nothing is ever asked
    await load(answered(key(T0)));
    act(() => patchSyncStatus({ phase: "live" }));
    await new Promise((r) => setTimeout(r, 150));
    expect(sheet()).toBeNull();
  });

  it("wartet höchstens die Gnadenfrist auf den Sync, dann fragt es", async () => {
    patchSyncStatus({ phase: "connecting" });
    mount({ graceMs: 250 });
    await new Promise((r) => setTimeout(r, 120));
    expect(sheet()).toBeNull();
    expect(await screen.findByTestId("checkin-sheet", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("nie über einem offenen Editor: erst nach dem Schließen", async () => {
    act(() => useUi.getState().openEditor({ fromFab: false }));
    mount();
    await new Promise((r) => setTimeout(r, 150));
    expect(sheet()).toBeNull();
    act(() => useUi.getState().closeEditor());
    expect(await screen.findByTestId("checkin-sheet", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("abgeschaltet (Konto oder dieses Gerät): keine Frage", async () => {
    setDevicePrompt(false);
    mount();
    await new Promise((r) => setTimeout(r, 150));
    expect(sheet()).toBeNull();
    setDevicePrompt(true);
    const st = useJournal.getState();
    await act(async () => {
      await st.saveSettings({ ...st.settings, checkin: { v: 1, prompt: false } } as unknown as Settings);
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(sheet()).toBeNull();
  });

  it("antwortet ein anderes Gerät, während der Dialog offen und unberührt ist, schließt er leise", async () => {
    mount();
    await screen.findByTestId("checkin-sheet");
    await load(answered(key(T0)));
    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 3000 });
  });

  it("zeigt nur die eingeschalteten Felder; Schalter landen in settings.checkin", async () => {
    mount();
    const s = await screen.findByTestId("checkin-sheet");
    expect(within(s).getByTestId("ci-focus")).toBeInTheDocument();
    for (const t of ["ci-sleepq", "ci-dayrisk", "ci-available", "ci-session", "ci-comment"]) expect(within(s).queryByTestId(t)).toBeNull();
    fireEvent.click(within(s).getByTestId("checkin-customize"));
    const cs = await within(s).findByTestId("checkin-settings");
    await act(async () => {
      fireEvent.click(within(cs).getByTestId("cs-field-dayRisk"));
      fireEvent.click(within(cs).getByTestId("cs-field-comment"));
      fireEvent.click(within(cs).getByTestId("cs-field-focus"));
    });
    expect(checkinConfigOf(useJournal.getState().settings).fields).toMatchObject({ dayRisk: true, comment: true, focus: false });
    await waitFor(() => expect(within(s).queryByTestId("ci-focus")).toBeNull());
    expect(within(s).getByTestId("ci-dayrisk")).toBeInTheDocument();
    fireEvent.change(within(s).getByTestId("ci-comment"), { target: { value: "Fokus auf Plan" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-done"));
    });
    expect(checkinOf(today())).toMatchObject({ comment: "Fokus auf Plan" });
  }, 30_000);

  it("eigene Frage mit Skala: anlegen, beantworten, in der Tagesnotiz gespeichert", async () => {
    mount();
    const s = await screen.findByTestId("checkin-sheet");
    fireEvent.click(within(s).getByTestId("checkin-customize"));
    const cs = await within(s).findByTestId("checkin-settings");
    fireEvent.change(within(cs).getByTestId("cs-q-label"), { target: { value: "Plan gelesen?" } });
    await act(async () => {
      fireEvent.click(within(cs).getByTestId("cs-q-add"));
    });
    const q = checkinConfigOf(useJournal.getState().settings).custom[0]!;
    expect(q).toMatchObject({ label: "Plan gelesen?", max: 5, on: true });
    const slider = await within(s).findByTestId(`ci-q-${q.id}`, {}, { timeout: 5000 });
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "5");
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-done"));
    });
    expect(checkinOf(today())).toMatchObject({ custom: { [q.id]: 5 } });
  }, 30_000);

  it("Zeitzone und Erinnerung werden in settings.checkin gespeichert", async () => {
    mount();
    const s = await screen.findByTestId("checkin-sheet");
    fireEvent.click(within(s).getByTestId("checkin-customize"));
    const cs = await within(s).findByTestId("checkin-settings");
    await act(async () => {
      fireEvent.change(within(cs).getByTestId("cs-reminder"), { target: { value: "07:30" } });
      fireEvent.change(within(cs).getByTestId("cs-timezone"), { target: { value: "Asia/Tokyo" } });
    });
    expect(checkinConfigOf(useJournal.getState().settings)).toMatchObject({ reminder: "07:30", timeZone: "Asia/Tokyo" });
  }, 30_000);

  it("nachgetragen: ein früherer Tag wird markiert und gespeichert, aber nie als beim Einstieg bekannt", async () => {
    mount();
    await screen.findByTestId("checkin-sheet");
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-skip"));
    });
    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 3000 });
    const yesterday = key(T0 - DAY);
    act(() => useGrowthUi.getState().openCheckin(yesterday));
    const s = await screen.findByTestId("checkin-sheet");
    expect(s).toHaveAttribute("data-late", "1");
    expect(within(s).getByTestId("checkin-late")).toHaveTextContent("nachgetragen");
    fireEvent.keyDown(within(s).getByTestId("ci-stress"), { key: "End" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("checkin-save"));
    });
    const raw = checkinRawOf(useJournal.getState().days[yesterday])!;
    expect(raw).toMatchObject({ stress: 5, late: true, status: "done" });
  });
});

describe("Check-in und Handelstag (Karte)", () => {
  beforeAll(() => installDomPolyfills());

  function seed(n: number) {
    const days: DayNotes = {};
    const trades = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(2026, 8, 1 + i, 0, 0).getTime();
      const stress = ((i % 5) + 1) as number;
      const at = new Date(d + 7 * HOUR).toISOString();
      days[dayKeyIn(d, TZ)] = { note: "", updatedAt: "", mood: 3, checkin: { stress, energy: 6 - stress, emotions: [], habits: {}, status: "done", firstAt: at, editedAt: at, at } } as unknown as DayNote;
      for (let k = 0; k < 2; k++) {
        const start = d + (9 + k) * HOUR;
        const iso = (ms: number) => {
          const x = new Date(ms);
          const p = (v: number) => String(v).padStart(2, "0");
          return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
        };
        trades.push(mkTrade({ id: `t${i}${k}`, date: iso(start), exitDate: iso(start + 600_000), entry: 100, stop: 99, exit: stress <= 2 ? 102 : 99, followedPlan: stress <= 2, status: "closed", r: stress <= 2 ? 2 : -1 }));
      }
    }
    return { days, trades: enrichTrades(trades, defaultSettings()) };
  }

  it("zu wenig Tage: sagt es, rechnet nicht; mit Stichprobe: ρ, Tage und der Hinweis „keine Diagnose, keine Kausalität“", () => {
    const few = seed(4);
    const { unmount } = render(
      <MotionRoot>
        <CheckInInsights days={few.days} trades={few.trades} settings={defaultSettings()} />
      </MotionRoot>,
    );
    expect(screen.getByTestId("insights-too-little")).toHaveTextContent("Zu wenig Daten: 4 von 8 Tagen");
    expect(screen.queryByTestId("insights-matrix")).toBeNull();
    expect(screen.getByTestId("insights-disclaimer")).toHaveTextContent("Keine Diagnose, keine Kausalität");
    unmount();

    const many = seed(15);
    render(
      <MotionRoot>
        <CheckInInsights days={many.days} trades={many.trades} settings={defaultSettings()} />
      </MotionRoot>,
    );
    expect(screen.getByTestId("insights-sample")).toHaveTextContent("15 Tage mit 30 Trades");
    expect(screen.getByTestId("insights-sample")).toHaveTextContent("nur Trades nach dem Check-in");
    const matrix = screen.getByTestId("insights-matrix");
    expect(within(matrix).getAllByRole("row").length).toBeGreaterThan(2);
    expect(screen.getByTestId("insights-lines").textContent).toMatch(/ρ [−-]?\d,\d\d, 15 Tage/);
    expect(screen.getByTestId("insights-disclaimer")).toHaveTextContent("Keine Diagnose, keine Kausalität");
  });

  it("ein Journal ohne Check-in: leer, ehrlich, ohne Zahl", () => {
    render(
      <MotionRoot>
        <CheckInInsights days={{}} trades={[]} settings={defaultSettings()} />
      </MotionRoot>,
    );
    expect(screen.getByTestId("insights-empty")).toHaveTextContent("Noch kein Check-in mit Trades danach");
    expect(screen.queryByTestId("insights-matrix")).toBeNull();
    expect(screen.getByTestId("growth-checkin-insights")).toHaveAttribute("data-used", "0");
  });
});
