/**
 * Monochrome "Nothing" theme for lightweight-charts 5.2.1 (Plan 5.2).
 * One-accent rule: `#e5202e` is used ONLY for the hard invalidation line (levels.ts) and the
 * series' own last-price line; every other chart element sits on the grey ramp.
 */
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type HistogramSeriesPartialOptions,
  type LineSeriesPartialOptions,
  type Time,
} from "lightweight-charts";
import { fmt } from "./format";
import { ink, withAlpha } from "./ink";

// time zone + label formatters: their own module (no `lightweight-charts` value import), so the overview's tooltip in
// the first load stays free of the chart library (P14) – re-exported here, the import paths stay
export { CHART_TIME_ZONE, formatChartTime } from "./timeFormat";
import { formatChartTime, tickFmt, toMs } from "./timeFormat";
export const CHART_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const CHART_FONT_LOAD = '11px "IBM Plex Mono"';

export { ink, applyInk, resetInk, subscribeInk, withAlpha, INK_DEFAULTS, type Ink, type InkKey } from "./ink";

/** Empty bar slots right of the last candle (the live edge); `follow()` restores it. */
export const CHART_RIGHT_OFFSET = 8;
/** Narrowest bar spacing (px) the candle chart zooms out to; a window with more bars than fit is cut from the left. */
export const CHART_MIN_BAR_SPACING = 3;
/** Price grid of the candle series (axis label precision 1). */
export const CHART_PRICE_MIN_MOVE = 0.1;

/** Background decision 7: start transparent (body dot grid shows through). */
export const CHART_BACKGROUND_TRANSPARENT = "transparent";
/** Solid fallback if the canvas does not stay see-through (Plan decision 7, M2). */
export const CHART_BACKGROUND_SOLID = ink.bg;

/** Axis tick labels per tick weight, Europe/Berlin. */
export function formatTickMark(time: Time, type: TickMarkType): string {
  const ms = toMs(time);
  if (ms == null) return "";
  switch (type) {
    case TickMarkType.Year:
      return tickFmt.year.format(ms);
    case TickMarkType.Month:
      return tickFmt.month.format(ms).replace(".", "");
    case TickMarkType.DayOfMonth:
      return tickFmt.day.format(ms);
    case TickMarkType.TimeWithSeconds:
      return tickFmt.timeSec.format(ms);
    default:
      return tickFmt.time.format(ms);
  }
}

export function makeNothingTheme(background: string = CHART_BACKGROUND_TRANSPARENT): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: background },
      textColor: ink.tick,
      fontSize: 11,
      fontFamily: CHART_FONT,
      attributionLogo: false,
      panes: { separatorColor: ink.separator, separatorHoverColor: withAlpha(ink.veil, 0.05), enableResize: false },
    },
    grid: {
      vertLines: { color: ink.grid, style: LineStyle.SparseDotted },
      horzLines: { color: ink.grid, style: LineStyle.SparseDotted },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: ink.ref, width: 1, style: LineStyle.Dotted, labelBackgroundColor: ink.labelBg },
      horzLine: { color: ink.ref, width: 1, style: LineStyle.Dotted, labelBackgroundColor: ink.labelBg },
    },
    rightPriceScale: {
      borderVisible: false,
      ticksVisible: false,
      entireTextOnly: true,
      scaleMargins: { top: 0.06, bottom: 0.22 },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: CHART_RIGHT_OFFSET,
      barSpacing: 9,
      minBarSpacing: CHART_MIN_BAR_SPACING,
      lockVisibleTimeRangeOnResize: true,
      tickMarkFormatter: (time: Time, type: TickMarkType) => formatTickMark(time, type),
    },
    localization: {
      locale: "de-DE",
      timeFormatter: (time: Time) => formatChartTime(time),
      priceFormatter: (p: number) => fmt.price(p),
    },
    handleScale: { axisPressedMouseMove: { time: true, price: false } },
    // a vertical swipe on the chart scrolls the page (the chart fills half a tablet screen); horizontal drags still pan
    // and pinch still zooms
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  };
}

export const NOTHING_DARK: DeepPartial<ChartOptions> = makeNothingTheme();

/**
 * The colour part of the chart options from the LIVE palette (`applyInk`, P02 theme hook): layout text, pane separator,
 * grid, crosshair. `NothingCandleChart` re-applies it when the palette changes; the defaults equal `NOTHING_DARK`.
 */
