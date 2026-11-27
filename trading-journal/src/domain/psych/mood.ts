/**
 * Mood, stress, energy and sleep against results (P08). Day factors come from the day check-in (`DayNote.mood` /
 * `checkin`), trade factors from the trade editor's psyche (P06 `psych.stress` / `psych.confidence`). Each factor is
 * bucketed by level; per bucket the closed trades' Ø R (or Ø P&L when too few trades carry an R), win rate and n,
 * plus a rank correlation over the days / trades and an honest one-line verdict with its sample. Under
 * `MIN_FACTOR_N` days / trades a factor says "zu wenig Daten" instead of guessing. Pure.
 */
import type { DayNotes, EnrichedTrade } from "../types";
import { dayKeyOf } from "../insights/shared";
import { checkinOf, ENERGY_LABELS, level5, MOOD_LABELS, STRESS_LABELS } from "./checkin";

export type FactorKey = "mood" | "stress" | "energy" | "sleep" | "tradeStress" | "confidence";
export type FactorUnit = "R" | "money";

export interface FactorBucket {
  key: string;
  label: string;
  /** days (day factors) or trades (trade factors) */
  n: number;
  trades: number;
  /** Ø result per trade in `unit` */
  avg: number | null;
  winRate: number | null;
}

export interface PsychFactor {
  key: FactorKey;
  label: string;
  scope: "day" | "trade";
  unit: FactorUnit;
  buckets: FactorBucket[];
  /** days / trades with a value */
  n: number;
  /** Spearman rank correlation level ↔ result (`null` under the minimum sample) */
  rho: number | null;
  /** the strongest bucket (n ≥ `MIN_BUCKET_N`), the weakest */
  best: FactorBucket | null;
  worst: FactorBucket | null;
  enough: boolean;
  verdict: string;
}

export const MIN_FACTOR_N = 8;
export const MIN_BUCKET_N = 3;

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

interface Sample {
  level: number;
  bucket: string;
  results: number[];
  wins: number;
  n: number;
}

/** Spearman rank correlation (average ranks for ties); `null` for < 3 points or no variance. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const rank = (v: readonly number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1]![0] === idx[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs.slice(0, n));
  const ry = rank(ys.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

const fmtVal = (v: number, unit: FactorUnit, cur: string): string => {
  const s = unit === "R" ? `${(Math.round(v * 100) / 100).toFixed(2).replace(".", ",")} R` : `${Math.round(v).toLocaleString("de-DE")} ${cur}`;
  return (v > 0 ? "+" : "") + s.replace("-", "−");
};

function factorOf(key: FactorKey, label: string, scope: "day" | "trade", samples: Sample[], order: readonly { key: string; label: string }[], unit: FactorUnit, cur: string, lowWord: string, highWord: string): PsychFactor {
  const by = new Map<string, { n: number; trades: number; sum: number; wins: number }>();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of samples) {
    const b = by.get(s.bucket) ?? { n: 0, trades: 0, sum: 0, wins: 0 };
    b.n++;
    b.trades += s.n;
    b.sum += s.results.reduce((a, c) => a + c, 0);
    b.wins += s.wins;
    by.set(s.bucket, b);
    if (s.results.length) {
      xs.push(s.level);
      ys.push(s.results.reduce((a, c) => a + c, 0) / s.results.length);
    }
  }
  const buckets: FactorBucket[] = order
    .filter((o) => by.has(o.key))
    .map((o) => {
      const b = by.get(o.key)!;
      return { key: o.key, label: o.label, n: b.n, trades: b.trades, avg: b.trades ? b.sum / b.trades : null, winRate: b.trades ? b.wins / b.trades : null };
    });
  const n = samples.length;
  const enough = n >= MIN_FACTOR_N;
  const rho = enough ? spearman(xs, ys) : null;
  const ranked = buckets.filter((b) => b.n >= MIN_BUCKET_N && b.avg != null).sort((a, b) => b.avg! - a.avg!);
  const best = ranked[0] ?? null;
  const worst = ranked.length > 1 ? ranked[ranked.length - 1]! : null;
  let verdict: string;
  if (!enough) verdict = `Zu wenig Daten: ${n} von ${MIN_FACTOR_N} ${scope === "day" ? "Tagen" : "Trades"} mit Wert.`;
  else if (!best || !worst || best === worst) verdict = "Noch kein klarer Unterschied zwischen den Stufen.";
  else {
    const strength = rho == null ? "" : Math.abs(rho) >= 0.5 ? " – deutlich" : Math.abs(rho) >= 0.25 ? " – eine Tendenz" : " – schwach";
    const dir = rho == null ? "" : rho > 0.1 ? ` Je ${highWord}, desto besser.` : rho < -0.1 ? ` Je ${lowWord}, desto besser.` : "";
    verdict = `${best.label}: Ø ${fmtVal(best.avg!, unit, cur)} (${best.n}) statt ${fmtVal(worst.avg!, unit, cur)} bei ${worst.label} (${worst.n})${strength}.${dir}`;
  }
  return { key, label, scope, unit, buckets, n, rho, best, worst, enough, verdict };
}

const LEVEL_ORDER = (labels: readonly string[]) => labels.map((label, i) => ({ key: String(i + 1), label }));
const SLEEP_ORDER = [
  { key: "lt6", label: "unter 6 h" },
  { key: "6to7", label: "6–7 h" },
  { key: "7to8", label: "7–8 h" },
  { key: "ge8", label: "8 h und mehr" },
];
const sleepBucket = (h: number): string => (h < 6 ? "lt6" : h < 7 ? "6to7" : h < 8 ? "7to8" : "ge8");

/**
 * Factor analysis of the journal. `unit`: R when ≥ 60 % of the closed trades carry an R, else money (`currency`).
 */
