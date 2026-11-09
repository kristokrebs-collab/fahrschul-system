/**
 * "Top-Trader: Netto Long/Short" on the Markt page: the card in every state (live with an earlier flip / without one / never
 * flipped, zu wenig Verlauf, lädt, keine Daten with the Bybit/OKX reason, veraltet), the headline and key figures, the range
 * switch with the real length, the plot (canvas painted with the zero line, both areas, the price axis, the arrow and label at
 * the flip; crosshair readout by keyboard; the hover glow layer), the pure model (ranges, ticks, label placement, texts) and the
 * wording (never Wale / Glassnode as a name). jsdom, no network: fapi.binance.com answers 451 from the sandbox.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTraderNet, type NetPriceBar, type NetRatioPoint } from "@/domain/signals";
import type { LiveTraderNet } from "@/market";
import { installDomPolyfills } from "./views.overview.harness";

const live = vi.hoisted(() => ({ net: null as unknown as LiveTraderNet }));
vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  return { ...actual, useTraderNet: () => live.net, useProvider: () => ({ symbolInfo: { base: "BTC" } }) };
});

import { MotionRoot } from "@/motion/MotionRoot";
import { netGeometry } from "@/views/overview/traderNetChart";
import TraderNetCard from "@/views/markt/TraderNetCard";
import { paintGlow, paintPlot } from "@/views/markt/TraderNetPlot";
import { flipIn, kpisOf, loadedLine, lengthLabel, netTicks, niceStep, pillPlacement, plotLabel, plotPad, priceTicks, rangeChoices, timeTicks, windowPoints, type Kpi } from "@/views/markt/traderNetCardModel";
import { NETCARD } from "@/views/markt/traderNetStrings";

const H = 3_600_000;
const STEP = 6 * H;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 9, 1);
const run = (net: number, n: number): number[] => Array.from({ length: n }, () => net);
const pts = (nets: number[], step = STEP): NetRatioPoint[] => nets.map((n, i) => ({ time: T0 + i * step, longPct: 50 + n / 2, shortPct: 50 - n / 2 }));
const bars = (n: number, step = STEP): NetPriceBar[] => Array.from({ length: n }, (_, i) => ({ time: T0 + i * step, open: 70_000 + i * 20, close: 70_010 + i * 20 }));
const NOW = T0 + 100 * STEP;
/** 40 short, 40 long, 20 short: two flips in 25 days */
const TWO = [...run(-10, 40), ...run(10, 40), ...run(-10, 20)];
/** one flip to Short after 70 long points */
const ONE = [...run(10, 70), ...run(-10, 30)];
const net = (nets: number[], extra: Partial<LiveTraderNet> = {}): LiveTraderNet => ({ view: buildTraderNet(pts(nets), bars(100), NOW, STEP), status: "live", stepMs: STEP, source: "binance", ...extra });
const none = (detail: string, status: LiveTraderNet["status"] = "none"): LiveTraderNet => ({ view: null, status, detail, stepMs: null, source: null });

