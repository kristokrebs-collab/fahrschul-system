/** German number and date text of the analyst (amounts in billions / millions of the filing's currency). Pure. */
import { DASH, isFin, minus, n0, n1, n2, pct } from "@/lib/format";

/** `28240000000, "USD"` → `"28,24 Mrd. USD"`; `412300000` → `"412,3 Mio. USD"`; a missing number is `"keine Daten"`. */
export function money(v: number | null | undefined, cur: string): string {
  if (!isFin(v)) return NO_DATA;
  const a = Math.abs(v);
  const body = a >= 1e9 ? `${n2(v / 1e9)} Mrd.` : a >= 1e6 ? `${n1(v / 1e6)} Mio.` : n0(v);
  return `${body} ${cur}`;
}

/** Per-share amount: `2.02` → `"2,02 USD"`. */
export const perShare = (v: number | null | undefined, cur: string): string => (isFin(v) ? `${n2(v)} ${cur}` : NO_DATA);

/** Share count: `14715000000` → `"14,72 Mrd."`. */
export function shareCount(v: number | null | undefined): string {
  if (!isFin(v)) return NO_DATA;
  const a = Math.abs(v);
  return a >= 1e9 ? `${n2(v / 1e9)} Mrd.` : a >= 1e6 ? `${n1(v / 1e6)} Mio.` : n0(v);
}

export const NO_DATA = "keine Daten";

/** Fraction → `"+16,4 %"` (sign shown), `"keine Daten"` for null. */
export const pctText = (f: number | null | undefined): string => (isFin(f) ? pct(f) : NO_DATA);
/** Fraction → `"50,1 %"` without a sign (a level, not a change). */
export const levelText = (f: number | null | undefined): string => (isFin(f) ? pct(f, false) : NO_DATA);
/** Change of a margin, fractions → `"+1,2 Pkt."`. */
export function pointsText(f: number | null | undefined): string {
  if (!isFin(f)) return NO_DATA;
  const p = f * 100;
  return `${minus((p > 0 ? "+" : "") + n1(p))} Pkt.`;
}

/** `"2026-06-27"` → `"27.06.2026"`; anything else → `"–"`. */
export function dateDe(iso: string | null | undefined): string {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : DASH;
}

/** `"Q3 GJ 2026"` when the company's numbering is known, else `"bis 27.06.2026"`. */
export function quarterLabel(r: { fiscalYear: number | null; fiscalQuarter: number | null; end: string }): string {
  return r.fiscalYear != null && r.fiscalQuarter != null ? `Q${r.fiscalQuarter} GJ ${r.fiscalYear}` : `bis ${dateDe(r.end)}`;
}

export const calendarLabel = (c: { year: number; q: number }): string => `Kalender-Q${c.q} ${c.year}`;
