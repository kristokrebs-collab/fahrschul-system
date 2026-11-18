/**
 * Tolerant number parsing / input formatting – 1:1 port of bundle `rt`, `nt`, `XM` (21212–21236).
 */

/**
 * `rt`: "Komma oder Punkt, beides geht".
 * numbers pass through when finite; strings are trimmed and stripped of whitespace;
 * when the string contains "," every "." is removed and "," becomes "." ("85.900,5" → 85900.5);
 * otherwise `Number()` ("85.900" → 85.9, NOT 85900). Non-finite → null.
 */
export function parseNumber(e: unknown): number | null {
  if (typeof e === "number") return isFinite(e) ? e : null;
  let t = String(e ?? "")
    .trim()
    .replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const r = Number(t);
  return isFinite(r) ? r : null;
}

/**
 * The German thousands reading of an input that `parseNumber` reads differently: dots before groups of exactly three digits and
 * no comma ("81.230", "1.234.567"). `parseNumber` keeps the bundle's rule (one dot = the decimal point → 81,23; several dots →
 * not a number), which is right for a price copied from a chart ("142.350") and a trap for someone who writes 81.230 for
 * eighty-one thousand. This returns the other reading (81230) so a form can ASK instead of guessing; `null` when the input has no
 * such shape. It never changes what `parseNumber` returns.
 */
export function thousandsReading(e: unknown): number | null {
  if (typeof e !== "string") return null;
  const t = e.trim().replace(/\s/g, "");
  if (!/^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) return null;
  const v = Number(t.replace(/\./g, ""));
  return isFinite(v) ? v : null;
}

/** `nt`: number → form input string with the first "." replaced by "," (null/undefined → ""). */
export function toInputString(e: number | string | null | undefined): string {
  return e == null ? "" : String(e).replace(".", ",");
}

/** Alias used by forms: number → "1234,5". */
export const formatNumberInput = toInputString;

/** Percent stored as fraction → form string with 2 decimals ("62,15"); bundle `+(x*100).toFixed(2)`. */
export function fractionToPercentInput(x: number | null | undefined): string {
  return x == null || !isFinite(x) ? "" : toInputString(+(x * 100).toFixed(2));
}

/** Form percent string → fraction (or null). */
export function percentInputToFraction(s: unknown): number | null {
  const v = parseNumber(s);
  return v == null ? null : v / 100;
}

/** `XM`: keeps a trimmed URL only when it starts with http(s)://, else "". */
export function sanitizeUrl(e: unknown): string {
  const s = String(e || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/** Bundle helper for `deltaCandles`: `Math.max(0, Math.round(x || 0))`. */
export function toNonNegativeInt(x: number | null | undefined): number {
  return Math.max(0, Math.round(x || 0));
}

export const rt = parseNumber;
export const nt = toInputString;
export const XM = sanitizeUrl;
