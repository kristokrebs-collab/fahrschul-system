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
import { AnalyseView, ANALYSE_WIDGETS, analyseDimFromQuery, analyseQuery, DEFAULT_DIM, fanGeometry, HERO_TILES, mcSampleOf, setAnalyseDim, useAnalyseUi } from "@/views/analyse";
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

  it("weekday × time heat map: the grid is the touch target – a click on a gap or the halo picks the nearest cell (round 5)", async () => {
    await loadFixture();
    renderView();
    const card = screen.getByTestId("ana-heat");
    const host = card.querySelector<HTMLElement>('[data-fx="heat-grid"]')!;
    expect(host.dataset.hitGrid).toBe("24");
    const cells = within(card).getAllByTestId("heat-cell");
    expect(cells).toHaveLength(84);
    // jsdom has no layout: 21 px cells on a 24 px pitch, 12 columns, origin (100, 50)
    const rect = (i: number) => ({ left: 100 + (i % 12) * 24, top: 50 + Math.floor(i / 12) * 24, width: 21, height: 21 });
    const proto = Element.prototype;
    const real = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: Element) {
      const i = (this as HTMLElement).dataset?.cell;
      if (i == null) return real.call(this);
      const r = rect(Number(i));
      return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const tap = async (x: number, y: number) => {
        await act(async () => {
          fireEvent.click(host, { clientX: x, clientY: y });
        });
      };
      // 0,8 px right of cell 30's right edge (the gap): cell 30 is nearer than cell 31
      await tap(rect(30).left + 21 + 0.8, rect(30).top + 10.5);
      expect(cells[30]).toHaveAttribute("aria-pressed", "true");
      // 6 px above the first row at column 6 (the halo): cell 6
      await tap(rect(6).left + 10.5, rect(6).top - 6);
      expect(cells[6]).toHaveAttribute("aria-pressed", "true");
      // far outside the snap radius: nothing changes
      await tap(rect(6).left + 10.5, rect(6).top - 60);
      expect(cells[6]).toHaveAttribute("aria-pressed", "true");
      // a click that ends on a cell's own button is that cell's business, not the grid's
      await act(async () => {
        fireEvent.click(cells[40]!, { clientX: rect(31).left, clientY: rect(31).top });
      });
      expect(cells[40]).toHaveAttribute("aria-pressed", "true");
      expect(cells[31]).toHaveAttribute("aria-pressed", "false");
    } finally {
      proto.getBoundingClientRect = real;
    }
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
    // 9 of 11 trades carry an R: Monte Carlo draws from the 11 money P&Ls instead of claiming "fewer than 10" (F3 / F17)
    expect(screen.getByTestId("ana-mc")).not.toHaveTextContent("braucht mindestens");
    expect(screen.getByTestId("ana-mc")).toHaveTextContent(`gezogen aus ${view.closed.length} Trades`);
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

  it("Monte Carlo sample: R when 10 trades carry one, else the money P&L of every closed trade (F3 / F17)", () => {
    const t = (r: number | null, pnl: number) => ({ r, pnl });
    // 11 closed, 9 with R → money, all 11
    const mixed = [...Array.from({ length: 9 }, (_, i) => t(i % 2 ? 1 : -1, i % 2 ? 100 : -50)), t(null, 20), t(null, -10)];
    expect(mcSampleOf(mixed, "R")).toMatchObject({ unit: "money", rCount: 9 });
    expect(mcSampleOf(mixed, "R").sample).toHaveLength(11);
    // 10 with R → R
    const rich = [...mixed, t(2, 200)];
    expect(mcSampleOf(rich, "R")).toMatchObject({ unit: "R", rCount: 10 });
    expect(mcSampleOf(rich, "R").sample).toHaveLength(10);
    // money preferred stays money
    expect(mcSampleOf(rich, "money").unit).toBe("money");
    // fewer than 10 closed → nothing to draw from
    expect(mcSampleOf(mixed.slice(0, 7), "R")).toEqual({ sample: null, unit: "R", rCount: 7 });
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
