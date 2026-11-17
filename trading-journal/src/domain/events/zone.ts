/**
 * Wall clock ⇄ instant in any IANA zone (via `Intl`, never the device's local getters), shared by the event calendar
 * and the ledger. The journal stores times as a local wall clock without a zone ("2026-10-12T09:30"); to show them in
 * another zone, to put them on a calendar day of New York or to compare them with a UTC grid, the zone they were written
 * in has to be named. Pure; the clock is always a parameter.
 *
 * Clock changes: a wall time that exists twice (autumn) is the EARLIER instant, one that does not exist (spring) is read
 * with the offset from before the change (so it lands one hour later on the wall clock) – the same as the `compatible`
 * rule of the Temporal proposal. Both are rare and the tests pin them.
 */
import { dayKeyIn, deviceTimeZone, isValidTimeZone } from "../checkin/day";

export { dayKeyIn, deviceTimeZone, isValidTimeZone };

/** A wall clock reading. `s` is seconds (default 0). */
export interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock of the instant `ms` in `tz`. */
export function wallOf(ms: number, tz: string): Required<Wall> {
  const out = { y: 1970, m: 1, d: 1, h: 0, min: 0, s: 0 };
  for (const p of formatter(tz).formatToParts(ms)) {
    if (p.type === "year") out.y = +p.value;
    else if (p.type === "month") out.m = +p.value;
    else if (p.type === "day") out.d = +p.value;
    else if (p.type === "hour") out.h = +p.value % 24;
    else if (p.type === "minute") out.min = +p.value;
    else if (p.type === "second") out.s = +p.value;
  }
  return out;
}

const asUtc = (w: Wall): number => Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s ?? 0);

/** Offset of `tz` at the instant `ms`, in ms (`+3_600_000` = one hour ahead of UTC). */
export function offsetMs(ms: number, tz: string): number {
  return asUtc(wallOf(ms, tz)) - Math.floor(ms / 1000) * 1000;
}

/** `UTC+1` / `UTC−5` / `UTC+5:30` of `tz` at `ms`. */
export function offsetLabel(ms: number, tz: string): string {
  const min = Math.round(offsetMs(ms, tz) / 60_000);
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

/** The instant at which the wall clock of `tz` shows `w` (see the module note for clock changes). */
export function wallToUtc(w: Wall, tz: string): number {
  const guess = asUtc(w);
  if (tz === "UTC") return guess;
  const day = 86_400_000;
  const before = guess - offsetMs(guess - day, tz);
  const after = guess - offsetMs(guess + day, tz);
  const ok = (t: number): boolean => {
    const x = wallOf(t, tz);
    return x.y === w.y && x.m === w.m && x.d === w.d && x.h === w.h && x.min === w.min && x.s === (w.s ?? 0);
  };
  const okBefore = ok(before);
  const okAfter = ok(after);
  if (okBefore && okAfter) return Math.min(before, after);
  if (okAfter) return after;
  return before;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** "2026-10-12T09:30[:ss]" (the journal's wall clock) → `Wall`, `null` for anything else. */
export function parseWall(s: string | null | undefined): Wall | null {
  if (typeof s !== "string") return null;
  const m = WALL.exec(s.trim());
  if (!m) return null;
  const w: Wall = { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: +m[4]!, min: +m[5]!, s: m[6] ? +m[6] : 0 };
  if (w.m < 1 || w.m > 12 || w.d < 1 || w.d > 31 || w.h > 23 || w.min > 59 || (w.s ?? 0) > 59) return null;
  return w;
}

/** A journal wall-clock string written in `tz` → the instant; `NaN` when it does not parse. */
export function wallStringToUtc(s: string | null | undefined, tz: string): number {
  const w = parseWall(s);
  return w ? wallToUtc(w, tz) : NaN;
}

const p2 = (n: number): string => String(n).padStart(2, "0");

/** `12.10.2026 09:30` of the instant in `tz`. */
export function formatStamp(ms: number, tz: string): string {
  const w = wallOf(ms, tz);
  return `${p2(w.d)}.${p2(w.m)}.${w.y} ${p2(w.h)}:${p2(w.min)}`;
}

/** `12.10.2026` of the instant in `tz`. */
export function formatDay(ms: number, tz: string): string {
  const w = wallOf(ms, tz);
  return `${p2(w.d)}.${p2(w.m)}.${w.y}`;
}

/** `09:30` of the instant in `tz`. */
export function formatClock(ms: number, tz: string): string {
  const w = wallOf(ms, tz);
  return `${p2(w.h)}:${p2(w.min)}`;
}

/** `YYYY-MM-DDTHH:mm` (a `datetime-local` value) of the instant in `tz`. */
export function toLocalInput(ms: number, tz: string): string {
  const w = wallOf(ms, tz);
  return `${w.y}-${p2(w.m)}-${p2(w.d)}T${p2(w.h)}:${p2(w.min)}`;
}

/** The year of the instant on the wall clock of `tz`. */
export function yearIn(ms: number, tz: string): number {
  return wallOf(ms, tz).y;
}

/** The weekday (0 = Sunday … 6) of a `YYYY-MM-DD` key (pure date arithmetic). */
export function weekdayOfKey(key: string): number {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The key `delta` days after `key` (pure date arithmetic, no zone). */
export function addDays(key: string, delta: number): string {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

export const keyOf = (y: number, m: number, d: number): string => `${String(y).padStart(4, "0")}-${p2(m)}-${p2(d)}`;

/** Zones offered in the pickers: the trader's device first, then the usual trading zones. Every entry is a valid IANA name. */
export const ZONE_CHOICES: readonly { id: string; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "Europe/Berlin", label: "Berlin / Wien / Zürich" },
  { id: "Europe/London", label: "London" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Singapore", label: "Singapur / Hongkong" },
  { id: "Asia/Tokyo", label: "Tokio" },
  { id: "Australia/Sydney", label: "Sydney" },
];
