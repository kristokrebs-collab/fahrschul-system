/**
 * Markt page (P02, `src/views/markt`): composition with a box view built from REAL BTCUSDT bars (the 4h bar of
 * 2026-10-10 20:00 UTC: an A+ range long), only A+ / A setups listed, the setup dialog with every reason and weight, the
 * phase rail, the RSI rows, the scanner rows, the settings card writing `settings.boxes` at once, the empty / off states
 * and the pure helpers (rail index, pill, gauge, marquee items).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import btc1d from "./fixtures/binance-btcusdt-1d.json";
import { analyzeBoxes, boxesCfgOf, boxIdOf, boxKey, boxState, gradePasses, type BoxAnalysis, type BoxTf } from "@/domain/boxes";
import type { Bar } from "@/domain/signals/indicators";
import type { BoxesView, BoxTfView } from "@/market/boxes/store";
import type { ScanView } from "@/market/boxes/scanner";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const load = (j: unknown): Bar[] => (j as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const B4 = load(btc4h);
const B1 = load(btc1d);
const CUT = 1493;
const AT = B4[CUT]!.t;

function tfView(tf: BoxTf, a: BoxAnalysis | null, ivMs: number): BoxTfView {
  return { tf, analysis: a, bars: a ? 700 : 0, closedAt: a ? a.at * 1000 : null, closesAt: a ? a.at * 1000 + 2 * ivMs : null, boxId: a ? boxIdOf(tf, a.box.box) : null, key: boxKey(a) };
}

function realView(over: Partial<BoxesView> = {}): BoxesView {
  const d1 = B1.filter((b) => b.t + 86_400 <= AT);
  const hs = boxState(d1);
  const a4 = analyzeBoxes({ tf: "4h", bars: B4.slice(CUT - 760, CUT), bias: null, htf: { tf: "1d", state: hs } })!;
  const a1 = analyzeBoxes({ tf: "1d", bars: d1 })!;
  const cfg = boxesCfgOf(undefined);
  const tfs = { "4h": tfView("4h", a4, 14_400_000), "1d": tfView("1d", a1, 86_400_000), "1w": tfView("1w", null, 604_800_000) };
  const best = (["4h", "1d"] as const).flatMap((tf) =>
    tfs[tf].analysis!.setups.filter((s) => s.best && gradePasses(s.grade, cfg.minGrade)).map((s) => ({ id: `${tf}:${tfs[tf].boxId}:${s.side}:${s.kind}`, tf, setup: s, analysis: tfs[tf].analysis! })),
  );
  return { state: "ok", detail: null, symbol: "BTCUSDT", cfg, bias: 0, tfs, best, ...over };
}

const SCAN: ScanView = { state: "ok", rows: [], progress: { done: 10, total: 10 }, lastScanAt: Date.now(), nextScanAt: Date.now() + 3_600_000, detail: null, failed: [], watchlist: [], viaProxy: false };

const state = vi.hoisted(() => ({ view: null as unknown, scan: null as unknown }));
vi.mock("@/market/boxes/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/boxes/store")>();
  return { ...actual, useBoxes: () => state.view, getBoxBars: () => [] };
});
vi.mock("@/market/boxes/scanner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/boxes/scanner")>();
  return { ...actual, useScan: () => state.scan, scanNow: vi.fn(() => Promise.resolve()) };
});
// the chart card renders lightweight-charts (canvas): a stub that shows what it would draw
vi.mock("@/views/markt/BoxChartCard", async () => {
  const { toChartBoxes } = await import("@/views/markt/chartBoxes");
  return {
    BoxChartCard: ({ view }: { view: BoxesView }) => <div data-testid="markt-chart" data-boxes={toChartBoxes(view.tfs["4h"].analysis, { intervalMs: 14_400_000 }).length} />,
  };
});

const { MarktView, bandItems, railIndex, pillOf, gaugeY } = await import("@/views/markt");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { MorphDialogProvider } = await import("@/motion/MorphDialog");
const { useJournal } = await import("@/store/journalStore");

function wrap() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <MarktView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  await bootFixtureJournal();
  state.view = realView();
  state.scan = SCAN;
});

describe("MarktView", () => {
  it("h1 Markt, only A+ / A setups with the grade in dot-matrix digits, rail, RSI rows, chart boxes, scanner, settings", () => {
    wrap();
    expect(screen.getByRole("heading", { level: 1, name: "Markt" })).toBeInTheDocument();
    const cards = screen.getAllByTestId("best-setup");
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(["A+", "A"]).toContain(c.getAttribute("data-grade"));
    expect(screen.getAllByRole("img", { name: /^Note A\+?$/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("meter", { name: "Score" })).toBeInTheDocument();
    const rail = screen.getByRole("list", { name: "Phasen der Box" });
    expect(within(rail).getAllByRole("listitem")).toHaveLength(5);
    expect(rail.querySelectorAll("[aria-current=step]")).toHaveLength(1);
    expect(screen.getAllByTestId("rsi-row")).toHaveLength(3);
    expect(Number(screen.getByTestId("markt-chart").getAttribute("data-boxes"))).toBeGreaterThan(0);
    expect(screen.getByTestId("markt-status")).toHaveAttribute("data-state", "ok");
    expect(within(screen.getByTestId("watchlist")).getAllByRole("listitem")).toHaveLength(10);
    // the marquee band names the 4h phase and the A-setup
    expect(screen.getByTestId("markt-band")).toHaveTextContent("4h · In der Box");
  });

  it("a setup opens the dialog with every reason, its weight and the plan", async () => {
    wrap();
    fireEvent.click(screen.getAllByTestId("best-setup")[0]!.closest("button")!);
    const dialog = await screen.findByRole("dialog");
    const explain = within(dialog).getByTestId("setup-explain");
    expect(within(explain).getByRole("heading", { name: "Gründe" })).toBeInTheDocument();
    const reasons = explain.querySelectorAll("li[data-ok]");
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    expect(within(explain).getByText("CRV")).toBeInTheDocument();
    expect(within(explain).getAllByText(/^T1 /).length).toBeGreaterThan(0);
  });

  it("trade the best: no A-setup → the honest empty state and the strongest candidate to watch", () => {
    state.view = realView({ best: [] });
    wrap();
    expect(screen.queryAllByTestId("best-setup")).toHaveLength(0);
    expect(screen.getByText("Gerade kein A-Setup.")).toBeInTheDocument();
    expect(screen.getByTestId("best-watch")).toHaveTextContent(/^Beobachten: /);
  });

  it("off / loading: the status says so, no fake setups", () => {
    state.view = { ...realView(), state: "off", detail: "Box-zu-Box ist aus (Einstellungen auf dieser Seite).", best: [] };
    const { unmount } = wrap();
    expect(screen.getByTestId("markt-status")).toHaveAttribute("data-state", "off");
    expect(within(screen.getByTestId("markt-best")).getByText(/Box-zu-Box ist aus/)).toBeInTheDocument();
    unmount();
    state.view = { ...realView(), state: "loading", detail: "Lade Kerzen …", best: [] };
    wrap();
    expect(screen.getByTestId("best-loading")).toHaveTextContent("Lade Kerzen …");
  });

  it("scanner rows list A+ / A only; an error is said honestly", () => {
    const row = { id: "ETHUSDT:4h:long:range:1", symbol: "ETHUSDT", tf: "4h" as const, setup: realView().best[0]!.setup, phase: "inside" as const, price: 3000, box: null, at: Date.now() };
    state.scan = { ...SCAN, rows: [row] };
    const { unmount } = wrap();
    expect(screen.getByTestId("scan-row")).toHaveAttribute("data-symbol", "ETHUSDT");
    unmount();
    state.scan = { ...SCAN, state: "error", rows: [], detail: "Binance nicht erreichbar (Region/CORS) – kein Proxy in der Datei-Version." };
    wrap();
    expect(screen.getByTestId("scan-empty")).toHaveTextContent(/Binance nicht erreichbar/);
  });

  it("settings write settings.boxes at once: a switch, the minimum grade, a watchlist chip", async () => {
    wrap();
    const save = vi.spyOn(useJournal.getState(), "saveSettings");
    fireEvent.click(screen.getByRole("switch", { name: "Watchlist-Scanner" }));
    await waitFor(() => expect((useJournal.getState().settings as { boxes?: { scanner?: boolean } }).boxes?.scanner).toBe(false));
    fireEvent.click(screen.getByRole("radio", { name: "nur A+" }));
    await waitFor(() => expect((useJournal.getState().settings as { boxes?: { minGrade?: string } }).boxes?.minGrade).toBe("A+"));
    fireEvent.click(screen.getByRole("button", { name: "DOGEUSDT entfernen" }));
    await waitFor(() => expect((useJournal.getState().settings as { boxes?: { watchlist?: string[] } }).boxes?.watchlist).not.toContain("DOGEUSDT"));
    // every other settings key is untouched
    expect(useJournal.getState().settings.market.symbol).toBeTruthy();
    save.mockRestore();
    await act(async () => undefined);
  });
});

describe("Markt helpers", () => {
  it("rail index: pending close sits between box and breakout, a failed breakout falls back", () => {
    expect(railIndex("inside", 0)).toBe(0);
    expect(railIndex("inside", 1)).toBe(1);
    expect(railIndex("failed", 0)).toBe(0);
    expect(railIndex("breakout", 0)).toBe(2);
    expect(railIndex("running", 0)).toBe(2);
    expect(railIndex("retest", 0)).toBe(3);
    expect(railIndex("target", 0)).toBe(4);
    expect(railIndex("none", 0)).toBe(-1);
  });

  it("pill: live after a confirmed breakout, warn while the close is pending", () => {
    const v = realView().tfs["4h"];
    expect(pillOf(v)).toMatchObject({ tone: "muted", label: "In der Box" });
    const a = v.analysis!;
    expect(pillOf({ ...v, analysis: { ...a, box: { ...a.box, pending: 1 } } }).tone).toBe("warn");
    expect(pillOf({ ...v, analysis: { ...a, box: { ...a.box, phase: "breakout", dir: 1 } } })).toMatchObject({ tone: "live", label: "Ausbruch ↑" });
    expect(pillOf({ ...v, analysis: null }).tone).toBe("muted");
  });

  it("gauge: the box spans the middle two thirds, the marker clamps to −25 % … 125 %", () => {
    expect(gaugeY(100, 110, 100, 150)).toBeCloseTo(125);
    expect(gaugeY(110, 110, 100, 150)).toBeCloseTo(25);
    expect(gaugeY(1000, 110, 100, 150)).toBeCloseTo(0);
    expect(gaugeY(1, 110, 100, 150)).toBeCloseTo(150);
  });

  it("marquee items: each timeframe's phase, the A-setups, this session's alerts", () => {
    const items = bandItems(realView(), [{ id: "x", title: "Ausbruch ↑ · BTCUSDT 4h", tone: "win" }]);
    expect(items[0]).toMatchObject({ id: "p:4h", text: "4h · In der Box" });
    expect(items.some((i) => i.id.startsWith("s:"))).toBe(true);
    expect(items.at(-1)).toMatchObject({ text: "Ausbruch ↑ · BTCUSDT 4h", tone: "win" });
  });
});
