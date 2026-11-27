/**
 * "Top-Trader (Binance)" in the Long signal: the plaque in every state (keine Daten, lädt, zu wenig Verlauf, live,
 * veraltet), the chart that opens lazily (canvas painted with the zero line, both areas, the price line and the flip mark;
 * crosshair readout by keyboard), the wording (never Wale / Glassnode, one sentence what it is and is not), the geometry,
 * and the card: only the Long view carries it, the "Warum"-Begründung gets ONE row, the verdict is unchanged.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTraderNet, type NetPriceBar, type NetRatioPoint } from "@/domain/signals";
import type { LiveTraderNet, SignalCheckState } from "@/market";
import { installDomPolyfills, bootFixtureJournal } from "./views.overview.harness";
import { gradedSnapshot, v2check } from "./views.overview.signalFixtures";

const live = vi.hoisted(() => ({ state: null as unknown as SignalCheckState, listeners: new Set<() => void>(), net: null as unknown as LiveTraderNet }));
vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (cb: () => void) => {
    live.listeners.add(cb);
    return () => void live.listeners.delete(cb);
  };
  return { ...actual, useSignalCheck: () => useSyncExternalStore(subscribe, () => live.state, () => live.state), useTraderNet: () => live.net };
});

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { SignalCard } from "@/views/overview/SignalCard";
import { paintNet } from "@/views/overview/TraderNetChart";
import { TraderNetSection } from "@/views/overview/TraderNetSection";
import { chartLabel, niceMax, nearestIndex, netGeometry, readoutOf, NET_CHART_H } from "@/views/overview/traderNetChart";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);
const NOW = T0 + 3.5 * 24 * H;
const pts = (nets: number[]): NetRatioPoint[] => nets.map((n, i) => ({ time: T0 + i * H, longPct: 50 + n / 2, shortPct: 50 - n / 2 }));
const bars = (n: number): NetPriceBar[] => Array.from({ length: n }, (_, i) => ({ time: T0 + i * H, open: 70_000 + i * 10, close: 70_005 + i * 10 }));
const FLIPPED = [12, 12, 12, 12, 12, 12, 12, 4, -4, -10, -10, -10, -10, -10];
const net = (nets: number[], extra: Partial<LiveTraderNet> = {}): LiveTraderNet => ({ view: buildTraderNet(pts(nets), bars(30), NOW, H), status: "live", stepMs: H, source: "binance", ...extra });
const none = (detail: string, status: LiveTraderNet["status"] = "none"): LiveTraderNet => ({ view: null, status, detail, stepMs: null, source: null });

/** A recording 2-D context: every method is a spy, gradients and text metrics answer. */
function fakeCtx() {
  const calls: Array<[string, unknown[]]> = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      if (k === "measureText") return () => ({ width: 60 });
      return (...a: unknown[]) => void calls.push([k, a]);
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("TraderNetSection states", () => {
  const wrap = (n: LiveTraderNet) => render(<TraderNetSection net={n} />);

  it("keine Daten: the reason, no expander, nothing to open", () => {
    wrap(none("Binance blockiert (Region)"));
    const s = screen.getByTestId("trader-net");
    expect(s).toHaveAttribute("data-state", "none");
    expect(s).toHaveTextContent("Top-Trader (Binance)");
    expect(screen.getByTestId("trader-net-headline")).toHaveTextContent("Binance blockiert (Region)");
    expect(within(s).getByText("keine Daten")).toBeInTheDocument();
    expect(within(s).queryByRole("button")).toBeNull();
  });
  it("lädt and zu wenig Verlauf", () => {
    const { unmount } = wrap(none("Top-Trader-Daten werden geladen …", "loading"));
    expect(screen.getByTestId("trader-net")).toHaveAttribute("data-state", "loading");
    expect(screen.getByText("lädt")).toBeInTheDocument();
    unmount();
    wrap({ ...net([3, 4, 5]), view: buildTraderNet(pts([3, 4, 5]), [], NOW, H) });
    expect(screen.getByTestId("trader-net")).toHaveAttribute("data-state", "short");
    expect(screen.getByTestId("trader-net-headline")).toHaveTextContent("zu wenig Verlauf");
    expect(screen.getByTestId("trader-net-detail")).toHaveTextContent("Erst 3 Punkte geladen");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("live and flipped to Short: badge, since-when headline, net and price since the flip; reserves two detail lines", () => {
    wrap(net(FLIPPED));
    const s = screen.getByTestId("trader-net");
    expect(s).toHaveAttribute("data-state", "ok");
    expect(s).toHaveAttribute("data-side", "short");
    expect(within(s).getByText("Netto Short")).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-headline")).toHaveTextContent("netto Short, seit 3 Tagen umgeschlagen");
    expect(screen.getByTestId("trader-net-detail")).toHaveTextContent(/Netto −10,0 Pkt\. \(Long 45,0 %\) · Preis seit dem Umschlag/);
    expect(screen.getByTestId("trader-net-detail").className).toContain("min-h-[2.75em]");
    expect(screen.getByRole("button", { name: /Details zeigen: Top-Trader \(Binance\) netto/ })).toBeInTheDocument();
  });
  it("net Long with no flip says so for the loaded history; stale gets a warning badge and the reason", () => {
    const calm = Array.from({ length: 20 }, () => 9);
    const { unmount } = wrap(net(calm));
    expect(screen.getByTestId("trader-net-headline")).toHaveTextContent("netto Long, im geladenen Verlauf (19 Std.) unverändert");
    unmount();
    wrap(net(calm, { status: "stale", detail: "Top-Trader-Daten veraltet" }));
    expect(screen.getByText("veraltet")).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-detail")).toHaveTextContent("Top-Trader-Daten veraltet");
  });
  it("never calls the series Wale or Glassnode", () => {
    wrap(net(FLIPPED));
    expect(document.body.textContent).not.toMatch(/Wal(e|s)|Glassnode/i);
  });
});

describe("TraderNetSection chart", () => {
  let paint: ReturnType<typeof fakeCtx>;
  beforeAll(() => installDomPolyfills());
  beforeEach(() => {
    paint = fakeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => paint.ctx as never);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 340 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });

  it("opens lazily, names itself, states what the series is and is not, and paints the flip mark", async () => {
    render(<TraderNetSection net={net(FLIPPED)} />);
    expect(screen.queryByTestId("trader-net-chart")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Details zeigen/ }));
    const chart = await screen.findByTestId("trader-net-chart");
    expect(chart).toHaveAttribute("role", "group");
    expect(chart).toHaveAccessibleName(/^Top-Trader \(Binance\) netto, 14 Punkte von 01\.10\. bis 01\.10\.: zuletzt −10,0 Pkt\., letzter Wechsel nach Short am 01\.10\.\.$/);
    expect(chart).toHaveAttribute("data-points", "14");
    expect(chart).toHaveStyle({ height: `${NET_CHART_H}px` });
    expect(screen.getByTestId("trader-net-help")).toHaveTextContent(/Long minus Short der größten Konten .* auf Binance Futures/);
    expect(screen.getByTestId("trader-net-help")).toHaveTextContent("Keine On-Chain-Wale und nur eine Börse");
    expect(screen.getByTestId("trader-net-legend")).toHaveTextContent("BTC-Preis (eigene Skala)");
    // the finished chart (reduced motion off in jsdom: the wipe runs on rAF; paint it directly as the component does at 100 %)
    const v = net(FLIPPED).view!;
    const g = netGeometry(v.points, 340)!;
    const p = fakeCtx();
    paintNet(p.ctx, g, v, 1);
    const names = p.calls.map((c) => c[0]);
    expect(names.filter((n) => n === "fill").length).toBeGreaterThanOrEqual(4); // green + red area, ring, label pill ...
    expect(p.calls.some((c) => c[0] === "fillText" && c[1][0] === "Short ab 01.10.")).toBe(true);
    expect(p.calls.some((c) => c[0] === "fillText" && c[1][0] === "+20")).toBe(true);
    expect(p.calls.some((c) => c[0] === "fillText" && c[1][0] === "−20")).toBe(true);
    expect(p.calls.some((c) => c[0] === "setLineDash" && (c[1][0] as number[]).length === 2)).toBe(true);
    // half way through the wipe there is no flip mark yet
    const half = fakeCtx();
    paintNet(half.ctx, g, v, 0.5);
    expect(half.calls.some((c) => c[0] === "fillText" && String(c[1][0]).includes("ab 01.10."))).toBe(false);
  });

  it("the arrow keys move the crosshair readout (announced politely), Escape and blur close it", async () => {
    render(<TraderNetSection net={net(FLIPPED)} />);
    fireEvent.click(screen.getByRole("button", { name: /Details zeigen/ }));
    const chart = await screen.findByTestId("trader-net-chart");
    await waitFor(() => expect(chart.querySelector("canvas")!.width).toBeGreaterThan(0));
    chart.focus();
    const tip = screen.getByTestId("trader-net-tip");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    // from the newest point one step back
    expect(tip).toHaveTextContent("Netto −10,0 Pkt. · Long 45,0 %");
    expect(tip.style.opacity).toBe("1");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(tip).toHaveTextContent("01.10., 00:00 UTC");
    expect(tip).toHaveTextContent("Netto +12,0 Pkt. · Long 56,0 %");
    expect(tip).toHaveTextContent("Preis 70.000");
    expect(chart.querySelector("[aria-live=polite]")).toHaveTextContent("01.10., 00:00 UTC: Netto +12,0 Pkt. · Long 56,0 %, Preis 70.000");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(tip.style.opacity).toBe("0");
    fireEvent.keyDown(chart, { key: "End" });
    expect(tip.style.opacity).toBe("1");
    act(() => chart.blur());
    expect(tip.style.opacity).toBe("0");
  });

  it("a price gap shows 'Preis –' in the readout", async () => {
    const short = { ...net(FLIPPED), view: buildTraderNet(pts(FLIPPED), bars(5), NOW, H) };
    render(<TraderNetSection net={short} />);
    fireEvent.click(screen.getByRole("button", { name: /Details zeigen/ }));
    const chart = await screen.findByTestId("trader-net-chart");
    await waitFor(() => expect(chart.querySelector("canvas")!.width).toBeGreaterThan(0));
    chart.focus();
    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByTestId("trader-net-tip")).toHaveTextContent("Preis –");
  });
});

