/**
 * Time labels of the charts (Europe/Berlin): the crosshair / tooltip format and the per-weight tick formatters. Only a
 * TYPE import of `lightweight-charts` (P14): the overview tooltip uses `formatChartTime` in the first load, the chart
 * library itself stays a lazy chunk. `theme.ts` re-exports the public names.
 */
import type { Time } from "lightweight-charts";

/** Display time zone for axis and crosshair labels. Data stays in UTC seconds. */
export const CHART_TIME_ZONE = "Europe/Berlin";

export const tickFmt = {
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

export function toMs(time: Time): number | null {
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
