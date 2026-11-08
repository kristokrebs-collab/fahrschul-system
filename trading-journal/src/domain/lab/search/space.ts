/**
 * Der Suchraum der Strategiesuche: die Familie „Ausbruch mit Trendfilter“ des Regel-Baukastens
 * (`@/domain/backtest/strategies/rules`: Schluss über dem Hoch der letzten N Kerzen, Schluss über einer EMA, Stop als ATR-Vielfaches,
 * Ziel als R-Vielfaches, Zeit-Stopp) und die gesetzte Ziehung von 1.000 Varianten daraus.
 *
 * Die Ziehung ist ohne Zurücklegen und hängt nur vom Seed (und der Kerzenlänge) ab, nie von den Kerzen: dieselben 1.000 Varianten
 * werden auf jedem Markt geprüft. Der Raum hat 24.000 Punkte – 1.000 davon sind ein Vierundzwanzigstel, genug Auswahl, um Glück zu
 * erzeugen, und genug Nachbarn, um echte Kanten zu finden.
 */
import { rng } from "@/domain/analytics/stats";
import type { RuleCond } from "@/domain/backtest/strategies/rules";
import { ORB_SESSIONS, ORB_SPACE } from "./orb";
import type { AnyVariant, OrbVariant, SearchInterval, SearchVariant } from "./types";

/** Modellversion: jede Änderung an Familie, Raum, Zielgröße oder Kriterien erhöht sie (gespeicherte Ergebnisse nennen sie). */
export const SEARCH_MODEL_VERSION = "strategiesuche-2";
export const SEARCH_FAMILY = "Ausbruch mit Trendfilter";
export const ORB_FAMILY = "Eröffnungs-Range-Ausbruch";
export const FAMILY_NAME = { trend: SEARCH_FAMILY, orb: ORB_FAMILY } as const;
export const SEARCH_VARIANTS = 1000;
/** Standard-Seed – ein anderer Seed zieht andere 1.000 Varianten aus demselben Raum. */
export const DEFAULT_SEED = 20261108;
/** Anteil der Kerzen, auf dem gesucht wird; die letzten 20 % bleiben ungesehen bis zum Endtest. */
export const IS_SHARE = 0.8;
/** Kerzen Vorlauf vor dem Handelsfenster (EMA 200 schwingt ein, Hoch/Tief-Fenster sind voll). */
export const SEARCH_WARMUP_BARS = 400;
/** Wenigste Kerzen im Handelsfenster, damit eine Suche überhaupt sinnvoll ist. */
export const MIN_WINDOW_BARS = 300;

export const SEARCH_INTERVALS: readonly SearchInterval[] = ["1h", "4h", "1d"];

export interface SearchSpace {
  side: readonly ("long" | "short")[];
  lookback: readonly number[];
  trendEma: readonly number[];
  stopAtr: readonly number[];
  targetR: readonly number[];
  maxBars: readonly number[];
}

const MAX_BARS: Readonly<Record<SearchInterval, readonly number[]>> = {
  "1h": [24, 48, 72, 120, 168],
  "4h": [6, 12, 24, 42, 60],
  "1d": [3, 5, 10, 15, 20],
};

export function searchSpace(interval: SearchInterval): SearchSpace {
  return {
    side: ["long", "short"],
    lookback: [8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40, 48, 56, 64],
    trendEma: [0, 20, 50, 100, 200],
    stopAtr: [1, 1.5, 2, 2.5, 3, 4],
    targetR: [1, 1.5, 2, 3, 4],
    maxBars: MAX_BARS[interval],
  };
}

export const spaceSize = (s: SearchSpace): number => s.side.length * s.lookback.length * s.trendEma.length * s.stopAtr.length * s.targetR.length * s.maxBars.length;

/** Der k-te Punkt des Raums (gemischte Zählweise). */
function pointAt(s: SearchSpace, k: number): Omit<SearchVariant, "id" | "family"> {
  let r = k;
  const take = <T>(list: readonly T[]): T => {
    const v = list[r % list.length]!;
    r = Math.floor(r / list.length);
    return v;
  };
  const side = take(s.side);
  const lookback = take(s.lookback);
  const trendEma = take(s.trendEma);
  const stopAtr = take(s.stopAtr);
  const targetR = take(s.targetR);
  const maxBars = take(s.maxBars);
  return { side, lookback, trendEma, stopAtr, targetR, maxBars };
}

