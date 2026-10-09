/**
 * Internal de-DE formatters for the chart module (mirror of the bundle's `V` helpers, Plan 2.x).
 * Kept local so the chart layer has no dependency on modules still under construction; when
 * `@/lib/format` lands with the same names, this file can re-export from there.
 */
const f0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const f1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fp2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const fp4 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 });

export const DASH = "–";
/** Replaces the ASCII hyphen-minus with U+2212. */
export const minus = (s: string): string => s.replace("-", "−");
const isFin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const fmt = {
  n0: (v: number | null | undefined): string => (isFin(v) ? minus(f0.format(v)) : DASH),
  n1: (v: number | null | undefined): string => (isFin(v) ? minus(f1.format(v)) : DASH),
  n2: (v: number | null | undefined): string => (isFin(v) ? minus(f2.format(v)) : DASH),
  signed: (v: number | null | undefined, d: 0 | 1 | 2 = 2): string =>
    isFin(v) ? minus((v > 0 ? "+" : "") + (d === 0 ? f0 : d === 1 ? f1 : f2).format(v)) : DASH,
  /** `0.6215` → `62 %` (no sign, no minus replacement – as in the bundle). */
  pct0: (v: number | null | undefined): string => (isFin(v) ? f0.format(v * 100) + " %" : DASH),
  /** Bundle `V.price`: max 4 decimals below 10, otherwise max 2, no minimum. */
  price: (v: number | null | undefined): string => (isFin(v) ? minus((v < 10 ? fp4 : fp2).format(v)) : DASH),
  /** `dd.MM.yy` */
  date: (d: Date): string =>
    Number.isNaN(+d) ? DASH : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }),
  /** `HH:mm` */
  time: (d: Date): string =>
    Number.isNaN(+d) ? "" : d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
  /** Y-axis formatter of the Recharts cards: `|v| ≥ 1e6 → n1(v/1e6) + " Mio"`, else `n0(v)`. */
  mio: (v: number): string => (Math.abs(v) >= 1e6 ? fmt.n1(v / 1e6) + " Mio" : fmt.n0(v)),
} as const;

/** Canonical trade time (bundle `tt`): `date` (local wall clock) → `createdAt` → epoch 0. */
export function tradeTime(t: { date?: string; createdAt?: string }): number {
  return new Date(t.date || t.createdAt || 0).getTime();
}
