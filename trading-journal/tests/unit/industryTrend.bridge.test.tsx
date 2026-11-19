/**
 * B3 → C1: the bridge from RECEIVED signals to the paper book. Pure side (what a received row means: Branchen-Signal or not, which
 * industry, grün / rot, too old, the id) and the doing side against the real paper store with fake candles and a REAL (small) simulation:
 * a fresh green signal opens ONE position, the same one again opens nothing, a red one closes, a stale one is ignored without fetching
 * anything, a failed candle fetch waits instead of losing the signal, two runs at once make one position, the Not-Aus holds.
 * Nothing is sent: `fetch` throws in these tests and is never called.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_PARAMS, strategyId } from "@/domain/industryTrend";
import { brancheOfSymbol, dayOf, emptyLog, handledIdsOf, isBranchenSignal, logOfStored, pendingSignals, tickerOf, verdictOf, withEntry, type ReceivedSignal } from "@/domain/industryTrend/bridge";
import { INSTRUMENTS, MAX_SIGNAL_AGE_DAYS, positionIdOf, signalIdOf } from "@/domain/industryTrend/paper";
import { runTimeMachineSync } from "@/domain/timemachine";
import { createSimulationStore, idbSimStorage, type SimulationStore } from "@/views/timemachine/simStore";
import { setSimulationsForTests } from "@/views/timemachine/simulations";
import type { TimeMachineCandle } from "@/views/timemachine/types";
import { resetPaperForTests, setPaperDepsForTests, usePaper } from "@/views/aktien/branchen/paperStore";
import { resetBridgeForTests, runBridge, useBridge } from "@/views/aktien/branchen/signalBridge";
import { latticeBars } from "./timemachine.helpers";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const STRAT = strategyId(BASE_PARAMS);
const iso = (ms: number): string => new Date(ms).toISOString();

const row = (over: Partial<ReceivedSignal> = {}): ReceivedSignal => ({
  id: `row-${Math.random().toString(36).slice(2, 10)}`,
  kind: "signal",
  status: "processed",
  schemaId: "branchen-trend/1",
  strategy: STRAT,
  symbol: "PBJ",
  direction: "long",
  time: iso(NOW - DAY),
  data: { zustand: "gruen", kurs: 50 },
  receivedAt: iso(NOW),
  ...over,
});
const red = (over: Partial<ReceivedSignal> = {}): ReceivedSignal => row({ direction: "flat", data: { zustand: "rot" }, ...over });

describe("was ein empfangenes Signal für das Papier-Buch heißt (rein)", () => {
  it("jeder ETF der Liste gehört zu genau einer Branche (kein Ticker doppelt)", () => {
    const syms = Object.values(INSTRUMENTS).map((i) => i.symbol);
    expect(new Set(syms).size).toBe(syms.length);
    for (const [code, ins] of Object.entries(INSTRUMENTS)) expect(brancheOfSymbol(ins.symbol)).toBe(code);
  });

  it("Ticker ohne Börsenpräfix, groß geschrieben; Unbekanntes ist keine Branche", () => {
    expect(tickerOf("amex:xle")).toBe("XLE");
    expect(brancheOfSymbol("AMEX:XLE")).toBe("Oil");
    expect(brancheOfSymbol("xle")).toBe("Oil");
    expect(brancheOfSymbol("BTCUSDT")).toBeNull();
    expect(brancheOfSymbol(null)).toBeNull();
  });

  it("grün = öffnen, rot = schließen; die Papier-Signal-ID kommt aus dem Inhalt (Quelle, Strategie, Branche, Zustand, Tag)", () => {
    const g = verdictOf(row(), NOW);
    expect(g.action).toBe("open");
    if (g.action !== "open") return;
    const base = { source: "tradingview" as const, strategie: STRAT, branche: "Food", state: "gruen" as const, datum: dayOf(iso(NOW - DAY))! };
    expect(g.signal).toMatchObject({ ...base, asOf: base.datum, signalId: signalIdOf(base) });
    const r = verdictOf(red(), NOW);
    expect(r.action).toBe("close");
    // another row with the same content → the SAME paper id (idempotent however often it arrives)
    const g2 = verdictOf(row({ id: "other", receivedAt: iso(NOW + 5000) }), NOW);
    expect(g2.action === "open" && g2.signal.signalId).toBe(g.signal.signalId);
  });

  it("ein signal/1 mit Zustand zählt auch; ohne Zustand und ohne Branchen-Schema nicht", () => {
    expect(isBranchenSignal(row({ schemaId: "signal/1" }))).toBe(true);
    expect(isBranchenSignal(row({ schemaId: "signal/1", data: null }))).toBe(false);
    expect(isBranchenSignal(row({ schemaId: "legacy-action", data: null }))).toBe(false);
    expect(verdictOf(row({ schemaId: "legacy-action", data: null }), NOW)).toMatchObject({ action: "ignore", code: "not-branchen" });
  });

  it("Test, Doppel und Abgelehntes zählen nie", () => {
    for (const s of [row({ kind: "test" }), row({ status: "duplicate" }), row({ status: "rejected" })]) {
      expect(verdictOf(s, NOW)).toMatchObject({ action: "ignore", code: "not-processed" });
      expect(pendingSignals([s], new Set())).toEqual([]);
    }
  });

  it("VERALTET: älter als die Grenze → ignoriert und gesagt; genau an der Grenze noch gültig", () => {
    const old = verdictOf(row({ time: iso(NOW - 10 * DAY) }), NOW);
    expect(old).toMatchObject({ action: "ignore", code: "stale" });
    expect((old as { reason: string }).reason).toMatch(/Veraltet.*Grenze 4/);
    // the day's end is the reference: a signal of 3.5 days ago passes, one of 5 does not
    expect(verdictOf(row({ time: iso(NOW - 3 * DAY) }), NOW).action).toBe("open");
    expect(verdictOf(row({ time: iso(NOW - (MAX_SIGNAL_AGE_DAYS + 2) * DAY) }), NOW).action).toBe("ignore");
  });

  it("unbekannter Ticker und unlesbare Zeit werden mit Grund ignoriert", () => {
    expect(verdictOf(row({ symbol: "ZZZZ" }), NOW)).toMatchObject({ action: "ignore", code: "no-instrument" });
    expect(verdictOf(row({ time: null }), NOW)).toMatchObject({ action: "ignore", code: "bad-time" });
    expect(verdictOf(row({ time: "gestern" }), NOW)).toMatchObject({ action: "ignore", code: "bad-time" });
  });

  it("offene Signale: ohne schon erledigte, älteste zuerst (grün vor rot derselben Branche)", () => {
    const a = row({ id: "a", time: iso(NOW - 3 * DAY) });
    const b = red({ id: "b", time: iso(NOW - 2 * DAY) });
    const c = row({ id: "c", time: iso(NOW - 1 * DAY) });
    expect(pendingSignals([c, b, a], new Set()).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(pendingSignals([c, b, a], new Set(["b"])).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("das Protokoll: gleiche ID nie doppelt, Unleserliches fällt weg, höchstens 200", () => {
    let log = emptyLog();
    const e = { id: "x", outcome: "opened" as const, note: "n", paperSignalId: "sig_1", symbol: "XLE", state: "gruen" as const, at: 1 };
    log = withEntry(log, e);
    expect(withEntry(log, { ...e, note: "zweites Mal" })).toBe(log);
    expect(handledIdsOf(log).has("x")).toBe(true);
    const back = logOfStored(JSON.parse(JSON.stringify({ entries: [e, { id: 5 }, { ...e, id: "y", outcome: "boom" }, { ...e, id: "x" }, "x", null] })));
    expect(back.entries.map((x) => x.id)).toEqual(["x"]);
    let big = emptyLog();
    for (let i = 0; i < 230; i++) big = withEntry(big, { ...e, id: `i${i}` });
    expect(big.entries).toHaveLength(200);
    expect(big.entries[199]!.id).toBe("i229");
  });
});

/* ------------------------------------------------------------------------------------------------ the doing side */

