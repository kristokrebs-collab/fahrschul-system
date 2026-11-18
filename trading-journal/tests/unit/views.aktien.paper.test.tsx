/**
 * C1: the way from a green industry to one paper position, with the Zeitmaschine in between – the store (candles and the simulation
 * are fakes, the simulation is REAL arithmetic on a small run) and the card. Fresh signal → check → rules → ONE position with
 * signalId / simulationId / tradeId (the saved simulation points back at the position); a double signal, a second click, an old
 * signal, a red signal, the Not-Aus, a source that is down. Nothing is sent: no network is touched.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_PARAMS, strategyId } from "@/domain/industryTrend";
import { positionIdOf, signalIdOf, signalOfRow, type TrendSignal } from "@/domain/industryTrend/paper";
import { runTimeMachineSync } from "@/domain/timemachine";
import { MotionRoot } from "@/motion/MotionRoot";
import { createSimulationStore, idbSimStorage, type SimulationStore } from "@/views/timemachine/simStore";
import { setSimulationsForTests } from "@/views/timemachine/simulations";
import type { TimeMachineCandle } from "@/views/timemachine/types";
import { PaperCard } from "@/views/aktien/branchen/PaperCard";
import { resetPaperForTests, setPaperDepsForTests, usePaper } from "@/views/aktien/branchen/paperStore";
import { useBranchen } from "@/views/aktien/branchen/store";
import { latticeBars } from "./timemachine.helpers";
import { installDomPolyfills } from "./views.overview.harness";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const ymd = (ms: number): number => Number(new Date(ms).toISOString().slice(0, 10).replace(/-/g, ""));
const STRAT = strategyId(BASE_PARAMS);

/** 300 daily candles of a lattice market, the last closed this morning. */
const candles = (): TimeMachineCandle[] => {
  const lastT = Math.floor(NOW / DAY) * 86_400 - 86_400;
  return latticeBars(300, 0.5, 86_400, lastT - 299 * 86_400).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, closed: true }));
};
const LAST_CLOSE = candles()[299]!.close;

let sims: SimulationStore;
const loadBars = vi.fn();
const runSim = vi.fn();

beforeAll(() => installDomPolyfills());
beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  sims = createSimulationStore(idbSimStorage("tj2-test-paper")!);
  setSimulationsForTests(sims);
  loadBars.mockReset().mockImplementation(async () => ({ ok: true, candles: candles(), fetchedAt: NOW, sourceLabel: "Testquelle" }));
  runSim.mockReset().mockImplementation(async (input, _signal, onProgress: (p: number) => void) => {
    onProgress(0.5);
    // real arithmetic, a small run: enough sessions to pass the gate (≥ 1 000)
    return runTimeMachineSync({ ...input, runs: 1000 });
  });
  setPaperDepsForTests({ now: () => NOW, loadBars, runSim, sims: () => sims });
  resetPaperForTests();
});
afterEach(() => {
  cleanup();
  setPaperDepsForTests(null);
  setSimulationsForTests(null);
  resetPaperForTests();
  useBranchen.setState({ ampel: null });
});

const green = (over: Partial<TrendSignal> = {}): TrendSignal => {
  const base = { branche: "Food", state: "gruen" as const, datum: "20260901", asOf: String(ymd(NOW - DAY)), source: "tradingview" as const, strategie: STRAT, ...over };
  return { ...base, signalId: signalIdOf(base) };
};
const done = async (s: TrendSignal) => waitFor(() => expect(usePaper.getState().checks[s.signalId]?.status).toBe("done"), { timeout: 30_000 });
const decision = (s: TrendSignal) => usePaper.getState().checks[s.signalId]!.decision!;
const failedRules = (s: TrendSignal) => decision(s).checks.filter((c) => !c.ok).map((c) => c.id);

