/**
 * RSI sub pane (P02): Wilder RSI 14 of the chart's own bars as a line in pane 1, dotted reference lines at 70 / 30 and
 * a faint 50, the diagonal RSI trendlines with their glowing breaks (`primitives/RsiOverlay.ts`).
 *
 * - Full compute with `rsi()` from `@/domain/signals` (TradingView `ta.rsi`) on every `setBars` (history load, new
 *   bar); NaN lead-in values become whitespace points, so the pane keeps the candle grid.
 * - Live: the forming bar's RSI in O(1) from the Wilder state after the last closed bar (`wilderStep`), one
 *   `series.update` per pushed frame (the chart pushes ≤ 1 per frame).
 * - Trendlines: `rsiLines()` (`@/domain/boxes`) on the CLOSED bars, once per closed-bar change – never per print. A
 *   forming bar beyond the active line is shown as a provisional break (soft tone) until its close.
 * Pure helpers (`wilderState`, `wilderStep`, `toRsiData`, `rsiOverlayData`) are exported for the tests.
 */
import { LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type LineData, type UTCTimestamp, type WhitespaceData } from "lightweight-charts";
import { DEFAULT_RSI_LINE_CFG, lineAt, rsiLines, type RsiLine, type RsiLineState } from "@/domain/boxes";
import { rsi } from "@/domain/signals/indicators";
import { ink } from "./ink";
import { NOTHING_RSI_LINE } from "./theme";
import { EMPTY_RSI_OVERLAY, RsiOverlay, type RsiOverlayBreak, type RsiOverlayData, type RsiOverlayLine } from "./primitives/RsiOverlay";

export const RSI_LEN = 14;
/** Reference lines of the pane (colours from the live palette, read when a pane is built or re-inked). */
export const RSI_LEVELS = [
  {
    price: 70,
    get color(): string {
      return ink.ref;
    },
    style: LineStyle.Dotted,
  },
  {
    price: 50,
    get color(): string {
      return ink.grid;
    },
    style: LineStyle.Solid,
  },
  {
    price: 30,
    get color(): string {
      return ink.ref;
    },
    style: LineStyle.Dotted,
  },
] as const;
/** Bars an active trendline is extended into the future space (dotted). */
export const RSI_EXTEND_BARS = 6;

export interface RsiBar {
  time: UTCTimestamp;
  close: number;
}

/** Wilder averages after a bar: the next RSI follows in O(1). */
export interface WilderState {
  avgUp: number;
  avgDn: number;
  /** close of that bar */
  close: number;
}

const rsiOf = (u: number, d: number): number => (d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d));

/**
 * Wilder averages (`rma` of gains / losses, seeded with the SMA of the first `len` changes – exactly `rsi()`) after the
 * bar `upTo` (inclusive). `null` while fewer than `len + 1` closes exist.
 */
export function wilderState(closes: readonly number[], len = RSI_LEN, upTo = closes.length - 1): WilderState | null {
  if (upTo < len) return null;
  let su = 0;
  let sd = 0;
  for (let i = 1; i <= len; i++) {
    const d = closes[i]! - closes[i - 1]!;
    su += Math.max(d, 0);
    sd += Math.max(-d, 0);
  }
  let u = su / len;
  let dn = sd / len;
  for (let i = len + 1; i <= upTo; i++) {
    const d = closes[i]! - closes[i - 1]!;
    u = (u * (len - 1) + Math.max(d, 0)) / len;
    dn = (dn * (len - 1) + Math.max(-d, 0)) / len;
  }
  return { avgUp: u, avgDn: dn, close: closes[upTo]! };
}

/** RSI of the next bar closing at `close` after state `s` (O(1)). */
export function wilderStep(s: WilderState, close: number, len = RSI_LEN): number {
  const d = close - s.close;
  const u = (s.avgUp * (len - 1) + Math.max(d, 0)) / len;
  const dn = (s.avgDn * (len - 1) + Math.max(-d, 0)) / len;
  return rsiOf(u, dn);
}

/** Line data on the bar grid: NaN lead-in values as whitespace (the pane keeps the candle grid). */
export function toRsiData(times: readonly UTCTimestamp[], values: readonly number[]): Array<LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> {
  return times.map((time, i) => {
    const v = values[i];
    return v != null && Number.isFinite(v) ? { time, value: v } : { time };
  });
}

