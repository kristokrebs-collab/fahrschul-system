/**
 * Calendar days in the trader's configured time zone (F61). One check-in belongs to one `YYYY-MM-DD` of THAT zone, so
 * the key is computed from an instant with `Intl` (never from the device's local getters) – correct after midnight, on the
 * 23 h and 25 h days of a clock change, and when the device zone differs from the configured one. Pure; the clock is a
 * parameter everywhere, so tests inject theirs.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    cache.set(tz, f);
  }
  return f;
}

/** An IANA zone the runtime knows (`Europe/Berlin`, `UTC` …). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The zone of this device (fallback `UTC`). */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

function wall(ms: number, tz: string): Wall {
  const out: Wall = { y: 1970, m: 1, d: 1, h: 0, min: 0 };
  for (const p of formatter(tz).formatToParts(ms)) {
    if (p.type === "year") out.y = +p.value;
    else if (p.type === "month") out.m = +p.value;
    else if (p.type === "day") out.d = +p.value;
    else if (p.type === "hour") out.h = +p.value % 24;
    else if (p.type === "minute") out.min = +p.value;
  }
  return out;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** `YYYY-MM-DD` of the instant `ms` on the wall clock of `tz`. */
export function dayKeyIn(ms: number, tz: string): string {
  const w = wall(ms, tz);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

/** Minutes since midnight (0–1439) of the instant on the wall clock of `tz`. */
export function minutesOfDayIn(ms: number, tz: string): number {
  const w = wall(ms, tz);
  return w.h * 60 + w.min;
}

/** `HH:mm` → minutes since midnight, `null` for anything else. */
export function parseClock(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m ? +m[1]! * 60 + +m[2]! : null;
}

/** The calendar day `delta` days after `key` (pure date arithmetic – no zone, no DST). */
export function shiftDayKey(key: string, delta: number): string {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * The next instant after `now` at which the wall clock of `tz` shows `minutes` (since midnight) – today when still ahead,
 * else tomorrow. Walks by the wall clock, so a clock change in between does not shift it by an hour.
 */
export function nextWallTime(now: number, tz: string, minutes: number): number {
  let t = now + (((minutes - minutesOfDayIn(now, tz) + 1440) % 1440) || 1440) * 60_000;
  for (let i = 0; i < 4; i++) {
    const diff = minutes - minutesOfDayIn(t, tz);
    if (diff === 0) break;
    // wrap into (−720, 720] so a clock change moves the guess by the hour it skipped / repeated, not by a day
    const d = ((diff + 2160) % 1440) - 720;
    t += d * 60_000;
  }
  return t > now ? t : t + 86_400_000;
}
