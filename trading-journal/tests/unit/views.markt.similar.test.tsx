/**
 * „Ähnliche Situationen“ card (F19) on a fake provider: the distribution with counter-examples and the sample, „zu wenig
 * Daten“ under 20 hits (no shares), a timeframe the feed cannot serve is said so, the unit switch, the hit sheet (replay
 * chart stubbed) and the open request of the assistant.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimCandle } from "@/domain/similar";
import { H, T0, walk } from "./similar.helpers";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const fake = vi.hoisted(() => ({ p: null as unknown }));
vi.mock("@/market/marketStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/marketStore")>();
  return {
    ...actual,
    useProvider: () => fake.p,
    useFeedSelect: (feed: string, select: (v: unknown) => unknown) => select((fake.p as { get(f: string): unknown } | null)?.get(feed)),
    useHealthSelect: (select: (h: unknown) => unknown) => select((fake.p as { getHealth(): unknown } | null)?.getHealth() ?? { feeds: {} }),
  };
});
const stub = vi.hoisted(() => ({ calls: [] as { bars: unknown[]; lines: { label: string }[]; showTrade?: boolean }[] }));
vi.mock("@/chart/ReplayChart", () => ({
  default: (p: { bars: unknown[]; lines: { label: string }[]; showTrade?: boolean }) => {
    stub.calls.push({ bars: p.bars, lines: p.lines, showTrade: p.showTrade });
    return <div data-testid="chart-stub" data-ready="true" />;
  },
}));

const { SimilarCard } = await import("@/views/markt/SimilarCard");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { openSimilar, useSimilarOpen } = await import("@/views/markt/similarOpen");

const H4 = 4 * H;

function install(feeds: Record<string, SimCandle[]>, now: number): void {
  const stamped = (data: unknown) => ({ data, asOf: now, receivedAt: now, source: "binance", comparable: true });
  const sf = Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, stamped(v)]));
  fake.p = { symbolInfo: { binance: "BTCUSDT" }, serverNow: () => now, get: (f: string) => sf[f], snapshot: () => ({}), getHealth: () => ({ feeds: {} }) };
}

const wrap = () =>
  render(
    <MotionRoot>
      <SimilarCard />
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  fake.p = null;
  localStorage.clear();
  stub.calls.length = 0;
  Element.prototype.scrollIntoView = vi.fn();
  await bootFixtureJournal();
});
afterEach(() => {
  useSimilarOpen.setState({ pending: false, seq: 0 });
});

describe("SimilarCard", () => {
  it("shows the headline with its range, the bar, the baseline, the counter-examples and the sample – and the caveats", async () => {
    const c = walk(900, 5, H4);
    install({ kline_4h: c }, T0 + 900 * H4);
    wrap();
    const summary = await screen.findByTestId("similar-summary");
    expect(screen.getByTestId("markt-similar")).toHaveAttribute("data-status", "ok");
    expect(within(summary).getByTestId("similar-headline").textContent).toMatch(/^In \d+ von \d+ ähnlichen Situationen lag der Kurs nach 12 Kerzen (höher|tiefer) \(\d+ %, Spanne \d+–\d+ %\)\.$/);
    expect(within(summary).getByTestId("similar-bar")).toHaveAttribute("role", "img");
    expect(screen.getByTestId("similar-baseline").textContent).toMatch(/Im ganzen Zeitraum/);
    // counter-examples: present and every one of them marked in the sample
    const counters = screen.getByTestId("similar-counters");
    expect(within(counters).getByRole("heading", { name: "Gegenbeispiele" })).toBeInTheDocument();
    const sample = screen.getByTestId("similar-sample");
    expect(within(sample).getAllByTestId("similar-hit").length).toBe(8);
    expect(screen.getByTestId("similar-caveats").textContent).toMatch(/keine Prognose/);
    expect(screen.getByTestId("similar-caveats").textContent).toMatch(/Mehrfachtest/);
    expect(screen.getByTestId("similar-how").textContent).toMatch(/Merkmale/);
  });

  it("under 20 hits: „Zu wenig Daten“, no shares, no verdict – the hits can still be looked at", async () => {
    install({ kline_4h: walk(130, 5, H4) }, T0 + 130 * H4);
    wrap();
    const few = await screen.findByTestId("similar-few");
    expect(few.textContent).toMatch(/Zu wenig Daten/);
    expect(screen.queryByTestId("similar-summary")).toBeNull();
    expect(screen.queryByTestId("similar-bar")).toBeNull();
    expect(screen.queryByTestId("similar-counters")).toBeNull();
  });

  it("a timeframe the feed cannot serve says why and is not replaced", async () => {
    install({ kline_4h: walk(300, 5, H4) }, T0 + 300 * H4);
    wrap();
    await screen.findByTestId("markt-similar");
    fireEvent.click(within(screen.getByTestId("similar-tfs")).getByRole("button", { name: "1D" }));
    expect(await screen.findByTestId("similar-waiting")).toHaveTextContent("1D-Kerzen werden geladen …");
    expect(screen.queryByTestId("similar-summary")).toBeNull();
  });

  it("without a running market there are no candles to compare, and it says so", async () => {
    fake.p = null;
    wrap();
    expect(await screen.findByTestId("similar-waiting")).toHaveTextContent("Der Live-Markt läuft nicht");
  });

  it("the unit switch re-reads the same hits in percent", async () => {
    install({ kline_4h: walk(900, 5, H4) }, T0 + 900 * H4);
    wrap();
    await screen.findByTestId("similar-summary");
    const first = screen.getAllByTestId("similar-hit")[0]!;
    const idx = first.getAttribute("data-index");
    expect(first.textContent).toMatch(/ R/);
    fireEvent.click(screen.getByRole("radio", { name: "%" }));
    await waitFor(() => expect(screen.getAllByTestId("similar-hit")[0]!.textContent).toMatch(/ %/));
    expect(screen.getAllByTestId("similar-hit")[0]!.getAttribute("data-index")).toBe(idx);
    // the choice is remembered on this device
    expect(JSON.parse(localStorage.getItem([...Object.keys(localStorage)].find((k) => k.endsWith("similar"))!)!)).toMatchObject({ unit: "pct", tf: "4h" });
  });

  it("features can be switched; a feature that makes no sense on the timeframe is disabled with its reason", async () => {
    install({ kline_4h: walk(900, 5, H4) }, T0 + 900 * H4);
    wrap();
    await screen.findByTestId("similar-summary");
    fireEvent.click(screen.getByTestId("similar-features-toggle"));
    const feats = screen.getByTestId("similar-features");
    expect(within(feats).getByRole("button", { name: "Session" })).toBeDisabled(); // 4h spans several sessions
    const vol = within(feats).getByRole("button", { name: "Volumen relativ" });
    expect(vol).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(vol);
    await waitFor(() => expect(within(screen.getByTestId("similar-features")).getByRole("button", { name: "Volumen relativ" })).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByTestId("similar-how").textContent).not.toMatch(/Volumen relativ/);
  });

  it("a hit opens the sheet: the replay chart gets the situation without the trade drawing, the reference lines and the values", async () => {
    install({ kline_4h: walk(900, 5, H4) }, T0 + 900 * H4);
    wrap();
    await screen.findByTestId("similar-summary");
    fireEvent.click(screen.getAllByTestId("similar-hit")[0]!);
    const sheet = await screen.findByTestId("similar-sheet");
    expect(within(sheet).getByTestId("similar-sheet-outcome").textContent).toMatch(/max\./);
    expect(await within(sheet).findByTestId("chart-stub")).toBeInTheDocument();
    const call = stub.calls.at(-1)!;
    expect(call.showTrade).toBe(false);
    expect(call.lines.map((l) => l.label)).toEqual(["Fundstelle (Schluss)", "+1 R", "−1 R"]);
    expect(within(sheet).getByTestId("similar-sheet-values").textContent).toMatch(/RSI-Stand/);
  });

  it("the open request of the assistant scrolls to the card and is consumed", async () => {
    install({ kline_4h: walk(300, 5, H4) }, T0 + 300 * H4);
    openSimilar();
    wrap();
    await screen.findByTestId("markt-similar");
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(useSimilarOpen.getState().pending).toBe(false);
    // a second request reaches the mounted card
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    act(() => openSimilar());
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1));
  });
});