const lineOf = (l: RsiLine, last: number, maxAge: number): RsiOverlayLine => {
  const broken = l.brokeAt != null;
  return {
    kind: l.kind,
    a: l.a,
    slope: l.slope,
    end: broken ? Math.min(last, (l.brokeAt as number) + 1) : last,
    extend: broken ? null : last + RSI_EXTEND_BARS,
    broken,
    fresh: broken && last - (l.brokeAt as number) <= maxAge,
  };
};

/**
 * What the overlay draws from the closed-bar trendlines (`state`, indices on the chart's bars; `lastClosed` = index of the
 * last closed bar) plus a provisional break of the forming bar (`live` RSI at index `lastClosed + 1`).
 */
export function rsiOverlayData(state: RsiLineState | null, lastClosed: number, live: number | null, maxAge = DEFAULT_RSI_LINE_CFG.maxAge): RsiOverlayData {
  if (!state) return EMPTY_RSI_OVERLAY;
  const lines: RsiOverlayLine[] = [];
  const breaks: RsiOverlayBreak[] = [];
  for (const l of [state.res, state.sup]) if (l) lines.push(lineOf(l, lastClosed, maxAge));
  for (const [l, dir] of [
    [state.breakUp, 1],
    [state.breakDown, -1],
  ] as const) {
    if (!l || l.brokeAt == null) continue;
    lines.push(lineOf(l, lastClosed, maxAge));
    breaks.push({ i: l.brokeAt, v: state.rsi[l.brokeAt] ?? lineAt(l, l.brokeAt), dir, fresh: lastClosed - l.brokeAt <= maxAge, provisional: false });
  }
  // the forming bar beyond an active line: provisional (counts at the close)
  if (live != null && Number.isFinite(live)) {
    const f = lastClosed + 1;
    const tol = DEFAULT_RSI_LINE_CFG.tol * 0.5;
    if (state.res && live - lineAt(state.res, f) > tol) breaks.push({ i: f, v: live, dir: 1, fresh: true, provisional: true });
    if (state.sup && lineAt(state.sup, f) - live > tol) breaks.push({ i: f, v: live, dir: -1, fresh: true, provisional: true });
  }
  return { lines, breaks };
}

/**
 * Which parts of the RSI pane are shown (F62 "Chart spiegeln"): the active diagonal trendlines, the breakouts (the break
 * dot with its glow and the broken line) and – on request only – the mirrored axis (read as 100−RSI; the data stays).
 */
export interface RsiView {
  trendlines: boolean;
  breakouts: boolean;
  mirrored: boolean;
  /** blind mode: break dots / broken lines without win / loss tones */
  neutral: boolean;
}
export const DEFAULT_RSI_VIEW: Readonly<RsiView> = Object.freeze({ trendlines: true, breakouts: true, mirrored: false, neutral: false });

/** The overlay data for a view: active lines are "Trendlinien", broken lines and break dots are "Ausbrüche". Pure. */
export function filterRsiOverlay(d: RsiOverlayData, v: Pick<RsiView, "trendlines" | "breakouts">): RsiOverlayData {
  if (v.trendlines && v.breakouts) return d;
  return { lines: d.lines.filter((l) => (l.broken ? v.breakouts : v.trendlines)), breaks: v.breakouts ? d.breaks : [] };
}

/** Identity of a provisional / fresh break set (the overlay is re-set only when it changes). */
const breaksKey = (d: RsiOverlayData): string => d.breaks.map((b) => `${b.i}${b.dir}${b.provisional ? "p" : ""}`).join(",");

export class RsiPane {
  readonly series: ISeriesApi<"Line">;
  readonly overlay = new RsiOverlay();
  private readonly levels: IPriceLine[];
  private times: UTCTimestamp[] = [];
  private closes: number[] = [];
  private values: number[] = [];
  private state: WilderState | null = null;
  private lines: RsiLineState | null = null;
  private closedKey = "";
  private overlayKey = "";
  private liveValue: number | null = null;
  private view: RsiView = { ...DEFAULT_RSI_VIEW };

