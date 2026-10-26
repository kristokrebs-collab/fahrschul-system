/**
 * Numbers as a screenshot shows them (F29 comma / point handling) – pure.
 *
 * The model returns the TEXT of a number ("67.432,5", "1,234.50", "−12.40", "10x", "+27,48 USDT"). This module reads it
 * without guessing silently: a clear format ("1.234,50" – both separators; "0,5"; "12.3456") is parsed as it is, a
 * genuinely ambiguous one ("1.234" – 1,234 or 1234?) is resolved with the style the SAME screenshot uses elsewhere
 * (`detectNumberStyle`) and reported as ambiguous with the other reading, so the preview can ask.
 */

/** Which character separates the decimals in a screenshot. */
export type NumberStyle = "point" | "comma";

export interface ParsedNumber {
  value: number;
  /** The text could be read two ways and the style of the screenshot did not decide it. */
  ambiguous: boolean;
  /** The other reading when `ambiguous`. */
  alt?: number;
  /** The decimal style this very number proves (both separators, or a separator with ≠ 3 trailing digits); `null` = none. */
  style: NumberStyle | null;
}

const MINUS = /[−‒–—﹣－]/g;
const SPACES = /[\s\u00A0\u202F\u2009']/g;
const THOUSANDS_APOSTROPHE = /[’ʼ]/g;

/** Keeps digits, separators and the sign of a displayed number; strips units, currency and signs of change. */
function clean(raw: string): { text: string; negative: boolean } | null {
  let s = raw.replace(MINUS, "-").replace(THOUSANDS_APOSTROPHE, "'");
  let negative = false;
  if (/^\s*\(.*\)\s*$/.test(s)) {
    negative = true;
    s = s.replace(/[()]/g, "");
  }
  // sign: leading "-" / "+" (also "-$12", "+ 12"), or a trailing "-" ("12.5-")
  const lead = /^\s*[^\d.,+-]*([+-])\s*[^\d.,]*\d/.exec(s);
  if (lead?.[1] === "-") negative = true;
  else if (!lead && /\d\s*-\s*[^\d]*$/.test(s)) negative = true;
  // the number itself: the first run of digits with separators / spaces inside
  const m = /\d[\d.,\s\u00A0\u202F\u2009']*\d|\d/.exec(s);
  if (!m) return null;
  const text = m[0].replace(SPACES, "");
  return text ? { text, negative } : null;
}

const decimalsAfter = (s: string, sep: string): number => s.length - s.lastIndexOf(sep) - 1;

/**
 * Parses a displayed number; `style` = the screenshot's decimal style (from `detectNumberStyle`) that settles an
 * ambiguous text. `null` when no number can be read.
 */
export function parseShotNumber(raw: string | null | undefined, style: NumberStyle | null = null): ParsedNumber | null {
  if (raw == null) return null;
  const c = clean(String(raw));
  if (!c) return null;
  const { text, negative } = c;
  const sign = negative ? -1 : 1;
  const done = (n: number, ambiguous = false, alt?: number, st: NumberStyle | null = null): ParsedNumber | null =>
    Number.isFinite(n) ? { value: sign * n, ambiguous, ...(alt != null ? { alt: sign * alt } : {}), style: st } : null;

  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;
  if (dots && commas) {
    // both present: the LAST one is the decimal separator
    const dec = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const thou = dec === "," ? "." : ",";
    const parts = text.split(dec);
    if (parts.length !== 2 || /^$/.test(parts[1]!)) return null;
    const groups = parts[0]!.split(thou);
    if (groups.length < 2 || groups.slice(1).some((g) => g.length !== 3)) return null;
    return done(Number(groups.join("") + "." + parts[1]), false, undefined, dec === "," ? "comma" : "point");
  }
  const sep = dots ? "." : commas ? "," : "";
  if (!sep) return done(Number(text));
  const count = dots || commas;
  if (count > 1) {
    // repeated separator: thousands ("1.234.567"); every group after the first has exactly three digits
    const groups = text.split(sep);
    if (groups.slice(1).some((g) => g.length !== 3)) return null;
    return done(Number(groups.join("")));
  }
  const after = decimalsAfter(text, sep);
  const [intPart, fracPart] = text.split(sep) as [string, string];
  const decimalStyle: NumberStyle = sep === "," ? "comma" : "point";
  if (after === 0) return done(Number(intPart));
  if (after !== 3) return done(Number(`${intPart}.${fracPart}`), false, undefined, decimalStyle);
  // exactly three digits after a single separator
  if (/^0+$/.test(intPart) || intPart.length > 3) return done(Number(`${intPart}.${fracPart}`), false, undefined, decimalStyle);
  const asDecimal = Number(`${intPart}.${fracPart}`);
  const asThousands = Number(`${intPart}${fracPart}`);
  const decimalWins = style ? style === decimalStyle : sep === ".";
  const value = decimalWins ? asDecimal : asThousands;
  const other = decimalWins ? asThousands : asDecimal;
  return done(value, style == null, style == null ? other : undefined);
}

/**
 * The decimal style a screenshot uses, from the numbers that prove it (both separators, or a separator with other
 * than three digits behind it). The majority wins; no proof or a tie → `null`.
 */
export function detectNumberStyle(raws: readonly (string | null | undefined)[]): NumberStyle | null {
  let point = 0;
  let comma = 0;
  for (const r of raws) {
    const p = parseShotNumber(r, null);
    if (p?.style === "point") point += 1;
    else if (p?.style === "comma") comma += 1;
  }
  return point > comma ? "point" : comma > point ? "comma" : null;
}

/** "10x" / "x10" / "10X" / "10.0x" → 10; anything with a number is accepted (a leverage text is short). */
export function parseLeverage(raw: string | null | undefined): number | null {
  const p = parseShotNumber(raw);
  return p && p.value > 0 ? Math.abs(p.value) : null;
}
