/** German number / time wording of the scanner's sentences. Pure (`Intl` only). */

const MINUS = "−";
const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f;
}

/** 1.234,50 – two decimals above 1, four below (cheap coins, penny stocks). */
export function priceText(v: number): string {
  const s = Math.abs(v) >= 1 ? nf(2, 2).format(v) : nf(2, 4).format(v);
  return v < 0 ? s.replace("-", MINUS) : s;
}

/** +12,4 % / −3,1 % from a fraction (0.124). */
export function pctText(fraction: number, digits = 1, signed = true): string {
  const s = nf(digits, digits).format(Math.abs(fraction * 100));
  const sign = fraction < 0 ? MINUS : signed && fraction > 0 ? "+" : "";
  return `${sign}${s} %`;
}

/** 27,4 */
export const numText = (v: number, digits = 1): string => nf(digits, digits).format(v).replace("-", MINUS);

/** 1,2 Mio. / 850.000 */
export function volumeText(v: number): string {
  if (Math.abs(v) >= 1e9) return `${nf(1, 1).format(v / 1e9)} Mrd.`;
  if (Math.abs(v) >= 1e6) return `${nf(1, 1).format(v / 1e6)} Mio.`;
  return nf(0, 0).format(Math.round(v));
}

const times = new Map<string, Intl.DateTimeFormat>();
/** 10:15 in the session's time zone (`America/New_York`, `UTC`). */
export function clockText(ms: number, timeZone: string): string {
  let f = times.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    times.set(timeZone, f);
  }
  return f.format(new Date(ms));
}
