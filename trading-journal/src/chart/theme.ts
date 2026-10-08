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
import { ink } from "./ink";

/** Display time zone for axis and crosshair labels. Data stays in UTC seconds. */
export const CHART_TIME_ZONE = "Europe/Berlin";
export const CHART_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const CHART_FONT_LOAD = '11px "IBM Plex Mono"';

export { ink };

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

const tickFmt = {
  year: new Intl.DateTimeFormat("de-DE", { timeZone: CHART_TIME_ZONE, year: "numeric" }),
  month: new Intl.DateTimeFormat("de-DE", { timeZone: CHART_TIME_ZONE, month: "short" }),
  day: new Intl.DateTimeFormat("de-DE", { timeZone: CHART_TIME_ZONE, day: "2-digit", month: "2-digit" }),
  time: new Intl.DateTimeFormat("de-DE", { timeZone: CHART_TIME_ZONE, hour: "2-digit", minute: "2-digit" }),
  timeSec: new Intl.DateTimeFormat("de-DE", {
    timeZone: CHART_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }),
  full: new Intl.DateTimeFormat("de-DE", {
    timeZone: CHART_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

function toMs(time: Time): number | null {
  if (typeof time === "number") return time * 1000;
  if (typeof time === "string") {
    const ms = Date.parse(time);
    return Number.isNaN(ms) ? null : ms;
  }
  return Date.UTC(time.year, time.month - 1, time.day);
}

/** Crosshair time label: `dd.MM. HH:mm` in Europe/Berlin. */
export function formatChartTime(time: Time): string {
  const ms = toMs(time);
  return ms == null ? "" : tickFmt.full.format(ms);
}

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
      panes: { separatorColor: ink.separator, separatorHoverColor: "rgba(255,255,255,0.05)", enableResize: false },
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

/** Up = filled white, down = hollow (`#0a0a0a` body) with grey borders and wicks. */
export const NOTHING_CANDLES: CandlestickSeriesPartialOptions = {
  upColor: ink.fg,
  downColor: ink.bg,
  borderVisible: true,
  borderUpColor: ink.mute,
  borderDownColor: ink.mute,
  wickVisible: true,
  wickUpColor: ink.mute,
  wickDownColor: ink.mute,
  priceLineVisible: true,
  priceLineColor: ink.signal,
  priceLineStyle: LineStyle.Dotted,
  lastValueVisible: true,
  priceFormat: { type: "price", precision: 1, minMove: CHART_PRICE_MIN_MOVE },
};

export const NOTHING_VOLUME: HistogramSeriesPartialOptions = {
  priceScaleId: "",
  priceFormat: { type: "volume" },
  color: "rgba(255,255,255,0.12)",
  lastValueVisible: false,
  priceLineVisible: false,
};
/** Overlay scale margins for the volume histogram (bottom 18 % of pane 0). */
export const VOLUME_SCALE_MARGINS = { top: 0.82, bottom: 0 } as const;

export const NOTHING_RATIO_LINE: LineSeriesPartialOptions = {
  color: ink.fg,
  lineWidth: 1,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
  priceFormat: { type: "price", precision: 1, minMove: 0.1 },
};

export const NOTHING_OI_LINE: LineSeriesPartialOptions = {
  color: ink.mute,
  lineWidth: 1,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
  priceFormat: { type: "volume" },
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

/**
 * Apache-2.0 attribution (Plan 5.8). `attributionLogo:false` requires the NOTICE text and a link to
 * tradingview.com on the page (footer). `public/NOTICE-lightweight-charts.txt` holds the notice file.
 */
export const CHART_ATTRIBUTION = {
  notice: "TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc. · ",
  linkText: "tradingview.com",
  href: "https://www.tradingview.com/",
  /** alternative link text if the footer prefers a sentence */
  linkTextLong: "Charting by TradingView",
  dataLine: "Marktdaten: Binance Futures (öffentlich)",
} as const;
