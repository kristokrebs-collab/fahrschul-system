/**
 * Clock of an account's time zone (`profiles.tz`, default Europe/Berlin) for the e-mail alarm: the active hours, the
 * day of the daily mail limit and the times in the mail are the user's local ones, not the server's (UTC).
 */
import type { LocalClock } from "../../../../src/domain/keylevels/serverAlerts";

export const DEFAULT_ALERT_TZ = "Europe/Berlin";

/** `tz` when `Intl` knows it, else the default zone. */
export function safeTz(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return DEFAULT_ALERT_TZ;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_ALERT_TZ;
  }
}

/** Minutes after local midnight and the local day (`YYYY-MM-DD`) of `ms` in `tz`. */
export function localClock(ms: number, tz: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeTz(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return { minutes: Number(get("hour")) * 60 + Number(get("minute")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

/** "25.10. 14:05" in `tz`. */
export function formatLocal(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: safeTz(tz), day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}
