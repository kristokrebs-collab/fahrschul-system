/**
 * Small de-DE formatters used inside the market layer (labels, funding line). Views own the full
 * formatter set; these are intentionally minimal and produce U+2212 for minus.
 */
const MINUS = "−";

export function deMinus(s: string): string {
  return s.replace(/-/g, MINUS);
}

export function n0(v: number): string {
  return deMinus(new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(v));
}
export function n1(v: number): string {
  return deMinus(new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v));
}
export function n2(v: number): string {
  return deMinus(new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v));
}
export function n4(v: number): string {
  return deMinus(new Intl.NumberFormat("de-DE", { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v));
}
/** `+1,23` / `−1,23` (sign always shown, minus U+2212). */
export function signed(v: number, digits = 1): string {
  const abs = new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v));
  return v < 0 ? `${MINUS}${abs}` : `+${abs}`;
}

/** `HH:mm` in the viewer's local time zone. */
export function hhmm(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(ms));
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
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}. ${g("hour")}:${g("minute")}`;
}