/** A recording 2-D context: every method is a spy, gradients and text metrics answer. */
function fakeCtx() {
  const calls: Array<[string, unknown[]]> = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      if (k === "measureText") return () => ({ width: 120 });
      return (...a: unknown[]) => void calls.push([k, a]);
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
const texts = (calls: Array<[string, unknown[]]>): string[] => calls.filter((c) => c[0] === "fillText").map((c) => String(c[1][0]));

const wrap = (n: LiveTraderNet) => {
  live.net = n;
  return render(
    <MotionRoot>
      <TraderNetCard />
    </MotionRoot>,
  );
};

describe("TraderNetCard states", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeCtx().ctx as never);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 340 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 256 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("an earlier flip exists: the headline names both dates, badge and key figures say the facts", () => {
    wrap(net(TWO));
    const card = screen.getByTestId("markt-trader-net");
    expect(card).toHaveAttribute("data-state", "ok");
    expect(card).toHaveAttribute("data-side", "short");
    expect(card).toHaveAttribute("data-kind", "since-previous");
    expect(screen.getByRole("heading", { level: 2, name: NETCARD.title })).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent(/^Top-Trader \(Binance\) sind seit 20\.10\. netto Short – erstmals seit 10\.10\.$/);
    expect(within(card).getByText("Netto Short")).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-kpi-net-value")).toHaveTextContent("−10,0 Pkt.");
    expect(screen.getByTestId("trader-net-kpi-since-value")).toHaveTextContent(/^\d+ (Std\.|Tage)$/);
    expect(screen.getByTestId("trader-net-kpi-price-value")).toHaveTextContent(/^[+−]\d+,\d %$/);
    expect(screen.getByTestId("trader-net-line")).toHaveTextContent("Geladener Verlauf: 24 Tage (100 Punkte, Abstand 6 Std.) · Zeiten in UTC");
  });

  it("the only flip of the loaded history says so and invents no earlier date", () => {
    wrap(net(ONE));
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent(/^Top-Trader \(Binance\) sind seit \d\d\.\d\d\. netto Short – im geladenen Verlauf von 24 Tagen erstmals\.$/);
    expect(screen.getByTestId("trader-net-title").textContent).not.toMatch(/erstmals seit|März/);
  });

  it("never flipped: seit mindestens N, kein Umschlag; the since figure says so", () => {
    wrap(net(run(9, 100)));
    expect(screen.getByTestId("markt-trader-net")).toHaveAttribute("data-kind", "no-flip");
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent("Top-Trader (Binance) sind seit mindestens 24 Tagen netto Long – kein Umschlag im geladenen Verlauf.");
    expect(screen.getByTestId("trader-net-kpi-since-value")).toHaveTextContent("–");
    expect(screen.getByTestId("trader-net-kpi-since")).toHaveTextContent("kein Umschlag im Verlauf");
    expect(screen.getByTestId("trader-net-kpi-price-value")).toHaveTextContent("–");
  });

  it("zu wenig Verlauf: the sentence says how many points, no plot, no range switch", () => {
    wrap({ ...net([3, 4, 5]), view: buildTraderNet(pts([3, 4, 5]), [], NOW, STEP) });
    expect(screen.getByTestId("markt-trader-net")).toHaveAttribute("data-state", "short");
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent("Zu wenig Verlauf: erst 3 Punkte von Binance geladen, ab 12 zeichnet die Karte den Verlauf.");
    expect(screen.getByText("zu wenig Verlauf", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByTestId("trader-net-plot")).toBeNull();
    expect(screen.getByTestId("trader-net-empty")).toBeInTheDocument();
    // the range switch is not offered (only the series switch is there)
    expect(screen.queryByRole("radiogroup", { name: "Zeitraum" })).toBeNull();
  });

  it("keine Daten (Bybit/OKX source, blocked region, offline): the reason in the card, no plot, no invented numbers", () => {
    for (const reason of ["Nur mit Binance", "Binance blockiert (Region)", "Offline"]) {
      const { unmount } = wrap(none(reason));
      expect(screen.getByTestId("markt-trader-net")).toHaveAttribute("data-state", "none");
      expect(screen.getByTestId("trader-net-title")).toHaveTextContent("Keine Top-Trader-Daten von Binance");
      expect(screen.getByTestId("trader-net-line")).toHaveTextContent(reason);
      expect(screen.getByTestId("trader-net-empty")).toHaveTextContent(reason);
      expect(screen.getByTestId("trader-net-kpi-net-value")).toHaveTextContent("–");
      expect(screen.queryByTestId("trader-net-plot")).toBeNull();
      unmount();
    }
  });

  it("lädt: a loader in the plot's box, nothing claimed", () => {
    wrap(none(NETCARD.loading, "loading"));
    expect(screen.getByTestId("markt-trader-net")).toHaveAttribute("data-state", "loading");
    expect(screen.getByText("lädt", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent(NETCARD.loading);
    expect(screen.getByTestId("trader-net-empty").className).toContain("h-[256px]");
  });

  it("veraltet: a warning badge and the reason next to the facts, the plot stays", () => {
    wrap(net(ONE, { status: "stale", detail: "Top-Trader-Daten veraltet" }));
    expect(screen.getByTestId("markt-trader-net")).toHaveAttribute("data-state", "stale");
    expect(screen.getByText("veraltet")).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-line")).toHaveTextContent("Top-Trader-Daten veraltet");
    expect(screen.getByTestId("trader-net-plot")).toBeInTheDocument();
  });

  it("never calls the series Wale or Glassnode; the help line says what it is and is not", () => {
    wrap(net(TWO));
    const card = screen.getByTestId("markt-trader-net");
    expect(card.textContent!.replace("keine On-Chain-Wale", "")).not.toMatch(/Wal(e|s)|Glassnode/i);
    const help = screen.getByTestId("trader-net-help");
    expect(help).toHaveTextContent("größten Konten (obere 20 % nach Einsatz) auf Binance Futures");
    expect(help).toHaveTextContent("keine On-Chain-Wale");
    expect(help).toHaveTextContent("sagt nichts über den Kurs voraus");
    expect(screen.getByTestId("trader-net-legend")).toHaveTextContent("BTC-Preislinie (Skala rechts)");
  });

  it("the range switch offers 7 / 30 / 90 Tage and Alles with the real length (a range the history does not fill is shown but disabled), and the plot follows", async () => {
    wrap(net(TWO));
    const group = screen.getByRole("radiogroup", { name: "Zeitraum" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["7 Tage", "30 Tage", "90 Tage", "Alles · 24 Tage"]);
    expect(radios.map((r) => (r as HTMLButtonElement).disabled)).toEqual([false, true, true, false]);
    const plot = await screen.findByTestId("trader-net-plot");
    expect(plot).toHaveAttribute("data-points", "100");
    fireEvent.click(within(group).getByRole("radio", { name: "7 Tage" }));
    expect(screen.getByTestId("trader-net-plot")).toHaveAttribute("data-points", "29");
    // the last flip (point 79) lies inside the last 7 days: still marked; the headline always talks about the whole history
    expect(screen.getByTestId("trader-net-plot")).not.toHaveAttribute("data-flip", "none");
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent(/erstmals seit 10\.10\.$/);
    fireEvent.click(within(group).getByRole("radio", { name: "Alles · 24 Tage" }));
    expect(screen.getByTestId("trader-net-plot")).toHaveAttribute("data-points", "100");
  });

  it("a history shorter than a week: every range is disabled, only Alles can be taken", () => {
    const short = Array.from({ length: 20 }, (_, i) => (i < 10 ? 8 : -8));
    live.net = { ...net(short), view: buildTraderNet(pts(short, H), bars(20, H), T0 + 20 * H, H), stepMs: H };
    render(
      <MotionRoot>
        <TraderNetCard />
      </MotionRoot>,
    );
    const group = screen.getByRole("radiogroup", { name: "Zeitraum" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["7 Tage", "30 Tage", "90 Tage", "Alles · 19 Std."]);
    expect(radios.map((r) => (r as HTMLButtonElement).disabled)).toEqual([true, true, true, false]);
    expect(radios[3]).toBeChecked();
  });

  it("the plot is a named group; the arrow keys move the crosshair readout (announced politely), Escape and blur close it", async () => {
    wrap(net(TWO));
    const plot = await screen.findByTestId("trader-net-plot");
    expect(plot).toHaveAttribute("role", "group");
    expect(plot).toHaveAccessibleName(/^Top-Trader \(Binance\) netto, 100 Punkte von 01\.10\. bis 25\.10\.: zuletzt −10,0 Pkt\., letzter Umschlag zu Short am 20\.10\.\.(?: Marken der Alarm-Regel: .+\.)?$/);
    await waitFor(() => expect(plot.querySelector("canvas")!.width).toBeGreaterThan(0));
    plot.focus();
    const tip = screen.getByTestId("trader-net-tip");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(tip).toHaveTextContent("Netto −10,0 Pkt. · Long 45,0 %");
    expect(tip.style.opacity).toBe("1");
    fireEvent.keyDown(plot, { key: "Home" });
    expect(tip).toHaveTextContent("01.10., 00:00 UTC");
    expect(tip).toHaveTextContent("Netto −10,0 Pkt. · Long 45,0 %");
    expect(tip).toHaveTextContent("BTC 70.000");
    expect(plot.querySelector("[aria-live=polite]")).toHaveTextContent("01.10., 00:00 UTC: Netto −10,0 Pkt. · Long 45,0 %, BTC 70.000");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(tip.style.opacity).toBe("0");
    fireEvent.keyDown(plot, { key: "End" });
    expect(tip.style.opacity).toBe("1");
    act(() => plot.blur());
    expect(tip.style.opacity).toBe("0");
    expect(screen.getByTestId("trader-net-glow").style.opacity).toBe("0");
  });

  it("the ring for the pulse sits at the flip (and is absent when the flip lies outside the range)", async () => {
    wrap(net(TWO));
    expect(await screen.findByTestId("trader-net-ring")).toHaveClass("border-loss");
    const group = screen.getByRole("radiogroup", { name: "Zeitraum" });
    // the flip to Short is 5 days old: inside the last 7 days, so the ring stays
    fireEvent.click(within(group).getByRole("radio", { name: "7 Tage" }));
    expect(screen.getByTestId("trader-net-ring")).toBeInTheDocument();
  });
});

describe("the plot painter", () => {
  const v = net(TWO).view!;
  const pad = plotPad(340);
  const g = netGeometry(v.points, 340, 256, pad)!;

  it("paints both areas, the zero line, the axes, the price line, the arrow with its label and a ring at the flip", () => {
    const p = fakeCtx();
    paintPlot(p.ctx, g, v.points, v.flip, 1);
    const t = texts(p.calls);
    expect(t).toContain("Umschlag zu Short · 20.10.");
    // the two axes are named: points of net on the left, the price (its own scale) on the right
    expect(t).toContain("Pkt.");
    expect(t).toContain("BTC");
    expect(t).toContain("+10");
    expect(t).toContain("0");
    expect(t).toContain("−10");
    expect(t.some((x) => /^7\d\.\d{3}$/.test(x)), "price axis labels").toBe(true);
    expect(t.some((x) => /^\d\d\.\d\d\.$/.test(x)), "time axis labels").toBe(true);
    const names = p.calls.map((c) => c[0]);
    expect(names.filter((n) => n === "fill").length).toBeGreaterThanOrEqual(5); // two areas, the pill, the arrow head, the ring, the dots
    expect(names).toContain("clip");
    expect(p.calls.some((c) => c[0] === "setLineDash" && (c[1][0] as number[]).length === 2)).toBe(true);
    // a long flip is labelled as such
    const up = netGeometry(net([...run(-10, 70), ...run(10, 30)]).view!.points, 340, 256, pad)!;
    const q = fakeCtx();
    const uv = net([...run(-10, 70), ...run(10, 30)]).view!;
    paintPlot(q.ctx, up, uv.points, uv.flip, 1);
    expect(texts(q.calls).some((x) => x.startsWith("Umschlag zu Long · "))).toBe(true);
  });

  it("half way through the draw-in there is no arrow and no label yet, but the head rides the tip", () => {
    const half = fakeCtx();
    paintPlot(half.ctx, g, v.points, v.flip, 0.5);
    expect(texts(half.calls).some((x) => x.startsWith("Umschlag"))).toBe(false);
    // axes first, then the clipped curve: a clip rectangle that grows with the progress
    const clip = half.calls.find((c) => c[0] === "rect" && (c[1][2] as number) > 0 && (c[1][2] as number) < g.w);
    expect(clip).toBeTruthy();
    expect(half.calls.filter((c) => c[0] === "arc").length).toBeGreaterThanOrEqual(2); // halo + head
    const start = fakeCtx();
    paintPlot(start.ctx, g, v.points, v.flip, 0);
    expect(texts(start.calls).length).toBeGreaterThan(3); // the axes stand there before the curve is drawn
  });

  it("without a flip in the range there is no arrow", () => {
    const p = fakeCtx();
    paintPlot(p.ctx, g, v.points, null, 1);
    expect(texts(p.calls).some((x) => x.startsWith("Umschlag"))).toBe(false);
  });

  it("the glow layer paints only the two areas, stronger, without axes or text", () => {
    const p = fakeCtx();
    paintGlow(p.ctx, g, v.points);
    expect(texts(p.calls)).toEqual([]);
    expect(p.calls.filter((c) => c[0] === "fill").length).toBe(2);
    expect(p.calls.some((c) => c[0] === "clearRect")).toBe(true);
  });

  it("a price gap breaks the line instead of bridging it", () => {
    const gap = buildTraderNet(pts(TWO), bars(30), NOW, STEP).points;
    const gg = netGeometry(gap, 340, 256, pad)!;
    const p = fakeCtx();
    paintPlot(p.ctx, gg, gap, null, 1);
    const moves = p.calls.filter((c) => c[0] === "moveTo").length;
    expect(moves).toBeGreaterThan(0);
  });
});

describe("model: ranges, ticks, placement, texts", () => {
  const v = net(TWO).view!;

  it("rangeChoices follow the real span: 7 / 30 / 90 Tage are taken only when the history is clearly longer (else shown disabled), Alles always with its length", () => {
    const on = (spanMs: number) => rangeChoices(spanMs).filter((c) => !c.disabled).map((c) => c.label);
    expect(rangeChoices(24.75 * DAY).map((c) => c.label)).toEqual(["7 Tage", "30 Tage", "90 Tage", "Alles · 24 Tage"]);
    expect(on(24.75 * DAY)).toEqual(["7 Tage", "Alles · 24 Tage"]);
    expect(on(40 * DAY)).toEqual(["7 Tage", "30 Tage", "Alles · 40 Tage"]);
    expect(on(120 * DAY)).toEqual(["7 Tage", "30 Tage", "90 Tage", "Alles · 120 Tage"]);
    expect(on(10 * DAY)).toEqual(["7 Tage", "Alles · 10 Tage"]);
    expect(on(7.5 * DAY)).toEqual(["Alles · 7 Tage"]);
    expect(on(36 * H)).toEqual(["Alles · 36 Std."]);
    expect(on(2 * 60_000)).toEqual(["Alles · unter 5 Min."]);
    expect(rangeChoices(20 * DAY).at(-1)).toMatchObject({ id: "all", days: null, label: "Alles · 20 Tage" });
    expect(lengthLabel(20.8 * DAY)).toBe("20 Tage");
    expect(lengthLabel(60_000)).toBe("unter 5 Min.");
  });

  it("windowPoints keeps the newest days (never fewer than two points); flipIn only keeps a flip inside the range", () => {
    expect(windowPoints(v.points, null)).toHaveLength(100);
    expect(windowPoints(v.points, 7)).toHaveLength(29);
    expect(windowPoints(v.points, 7)[0]!.t).toBe(v.points[99]!.t - 7 * DAY);
    expect(windowPoints(v.points.slice(0, 2), 7)).toHaveLength(2);
    expect(windowPoints(v.points, 0.0001)).toHaveLength(2);
    expect(flipIn(windowPoints(v.points, 7), v.flip)).toBe(v.flip);
    expect(flipIn(windowPoints(v.points, 3), v.flip)).toBeNull(); // the flip is 5 days old
    expect(flipIn(v.points, null)).toBeNull();
  });

  it("net ticks: ±max and 0, the halves only when they are whole numbers", () => {
    const geo = netGeometry(v.points, 340, 256, plotPad(340))!;
    // ±10 pp of net with 12 % of room above: the range is ±20
    expect(netTicks(geo).map((t) => t.label)).toEqual(["+20", "+10", "0", "−10", "−20"]);
    expect(netTicks({ max: 25, y: (n: number) => n }).map((t) => t.label)).toEqual(["+25", "0", "−25"]);
    expect(netTicks(geo).find((t) => t.v === 0)!.y).toBe(geo.zeroY);
  });

  it("price ticks are nice numbers inside the drawn range, with their own y", () => {
    const geo = netGeometry(v.points, 340, 256, plotPad(340))!;
    const ticks = priceTicks(geo);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(t.v).toBeGreaterThanOrEqual(geo.pMin!);
      expect(t.v).toBeLessThanOrEqual(geo.pMax!);
      expect(t.y).toBeCloseTo(geo.yPrice(t.v), 8);
      expect(t.label).toMatch(/^\d{2}\.\d{3}$/);
    }
    expect(priceTicks({ pMin: null, pMax: null, yPrice: () => 0 })).toEqual([]);
    expect(niceStep(740)).toBe(1000);
    expect(niceStep(0.3)).toBe(0.5);
    expect(niceStep(0)).toBe(1);
  });

  it("time ticks sit on the UTC clock with room between the labels, away from both ends", () => {
    const geo = netGeometry(v.points, 340, 256, plotPad(340))!;
    const ticks = timeTicks(geo);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.x - ticks[i - 1]!.x).toBeGreaterThanOrEqual(56);
    for (const t of ticks) {
      expect(t.x).toBeGreaterThan(geo.left + 13);
      expect(t.x).toBeLessThan(geo.right - 13);
      expect(t.label).toMatch(/^\d\d\.\d\d\.$/);
    }
    // below a day the labels are clock times
    const hours = netGeometry(buildTraderNet(pts(run(5, 20), 15 * 60_000), [], NOW, 900_000).points, 340, 256, plotPad(340))!;
    expect(timeTicks(hours).every((t) => /^\d\d:\d\d$/.test(t.label))).toBe(true);
  });

  it("the flip label sits where it hides the fewest points of the curve and stays inside the plot", () => {
    const geo = netGeometry(v.points, 340, 256, plotPad(340))!;
    const fx = geo.x(v.flip!.at);
    const left = pillPlacement(geo, v.points, fx, 150);
    expect(left).toBeGreaterThanOrEqual(geo.left);
    expect(left + 150).toBeLessThanOrEqual(geo.right);
    // a flip at the very right edge: pushed back into the plot
    expect(pillPlacement(geo, v.points, geo.right, 150) + 150).toBeLessThanOrEqual(geo.right);
    // a curve that is high on the left only: the label moves to the right side of the crossing
    const high = [2.5, 3.5].map((t) => ({ t, net: 20, longPct: 60, price: null }));
    const low = [9, 10].map((t) => ({ t, net: -20, longPct: 40, price: null }));
    const synthetic = { left: 0, right: 200, top: 10, x: (t: number) => t * 20, y: (n: number) => 60 - n * 2 };
    // centred (40 … 160) and left of the crossing (0 … 120) would cover the two high points; right of it (80 … 200) covers none
    expect(pillPlacement(synthetic, [...high, ...low], 100, 120)).toBe(80);
    // nothing in the way: centred on the crossing
    expect(pillPlacement(synthetic, low, 100, 120)).toBe(40);
  });

  it("key figures: facts or an honest dash with the reason", () => {
    const [n, s, p] = kpisOf(v) as [Kpi, Kpi, Kpi];
    expect(n).toMatchObject({ id: "net", value: "−10,0 Pkt.", sub: "Long 45,0 % der Positionen", tone: "loss" });
    expect(s).toMatchObject({ id: "since", sub: "Umschlag zu Short am 20.10." });
    expect(p.value).toMatch(/^[+−]\d+,\d %$/);
    expect(p.sub).toMatch(/^\d{2}\.\d{3} → \d{2}\.\d{3}$/);
    const noPrice = kpisOf(buildTraderNet(pts(TWO), [], NOW, STEP));
    expect(noPrice[2]).toMatchObject({ value: "–", sub: "kein Kurs zum Umschlag", tone: "mute" });
    expect(kpisOf(null).map((k) => k.value)).toEqual(["–", "–", "–"]);
    expect(kpisOf(net(run(9, 100)).view!)[1]).toMatchObject({ value: "–", sub: "kein Umschlag im Verlauf" });
  });

  it("texts: loaded line and plot label never claim more than they know", () => {
    expect(loadedLine(v, STEP)).toBe("Geladener Verlauf: 24 Tage (100 Punkte, Abstand 6 Std.) · Zeiten in UTC");
    expect(loadedLine(null, null, "Nur mit Binance")).toBe("Nur mit Binance");
    expect(loadedLine(null, null)).toBe("Keine Daten von Binance.");
    expect(loadedLine(buildTraderNet(pts([1, 2, 3]), [], NOW, STEP), STEP)).toBe("Binance lieferte erst 3 Punkte (Abstand 6 Std.)");
    const week = windowPoints(v.points, 3);
    expect(plotLabel(v, week, null)).toBe("Top-Trader (Binance) netto, 13 Punkte von 22.10. bis 25.10.: zuletzt −10,0 Pkt., letzter Umschlag zu Short am 20.10., vor dem gezeigten Zeitraum.");
    expect(plotLabel(net(run(9, 100)).view!, run(9, 100).map((n, i) => ({ t: T0 + i * STEP, net: n, longPct: 55, price: null })), null)).toContain("kein Umschlag im geladenen Verlauf");
    expect(plotLabel(buildTraderNet([], [], NOW, STEP), [], null)).toBe("Top-Trader (Binance) netto: keine Daten");
  });
});
