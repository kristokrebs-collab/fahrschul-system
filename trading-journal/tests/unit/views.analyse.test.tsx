/**
 * Analyse page (P03, `src/views/analyse`): empty journal preview; with the analytics fixture (60 trades) the hero
 * (Sharpe, edge test, 9 ratio tiles → MorphCard dialog with sample and interval), every card, the breakdown rows
 * through `aggregate()` and the dimension seam (`setAnalyseDim` / `analyseDimFromQuery`), the Monte Carlo and risk of
 * ruin runs (idle-chunk runner – jsdom has no Worker), a custom stat saved into `settings.analytics.custom`, the
 * honest small-sample states of the legacy fixture and the cockpit widgets.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aggregate } from "@/domain/agg";
import { customStatsOf, DIMENSION_ORDER } from "@/domain/analytics";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { getAccountView, getEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { monteCarlo } from "@/domain/analytics";
import { AnalyseView, ANALYSE_WIDGETS, analyseDimFromQuery, analyseQuery, DEFAULT_DIM, fanGeometry, HERO_TILES, setAnalyseDim, useAnalyseUi } from "@/views/analyse";
import { fixtureTrades, SETTINGS } from "./analytics.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

function renderView() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <AnalyseView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

async function loadFixture() {
  await act(async () => {
    useJournal.setState({ trades: fixtureTrades(), settings: SETTINGS });
  });
}

describe("AnalyseView", () => {
  beforeAll(() => {
    installDomPolyfills();
    // jsdom has no canvas: the fan's draw is a no-op (the domain + e2e cover the picture)
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    useAnalyseUi.setState({ dim: DEFAULT_DIM, mcHorizon: 50, mcMethod: "bootstrap", rorRisk: null, rorRuin: 0.5, rollingWindow: 20, compareMode: "period" });
  });
  afterEach(() => useUi.setState({ acc: "all" }));

  it("empty journal: h1 and one calm preview card", async () => {
    await act(async () => {
      useJournal.setState({ trades: [] });
    });
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Analyse" })).toBeInTheDocument();
    expect(screen.getByTestId("ana-preview")).toHaveTextContent("Noch nichts zu analysieren");
    expect(screen.queryByTestId("ana-hero")).toBeNull();
  });

  it("renders every section and card with the fixture journal", async () => {
    await loadFixture();
    renderView();
    const view = screen.getByTestId("analyse-view");
    expect(view).toHaveAttribute("data-n", "60");
    for (const title of ["Kennzahlen", "Was kommen kann", "Wo deine Edge liegt", "Ausführung", "Muster", "Gegen den Markt"]) expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    for (const id of ["ana-hero", "ana-costs", "ana-mc", "ana-ror", "ana-breakdown", "ana-heat", "ana-excursion", "ana-dist", "ana-rolling", "ana-streaks", "ana-bench", "ana-compare", "ana-custom"]) expect(screen.getByTestId(id)).toBeInTheDocument();
    const hero = screen.getByTestId("ana-hero");
    expect(within(hero).getByTestId("ana-sharpe").textContent).toMatch(/\d/);
    expect(within(hero).getByTestId("ana-edge")).toHaveTextContent(/pro Trade · p/);
    expect(HERO_TILES).toHaveLength(9);
    for (const k of HERO_TILES) expect(within(hero).getByTestId(`ana-tile-${k}`)).toBeInTheDocument();
  });

  it("a ratio tile opens its explainer with sample, interval and verdict", async () => {
    await loadFixture();
    renderView();
    const tile = within(screen.getByTestId("ana-tile-sqn")).getByRole("button");
    await act(async () => {
      fireEvent.click(tile);
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Stichprobe")).toBeInTheDocument();
    expect(within(dialog).getAllByText("80-%-Intervall").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/SQN = √min\(n, 100\)/)).toBeInTheDocument();
  });

  it("breakdown rows aggregate their trades; the robust best leads; the dimension follows the store", async () => {
    await loadFixture();
    renderView();
    const bd = screen.getByTestId("ana-breakdown");
    const rows = within(bd).getAllByTestId("bd-row");
    expect(rows.map((r) => r.dataset.key)).toEqual(["s_good", "s_bad"]);
    expect(rows[0]).toHaveAttribute("data-verdict", "klar");
    expect(within(bd).getByTestId("bd-banner")).toHaveTextContent(/Trade the best\s*Breakout/);
    // a row opens its trades
    await act(async () => {
      fireEvent.click(within(rows[0]!).getByRole("button"));
    });
    expect(within(bd).getAllByRole("button").some((b) => b.dataset.tradeId)).toBe(true);
    // router seam
    await act(async () => setAnalyseDim("session"));
    const keys = within(screen.getByTestId("ana-breakdown"))
      .getAllByTestId("bd-row")
      .map((r) => r.dataset.key);
    expect(keys.every((k) => ["asia", "london", "ny", "late", "weekend"].includes(k!))).toBe(true);
    setAnalyseDim("bogus");
    expect(useAnalyseUi.getState().dim).toBe("session");
  });

  it("Monte Carlo and risk of ruin run (idle chunks) and show their numbers", async () => {
    await loadFixture();
    renderView();
    const mc = screen.getByTestId("ana-mc");
    await waitFor(() => expect(within(mc).getByTestId("mc-fan")).toBeInTheDocument(), { timeout: 10_000 });
    expect(mc).toHaveTextContent("nach 50 Trades");
    expect(within(mc).getByRole("slider", { name: "Simulierte Läufe durchgehen" })).toBeInTheDocument();
    expect(within(mc).getByTestId("mc-readout").textContent).toMatch(/^Lauf \d+: Ende/);
    const ror = screen.getByTestId("ana-ror");
    await waitFor(() => expect(within(ror).getByTestId("ror-value")).toHaveAttribute("data-state", "done"), { timeout: 10_000 });
    expect(within(ror).getByTestId("ror-curve")).toBeInTheDocument();
  });

  it("a custom stat is saved into settings.analytics.custom and removed again", async () => {
    await loadFixture();
    renderView();
    const card = screen.getByTestId("ana-custom");
    expect(within(card).getByTestId("custom-preview")).toHaveTextContent("Win-Rate · nach Session");
    await act(async () => {
      fireEvent.click(within(card).getByRole("radio", { name: "Long" }));
    });
    await act(async () => {
      fireEvent.click(within(card).getByTestId("custom-save"));
    });
    await waitFor(() => expect(customStatsOf(useJournal.getState().settings)).toHaveLength(1));
    expect(customStatsOf(useJournal.getState().settings)[0]).toMatchObject({ metric: "winRate", filter: { side: "long" }, groupBy: "session" });
    expect(within(card).getByTestId("custom-stat")).toHaveTextContent("Win-Rate · Long · nach Session");
  });

  it("legacy fixture (11 closed trades): small-sample states instead of guessed numbers", () => {
    renderView();
    const { trades, settings } = useJournal.getState();
    const view = getAccountView(getEnriched(trades, settings), settings, "all");
    expect(screen.getByTestId("analyse-view")).toHaveAttribute("data-n", String(view.closed.length));
    expect(screen.getByTestId("ana-excursion")).toHaveTextContent("Noch keine MAE / MFE");
    // 9 trades with a stop: too few to draw from
    expect(screen.getByTestId("ana-mc")).toHaveTextContent("Monte Carlo braucht mindestens 10");
    // the hero's sample follows aggregate()
    expect(aggregate(view.closed).n).toBe(view.closed.length);
  });

  it("the account switch is the Hero's (uiStore.acc)", async () => {
    await loadFixture();
    renderView();
    const group = screen.getByRole("radiogroup", { name: "Konto der Analyse" });
    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: "Makro" }));
    });
    expect(useUi.getState().acc).toBe("makro");
    expect(screen.getByTestId("analyse-view")).toHaveAttribute("data-n", "12");
  });
});

describe("router seam and widgets", () => {
  it("fan geometry: one scale for paths and bands, inside the box", () => {
    const res = monteCarlo([1, -1, 2, -0.5, 0.8], { runs: 200, horizon: 30, keepPaths: 12, seed: 3 });
    const g = fanGeometry(res, 400, 220)!;
    expect(g.pts).toHaveLength(12);
    expect(g.pts[0]).toHaveLength(31);
    expect(g.pathD).toHaveLength(12);
    for (const p of g.pts.flat()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(220);
    }
    expect(g.band.endsWith("Z")).toBe(true);
    expect(fanGeometry(res, 0, 220)).toBeNull();
    expect(fanGeometry(monteCarlo([]), 400, 220)).toBeNull();
  });

  it("dim query parsing", () => {
    expect(analyseDimFromQuery("?dim=weekday")).toBe("weekday");
    expect(analyseDimFromQuery("dim=nope")).toBeNull();
    expect(analyseDimFromQuery(new URLSearchParams("x=1"))).toBeNull();
    expect(analyseQuery("setup")).toBe("");
    expect(analyseQuery("hold")).toBe("dim=hold");
    expect(DIMENSION_ORDER).toContain(DEFAULT_DIM);
  });

  it("cockpit widgets: unique ids, 12-column spans, each renders", async () => {
    installDomPolyfills();
    await bootFixtureJournal();
    await loadFixture();
    expect(new Set(ANALYSE_WIDGETS.map((w) => w.id)).size).toBe(ANALYSE_WIDGETS.length);
    for (const w of ANALYSE_WIDGETS) {
      expect(w.defaultSpan).toBeGreaterThan(0);
      expect(w.defaultSpan).toBeLessThanOrEqual(12);
      const C = w.component;
      const { unmount, container } = render(
        <MotionRoot>
          <MorphDialogProvider>
            <C />
          </MorphDialogProvider>
        </MotionRoot>,
      );
      expect(container.textContent?.length).toBeGreaterThan(10);
      unmount();
    }
  });
});