export function inkChartOptions(): DeepPartial<ChartOptions> {
  return {
    layout: { textColor: ink.tick, panes: { separatorColor: ink.separator, separatorHoverColor: withAlpha(ink.veil, 0.05) } },
    grid: { vertLines: { color: ink.grid }, horzLines: { color: ink.grid } },
    crosshair: { vertLine: { color: ink.ref, labelBackgroundColor: ink.labelBg }, horzLine: { color: ink.ref, labelBackgroundColor: ink.labelBg } },
  };
}

/** Candle colours from the live palette (same values as `NOTHING_CANDLES` with the default ink). */
export function inkCandleOptions(): CandlestickSeriesPartialOptions {
  return { upColor: ink.fg, downColor: ink.bg, borderUpColor: ink.mute, borderDownColor: ink.mute, wickUpColor: ink.mute, wickDownColor: ink.mute, priceLineColor: ink.signal };
}

/** Volume colour from the live palette (the histogram's series colour; the bars carry their own `volumeColor`). */
export function inkVolumeOptions(): HistogramSeriesPartialOptions {
  return { color: withAlpha(ink.veil, 0.12) };
}

/*
 * The series option sets below read their colours from the LIVE palette when a chart reads them (getters): a chart
 * created after a theme switch starts in the current ink, not in the ink of the moment this module was loaded. With the
 * default ink the values are the dark ones of Plan 5.2.
 */

/** Up = filled white, down = hollow (`#0a0a0a` body) with grey borders and wicks. */
export const NOTHING_CANDLES: CandlestickSeriesPartialOptions = {
  get upColor() {
    return ink.fg;
  },
  get downColor() {
    return ink.bg;
  },
  borderVisible: true,
  get borderUpColor() {
    return ink.mute;
  },
  get borderDownColor() {
    return ink.mute;
  },
  wickVisible: true,
  get wickUpColor() {
    return ink.mute;
  },
  get wickDownColor() {
    return ink.mute;
  },
  priceLineVisible: true,
  get priceLineColor() {
    return ink.signal;
  },
  priceLineStyle: LineStyle.Dotted,
  lastValueVisible: true,
  priceFormat: { type: "price", precision: 1, minMove: CHART_PRICE_MIN_MOVE },
};

export const NOTHING_VOLUME: HistogramSeriesPartialOptions = {
  priceScaleId: "",
  priceFormat: { type: "volume" },
  get color() {
    return withAlpha(ink.veil, 0.12);
  },
  lastValueVisible: false,
  priceLineVisible: false,
};
/** Overlay scale margins for the volume histogram (bottom 18 % of pane 0). */
export const VOLUME_SCALE_MARGINS = { top: 0.82, bottom: 0 } as const;

export const NOTHING_RATIO_LINE: LineSeriesPartialOptions = {
  get color() {
    return ink.fg;
  },
  lineWidth: 1,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
  priceFormat: { type: "price", precision: 1, minMove: 0.1 },
};

export const NOTHING_OI_LINE: LineSeriesPartialOptions = {
  get color() {
    return ink.mute;
  },
  lineWidth: 1,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
  priceFormat: { type: "volume" },
};

/** RSI pane line (P02): 1 px fg, a small crosshair dot, no axis label (the pane legend carries the value). */
export const NOTHING_RSI_LINE: LineSeriesPartialOptions = {
  get color() {
    return ink.fg;
  },
  lineWidth: 1,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: true,
  crosshairMarkerRadius: 2.5,
  get crosshairMarkerBorderColor() {
    return ink.bg;
  },
  get crosshairMarkerBackgroundColor() {
    return ink.fg;
  },
  priceFormat: { type: "price", precision: 1, minMove: 0.1 },
};

/** Non-interactive variant for `MiniTradeChart`. */
export const NOTHING_MINI: DeepPartial<ChartOptions> = {
  ...makeNothingTheme(),
  handleScroll: false,
  handleScale: false,
  crosshair: { mode: CrosshairMode.Hidden, vertLine: { visible: false }, horzLine: { visible: false } },
  rightPriceScale: { borderVisible: false, ticksVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
  timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2, barSpacing: 4 },
};

// Apache-2.0 attribution (Plan 5.8): its own module, so the footer (first load) shows it without pulling
// `lightweight-charts` into the main chunk (P14) – re-exported here, the import path stays.
export { CHART_ATTRIBUTION } from "./attribution";