describe("chart geometry and texts", () => {
  const v = net(FLIPPED).view!;
  it("niceMax picks the smallest nice half range", () => {
    expect([1, 5, 6, 11, 20, 21, 33, 45, 99].map(niceMax)).toEqual([5, 5, 10, 20, 20, 25, 40, 50, 100]);
  });
  it("net axis is symmetric around a centred zero line; x runs over time; the price has its own scale", () => {
    const g = netGeometry(v.points, 340)!;
    expect(g.max).toBe(20);
    expect(g.y(0)).toBe(g.zeroY);
    expect(g.zeroY).toBeCloseTo((g.top + g.bottom) / 2, 10);
    expect(g.y(20)).toBeCloseTo(g.top, 10);
    expect(g.y(-20)).toBeCloseTo(g.bottom, 10);
    expect(g.x(v.points[0]!.t)).toBe(g.left);
    expect(g.x(v.points[13]!.t)).toBe(g.right);
    expect(g.yPrice(g.pMin!)).toBeGreaterThan(g.yPrice(g.pMax!));
    expect(netGeometry(v.points, 20)).toBeNull();
    expect(netGeometry(v.points.slice(0, 1), 340)).toBeNull();
  });
  it("nearestIndex snaps to the closest point and clamps outside the plot", () => {
    const g = netGeometry(v.points, 340)!;
    expect(nearestIndex(v.points, g, -50)).toBe(0);
    expect(nearestIndex(v.points, g, 999)).toBe(13);
    expect(nearestIndex(v.points, g, g.x(v.points[6]!.t) + 1)).toBe(6);
    expect(nearestIndex([], g, 10)).toBe(-1);
  });
  it("readout and chart label are facts only", () => {
    expect(readoutOf(v.points[0]!)).toMatchObject({ stamp: "01.10., 00:00 UTC", net: "Netto +12,0 Pkt. · Long 56,0 %", price: "Preis 70.000" });
    expect(chartLabel(v)).toContain("letzter Wechsel nach Short");
    expect(chartLabel(net(Array.from({ length: 14 }, () => 5)).view!)).toContain("kein Wechsel im geladenen Verlauf");
  });
});

