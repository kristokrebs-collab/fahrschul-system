/**
 * Strategiesuche – Oberfläche: (e) die Animation nutzt die ECHTEN Kurven und Scores des Ergebnisses (Szene = dieselben Arrays, Blitze = die Wechsel des
 * laufenden Bestwerts, der Sieger schließt die Folge, die gezeichneten Punkte stammen aus den Werten), der Ablauf der Karte mit Fixture (Demo-Beschriftung nur
 * dann), das Speichern, der Kandidat mit eigenem Risiko (Handrechnung) und „In Handelsplan übernehmen“ (öffnet vorbefüllt, bestellt nichts).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runSearchSync, type SearchResult } from "@/domain/lab/search";
import { MotionRoot } from "@/motion/MotionRoot";
import { storageKey } from "@/store/storage";
import { useJournal } from "@/store/journalStore";
import { usePlanForm } from "@/views/plan/planStore";
import { __resetLabor } from "@/views/labor";
import StrategySearchSection from "@/views/labor/search/StrategySearchSection";
import { __resetSearch, useSearch, readSaved } from "@/views/labor/search/searchStore";
import { drawFrame, flashSequence, framePlan, geometryOf, pointX, pointY, rangeOf, REPLAY_MS, sceneOf, type Palette } from "@/views/labor/search/timeline";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { market, searchInput } from "./search.helpers";

const openFeature = vi.fn();
vi.mock("@/app/featureOpen", () => ({ openFeature: (...a: unknown[]) => openFeature(...a) }));

const BARS = market(2400, 77, { edge: { lookback: 20, hold: 4, drift: 1 } });
const RESULT: SearchResult = runSearchSync(searchInput(BARS, 7));
const PAL: Palette = { fg: "fg", mute: "mute", faint: "faint", line: "line", win: "win", loss: "loss", zone: "zone" };

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

  it("die Szene hält dieselben Arrays wie das Ergebnis: 1.000 Kurven, die Scores der Zeilen, der Sieger", () => {
    expect(scene.n).toBe(RESULT.counts.variants);
    expect(scene.n).toBe(1000);
    for (let i = 0; i < scene.n; i++) expect(scene.curves[i]).toBe(RESULT.curves.is[i]);
    expect(scene.scores).toEqual(RESULT.rows.map((r) => r.isScore));
    expect(scene.winner).toBe(RESULT.winner!.variant.id);
    expect(scene.winnerCurve).toBe(RESULT.curves.winner);
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

  it("der Zeitplan: der Scanner besucht 0 → 1.000 nur aufwärts, der Bestwert ist zu jedem Zeitpunkt ein früherer Blitz, am Ende ist es der Sieger", () => {
    expect(framePlan(scene, 0).scanned).toBe(0);
    let last = -1;
    let lastBest = -1;
    for (let t = 0; t <= REPLAY_MS; t += 50) {
      const p = framePlan(scene, t);
      expect(p.scanned).toBeGreaterThanOrEqual(last);
      last = p.scanned;
      if (p.best != null) {
        expect(scene.flashes).toContain(p.best);
        expect(p.best).toBeGreaterThanOrEqual(lastBest);
        lastBest = p.best;
      }
    }
    const end = framePlan(scene, REPLAY_MS);
    expect(end).toMatchObject({ scanned: 1000, best: scene.winner, oos: 1, done: true });
    expect(end.rest).toBeCloseTo(0.18, 5);
  });

  it("gezeichnet wird, was in den Kurven steht: die Punkte des Siegers im Endbild liegen auf den Werten von `curves.winner`; alle 1.000 Kurven sind im Pfad", () => {
    const { ctx, calls } = recorder();
    const g = geometryOf(800, 260);
    const range = rangeOf(scene);
    drawFrame(ctx, g, scene, framePlan(scene, REPLAY_MS), PAL, range);
    // gestrichelter Lauf in den Endtest: lineTo-Punkte mit gesetztem Strich
    const dashed = calls.filter((c) => c.op === "lineTo" && c.dash === 2 && c.style !== "line");
    const k0 = scene.isPoints;
    expect(dashed).toHaveLength(scene.gridLen - k0);
    dashed.forEach((c, i) => {
      expect(c.args[0]).toBeCloseTo(pointX(g, scene, k0 + i), 6);
      expect(c.args[1]).toBeCloseTo(pointY(g, range, scene.winnerCurve[k0 + i]!), 6);
    });
    // die schwachen Kurven: ein gebündelter Pfad mit je isPoints Punkten – alle außer dem Sieger (999) ≥ 999 × isPoints lineTo
    const lines = calls.filter((c) => c.op === "lineTo").length;
    expect(lines).toBeGreaterThanOrEqual(999 * scene.isPoints);
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
    expect(screen.getByTestId("search-counts")).toHaveAttribute("data-is-runs", "1000");
    // überspringen → das Ergebnis erscheint
    fireEvent.click(screen.getByTestId("search-skip"));
    await waitFor(() => expect(screen.getByTestId("search-result-wrap")).toHaveAttribute("data-ready", "true"));
    expect(screen.getByTestId("search-verdict")).toHaveTextContent(/Bestanden|Verworfen/);
    expect(screen.getByTestId("search-demo")).toBeInTheDocument();
    expect(screen.getByTestId("search-seed")).toHaveTextContent("Seed 20261108 · Modell strategiesuche-2");
    expect(screen.getByTestId("search-rank")).toHaveTextContent(/Platz|Kein Rang/);
    expect(screen.getByTestId("search-multi")).toHaveTextContent(/Bei 1\.000 Versuchen/);
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
    // eigenes Risiko 1 % und Konto Makro
    act(() => useJournal.setState((st) => ({ settings: { ...st.settings, capital: { ...st.settings.capital, makro: 10_000 }, risk: { riskPerTradePct: 0.01 } } as typeof st.settings })));
    const box = await screen.findByTestId("search-candidate-size");
    await waitFor(() => expect(box).toHaveTextContent(/Dein Risiko 1,00 %/));
    expect(box).toHaveTextContent(/10\.000 USDT/);
    expect(screen.getByTestId("search-candidate-levels")).toHaveTextContent(/95/);
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
