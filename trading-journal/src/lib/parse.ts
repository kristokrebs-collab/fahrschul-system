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