/**
 * Zieht `count` verschiedene Varianten (Teil-Mischung nach Fisher-Yates über den Indexraum, gesetzt durch `seed`).
 * Deterministisch; wirft nicht, wenn `count` den Raum übersteigt (dann ist es der ganze Raum).
 */
export function drawVariants(interval: SearchInterval, seed: number, count = SEARCH_VARIANTS): SearchVariant[] {
  const space = searchSpace(interval);
  const total = spaceSize(space);
  const n = Math.max(0, Math.min(Math.floor(count), total));
  const rand = rng(Math.floor(seed) >>> 0);
  const moved = new Map<number, number>();
  const at = (i: number): number => moved.get(i) ?? i;
  const out: SearchVariant[] = [];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (total - i));
    const pick = at(j);
    moved.set(j, at(i));
    out.push({ family: "trend", id: i, ...pointAt(space, pick) });
  }
  return out;
}

/** Die Bedingungen des Regel-Baukastens, die diese Variante ausmachen (Long: Ausbruch nach oben, Short: nach unten). */
export function condsOf(v: SearchVariant): RuleCond[] {
  const long = v.side === "long";
  const conds: RuleCond[] = [{ kind: long ? "breakoutHigh" : "breakdownLow", a: v.lookback }];
  if (v.trendEma > 0) conds.push({ kind: long ? "closeAboveEma" : "closeBelowEma", a: v.trendEma });
  return conds;
}

/** Stabiler Schlüssel der Einstiegs-Bedingung (Rechen-Cache: viele Varianten teilen sich dieselben Signale). */
export const signalKey = (v: SearchVariant): string => `${v.side}|${v.lookback}|${v.trendEma}`;

const nf = (x: number): string => String(x).replace(".", ",");

/** Die Regeln einer Variante in einem Satz. */
export function variantText(v: AnyVariant): string {
  if (v.family === "orb") return orbText(v);
  const long = v.side === "long";
  const edge = long ? "über dem Hoch" : "unter dem Tief";
  const trend = v.trendEma > 0 ? ` und ${long ? "über" : "unter"} der EMA ${v.trendEma}` : "";
  return `${long ? "Long" : "Short"}, wenn der Schluss ${edge} der letzten ${v.lookback} Kerzen liegt${trend} · Stop ${nf(v.stopAtr)} × ATR · Ziel ${nf(v.targetR)} R · Zeit-Stopp ${v.maxBars} Kerzen`;
}

const STOP_TEXT = { range: "gegenüberliegende Seite der Range", mid: "Mitte der Range", atr15: "1,5 × ATR" } as const;

/** Die Regeln einer Eröffnungs-Range-Variante in einem Satz. */
export function orbText(v: OrbVariant): string {
  const S = ORB_SESSIONS[v.session];
  return `Eröffnungs-Range ${S.name}, erste ${v.rangeMin} Minuten: Einstieg zur Eröffnung nach dem ersten Schluss außerhalb (binnen 3 Stunden), Volumen ≥ ${nf(v.volThr)}× des Schnitts der 20 Kerzen davor${v.trend ? " und Kurs auf der passenden Seite der EMA 50" : ""} · Stop ${STOP_TEXT[v.stop]} · Ziel ${nf(v.targetR)} R · Zeit-Stopp am Sitzungsende`;
}

/** Alle 540 Varianten der Eröffnungs-Range-Familie (Ids setzt der Aufrufer). */
export function orbVariants(): OrbVariant[] {
  const out: OrbVariant[] = [];
  for (const session of ORB_SPACE.session)
    for (const rangeMin of ORB_SPACE.rangeMin)
      for (const volThr of ORB_SPACE.volThr)
        for (const targetR of ORB_SPACE.targetR)
          for (const stop of ORB_SPACE.stop)
            for (const trend of ORB_SPACE.trend) out.push({ family: "orb", id: 0, session, rangeMin, volThr, targetR, stop, trend });
  return out;
}
