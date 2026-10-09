/**
 * Rolling display of a preformatted de-DE value (`"+396,00"`, `"+1.234,50 USDT"`, `"−12 %"`): the toast island
 * counts win values up from zero. Parsing keeps everything around the number verbatim, so the final frame is
 * exactly the original string.
 */
export interface RollSpec {
  /** Text before the sign/number (e.g. `"4H "`). */
  prefix: string;
  /** Explicit sign as written (`"+"`, `"−"`, `"-"` or `""`). */
  sign: string;
  /** Absolute numeric value. */
  value: number;
  decimals: number;
  /** Whether the source used `.` thousands grouping. */
  grouped: boolean;
  /** Text after the number (e.g. `" USDT"`). */
  suffix: string;
}

// the first whole de-DE number (optionally signed, `.` grouping, `,` decimals), never a fragment of a longer one
const NUMBER = /^(.*?)([+\-−]?)(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?![\d.,])(.*)$/s;

/** `null` when the string carries no number to roll. */
export function parseRollValue(text: string): RollSpec | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const [, prefix = "", sign = "", int = "0", frac, suffix = ""] = m;
  const value = Number(`${int.replace(/\./g, "")}.${frac ?? "0"}`);
  if (!Number.isFinite(value)) return null;
  return { prefix, sign, value, decimals: frac?.length ?? 0, grouped: int.includes("."), suffix };
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(decimals: number, grouped: boolean): Intl.NumberFormat {
  const key = `${decimals}|${grouped}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
    formatters.set(key, f);
  }
  return f;
}

/** Formats `n` (0 … spec.value) in the spec's shape (sign, decimals, grouping, prefix/suffix as in the source). */
export function formatRoll(spec: RollSpec, n: number): string {
  return `${spec.prefix}${spec.sign}${formatter(spec.decimals, spec.grouped).format(Math.abs(n))}${spec.suffix}`;
}
