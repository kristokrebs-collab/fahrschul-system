/**
 * Quiet hours (Ruhezeiten) in the USER's time zone. Pure: the clock is a parameter, the zone comes from the profile.
 * The settings say when it is quiet (`from` … `to`); `inActiveHoursAt` of the key-level alarms says when it is not, so the
 * quiet range is passed through with its two ends swapped.
 */
import { inActiveHoursAt } from "../keylevels/alerts";
import type { QuietHours } from "./config";

export const DEFAULT_TZ = "Europe/Berlin";

/** `tz` when `Intl` knows it, else the default zone. */
export function safeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export interface ZoneClock {
  /** minutes after local midnight */
  minutes: number;
  /** `YYYY-MM-DD` */
  day: string;
}

export function zoneClock(ms: number, tz: string): ZoneClock {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return { minutes: Number(get("hour")) * 60 + Number(get("minute")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

/** `true` when `ms` falls inside the quiet hours of `q` in `tz`. Off = never quiet; `from === to` = never quiet. */
export function isQuiet(q: QuietHours, ms: number, tz: string): boolean {
  if (!q.on || q.from === q.to) return false;
  return !inActiveHoursAt({ on: true, from: q.to, to: q.from }, zoneClock(ms, tz).minutes);
}

/**
 * The first moment (ms, on a 5-minute grid) at or after `ms` that is NOT quiet; `ms` itself when it is not quiet. Quiet hours
 * never last 24 h (`from === to` means none), so the search stops within a day.
 */
export function quietEndsAt(q: QuietHours, ms: number, tz: string): number {
  if (!isQuiet(q, ms, tz)) return ms;
  const step = 5 * 60_000;
  let t = Math.floor(ms / step) * step + step;
  for (let i = 0; i < 24 * 12 + 1; i++, t += step) if (!isQuiet(q, t, tz)) return t;
  return ms;
}
