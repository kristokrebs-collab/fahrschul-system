/**
 * Zahlen des Handelsplans in Worten und Ticket: deutsche Schreibweise, Preise mit den Nachkommastellen des Kursschritts
 * (ein Tick von 0,1 zeigt eine Stelle, 0,0001 vier), Mengen mit denen des Mengenschritts. Rein.
 */
const MINUS = "−";
const cache = new Map<number, Intl.NumberFormat>();

function nf(decimals: number): Intl.NumberFormat {
  const d = Math.max(0, Math.min(10, Math.round(decimals)));
  let f = cache.get(d);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
    cache.set(d, f);
  }
  return f;
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Decimal places of a step (0,01 → 2, 0,5 → 1, 1 → 0, 1e-8 → 8). */
export function decimalsOf(step: number): number {
  if (!fin(step) || step <= 0) return 2;
  const s = step.toString();
  if (s.includes("e-")) return Math.min(10, Number(s.split("e-")[1]) + (s.split("e-")[0]!.split(".")[1]?.length ?? 0));
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(10, s.length - i - 1);
}

/** A number with exactly `decimals` places, German separators, real minus sign. */
export function num(x: number | null | undefined, decimals: number): string {
  if (!fin(x)) return "–";
  return nf(decimals).format(x).replace("-", MINUS);
}

/** A number with at most `max` places and no trailing zeros ("358,325", "100"). */
export function numTrim(x: number | null | undefined, max = 4): string {
  if (!fin(x)) return "–";
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: max }).format(x).replace("-", MINUS);
}

/** A price with the decimals of the tick. */
export const priceText = (x: number | null | undefined, tick: number): string => num(x, decimalsOf(tick));

/** A quantity with the decimals of the lot step. */
export const qtyText = (x: number | null | undefined, lot: number): string => num(x, decimalsOf(lot));

/** Money with 2 decimals. */
export const moneyText = (x: number | null | undefined): string => num(x, 2);

/** A fraction as percent: `0.0181` → `1,81 %`; `digits` places. */
export function pctText(x: number | null | undefined, digits = 2): string {
  return fin(x) ? `${num(x * 100, digits)} %` : "–";
}

/** A signed percent: `−0,14 %`, `+0,55 %`. */
export function signedPctText(x: number | null | undefined, digits = 2): string {
  if (!fin(x)) return "–";
  return `${x > 0 ? "+" : ""}${num(x * 100, digits)} %`;
}

/** `2R`, `1,5R` – the R multiple of a target. */
export function rText(r: number | null | undefined): string {
  if (!fin(r)) return "–";
  return `${String(Math.round(r * 100) / 100).replace(".", ",")}R`;
}

/** Rounds to a multiple of `step` without floating-point dust (`0.1 * 3` → `0.3`). */
export function toStep(x: number, step: number, mode: "floor" | "ceil" | "nearest-away", away: 1 | -1 = 1): number {
  const dec = decimalsOf(step);
  const q = x / step;
  let n: number;
  if (mode === "floor") n = Math.floor(q + 1e-9);
  else if (mode === "ceil") n = Math.ceil(q - 1e-9);
  else {
    // nearest, ties away from the entry (`away` = +1: up, −1: down)
    const f = Math.floor(q + 1e-9);
    const frac = q - f;
    if (Math.abs(frac - 0.5) < 1e-9) n = away > 0 ? f + 1 : f;
    else n = Math.round(q);
  }
  return Number((n * step).toFixed(dec));
}

/**
 * The finest step the prices were quoted in, read from the numbers themselves (84206.1 → 0,1). It is a floor of the
 * exchange's real tick (the data may only show some of the places), so the plan says "aus den Kerzen abgeleitet".
 */
export function inferStep(values: readonly number[], fallback = 0.01): number {
  let max = 0;
  for (const v of values) {
    if (!fin(v) || v <= 0) continue;
    max = Math.max(max, decimalsOf(Number(v.toPrecision(12))));
    if (max >= 8) break;
  }
  return values.length ? Number((10 ** -max).toFixed(max)) : fallback;
}
