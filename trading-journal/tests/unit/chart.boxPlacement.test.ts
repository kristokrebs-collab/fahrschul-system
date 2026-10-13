/**
 * Box fix (P02): boxes sit exactly on their bars.
 *
 * Root cause of "the active box is drawn from the chart's left edge": lightweight-charts 5.2 `logicalToCoordinate`
 * maps only WHOLE logical indices – a fractional one (a bar edge `i − 0.5`) answers 0. The fake time scale below
 * behaves exactly like that. The same real BTCUSDT bars go to the engine and to the chart (via `toChartBoxes` +
 * `BoxPrimitive`), and every drawn box must span its own bars only: its left edge on the left edge of its first bar,
 * every closed candle under it closing inside its edges ± the breakout buffer – on 4h, 1D and 1W, for every "now" of
 * the last days (inside, breakout, retest, target, back inside).
 */
import { describe, expect, it } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import btc1d from "./fixtures/binance-btcusdt-1d.json";
import { analyzeBoxes, DEFAULT_BOX_CFG, reentryIndex, type Box } from "@/domain/boxes";
import type { Bar } from "@/domain/signals/indicators";
import { logicalToX } from "@/chart/logicalX";
import { BoxPrimitive, type ChartBox } from "@/chart/primitives/BoxPrimitive";
import { toChartBoxes } from "@/views/markt/chartBoxes";

const load = (j: unknown): Bar[] => (j as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const B4 = load(btc4h);
const B1 = load(btc1d);
const DAY = 86_400;
const WEEK = 7 * DAY;
function weekly(days: readonly Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const d of days) {
    const open = Math.floor((d.t - 4 * DAY) / WEEK) * WEEK + 4 * DAY;
    const last = out[out.length - 1];
    if (last && last.t === open) Object.assign(last, { h: Math.max(last.h, d.h), l: Math.min(last.l, d.l), c: d.c });
    else out.push({ t: open, o: d.o, h: d.h, l: d.l, c: d.c });
  }
  return out;
}
const W1 = weekly(B1);

/** lightweight-charts 5.2: `indexToCoordinate` answers 0 for a fractional index. */
const SPACING = 6;
const OFFSET = 3;
const lwcScale = { logicalToCoordinate: (l: number) => (Number.isInteger(l) ? l * SPACING + OFFSET : 0) };
const centerX = (i: number) => i * SPACING + OFFSET;

/** A primitive on a chart showing `bars` (the last one forming) completely. */
function drawn(bars: readonly Bar[], boxes: ChartBox[], intervalSec: number) {
  const chartBars = bars.map((b) => ({ time: b.t, high: b.h, low: b.l }));
  const width = (bars.length + 8) * SPACING;
  const p = new BoxPrimitive({ bars: () => chartBars, intervalSec: () => intervalSec, reducedMotion: () => true });
  const chart = {
    timeScale: () => ({ getVisibleLogicalRange: () => ({ from: -0.5, to: bars.length + 6 }), width: () => width, ...lwcScale }),
    panes: () => [{ getHeight: () => 400 }],
  };
  p.attached({ chart, series: { priceToCoordinate: (v: number) => 400 - v / 1000 }, requestUpdate: () => undefined } as never);
  p.setBoxes(boxes);
  p.updateAllViews();
  return p;
}

describe("logicalToX (lwc maps whole logicals only)", () => {
  it("passes whole indices through and interpolates fractional ones – also off the data on both sides", () => {
    expect(logicalToX(lwcScale, 10)).toBe(centerX(10));
    expect(logicalToX(lwcScale, 9.5)).toBe(centerX(9.5)); // the left edge of bar 10, not 0
    expect(logicalToX(lwcScale, -3.25)).toBeCloseTo(centerX(-3.25), 9);
    expect(logicalToX(lwcScale, 1234.75)).toBeCloseTo(centerX(1234.75), 9);
    expect(logicalToX({ logicalToCoordinate: () => null }, 2.5)).toBeNull();
    expect(logicalToX(lwcScale, Number.NaN)).toBeNull();
  });

  it("drops the float noise of a bar spacing one ulp off: a half-pixel bar centre stays a half pixel", () => {
    // lwc at width 1144, rightOffset + baseIndex 1464, bar spacing 3.0000000000000004 instead of 3 (CI desktop, 30m / 1M)
    const scale = (barSpacing: number) => ({ logicalToCoordinate: (l: number) => 1144 - (1464 - l + 0.5) * barSpacing - 1 });
    expect(scale(3.0000000000000004).logicalToCoordinate(1110)).toBe(79.49999999999977);
    expect(logicalToX(scale(3.0000000000000004), 1110)).toBe(79.5);
    expect(logicalToX(scale(3.0000000000000004), 1109.5)).toBe(78);
    expect(logicalToX(scale(3), 1110)).toBe(79.5);
  });
});