describe("SignalCard: Long only, one row in the Begründung, verdict unchanged", () => {
  const bottom = (barsAgo = 0) => ({ kind: "bottom" as const, barsAgo });
  const snap = () => gradedSnapshot([v2check("30m", { long: bottom(), rsi: 28 }), v2check("45m", { long: bottom(), rsi: 33 }), v2check("1h", { rsi: 36, pos: 0.2 }), v2check("4h", { rsi: 44 })]);
  const wrap = () =>
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <SignalCard />
        </MorphDialogProvider>
      </MotionRoot>,
    );
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    live.listeners.clear();
    await bootFixtureJournal();
    live.state = { state: "ok", snapshot: snap(), updatedAt: 1, message: null };
    live.net = net(FLIPPED);
  });

  it("the Long view carries the plaque between the reasons and the Begründung; the Short view does not", () => {
    wrap();
    const card = screen.getByTestId("signal-card");
    const plaque = within(card).getByTestId("trader-net");
    const why = within(card).getByTestId("why-section");
    expect(plaque.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(plaque).getByTestId("trader-net-headline")).toHaveTextContent("netto Short, seit 3 Tagen umgeschlagen");
    fireEvent.click(within(card).getByRole("radio", { name: "Short" }));
    expect(within(card).queryByTestId("trader-net")).toBeNull();
    fireEvent.click(within(card).getByRole("radio", { name: "Long" }));
    expect(within(card).getByTestId("trader-net")).toBeInTheDocument();
  });

  it("the Begründung gets exactly one extra optional row with the sentence; decision and headline match the run without data", () => {
    const { unmount } = wrap();
    const why = screen.getByTestId("why-section");
    fireEvent.click(within(why).getByRole("button", { name: /Details zeigen/ }));
    const optional = within(screen.getByTestId("why-optional"));
    const row = optional.getByText("Top-Trader (Binance): netto").closest("li")!;
    expect(row).toHaveAttribute("data-status", "unmet");
    expect(row).toHaveTextContent("netto Short");
    expect(row).toHaveTextContent("ändert die Bewertung aber nicht");
    const withNet = { decision: why.getAttribute("data-decision"), head: screen.getByTestId("why-headline").textContent, score: screen.getByTestId("signal-card").textContent!.match(/\d+\s*\/\s*100|Score \d+/)?.[0] };
    expect(within(screen.getByTestId("why-conflicts")).queryByText(/Top-Trader \(Binance\)/)).toBeNull();
    unmount();
    live.net = none("Binance blockiert (Region)");
    wrap();
    const why2 = screen.getByTestId("why-section");
    fireEvent.click(within(why2).getByRole("button", { name: /Details zeigen/ }));
    expect(within(screen.getByTestId("why-optional")).queryByText("Top-Trader (Binance): netto")).toBeNull();
    expect({ decision: why2.getAttribute("data-decision"), head: screen.getByTestId("why-headline").textContent, score: screen.getByTestId("signal-card").textContent!.match(/\d+\s*\/\s*100|Score \d+/)?.[0] }).toEqual(withNet);
  });

  it("while the card has no data the plaque still shows the reason and the card stays usable", () => {
    live.net = none("Nur mit Binance");
    wrap();
    expect(screen.getByTestId("trader-net-headline")).toHaveTextContent("Nur mit Binance");
    expect(screen.getByTestId("signal-card")).toHaveAttribute("data-state", "ok");
  });
});
