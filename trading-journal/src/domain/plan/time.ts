/**
 * Zeit und Zeitzonen des Handelsplans – rein, mit `Intl` (IANA-Zonen), nie mit der Zone des Geräts.
 *
 * Eine Sitzung beginnt zu einer Ortszeit ("9:30 in New York", "8:00 in London"), nicht zu einer festen UTC-Zeit. Die
 * Sommerzeit der Zone entscheidet, welcher Zeitpunkt das ist: New York wechselt am 2. Sonntag im März und am 1. Sonntag
 * im November, London am letzten Sonntag im März und im Oktober – dazwischen liegen Wochen, in denen die Abstände anders
 * sind. Alles hier rechnet deshalb über den Versatz der Zone AN DEM Zeitpunkt (`offsetMinutes`).
 */
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formats.set(tz, f);
  }
  return f;
}

/** The wall clock of an instant in an IANA zone. */
export function wallIn(ms: number, tz: string): Wall {
  const g: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) if (p.type !== "literal") g[p.type] = Number(p.value);
  return { y: g.year!, mo: g.month!, d: g.day!, h: g.hour! % 24, mi: g.minute!, s: g.second! };
}

const asUtc = (w: Wall): number => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);

/** Offset of the zone to UTC at an instant, in minutes (New York in summer: −240). */
export function offsetMinutes(ms: number, tz: string): number {
  return Math.round((asUtc(wallIn(ms, tz)) - Math.floor(ms / 1000) * 1000) / MIN);
}

/**
 * The instant at which the wall clock of `tz` reads `w`. An hour that does not exist (spring forward) moves ahead like
 * `Date` does; an hour that exists twice (fall back) is the first one.
 */
export function zonedToUtc(w: Pick<Wall, "y" | "mo" | "d" | "h" | "mi">, tz: string): number {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const o1 = offsetMinutes(guess, tz);
  const t1 = guess - o1 * MIN;
  const o2 = offsetMinutes(t1, tz);
  if (o2 === o1) return t1;
  const t2 = guess - o2 * MIN;
  // the clock reads `w` at t2 only if the offset there is o2; otherwise `w` falls into a gap: keep the old offset
  return offsetMinutes(t2, tz) === o2 ? t2 : t1;
}

const p2 = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of the instant in the zone. */
export function dayKeyIn(ms: number, tz: string): string {
  const w = wallIn(ms, tz);
  return `${w.y}-${p2(w.mo)}-${p2(w.d)}`;
}

export const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → parts, `null` for anything that is not a real calendar day. */
export function parseDayKey(key: string): { y: number; mo: number; d: number } | null {
  if (!DAY_KEY.test(key)) return null;
  const y = Number(key.slice(0, 4));
  const mo = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, mo, d } : null;
}

/** The calendar day `n` days after (or before) `key`. */
export function addDays(key: string, n: number): string {
  const p = parseDayKey(key);
  if (!p) return key;
  const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  const p = parseDayKey(key);
  return p ? new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() : 0;
}

/** `HH:MM` → minutes after midnight, `null` when it is not a time of day. */
export function parseHHMM(text: string): number | null {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `HH:MM` of the instant in the zone. */
export function clockIn(ms: number, tz: string): string {
  const w = wallIn(ms, tz);
  return `${p2(w.h)}:${p2(w.mi)}`;
}

/** `UTC−4`, `UTC+1`, `UTC+5:30` – the offset the zone has at that instant. */
export function zoneLabel(ms: number, tz: string): string {
  const o = offsetMinutes(ms, tz);
  if (o === 0) return "UTC";
  const a = Math.abs(o);
  return `UTC${o < 0 ? "−" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${p2(a % 60)}` : ""}`;
}

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

/** `Mo 19.10.` of the instant in the zone. */
export function dayLabelIn(ms: number, tz: string): string {
  const w = wallIn(ms, tz);
  const key = `${w.y}-${p2(w.mo)}-${p2(w.d)}`;
  return `${WEEKDAY_SHORT[weekdayOf(key)]} ${p2(w.d)}.${p2(w.mo)}.`;
}

/** `Mo 19.10.` of a calendar day key. */
export function dayKeyLabel(key: string): string {
  const p = parseDayKey(key);
  return p ? `${WEEKDAY_SHORT[weekdayOf(key)]} ${p2(p.d)}.${p2(p.mo)}.` : key;
}

/** `19.10.2026 15:35` of the instant in the zone. */
export function dateTimeIn(ms: number, tz: string): string {
  const w = wallIn(ms, tz);
  return `${p2(w.d)}.${p2(w.mo)}.${w.y} ${p2(w.h)}:${p2(w.mi)}`;
}

export const BERLIN = "Europe/Berlin";