describe("Prüfung und Eröffnung (Store)", () => {
  it("frisches grünes Signal: Kerzen → Zeitmaschine → Regeln → genau eine Position mit signalId, simulationId, tradeId – die gespeicherte Simulation zeigt auf die Position", async () => {
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    expect(failedRules(s)).toEqual([]);
    expect(decision(s).ok).toBe(true);
    expect(loadBars).toHaveBeenCalledTimes(1);
    expect(loadBars.mock.calls[0]![0]).toBe("PBJ");
    expect(runSim).toHaveBeenCalledTimes(1);
    // the plan the Zeitmaschine played: long, entry = last close, stop under it, target above it, 20 days
    const input = runSim.mock.calls[0]![0] as { plan: { side: string; entry: number; stop: number; target: number }; horizon: number; symbol: string };
    expect(input).toMatchObject({ symbol: "PBJ", horizon: 20, plan: { side: "long" } });
    expect(input.plan.entry).toBeCloseTo(LAST_CLOSE, 3);
    expect(input.plan.stop).toBeLessThan(input.plan.entry);
    expect(input.plan.target).toBeGreaterThan(input.plan.entry);

    expect(usePaper.getState().openFrom(s)).toBe("opened");
    const book = usePaper.getState().book;
    expect(book.positions).toHaveLength(1);
    const p = book.positions[0]!;
    expect(p).toMatchObject({ signalId: s.signalId, tradeId: positionIdOf(s.signalId), id: positionIdOf(s.signalId), side: "long", status: "open", symbol: "PBJ", modus: "PAPIER", gesendet: false });
    expect(p.simulationId).toMatch(/^sim_/);
    // the saved simulation knows the position: same id, same trade
    const rec = await sims.forTrade(p.tradeId);
    expect(rec?.simulationId).toBe(p.simulationId);
    expect(rec?.tradeId).toBe(p.tradeId);
    expect(rec?.symbol).toBe("PBJ");
    expect(rec?.plan).toMatchObject({ side: "long", entry: p.entry, stop: p.stop, target: p.target });
    // persisted on this device
    const stored = JSON.parse(localStorage.getItem("tj2-branchen-paper")!);
    expect(stored.positions).toHaveLength(1);
  });

  it("derselbe Knopf zweimal, schnell hintereinander: eine Position (Doppelklick)", async () => {
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    const results = [usePaper.getState().openFrom(s), usePaper.getState().openFrom(s), usePaper.getState().openFrom(s)];
    expect(results).toEqual(["opened", "duplicate", "duplicate"]);
    expect(usePaper.getState().book.positions).toHaveLength(1);
    expect(usePaper.getState().note).toMatch(/keine zweite/);
  });

  it("dasselbe Signal noch einmal geprüft (z. B. von TradingView ein zweites Mal): keine Daten geladen, nichts simuliert, keine zweite Position", async () => {
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    usePaper.getState().openFrom(s);
    loadBars.mockClear();
    runSim.mockClear();
    const again = green(); // an identical delivery: the same id
    expect(again.signalId).toBe(s.signalId);
    await act(async () => void usePaper.getState().check(again));
    await done(again);
    expect(failedRules(again)).toContain("doppel");
    expect(loadBars).not.toHaveBeenCalled();
    expect(runSim).not.toHaveBeenCalled();
    expect(usePaper.getState().openFrom(again)).toBe("duplicate");
    expect(usePaper.getState().book.positions).toHaveLength(1);
  });

  it("ein neues grünes Signal derselben Branche, solange die Position offen ist: abgelehnt", async () => {
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    usePaper.getState().openFrom(s);
    const next = green({ datum: "20261105" });
    await act(async () => void usePaper.getState().check(next));
    await done(next);
    // the rule that said no comes first; the ones that need data are marked as not checked (and nothing was fetched for it)
    expect(failedRules(next)[0]).toBe("offen");
    expect(decision(next).checks.find((c) => c.id === "zeitmaschine")!.text).toMatch(/Nicht geprüft/);
    expect(loadBars).toHaveBeenCalledTimes(1);
    expect(usePaper.getState().openFrom(next)).toBe("refused");
    expect(usePaper.getState().book.positions).toHaveLength(1);
  });

  it("ein veraltetes Signal (Datenstand Wochen alt) eröffnet nichts – und es wird nicht einmal geladen oder simuliert", async () => {
    const old = green({ asOf: String(ymd(NOW - 40 * DAY)) });
    await act(async () => void usePaper.getState().check(old));
    await done(old);
    expect(failedRules(old)).toContain("alter");
    expect(decision(old).checks.find((c) => c.id === "alter")!.text).toMatch(/veraltet/);
    expect(decision(old).checks.find((c) => c.id === "zeitmaschine")!.text).toMatch(/Nicht geprüft/);
    expect(loadBars).not.toHaveBeenCalled();
    expect(runSim).not.toHaveBeenCalled();
    expect(usePaper.getState().openFrom(old)).toBe("refused");
    expect(usePaper.getState().book.positions).toHaveLength(0);
    expect(await sims.list()).toHaveLength(0);
  });

  it("Rot ist Cash: ein rotes Signal eröffnet nie eine Position (keine Short-Position)", async () => {
    const red = green({ state: "rot" });
    await act(async () => void usePaper.getState().check(red));
    await done(red);
    expect(failedRules(red)).toContain("gruen");
    expect(usePaper.getState().openFrom(red)).toBe("refused");
    expect(usePaper.getState().book.positions).toHaveLength(0);
    expect(loadBars).not.toHaveBeenCalled();
  });

  it("eine Branche ohne ETF in der Liste: nichts", async () => {
    const s = green({ branche: "Guns" });
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    expect(failedRules(s)).toContain("instrument");
    expect(loadBars).not.toHaveBeenCalled();
    expect(usePaper.getState().openFrom(s)).toBe("refused");
  });

  it("Not-Aus: nichts Neues; die Prüfung muss danach neu laufen; Schließen bleibt möglich", async () => {
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    usePaper.getState().openFrom(s);
    usePaper.getState().setKillSwitch(true);
    expect(usePaper.getState().checks).toEqual({}); // the checks on screen were made under the other setting
    expect(JSON.parse(localStorage.getItem("tj2-branchen-paper")!).killSwitch).toBe(true);
    const next = green({ branche: "Banks" });
    await act(async () => void usePaper.getState().check(next));
    await done(next);
    expect(failedRules(next)).toContain("notaus");
    expect(usePaper.getState().openFrom(next)).toBe("refused");
    expect(usePaper.getState().book.positions).toHaveLength(1);
    // closing is never blocked
    const p = usePaper.getState().book.positions[0]!;
    await act(async () => void (await usePaper.getState().close(p.id, "manuell")));
    expect(usePaper.getState().book.positions[0]!.status).toBe("closed");
    // and switching it off again lets the next one through
    usePaper.getState().setKillSwitch(false);
    await act(async () => void usePaper.getState().check(next));
    await done(next);
    expect(usePaper.getState().openFrom(next)).toBe("opened");
  });

  it("Ausstieg bei Rot: zum letzten Schlusskurs, mit Gewinn in Geld und R, mit dem Rot-Signal als Grund; danach kann dasselbe Signal nicht neu eröffnen", async () => {
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    usePaper.getState().openFrom(s);
    const p = usePaper.getState().book.positions[0]!;
    const red = green({ state: "rot", datum: "20261105" });
    let ok = false;
    await act(async () => void (ok = await usePaper.getState().close(p.id, "rot", red.signalId)));
    expect(ok).toBe(true);
    const c = usePaper.getState().book.positions[0]!;
    expect(c).toMatchObject({ status: "closed", exitReason: "rot", exitSignalId: red.signalId, exit: Math.round(LAST_CLOSE * 1e4) / 1e4 });
    expect(c.pnl).toBeCloseTo((LAST_CLOSE - p.entry) * p.qty, 2);
    expect(c.r).toBeDefined();
    // the first signal is used up: it does not open again
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    expect(failedRules(s)).toContain("doppel");
    expect(usePaper.getState().openFrom(s)).toBe("duplicate");
    expect(usePaper.getState().book.positions).toHaveLength(1);
  });

  it("die Quelle der Kerzen ist down: der Grund steht da, es wird nichts simuliert und nichts eröffnet; schließen sagt ehrlich, dass kein Kurs da ist", async () => {
    loadBars.mockImplementation(async () => ({ ok: false, message: "Yahoo Finance (inoffiziell): Die Quelle verweigert die Abrufe." }));
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    const k = decision(s).checks.find((c) => c.id === "kerzen")!;
    expect(k.ok).toBe(false);
    expect(k.text).toMatch(/verweigert/);
    expect(runSim).not.toHaveBeenCalled();
    expect(usePaper.getState().openFrom(s)).toBe("refused");
    // an open position cannot be closed without a price
    loadBars.mockImplementation(async () => ({ ok: true, candles: candles(), fetchedAt: NOW, sourceLabel: "Testquelle" }));
    const s2 = green({ branche: "Util" });
    await act(async () => void usePaper.getState().check(s2));
    await done(s2);
    usePaper.getState().openFrom(s2);
    loadBars.mockImplementation(async () => ({ ok: false, message: "offline" }));
    const p = usePaper.getState().book.positions[0]!;
    let ok = true;
    await act(async () => void (ok = await usePaper.getState().close(p.id, "manuell")));
    expect(ok).toBe(false);
    expect(usePaper.getState().book.positions[0]!.status).toBe("open");
    expect(usePaper.getState().note).toMatch(/kein Kurs/);
  });

  it("zu alte Kerzen des ETFs: der Kurs ist veraltet – keine Simulation, keine Position", async () => {
    loadBars.mockImplementation(async () => {
      const old = candles().map((c) => ({ ...c, time: c.time - 30 * DAY }));
      return { ok: true, candles: old, fetchedAt: NOW, sourceLabel: "Testquelle" };
    });
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    expect(decision(s).checks.find((c) => c.id === "kerzen")!.text).toMatch(/veraltet/);
    expect(decision(s).checks.find((c) => c.id === "zeitmaschine")!.text).toMatch(/Nicht geprüft/);
    expect(runSim).not.toHaveBeenCalled();
    expect(usePaper.getState().openFrom(s)).toBe("refused");
  });

  it("ein Fehler in der Zeitmaschine wird als Fehler gezeigt, nicht als Zustimmung", async () => {
    runSim.mockRejectedValue(new Error("Nur 12 brauchbare Kerzen (von 300) – mindestens 200 sind nötig."));
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await waitFor(() => expect(usePaper.getState().checks[s.signalId]?.status).toBe("error"), { timeout: 30_000 });
    expect(usePaper.getState().checks[s.signalId]!.message).toMatch(/Nur 12/);
    expect(usePaper.getState().openFrom(s)).toBe("nocheck");
    expect(usePaper.getState().book.positions).toHaveLength(0);
  });

  it("ein Neustart (Store neu lesen) bringt das Buch zurück", async () => {
    const s = green();
    await act(async () => void usePaper.getState().check(s));
    await done(s);
    usePaper.getState().openFrom(s);
    const before = usePaper.getState().book.positions[0]!;
    resetPaperForTests();
    expect(usePaper.getState().book.positions[0]).toEqual(before);
  });
});