describe("BoxPrimitive on the real bar grid", () => {
  const hourly = Array.from({ length: 50 }, (_, i) => ({ t: 1_790_000_000 - (1_790_000_000 % 3600) + i * 3600, o: 100, h: 110, l: 90, c: 100 }));
  const ms = (i: number) => hourly[0]!.t * 1000 + i * 3_600_000;
  const box = (over: Partial<ChartBox>): ChartBox => ({ id: "x", from: ms(10), to: ms(20), top: 105, btm: 95, tone: "neutral", ...over });

  it("a box spans its bars edge to edge (never from the pane's left edge)", () => {
    const g = drawn(hourly, [box({})], 3600).geometry()[0]!;
    expect(g.x1).toBe(centerX(9.5));
    expect(g.x2).toBe(centerX(19.5));
  });

  it("older than the loaded bars: starts off screen on the bar grid; ended before them: not drawn (never the live edge)", () => {
    const p = drawn(hourly, [box({ id: "older", from: ms(-30), to: ms(5) }), box({ id: "gone", from: ms(-30), to: ms(-10) }), box({ id: "live", from: ms(-30), to: null, active: true })], 3600);
    const ids = p.geometry().map((g) => g.id);
    expect(ids).toEqual(["older", "live"]);
    expect(p.geometry()[0]).toMatchObject({ x1: 0, x2: centerX(4.5) });
    expect(p.geometry()[1]!.x2).toBe((hourly.length + 8) * SPACING);
  });
});

/** Every drawn box covers only closed candles that close inside its edges ± the breakout buffer; its left edge is its first bar's. */
function expectHugging(tf: "4h" | "1d" | "1w", bars: readonly Bar[], cut: number, intervalSec: number): number {
  const closed = bars.slice(0, cut);
  const forming = bars[cut]!;
  const a = analyzeBoxes({ tf, bars: closed, live: forming.c })!;
  expect(a).not.toBeNull();
  const re = reentryIndex(closed, a.box.box);
  const boxes = toChartBoxes(a, { intervalMs: intervalSec * 1000, liveFrom: re == null ? null : closed[re]!.t * 1000 });
  const p = drawn(bars.slice(0, cut + 1), boxes, intervalSec);
  const byId = new Map<string, Box>(a.box.boxes.map((b) => [boxes.find((c) => c.from === b.t0 * 1000 && c.top === b.top && c.btm === b.bottom)!.id, b]));
  const geo = p.geometry();
  expect(geo.length).toBe(boxes.length);
  for (const g of geo) {
    const live = g.id.endsWith(":live");
    const b = byId.get(live ? g.id.slice(0, -5) : g.id)!;
    expect(b, g.id).toBeDefined();
    const buf = DEFAULT_BOX_CFG.breakAtr * b.atr;
    const first = live ? re! : b.i0;
    expect(g.x1, `${tf} ${g.id} left edge`).toBe(Math.max(0, centerX(first - 0.5)));
    let covered = 0;
    for (let j = 0; j < cut; j++) {
      const x = centerX(j);
      if (x < g.x1 || x > g.x2) continue;
      covered++;
      const c = closed[j]!.c;
      expect(c, `${tf} cut ${cut} box ${g.id}: bar ${j} closes outside`).toBeLessThanOrEqual(b.top + buf + 1e-9);
      expect(c, `${tf} cut ${cut} box ${g.id}: bar ${j} closes outside`).toBeGreaterThanOrEqual(b.bottom - buf - 1e-9);
    }
    // the box spans every one of its own bars
    if (!live) expect(covered).toBeGreaterThanOrEqual(b.i1 - b.i0 + 1);
  }
  return geo.length;
}

describe("real BTCUSDT: every drawn box hugs its range (engine and chart see the same bars)", () => {
  it("4h, every 'now' of the last ten days (inside, breakout, retest, target, back inside)", () => {
    let drawnBoxes = 0;
    for (let cut = 1440; cut < B4.length; cut += 1) drawnBoxes += expectHugging("4h", B4, cut, 4 * 3600);
    expect(drawnBoxes).toBeGreaterThan(300);
  });

  it("4h at the e2e's 'now' (2026-10-11 00:00): the box of 23.09. starts on its first bar, the live part on the re-entry", () => {
    expect(expectHugging("4h", B4, 1493, 4 * 3600)).toBe(7); // six boxes + the live part of the newest one
  });

  it("1D and 1W", () => {
    for (let cut = B1.length - 40; cut < B1.length; cut += 3) expectHugging("1d", B1, cut, DAY);
    for (let cut = W1.length - 12; cut < W1.length; cut += 1) expectHugging("1w", W1, cut, WEEK);
  });

  it("targets are real prices: the 2024–26 weekly box (53k–126k) has no measured move below zero", () => {
    for (let cut = W1.length - 12; cut < W1.length; cut += 1) {
      const a = analyzeBoxes({ tf: "1w", bars: W1.slice(0, cut), live: W1[cut]!.c })!;
      const st = a.box;
      expect(st.box!.bottom - st.box!.height).toBeLessThan(0); // the case: a measured move down would be negative
      for (const t of [...st.up, ...st.down, ...st.targets]) expect(t.price).toBeGreaterThan(0);
      for (const b of toChartBoxes(a, { intervalMs: WEEK * 1000 })) for (const t of b.targets ?? []) expect(t.price).toBeGreaterThan(0);
    }
  });
});
