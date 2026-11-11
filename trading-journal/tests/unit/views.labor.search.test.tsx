/**
 * Strategiesuche – Oberfläche: (e) die Animation nutzt die ECHTEN Kurven und Scores des Ergebnisses (Szene = dieselben Arrays, Blitze = die Wechsel des
 * laufenden Bestwerts, der Sieger schließt die Folge, die gezeichneten Punkte stammen aus den Werten), der Ablauf der Karte mit Fixture (Demo-Beschriftung nur
 * dann), das Speichern, der Kandidat mit eigenem Risiko (Handrechnung) und „In Handelsplan übernehmen“ (öffnet vorbefüllt, bestellt nichts).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ruleParts, runSearchSync, stopRuleText, type SearchResult } from "@/domain/lab/search";
import { MotionRoot } from "@/motion/MotionRoot";
import { storageKey } from "@/store/storage";
import { useJournal } from "@/store/journalStore";
import { usePlanForm } from "@/views/plan/planStore";
import { __resetLabor } from "@/views/labor";
import StrategySearchSection from "@/views/labor/search/StrategySearchSection";
import { __resetSearch, useSearch, readSaved } from "@/views/labor/search/searchStore";
import { advanceLayers, flashSequence, framePlan, geometryOf, lineProgress, newLayers, paintFrame, pointX, pointY, rangeOf, REPLAY_MS, sceneOf, STAGES, type Palette } from "@/views/labor/search/timeline";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { market, searchInput } from "./search.helpers";

const openFeature = vi.fn();
vi.mock("@/app/featureOpen", () => ({ openFeature: (...a: unknown[]) => openFeature(...a) }));

const BARS = market(2400, 77, { edge: { lookback: 20, hold: 4, drift: 1 } });
const RESULT: SearchResult = runSearchSync(searchInput(BARS, 7));
const PAL: Palette = { veil: "255 255 255", fg: "fg", faint: "faint", win: "win", loss: "loss" };

/** A recording 2D context: what is drawn, in order. */
function recorder() {
  const calls: { op: string; args: unknown[]; style?: string; dash?: number }[] = [];
  let dash = 0;
  const state: Record<string, unknown> = { strokeStyle: "", fillStyle: "", lineWidth: 1, globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(t, p: string) {
      if (p in t) return t[p];
      return (...args: unknown[]) => {
        if (p === "setLineDash") dash = (args[0] as number[]).length;
        calls.push({ op: p, args, style: String(t.strokeStyle), dash });
      };
    },
    set(t, p: string, v) {
      t[p] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("(e) die Animation nutzt die echten Kurven und Scores", () => {
  const scene = sceneOf(RESULT);

  it("die Szene hält dieselben Arrays wie das Ergebnis: 1.000 Kurven, die Scores der Zeilen, der Sieger, das Band seiner Endtest-Trades", () => {
    expect(scene.n).toBe(RESULT.counts.variants);
    expect(scene.n).toBe(1000);
    for (let i = 0; i < scene.n; i++) expect(scene.curves[i]).toBe(RESULT.curves.is[i]);
    expect(scene.scores).toEqual(RESULT.rows.map((r) => r.isScore));
    expect(scene.winner).toBe(RESULT.winner!.variant.id);
    expect(scene.winnerCurve).toBe(RESULT.curves.winner);
    // das Band: die Neuziehung der Endtest-Trades, verschoben auf den Wert des Siegers am Schnitt (absolut auf derselben Achse)
    const base = RESULT.curves.winner[RESULT.curves.isPoints - 1]!;
    const band = RESULT.winner!.risk!.band;
    expect(scene.band!.lo).toEqual(band.lo.map((x) => base + x));
    expect(scene.band!.hi).toEqual(band.hi.map((x) => base + x));
    expect(scene.band!.lo).toHaveLength(scene.gridLen - scene.isPoints);
  });

  it("die Blitze sind genau die Momente, in denen der laufende Bestwert wechselt – unabhängig nachgerechnet; der Sieger schließt die Folge", () => {
    let best = -Infinity;
    const expected: number[] = [];
    RESULT.rows.forEach((r, i) => {
      if (r.isScore != null && r.isScore > best) {
        best = r.isScore;
        expected.push(i);
      }
    });
    expect(scene.flashes.slice(0, expected.length)).toEqual(expected);
    expect(scene.flashes[scene.flashes.length - 1]).toBe(RESULT.winner!.variant.id);
    expect(scene.flashes.length).toBeGreaterThan(2);
    // ohne Sieger bleibt es bei der Folge der Zeilen
    expect(flashSequence([null, 1, 3, 2, 3], null)).toEqual([1, 2]);
  });

  it("die Zähler zählen Gezeigtes: „Gezeichnet“ = Linien, die ganz auf der Bühne stehen; „Geprüft“ = verglichene Varianten, nur aufwärts; der Bestwert ist immer ein früherer Blitz", () => {
    expect(framePlan(scene, 0).counter).toEqual({ label: "Gezeichnet", value: 0 });
    const drawMs = STAGES[0].ms;
    for (let t = 0; t < drawMs; t += 37) {
      const p = framePlan(scene, t);
      expect(p.stage).toBe(0);
      let full = 0;
      for (let i = 0; i < scene.n; i++) if (lineProgress(i, scene.n, p.s) >= 1) full++;
      expect(p.counter.value, `t = ${t}`).toBe(full);
    }
    let last = -1;
    let lastBest = -1;
    for (let t = drawMs; t <= REPLAY_MS; t += 50) {
      const p = framePlan(scene, t);
      expect(p.counter.label).toBe("Geprüft");
      expect(p.scanned).toBeGreaterThanOrEqual(last);
      expect(p.counter.value).toBe(p.scanned);
      last = p.scanned;
      if (p.best != null) {
        expect(scene.flashes).toContain(p.best);
        expect(p.best).toBeLessThan(Math.max(1, p.scanned));
        expect(p.best).toBeGreaterThanOrEqual(lastBest);
        lastBest = p.best;
        // genau der letzte Blitz vor dem Scanner
        if (p.stage === 1) expect(p.best).toBe([...scene.flashes].reverse().find((id) => id < p.scanned));
      }
    }
    const end = framePlan(scene, REPLAY_MS);
    expect(end).toMatchObject({ scanned: 1000, best: scene.winner, oos: 1, band: 1, done: true, stage: 3 });
    expect(end.counter).toEqual({ label: "Geprüft", value: 1000 });
    expect(STAGES.map((s) => s.label)).toEqual(["Zeichnen", "Prüfen", "Kristallisieren", "Endtest"]);
  });

  it("gezeichnet wird, was in den Kurven steht: jede der 1.000 Kurven Punkt für Punkt, ein Punkt je verglichener Variante, der gestrichelte Endtest und das Band aus den Werten", () => {
    const g = geometryOf(900, 400);
    const range = rangeOf(scene);
    const pal = PAL;
    const base = recorder();
    const L = newLayers(base.ctx, scene.n);
    const end = framePlan(scene, REPLAY_MS);
    // in Häppchen: höchstens 24.000 Strecken je Aufruf, bis alles steht
    let calls = 0;
    while (!advanceLayers(L, g, scene, range, pal, end, 24_000)) calls++;
    expect(calls).toBeGreaterThan(1);
    const lines = base.calls.filter((c) => c.op === "lineTo");
    expect(lines).toHaveLength(scene.n * scene.isPoints);
    expect(base.calls.filter((c) => c.op === "stroke")).toHaveLength(scene.n);
    // die Punkte der Kurve 0 und der letzten Kurve stammen aus ihren Werten
    for (const i of [0, scene.n - 1]) {
      const first = i * scene.isPoints;
      for (let k = 0; k < scene.isPoints; k++) {
        expect(lines[first + k]!.args[0]).toBeCloseTo(pointX(g, scene, k), 6);
        expect(lines[first + k]!.args[1]).toBeCloseTo(pointY(g, range, scene.curves[i]![k]!), 6);
      }
    }
    // ein Punkt je verglichener Variante, am Ende ihres Trainings
    const arcs = base.calls.filter((c) => c.op === "arc");
    expect(arcs).toHaveLength(scene.n);
    arcs.forEach((c, i) => expect(c.args[1]).toBeCloseTo(pointY(g, range, scene.curves[i]![scene.isPoints - 1]!), 6));

    const main = recorder();
    paintFrame(main.ctx, g, scene, range, pal, end);
    const k0 = scene.isPoints;
    const dashed = main.calls.filter((c) => c.op === "lineTo" && c.dash === 2 && (c.style === "win" || c.style === "loss" || c.style === "fg"));
    expect(dashed).toHaveLength(scene.gridLen - k0);
    dashed.forEach((c, i) => {
      expect(c.args[0]).toBeCloseTo(pointX(g, scene, k0 + i), 6);
      expect(c.args[1]).toBeCloseTo(pointY(g, range, scene.winnerCurve[k0 + i]!), 6);
    });
    // das Band: oben die 95-%-Werte vorwärts, unten die 5-%-Werte rückwärts
    const fillAt = main.calls.findIndex((c) => c.op === "fill");
    const poly = main.calls.slice(0, fillAt).filter((c) => c.op === "lineTo").slice(-2 * scene.band!.lo.length);
    const m = scene.band!.lo.length;
    for (let j = 0; j < m; j++) {
      expect(poly[j]!.args[1]).toBeCloseTo(pointY(g, range, scene.band!.hi[j]!), 6);
      expect(poly[m + j]!.args[1]).toBeCloseTo(pointY(g, range, scene.band!.lo[m - 1 - j]!), 6);
    }
  });
});

describe("Karte: Suche mit Fixture, Speichern, Kandidat, Handelsplan", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    window.scrollTo = vi.fn() as never;
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.clear();
    __resetLabor();
    __resetSearch();
    openFeature.mockClear();
  });
  afterEach(() => {
    __resetSearch();
    __resetLabor();
  });

  const renderSection = () =>
    render(
      <MotionRoot>
        <StrategySearchSection fixture={{ trend: { bars: BARS, symbol: "TESTUSDT", interval: "4h" } }} />
      </MotionRoot>,
    );

  it("startet, rechnet alle 1.000, zeigt Ergebnis mit Demo-Beschriftung, legt die Zusammenfassung ab", async () => {
    renderSection();
    expect(screen.getByTestId("search-fixture-note")).toHaveTextContent(/Demo-Daten/);
    fireEvent.click(screen.getByTestId("search-start"));
    await waitFor(() => expect(useSearch.getState().status).toBe("done"), { timeout: 30_000 });
    const canvas = await screen.findByTestId("search-stage");
    expect(canvas).toHaveAttribute("data-curves", "1000");
    expect(screen.getByTestId("search-counts")).toHaveAttribute("data-variants", "1000");
    expect(screen.getByTestId("search-counts")).toHaveAttribute("data-candidates", "3000");
    expect(screen.getByTestId("search-counts")).toHaveAttribute("data-is-runs", "3000");
    // überspringen → das Ergebnis erscheint
    fireEvent.click(screen.getByTestId("search-skip"));
    await waitFor(() => expect(screen.getByTestId("search-result-wrap")).toHaveAttribute("data-ready", "true"));
    expect(screen.getByTestId("search-verdict")).toHaveTextContent(/Bestanden|Verworfen/);
    expect(screen.getByTestId("search-demo")).toBeInTheDocument();
    expect(screen.getByTestId("search-seed")).toHaveTextContent("Seed 20261108 · Modell strategiesuche-3");
    expect(screen.getByTestId("search-rank")).toHaveTextContent(/Platz|Kein Rang/);
    expect(screen.getByTestId("search-multi")).toHaveTextContent(/Bei 3\.000 Versuchen/);
    // gespeichert: Zusammenfassung ohne Kurven und Zeilen
    const saved = readSaved();
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty("curves");
    expect(saved[0]).not.toHaveProperty("rows");
    expect(saved[0]!.seed).toBe(20261108);
    expect(JSON.parse(localStorage.getItem(storageKey("labor-search"))!).items).toHaveLength(1);
    expect(screen.getAllByTestId("search-saved-item")).toHaveLength(1);
  }, 60_000);

  it("Demo-Beschriftung nur bei Fixture-Daten: dieselbe Zusammenfassung mit Marktdaten trägt sie nicht", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("search-start"));
    await waitFor(() => expect(useSearch.getState().status).toBe("done"), { timeout: 30_000 });
    const s = useSearch.getState().summary!;
    act(() => useSearch.setState({ result: null, summary: { ...s, datasets: s.datasets.map((d) => ({ ...d, fixture: false, source: "binance" })) } }));
    await waitFor(() => expect(screen.queryByTestId("search-demo")).toBeNull());
    expect(screen.getByTestId("search-dataset-trend")).not.toHaveTextContent(/Demo/);
  }, 60_000);

  it("Abbrechen: mitten in der Suche beendet sie, nichts wird gespeichert", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("search-start"));
    await screen.findByTestId("search-cancel");
    fireEvent.click(screen.getByTestId("search-cancel"));
    await waitFor(() => expect(useSearch.getState().status).toBe("cancelled"));
    expect(screen.getByTestId("search-stage-text")).toHaveTextContent(/abgebrochen/);
    expect(readSaved()).toHaveLength(0);
  });

  it("verworfen: kein Kandidat, nur der Hinweis; bestanden: Kandidat, ohne eigenes Risiko keine Größe, mit ihm die Handrechnung", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("search-start"));
    await waitFor(() => expect(useSearch.getState().status).toBe("done"), { timeout: 30_000 });
    fireEvent.click(screen.getByTestId("search-skip"));
    await waitFor(() => expect(screen.getByTestId("search-result-wrap")).toHaveAttribute("data-ready", "true"));
    const s = useSearch.getState().summary!;
    // verworfen
    act(() => useSearch.setState({ result: null, summary: { ...s, verdict: { ...s.verdict, passed: false } }, candidate: null }));
    expect(await screen.findByTestId("search-candidate-rejected")).toHaveTextContent(/Strategie war nicht belastbar/);
    expect(screen.queryByTestId("search-to-plan")).toBeNull();
    // verworfen: keine Regelkarte, sondern ein klares „keine Regel zum Handeln“ mit dem Grund
    expect(await screen.findByTestId("search-plan-none")).toHaveTextContent(/Keine Regel zum Handeln/);
    expect(screen.getByTestId("search-plan-none")).toHaveTextContent(s.verdict.reason);
    expect(screen.queryByTestId("search-plan")).toBeNull();
    // bestanden mit Long-Signal von Hand
    const signal = { side: "long" as const, entry: 100, stop: 95, target: 110, maxBars: 12, stopPct: 5, targetR: 2, stopAtr: 2 };
    act(() =>
      useSearch.setState({
        result: null,
        summary: { ...s, verdict: { ...s.verdict, passed: true } },
        candidate: { state: "long", asOf: Date.UTC(2026, 10, 8), lastClose: 100, signal, holdsFor: 0, text: "Long-Signal auf der letzten geschlossenen Kerze.", rules: "Regeln", family: "trend" },
      }),
    );
    expect(await screen.findByTestId("search-candidate-state")).toHaveTextContent("Long");
    expect(screen.getByTestId("search-candidate-needrisk")).toHaveTextContent(/dein eigenes Risiko/);
    expect(screen.queryByText(/Dein Risiko/)).toBeNull();
    expect(screen.getByText(/Keine Anlageempfehlung/)).toBeInTheDocument();
    // „Was machen wir wann?“: die Regeln des Siegers als Handlung, ohne eigenes Risiko keine Größe, mit den Grundlagen
    const plan = await screen.findByTestId("search-plan");
    const w = s.winner!;
    const parts = ruleParts(w.variant, w.stop);
    expect(screen.getByTestId("search-plan-entry")).toHaveTextContent(parts.entry);
    expect(screen.getByTestId("search-plan-stop")).toHaveTextContent(parts.stop);
    expect(screen.getByTestId("search-plan-manage")).toHaveTextContent(stopRuleText(w.stop, w.variant));
    expect(screen.getByTestId("search-plan-exit")).toHaveTextContent(parts.exit);
    expect(screen.getByTestId("search-plan-size")).toHaveTextContent(/dein eigenes Risiko je Trade fest/);
    expect(screen.getByTestId("search-plan-holds")).toHaveTextContent(`mit ${w.oos.n} Trades`);
    expect(screen.getByTestId("search-plan-holds")).toHaveTextContent(/für 3\.000 Versuche/);
    expect(plan).not.toHaveTextContent(/\d USDT/);
    // die Zeile unter dem Ergebnis nennt die Annahmen
    expect(screen.getByTestId("search-legal")).toHaveTextContent(/keine Prognose.*Gebühren Taker 0,05 %.*Slippage 2 Basispunkte.*Funding flach/);
    // eigenes Risiko 1 % und Konto Makro
    act(() => useJournal.setState((st) => ({ settings: { ...st.settings, capital: { ...st.settings.capital, makro: 10_000 }, risk: { riskPerTradePct: 0.01 } } as typeof st.settings })));
    const box = await screen.findByTestId("search-candidate-size");
    await waitFor(() => expect(box).toHaveTextContent(/Dein Risiko 1,00 %/));
    expect(box).toHaveTextContent(/10\.000 USDT/);
    expect(screen.getByTestId("search-candidate-levels")).toHaveTextContent(/95/);
    // die Regelkarte rechnet mit derselben eigenen Zahl: 1 % von 10.000 = 100 USDT je Stop, Beispiel mit dem letzten Schluss und der ATR
    await waitFor(() => expect(screen.getByTestId("search-plan-size")).toHaveTextContent(/1,00 % deines Kontos kostet: 100 USDT von 10\.000 USDT/));
    expect(screen.getByTestId("search-plan-size")).toHaveTextContent(/Stop-Abstand/);
    // „In Handelsplan übernehmen“: öffnet den Plan vorbefüllt – nichts wird bestellt
    fireEvent.click(screen.getByTestId("search-to-plan"));
    await waitFor(() => expect(openFeature).toHaveBeenCalledWith("page:plan"));
    const form = usePlanForm.getState().form;
    expect(form.symbol).toBe("TESTUSDT");
    expect(form.sides).toBe("long");
    expect(form.manualEntry).toBe(100);
    expect(form.stop).toEqual({ kind: "price", price: 95 });
    expect(form.target).toEqual({ kind: "price", price: 110 });
  }, 60_000);
});