describe("Karte", () => {
  const ampelOf = (rows: { code: string; state: "kauf" | "cash"; since: number | null }[]) =>
    useBranchen.setState({
      ampel: {
        asOf: ymd(NOW - DAY),
        days: 5000,
        params: { ...BASE_PARAMS },
        rows: rows.map((r, i) => ({ index: i, code: r.code, name: r.code, state: r.state, since: r.since, daysSince: 10, weight: r.state === "kauf" ? 0.05 : 0 })),
        events: [],
        kauf: 0,
        cash: 0,
        grossWeight: 0,
        capped: false,
      },
    });
  const wrap = () => render(<MotionRoot><PaperCard /></MotionRoot>);

  it("ohne Ampel: sagt, dass sie fehlt; mit Ampel: nur grüne Branchen mit ETF sind Kandidaten", () => {
    wrap();
    expect(screen.getByTestId("paper-no-ampel")).toBeInTheDocument();
    cleanup();
    ampelOf([
      { code: "Food", state: "kauf", since: 20260901 },
      { code: "Banks", state: "cash", since: 20260901 },
      { code: "Guns", state: "kauf", since: 20260901 },
    ]);
    wrap();
    const rows = screen.getAllByTestId("paper-candidate");
    expect(rows.map((r) => r.getAttribute("data-branche"))).toEqual(["Food"]);
    expect(within(rows[0]!).getByText(/PBJ/)).toBeInTheDocument();
    expect(screen.getByTestId("paper-age")).toHaveTextContent("Datenstand");
    expect(screen.getByTestId("paper-empty")).toBeInTheDocument();
    expect(screen.getByTestId("branchen-paper")).toHaveTextContent("nichts an eine Börse");
    expect(screen.getByTestId("branchen-paper")).toHaveTextContent("Simulation, keine Prognose");
  });

  it("der Weg im Bild: Prüfen → alle Regeln mit Ja/Nein → Eröffnen → Position mit den drei IDs → zweiter Klick geht nicht → Schließen", async () => {
    ampelOf([{ code: "Food", state: "kauf", since: 20260901 }]);
    wrap();
    fireEvent.click(screen.getByTestId("paper-check"));
    const panel = await screen.findByTestId("paper-check-panel");
    await waitFor(() => expect(panel).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
    const rules = within(panel).getAllByTestId("paper-rule");
    expect(rules.map((r) => r.getAttribute("data-rule"))).toEqual(["notaus", "gruen", "alter", "instrument", "doppel", "offen", "kerzen", "zeitmaschine", "limit", "groesse"]);
    expect(rules.every((r) => r.getAttribute("data-ok") === "true")).toBe(true);
    expect(within(panel).getByTestId("paper-verdict")).toHaveTextContent("Alle Regeln sagen Ja");
    expect(within(panel).getByTestId("paper-sizing")).toHaveTextContent(/\d+ × PBJ zu/);
    fireEvent.click(within(panel).getByTestId("paper-open"));
    const row = await screen.findByTestId("paper-position");
    expect(row).toHaveAttribute("data-status", "open");
    expect(row.getAttribute("data-signal-id")).toMatch(/^sig_/);
    expect(row.getAttribute("data-simulation-id")).toMatch(/^sim_/);
    expect(row.getAttribute("data-trade-id")).toMatch(/^pp_/);
    expect(within(row).getByTestId("paper-ids")).toHaveTextContent(/Signal sig_.*Simulation sim_.*Trade pp_/);
    expect(row).toHaveTextContent("PAPIER · nichts gesendet");
    // the button is gone: this signal has its position
    expect(within(panel).queryByTestId("paper-open")).toBeNull();
    expect(within(panel).getByTestId("paper-already")).toBeInTheDocument();
    expect(screen.getByTestId("paper-open-count")).toHaveTextContent("offen 1 von 5");
    expect(screen.getAllByTestId("paper-position")).toHaveLength(1);
    // the saved simulation is one click away and shows the same id
    fireEvent.click(within(panel).getByText("Gespeicherte Simulation anzeigen"));
    const block = await screen.findByTestId("trade-simulation");
    expect(block.getAttribute("data-sim-id")).toBe(row.getAttribute("data-simulation-id"));
    // manual close (the Ampel is still green)
    fireEvent.click(within(row).getByTestId("paper-close"));
    await waitFor(() => expect(screen.getByTestId("paper-position")).toHaveAttribute("data-status", "closed"), { timeout: 10_000 });
    expect(screen.getByTestId("paper-stats")).toHaveTextContent("1 geschlossen");
    expect(screen.getByTestId("paper-open-count")).toHaveTextContent("offen 0 von 5");
  });

  it("Rot bei offener Position: der Knopf heißt „Ausstieg – Rot = Cash“ und schließt", async () => {
    ampelOf([{ code: "Food", state: "kauf", since: 20260901 }]);
    wrap();
    fireEvent.click(screen.getByTestId("paper-check"));
    await waitFor(() => expect(screen.getByTestId("paper-check-panel")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
    fireEvent.click(screen.getByTestId("paper-open"));
    await screen.findByTestId("paper-position");
    act(() => ampelOf([{ code: "Food", state: "cash", since: 20261105 }]));
    const btn = await screen.findByTestId("paper-close-rot");
    expect(screen.getByTestId("paper-position")).toHaveTextContent("Die Ampel ist für diese Branche jetzt rot: Cash.");
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("paper-position")).toHaveAttribute("data-status", "closed"), { timeout: 10_000 });
    expect(screen.getByTestId("paper-position")).toHaveTextContent("Rot = Cash");
  });

  it("ein altes Signal: die Prüfung nennt das veraltete Datum – der Knopf zum Eröffnen ist aus", async () => {
    useBranchen.setState({
      ampel: {
        asOf: ymd(NOW - 60 * DAY),
        days: 5000,
        params: { ...BASE_PARAMS },
        rows: [{ index: 0, code: "Food", name: "Food", state: "kauf", since: 20260901, daysSince: 10, weight: 0.05 }],
        events: [],
        kauf: 1,
        cash: 0,
        grossWeight: 0.05,
        capped: false,
      },
    });
    wrap();
    expect(screen.getByTestId("paper-age")).toHaveTextContent(/60 Tage alt|59,\d Tage alt|60,\d Tage alt/);
    fireEvent.click(screen.getByTestId("paper-check"));
    const panel = await screen.findByTestId("paper-check-panel");
    await waitFor(() => expect(panel).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
    expect(within(panel).getByTestId("paper-verdict")).toHaveTextContent("Eine Regel sagt Nein");
    expect(within(panel).getByTestId("paper-open")).toBeDisabled();
    expect(within(panel).getAllByTestId("paper-rule").find((r) => r.getAttribute("data-rule") === "alter")).toHaveTextContent("veraltet");
    expect(screen.queryByTestId("paper-position")).toBeNull();
  });

  it("der Not-Aus-Schalter zeigt seinen Zustand und wirkt", () => {
    ampelOf([{ code: "Food", state: "kauf", since: 20260901 }]);
    wrap();
    expect(screen.getByTestId("paper-kill-state")).toHaveTextContent("Not-Aus aus");
    fireEvent.click(screen.getByTestId("paper-kill"));
    expect(screen.getByTestId("paper-kill-state")).toHaveTextContent("Not-Aus ist AN");
    expect(screen.getByTestId("paper-kill")).toHaveAttribute("aria-pressed", "true");
    expect(usePaper.getState().book.killSwitch).toBe(true);
    fireEvent.click(screen.getByTestId("paper-kill"));
    expect(screen.getByTestId("paper-kill-state")).toHaveTextContent("Not-Aus aus");
  });

  it("signalOfRow und Karte sind dasselbe Signal (die ID auf der Karte stimmt)", () => {
    ampelOf([{ code: "Food", state: "kauf", since: 20260901 }]);
    wrap();
    const s = signalOfRow({ code: "Food", state: "kauf", since: 20260901 }, ymd(NOW - DAY), STRAT);
    expect(screen.getByTestId("paper-candidate")).toHaveAttribute("data-signal-id", s.signalId);
  });
});
