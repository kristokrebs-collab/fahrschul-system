/**
 * Number/date formatting – 1:1 port of the bundle's `V` formatter (bundle.pretty.js 21160–21209).
 * Locale de-DE, hyphen-minus rendered as U+2212 "−" (first occurrence), non-finite → "–" (U+2013).
 */
// Every formatter is built once at module level: these run inside live re-renders, and constructing an
// `Intl` formatter (or calling `toLocale*String` with options, which does the same internally) per call dominated.
const f0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const f1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fPriceSmall = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 });
const fPrice = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const fDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
const fTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const fDateTime = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const DASH = "–";
export const MINUS = "−";
export const INFINITY_SIGN = "∞";

/** Bundle `Zl`: replaces the first "-" with U+2212. */
export const minus = (s: string): string => s.replace("-", MINUS);
/** Bundle `Xr`: finite number guard (null/undefined/NaN/±∞ → false). */
export const isFin = (e: unknown): e is number => e != null && typeof e === "number" && isFinite(e);

export type SignedDigits = 0 | 1 | 2;

/** Integer, e.g. 85900 → "85.900". */
export const n0 = (e: number | null | undefined): string => (isFin(e) ? minus(f0.format(e)) : DASH);
/** One decimal, e.g. 1.25 → "1,3". */
export const n1 = (e: number | null | undefined): string => (isFin(e) ? minus(f1.format(e)) : DASH);
/** Two decimals, e.g. 1.2 → "1,20". */
export const n2 = (e: number | null | undefined): string => (isFin(e) ? minus(f2.format(e)) : DASH);
/** "+" prefix for positive values; `d` = decimals (0|1|2, default 2). */
export const signed = (e: number | null | undefined, d: SignedDigits = 2): string =>
  isFin(e) ? minus((e > 0 ? "+" : "") + (d === 0 ? f0 : d === 1 ? f1 : f2).format(e)) : DASH;
/** Fraction → percent with 1 decimal and " %" suffix, "+" prefix when `plus` (default true). */
export const pct = (e: number | null | undefined, plus = true): string =>
  isFin(e) ? minus((plus && e > 0 ? "+" : "") + f1.format(e * 100)) + " %" : DASH;
/** Fraction → percent with 0 decimals, no sign handling (bundle quirk: no U+2212 replacement). */
export const pct0 = (e: number | null | undefined): string => (isFin(e) ? f0.format(e * 100) + " %" : DASH);
/** R-multiple: "+1,25 R". */
export const r = (e: number | null | undefined): string =>
  isFin(e) ? minus((e > 0 ? "+" : "") + f2.format(e)) + " R" : DASH;
/** Price: 4 fraction digits below 10, else 2 (no U+2212 replacement, like the bundle). */
export const price = (e: number | null | undefined): string => (isFin(e) ? (e < 10 ? fPriceSmall : fPrice).format(e) : DASH);
/** "dd.MM.yy" */
export const date = (d: Date): string => (isNaN(+d) ? DASH : fDate.format(d));
/** "HH:mm" ("" for invalid dates, like the bundle). */
export const time = (d: Date): string => (isNaN(+d) ? "" : fTime.format(d));
/** Market-card style "dd.MM. HH:mm" (bundle `toLocaleString("de-DE", {day, month, hour, minute})`). */
export const dateTime = (d: Date): string => (isNaN(+d) ? DASH : fDateTime.format(d));
/** Profit factor cell: "–" | "∞" | n2. */
export const pf = (e: number | null | undefined): string =>
  e == null ? DASH : e === Infinity ? INFINITY_SIGN : n2(e);

/** Bundle `Xe`: colour class by sign (null/0 → text-fg). */
export const colorClass = (e: number | null | undefined): "text-fg" | "text-win" | "text-loss" =>
  !isFin(e) || e === 0 ? "text-fg" : e > 0 ? "text-win" : "text-loss";
/** Bundle `so`: same as `colorClass` but only null/0 map to text-fg (NaN → text-loss via `> 0` false). */
export const toneClass = (e: number | null | undefined): "text-fg" | "text-win" | "text-loss" =>
  e == null || e === 0 ? "text-fg" : e > 0 ? "text-win" : "text-loss";

/** Chart axis tick: |v| ≥ 1e6 → "1,2 Mio", else integer. */
export const mio = (v: number): string => (Math.abs(v) >= 1e6 ? n1(v / 1e6) + " Mio" : n0(v));

export const fmt = { n0, n1, n2, signed, pct, pct0, r, price, date, time, dateTime, pf, mio } as const;
export type Fmt = typeof fmt;
export default fmt;
