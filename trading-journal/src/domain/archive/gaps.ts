/**
 * Gaps of the archive (F26): a stretch with no point is a gap – never filled, never interpolated, never estimated. This
 * module finds them from the points' times and explains them from the tick log: no tick at all → the app (or the tab)
 * was closed; ticks that failed → the reason of the request; ticks without the symbol → it was not selected then.
 * Pure.
 */
import type { SeriesDef } from "./series";
import type { Gap, GapCause, TickRecord } from "./types";

/** A stretch counts as a gap when it is longer than this many expected steps. */
export const GAP_FACTOR = 2.5;
/** Used when no tick is known at all (a point without log): the longest interval the collector offers. */
const FALLBACK_IV_MIN = 15;
/** Clock slack between the exchange's and the device's time. */
const SKEW_MS = 60_000;
/** A 5-minute point is published a little after its time. */
const PUBLISH_LAG_MS = 120_000;

/** Index of the first tick with `t >= x` (ticks ascending). */
function lowerBound(ticks: readonly TickRecord[], x: number): number {
  let lo = 0;
  let hi = ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ticks[mid]!.t < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The interval (minutes) in force at `t`: that of the last tick at or before it, else of the first after it. */
export function ivAt(ticks: readonly TickRecord[], t: number): number {
  if (!ticks.length) return FALLBACK_IV_MIN;
  const i = lowerBound(ticks, t + 1) - 1;
  return (i >= 0 ? ticks[i]! : ticks[0]!).iv;
}

/** Longest distance of two neighbouring points that is still no gap (ms). */
export function gapThreshold(def: SeriesDef, ivMin: number): number {
  return GAP_FACTOR * Math.max(ivMin * 60_000, def.stepMs);
}

function topReason(ticks: readonly TickRecord[], symbol: string): string | null {
  const count = new Map<string, number>();
  for (const t of ticks) {
    const r = t.res[symbol];
    if (!r || r === "ok") continue;
    const reason = r.startsWith("partial:") ? r.slice(8) : r;
    count.set(reason, (count.get(reason) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of count) if (v > n || (v === n && best !== null && k < best)) [best, n] = [k, v];
  return best;
}

/** Why there is no point between `a` and `b`: read from the ticks that ran inside. */
export function explainGap(def: SeriesDef, symbol: string, a: number, b: number, ticks: readonly TickRecord[]): Pick<Gap, "cause" | "detail" | "ticks"> {
  const lag = def.stepMs > 0 ? def.stepMs + ivAt(ticks, a) * 60_000 + PUBLISH_LAG_MS : SKEW_MS;
  const inside: TickRecord[] = [];
  for (let i = lowerBound(ticks, a + lag); i < ticks.length && ticks[i]!.t < b; i++) inside.push(ticks[i]!);
  if (!inside.length) return { cause: "app", detail: null, ticks: 0 };
  // state series come from the app's own analysis of the live symbol, independent of the requests: ticks that ran
  // without writing them say the analysis was not there
  if (def.kind === "state") return { cause: "analysis", detail: null, ticks: inside.length };
  const withSymbol = inside.filter((t) => symbol in t.res);
  if (!withSymbol.length) return { cause: "unwatched", detail: null, ticks: inside.length };
  const failed = withSymbol.filter((t) => t.res[symbol] !== "ok");
  if (failed.length) return { cause: "failed", detail: topReason(failed, symbol), ticks: inside.length };
  return { cause: "unknown", detail: null, ticks: inside.length };
}

/**
 * The gaps of one series of one symbol. `times` ascending (ms); `ticks` ascending. Two neighbouring points further
 * apart than `GAP_FACTOR` × the expected step form a gap. Nothing is added inside.
 */
export function findGaps(def: SeriesDef, symbol: string, times: readonly number[], ticks: readonly TickRecord[]): Gap[] {
  const out: Gap[] = [];
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1]!;
    const b = times[i]!;
    if (b - a <= gapThreshold(def, ivAt(ticks, a))) continue;
    out.push({ from: a, to: b, ...explainGap(def, symbol, a, b, ticks) });
  }
  return out;
}

/** Total time inside gaps (ms). */
export const gapMs = (gaps: readonly Gap[]): number => gaps.reduce((s, g) => s + (g.to - g.from), 0);

export const GAP_CAUSE_LABEL: Readonly<Record<GapCause, string>> = {
  app: "App war zu oder pausiert – kein Abruf versucht",
  failed: "Abruf fehlgeschlagen",
  unwatched: "Symbol war nicht ausgewählt",
  analysis: "Auswertung der App lag nicht vor",
  unknown: "Grund unbekannt",
};

/** German names of the failure reasons the collector logs. */
export const FAIL_LABEL: Readonly<Record<string, string>> = {
  blocked_451: "Binance sperrt den Standort (451)",
  network: "Netzwerk- oder CORS-Fehler",
  rate_limited: "Binance bremst (429/418/403)",
  timeout: "Zeitüberschreitung",
  offline: "Gerät offline",
  http_5xx: "Fehler bei Binance",
  bad_symbol: "Symbol unbekannt",
  budget: "Abfragebudget aufgebraucht",
};

/** `Abruf fehlgeschlagen: Netzwerk- oder CORS-Fehler`. */
export function gapText(g: Pick<Gap, "cause" | "detail">): string {
  const base = GAP_CAUSE_LABEL[g.cause];
  return g.cause === "failed" && g.detail ? `${base}: ${FAIL_LABEL[g.detail] ?? g.detail}` : base;
}
