/**
 * Small de-DE formatters used inside the market layer (labels, funding line). Views own the full
 * formatter set; these are intentionally minimal and produce U+2212 for minus. `Intl` formatters are built once
 * and cached (the labels render inside live updates; constructing a formatter per call dominated their cost).
 */
const MINUS = "−";

export function deMinus(s: string): string {
  return s.replace(/-/g, MINUS);
}

const F0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const fixedFormats = new Map<number, Intl.NumberFormat>();

/** Cached `de-DE` formatter with exactly `digits` fraction digits. */
function fixed(digits: number): Intl.NumberFormat {
  let f = fixedFormats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    fixedFormats.set(digits, f);
  }
  return f;
}

export function n0(v: number): string {
  return deMinus(F0.format(v));
}
export function n1(v: number): string {
  return deMinus(fixed(1).format(v));
}
export function n2(v: number): string {
  return deMinus(fixed(2).format(v));
}
export function n4(v: number): string {
  return deMinus(fixed(4).format(v));
}
/** `+1,23` / `−1,23` (sign always shown, minus U+2212). */
export function signed(v: number, digits = 1): string {
  const abs = fixed(digits).format(Math.abs(v));
  return v < 0 ? `${MINUS}${abs}` : `+${abs}`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** Cached `de-DE` date formatter per pattern and time zone (`undefined` = the viewer's zone). */
function dateFormat(kind: "hhmm" | "ddmmHHmm", timeZone: string | undefined): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone ?? ""}`;
  let f = dateFormats.get(key);
  if (!f) {
    f =
      kind === "hhmm"
        ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })
        : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    dateFormats.set(key, f);
  }
  return f;
}

/** `HH:mm` in the viewer's local time zone. */
export function hhmm(ms: number, timeZone?: string): string {
  return dateFormat("hhmm", timeZone).format(new Date(ms));
}
/** `HH:mm:ss` from a duration. */
export function hhmmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
/** `mm:ss` from a duration. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
/** `dd.MM. HH:mm` (bundle format for `Letzter geschlossener 4H-Schluss · …`). */
export function ddmmHHmm(ms: number, timeZone?: string): string {
  const parts = dateFormat("ddmmHHmm", timeZone).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}. ${g("hour")}:${g("minute")}`;
}