  constructor(
    chart: IChartApi,
    paneIndex = 1,
    private readonly len = RSI_LEN,
  ) {
    this.series = chart.addSeries(LineSeries, { ...NOTHING_RSI_LINE, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, paneIndex);
    this.levels = RSI_LEVELS.map((l) => this.series.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.style, axisLabelVisible: false, title: "" }));
    this.series.attachPrimitive(this.overlay);
  }

  /** The palette changed (light mode / accent): line, crosshair dot and guides follow; the overlay reads `ink` per draw. */
  applyInk(): void {
    this.series.applyOptions({ color: ink.fg, crosshairMarkerBorderColor: ink.bg, crosshairMarkerBackgroundColor: ink.fg });
    this.levels.forEach((line, i) => line.applyOptions({ color: RSI_LEVELS[i]!.color }));
  }

  /** Every bar of the chart (the last one forming): full RSI, Wilder state, and – on a closed-bar change – the trendlines. */
  setBars(bars: readonly RsiBar[]): void {
    this.times = bars.map((b) => b.time);
    this.closes = bars.map((b) => b.close);
    this.values = rsi(this.closes, this.len);
    this.series.setData(toRsiData(this.times, this.values));
    const lastClosed = bars.length - 2;
    this.state = lastClosed >= 0 ? wilderState(this.closes, this.len, lastClosed) : null;
    this.liveValue = this.values[this.values.length - 1] ?? null;
    const lc = bars[lastClosed];
    const key = lc ? `${lastClosed}:${lc.time}:${lc.close}:${bars[0]!.time}` : "";
    if (key !== this.closedKey) {
      this.closedKey = key;
      this.lines = lastClosed >= DEFAULT_RSI_LINE_CFG.len + 30 ? rsiLines(bars.slice(0, lastClosed + 1).map((b) => ({ t: b.time, o: b.close, h: b.close, l: b.close, c: b.close })), DEFAULT_RSI_LINE_CFG) : null;
      this.overlayKey = "";
    }
    this.syncOverlay();
  }

  /** The forming bar moved (≤ 1 per frame): its RSI in O(1); the overlay only when a provisional break flips. */
  push(bar: RsiBar): void {
    const i = this.times.length - 1;
    if (i < 0 || bar.time !== this.times[i] || !this.state) return;
    const v = wilderStep(this.state, bar.close, this.len);
    this.closes[i] = bar.close;
    this.values[i] = v;
    if (v === this.liveValue) return;
    this.liveValue = v;
    this.series.update({ time: bar.time, value: v });
    this.syncOverlay();
  }

  private syncOverlay(): void {
    const data = filterRsiOverlay(rsiOverlayData(this.lines, this.times.length - 2, this.liveValue), this.view);
    const key = `${this.closedKey}|${breaksKey(data)}|${this.view.trendlines ? "t" : "-"}${this.view.breakouts ? "b" : "-"}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.overlay.setData(data);
  }

  /** Shows / hides trendlines and breakouts and (un)mirrors the axis. Data, indicator values and break times never change. */
  setView(v: Partial<RsiView>): void {
    const next = { ...this.view, ...v };
    const axis = next.mirrored !== this.view.mirrored;
    this.view = next;
    if (axis) this.series.priceScale().applyOptions({ invertScale: next.mirrored });
    this.overlay.setNeutral(next.neutral);
    this.syncOverlay();
  }

  /** The 100−RSI axis is on. */
  isMirrored(): boolean {
    return this.view.mirrored;
  }

  /** RSI at a bar time (crosshair legend); `null` when unknown. */
  valueAt(time: number): number | null {
    let lo = 0;
    let hi = this.times.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = this.times[mid]!;
      if (t === time) {
        const v = this.values[mid];
        return v != null && Number.isFinite(v) ? v : null;
      }
      if (t < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** RSI of the newest bar. */
  lastValue(): number | null {
    return this.liveValue != null && Number.isFinite(this.liveValue) ? this.liveValue : null;
  }

  /** The newest fresh break of a CLOSED bar (the DOM glow sits on it), `null` when none. */
  freshBreak(): RsiOverlayBreak | null {
    if (!this.view.breakouts) return null;
    const d = rsiOverlayData(this.lines, this.times.length - 2, null);
    const fresh = d.breaks.filter((b) => b.fresh && !b.provisional).sort((a, b) => b.i - a.i);
    return fresh[0] ?? null;
  }

  /** Trendline state of the closed bars (tests / cards). */
  lineState(): RsiLineState | null {
    return this.lines;
  }

  dispose(): void {
    try {
      this.series.detachPrimitive(this.overlay);
      for (const l of this.levels) this.series.removePriceLine(l);
    } catch {
      /* series already gone with the chart */
    }
  }
}