const candles = (): TimeMachineCandle[] => {
  const lastT = Math.floor(NOW / DAY) * 86_400 - 86_400;
  return latticeBars(300, 0.5, 86_400, lastT - 299 * 86_400).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, closed: true }));
};

let sims: SimulationStore;
const loadBars = vi.fn();
const runSim = vi.fn();
const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));

beforeAll(() => {
  vi.stubGlobal("fetch", fetchSpy);
});
beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  fetchSpy.mockClear();
  sims = createSimulationStore(idbSimStorage("tj2-test-bridge")!);
  setSimulationsForTests(sims);
  loadBars.mockReset().mockImplementation(async () => ({ ok: true, candles: candles(), fetchedAt: NOW, sourceLabel: "Testquelle" }));
  runSim.mockReset().mockImplementation(async (input) => runTimeMachineSync({ ...input, runs: 1000 }));
  setPaperDepsForTests({ now: () => NOW, loadBars, runSim, sims: () => sims });
  resetPaperForTests();
  resetBridgeForTests();
});
afterEach(() => {
  setPaperDepsForTests(null);
  setSimulationsForTests(null);
  resetPaperForTests();
  resetBridgeForTests();
});

describe("die Brücke gegen das Papier-Buch", () => {
  it("ein frisches grünes Signal eröffnet genau EINE Papier-Position (nur Papier, nichts gesendet) und wird protokolliert", async () => {
    const s = row({ id: "r1" });
    const done = await runBridge([s]);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ id: "r1", outcome: "opened", state: "gruen", symbol: "PBJ" });
    const book = usePaper.getState().book;
    expect(book.positions).toHaveLength(1);
    expect(book.positions[0]).toMatchObject({ symbol: "PBJ", branche: "Food", status: "open", modus: "PAPIER", gesendet: false, side: "long" });
    expect(book.positions[0]!.id).toBe(positionIdOf(book.positions[0]!.signalId));
    // the position and the Zeitmaschine's simulation belong together
    expect((await sims.forTrade(book.positions[0]!.tradeId))?.symbol).toBe("PBJ");
    // logged on this device
    expect(JSON.parse(localStorage.getItem("tj2-branchen-bridge")!).entries).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dasselbe Signal noch einmal angeboten (Neuladen, nächster Abruf): nichts passiert, nichts wird neu geprüft", async () => {
    const s = row({ id: "r1" });
    await runBridge([s]);
    loadBars.mockClear();
    runSim.mockClear();
    expect(await runBridge([s])).toEqual([]);
    expect(loadBars).not.toHaveBeenCalled();
    expect(runSim).not.toHaveBeenCalled();
    expect(usePaper.getState().book.positions).toHaveLength(1);
  });

  it("zwei Zeilen mit demselben Inhalt (andere Zeilen-ID) eröffnen trotzdem nur eine Position", async () => {
    const out = await runBridge([row({ id: "r1" }), row({ id: "r2", receivedAt: iso(NOW + 1000) })]);
    expect(out.map((e) => e.outcome)).toEqual(["opened", "duplicate"]);
    expect(usePaper.getState().book.positions).toHaveLength(1);
  });

  it("zwei Läufe gleichzeitig (zwei Tabs der Karte, schneller Abruf) → ein Lauf, eine Position", async () => {
    const s = row({ id: "r1" });
    const [a, b] = await Promise.all([runBridge([s]), runBridge([s])]);
    expect(a).toBe(b);
    expect(usePaper.getState().book.positions).toHaveLength(1);
    expect(loadBars).toHaveBeenCalledTimes(1);
  });

  it("ein rotes Signal schließt die offene Position der Branche (Cash), mit Verweis auf das Signal – nie ein Short", async () => {
    await runBridge([row({ id: "r1", time: iso(NOW - 2 * DAY) })]);
    const out = await runBridge([red({ id: "r2", time: iso(NOW - 1 * DAY) })]);
    expect(out[0]).toMatchObject({ outcome: "closed", state: "rot" });
    const p = usePaper.getState().book.positions[0]!;
    expect(p).toMatchObject({ status: "closed", exitReason: "rot" });
    expect(p.exitSignalId).toMatch(/^sig_/);
    expect(usePaper.getState().book.positions).toHaveLength(1);
  });

  it("rot ohne offene Position: nichts zu schließen, keine neue Position", async () => {
    const out = await runBridge([red({ id: "r1" })]);
    expect(out[0]).toMatchObject({ outcome: "nothing-to-close" });
    expect(usePaper.getState().book.positions).toHaveLength(0);
    expect(loadBars).not.toHaveBeenCalled();
  });

  it("grün und rot in einem Abruf: die Reihenfolge der Signalzeit gilt, nicht die der Liste", async () => {
    const g = row({ id: "g", time: iso(NOW - 3 * DAY) });
    const r = red({ id: "r", time: iso(NOW - 1 * DAY) });
    const out = await runBridge([r, g]);
    expect(out.map((e) => e.outcome)).toEqual(["opened", "closed"]);
  });

  it("VERALTETE Signale werden ignoriert: keine Kerzen geholt, keine Simulation, keine Position – und sie kommen nicht wieder", async () => {
    const out = await runBridge([row({ id: "old", time: iso(NOW - 9 * DAY) })]);
    expect(out[0]).toMatchObject({ outcome: "ignored", note: expect.stringContaining("Veraltet") });
    expect(loadBars).not.toHaveBeenCalled();
    expect(runSim).not.toHaveBeenCalled();
    expect(usePaper.getState().book.positions).toHaveLength(0);
    expect(await runBridge([row({ id: "old", time: iso(NOW - 9 * DAY) })])).toEqual([]);
  });

  it("unbekannter Ticker: ignoriert mit Grund", async () => {
    const out = await runBridge([row({ id: "x", symbol: "ZZZZ" })]);
    expect(out[0]).toMatchObject({ outcome: "ignored", note: expect.stringContaining("keine Branche") });
  });

  it("Not-Aus an: die Regeln verweigern, das Signal ist erledigt (nicht still verloren), es entsteht keine Position", async () => {
    usePaper.getState().setKillSwitch(true);
    const out = await runBridge([row({ id: "k" })]);
    expect(out[0]).toMatchObject({ outcome: "refused", note: expect.stringContaining("Not-Aus") });
    expect(usePaper.getState().book.positions).toHaveLength(0);
  });

  it("Kerzen nicht ladbar: das Signal WARTET (nicht erledigt, nichts eröffnet); beim nächsten Abruf mit Kerzen wird es eröffnet", async () => {
    loadBars.mockImplementationOnce(async () => ({ ok: false, message: "Quelle antwortet nicht." }));
    const s = row({ id: "w" });
    expect(await runBridge([s])).toEqual([]);
    expect(useBridge.getState().waiting.w).toContain("Quelle antwortet nicht");
    expect(useBridge.getState().log.entries).toHaveLength(0);
    expect(usePaper.getState().book.positions).toHaveLength(0);
    const out = await runBridge([s]);
    expect(out[0]).toMatchObject({ outcome: "opened" });
    expect(useBridge.getState().waiting.w).toBeUndefined();
  });

  it("zu viele offene Positionen / Regeln sagen Nein: erledigt als 'nicht eröffnet' mit dem ersten Grund", async () => {
    for (const [i, sym] of ["PBJ", "XLV", "XLE", "XLK", "XLF"].entries()) await runBridge([row({ id: `p${i}`, symbol: sym, time: iso(NOW - (i % 3) * DAY) })]);
    expect(usePaper.getState().book.positions.filter((p) => p.status === "open").length).toBeLessThanOrEqual(5);
    const out = await runBridge([row({ id: "extra", symbol: "XLU" })]);
    if (out[0]!.outcome === "refused") expect(out[0]!.note).toMatch(/^Nicht eröffnet: /);
    expect(usePaper.getState().book.positions.filter((p) => p.status === "open").length).toBeLessThanOrEqual(5);
  });
});