export function psychFactors({ days, closed, currency = "" }: { days: DayNotes; closed: readonly EnrichedTrade[]; currency?: string }): PsychFactor[] {
  const withR = closed.filter((t) => fin(t.r)).length;
  const unit: FactorUnit = closed.length && withR >= closed.length * 0.6 ? "R" : "money";
  const val = (t: EnrichedTrade): number | null => (unit === "R" ? (fin(t.r) ? t.r : null) : fin(t.pnl) ? t.pnl : null);
  const isWin = (t: EnrichedTrade) => t.result === "win";

  // closed trades per day (entry day – the same bucketing as the calendar)
  const perDay = new Map<string, EnrichedTrade[]>();
  for (const t of closed) {
    const k = dayKeyOf(t);
    const arr = perDay.get(k);
    if (arr) arr.push(t);
    else perDay.set(k, [t]);
  }
  const daySamples = (pick: (k: string) => { level: number; bucket: string } | null): Sample[] => {
    const out: Sample[] = [];
    for (const [k, ts] of perDay) {
      const p = pick(k);
      if (!p) continue;
      const results = ts.map(val).filter(fin);
      if (!results.length) continue;
      out.push({ ...p, results, wins: ts.filter(isWin).length, n: results.length });
    }
    return out;
  };
  const lv = (v: number | null) => (v == null ? null : { level: v, bucket: String(v) });

  const mood = daySamples((k) => lv(level5(days[k]?.mood)));
  const stress = daySamples((k) => lv(checkinOf(days[k])?.stress ?? null));
  const energy = daySamples((k) => lv(checkinOf(days[k])?.energy ?? null));
  const sleep = daySamples((k) => {
    const h = checkinOf(days[k])?.sleep;
    return h == null ? null : { level: h, bucket: sleepBucket(h) };
  });
  const tradeSamples = (pick: (t: EnrichedTrade) => number | null): Sample[] =>
    closed.flatMap((t) => {
      const l = pick(t);
      const v = val(t);
      return l == null || v == null ? [] : [{ level: l, bucket: String(l), results: [v], wins: isWin(t) ? 1 : 0, n: 1 }];
    });
  const tStress = tradeSamples((t) => level5(t.psych?.stress));
  const conf = tradeSamples((t) => level5(t.psych?.confidence));
  const CONF = ["Zweifelnd", "Unsicher", "Okay", "Sicher", "Felsenfest"] as const;

  return [
    factorOf("mood", "Stimmung", "day", mood, LEVEL_ORDER(MOOD_LABELS), unit, currency, "schlechter die Stimmung", "besser die Stimmung"),
    factorOf("stress", "Stress", "day", stress, LEVEL_ORDER(STRESS_LABELS), unit, currency, "entspannter", "angespannter"),
    factorOf("energy", "Energie", "day", energy, LEVEL_ORDER(ENERGY_LABELS), unit, currency, "müder", "wacher"),
    factorOf("sleep", "Schlaf", "day", sleep, SLEEP_ORDER, unit, currency, "kürzer der Schlaf", "länger der Schlaf"),
    factorOf("tradeStress", "Stress im Trade", "trade", tStress, LEVEL_ORDER(STRESS_LABELS), unit, currency, "entspannter", "angespannter"),
    factorOf("confidence", "Zuversicht im Trade", "trade", conf, LEVEL_ORDER(CONF), unit, currency, "zweifelnder", "sicherer"),
  ];
}

/** Factors with enough data, the clearest (|ρ|) first – "trade the best": only these deserve the headline. */
export function strongestFactors(factors: readonly PsychFactor[], max = 3): PsychFactor[] {
  return factors
    .filter((f) => f.enough && f.best && f.worst && f.best !== f.worst)
    .sort((a, b) => Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0))
    .slice(0, max);
}
