/**
 * Was aus dem Endtest des Siegers folgt – nur aus seinen Endtest-Trades, nie eine Prognose (rein, deterministisch):
 *
 *   riskOf        größter Rückgang (R und % bei `riskPct` je Trade, mit Zinseszins) und eine Neuziehung der Trades (Bootstrap mit
 *                 Zurücklegen, `n` Ziehungen, gesetzt): Spanne des größten Rückgangs und der Summe (5 % / 50 % / 95 %) und das Band der
 *                 Summenkurve an den Endtest-Rasterpunkten. Die k-te gezogene Trade erhält den Zeitpunkt der k-ten echten – so liegt das Band
 *                 auf derselben Zeitachse wie die Linie des Siegers.
 *   compareStops  die Stop-Führung des Siegers gegen eine andere derselben Einstiegsregeln im Endtest: Differenz der Erwartung (alle
 *                 Trades) und – gepaart über DIESELBEN Einstiege (gleiche Einstiegskerze in beiden Läufen) – ihre Spanne aus einer
 *                 Neuziehung der Paare und ein einseitiges p; unter 8 Paaren ungepaart (beide Listen neu gezogen). „Besser“ nur, wenn der
 *                 Endtest allein trennt UND das Training in dieselbe Richtung zeigt; ausgesprochen nur nach „bestanden“.
 *
 * Grenzen (ehrlich, auch in der Oberfläche): die Neuziehung nimmt an, dass die Trades unabhängig sind und die Zukunft aus derselben Verteilung
 * kommt – beides ist nicht garantiert; mit wenigen Trades ist die Spanne selbst unsicher.
 */
import { rng } from "@/domain/analytics/stats";
import type { Q3, RiskInfo, StopCompare, StopLine, StopRule } from "./types";

/** Ziehungen der Neuziehung (fest – die Zahl steht in der Oberfläche). */
export const BOOTSTRAP_N = 2000;
/** Einseitiges p, ab dem eine Stop-Führung im Endtest als besser gilt (genau ein Vergleich). */
export const STOP_MAX_P = 0.05;

const r4 = (x: number): number => Math.round(x * 10_000) / 10_000;

function q(sorted: Float64Array | number[], p: number): number {
  const n = sorted.length;
  if (!n) return 0;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

const q3 = (xs: Float64Array): Q3 => {
  xs.sort();
  return { p5: r4(q(xs, 0.05)), p50: r4(q(xs, 0.5)), p95: r4(q(xs, 0.95)) };
};

/** Größter Rückgang einer Folge in R (Summe) und in % des Kontos bei `riskPct` je Trade mit Zinseszins (0,06 = 6 %). */
export function drawdownOf(rs: ArrayLike<number>, riskPct: number): { r: number; pct: number } {
  let cum = 0;
  let peak = 0;
  let dd = 0;
  let eq = 1;
  let eqPeak = 1;
  let ddPct = 0;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    cum += r;
    if (cum > peak) peak = cum;
    if (peak - cum > dd) dd = peak - cum;
    eq *= Math.max(0, 1 + riskPct * r);
    if (eq > eqPeak) eqPeak = eq;
    if (eqPeak > 0 && 1 - eq / eqPeak > ddPct) ddPct = 1 - eq / eqPeak;
  }
  return { r: dd, pct: ddPct };
}

export interface RiskInput {
  /** R je Endtest-Trade in zeitlicher Reihenfolge */
  rs: readonly number[];
  /** Zeitpunkt (Anteil des Zeitraums) je Trade, gleiche Reihenfolge */
  fs: readonly number[];
  /** Rasterpunkte des Endtests (Anteile des Zeitraums, aufsteigend) */
  grid: readonly number[];
  riskPct: number;
  seed: number;
  n?: number;
}

/** Rückgangs-Risiko und Spanne aus den Endtest-Trades; `null` unter 2 Trades (nichts zum Ziehen). */
export function riskOf({ rs, fs, grid, riskPct, seed, n = BOOTSTRAP_N }: RiskInput): RiskInfo | null {
  const m = rs.length;
  if (m < 2) return null;
  const actual = drawdownOf(rs, riskPct);
  // wie viele Trades bis zu jedem Rasterpunkt abgeschlossen sind (die k-te Ziehung bekommt den Zeitpunkt der k-ten echten Trade)
  const upTo = grid.map((g) => {
    let c = 0;
    while (c < m && fs[c]! <= g + 1e-12) c++;
    return c;
  });
  const rand = rng((Math.floor(seed) ^ 0x2545f491) >>> 0);
  const dds = new Float64Array(n);
  const ddp = new Float64Array(n);
  const sums = new Float64Array(n);
  const at: Float64Array[] = grid.map(() => new Float64Array(n));
  const draw = new Float64Array(m);
  const cum = new Float64Array(m + 1);
  let losses = 0;
  for (let b = 0; b < n; b++) {
    for (let k = 0; k < m; k++) {
      draw[k] = rs[Math.floor(rand() * m)]!;
      cum[k + 1] = cum[k]! + draw[k]!;
    }
    const d = drawdownOf(draw, riskPct);
    dds[b] = d.r;
    ddp[b] = d.pct;
    sums[b] = cum[m]!;
    if (cum[m]! <= 0) losses++;
    for (let g = 0; g < grid.length; g++) at[g]![b] = cum[upTo[g]!]!;
  }
  const band = { lo: [] as number[], mid: [] as number[], hi: [] as number[] };
  for (const xs of at) {
    xs.sort();
    band.lo.push(r4(q(xs, 0.05)));
    band.mid.push(r4(q(xs, 0.5)));
    band.hi.push(r4(q(xs, 0.95)));
  }
  return { n, trades: m, riskPct, ddR: r4(actual.r), ddPct: r4(actual.pct), ddRq: q3(dds), ddPctQ: q3(ddp), sumRq: q3(sums), pLoss: r4(losses / n), band };
}

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Differenz der Mittel zweier Listen und ihre Spanne aus einer Neuziehung beider (unabhängig, mit Zurücklegen). */
export function bootstrapDiff(a: readonly number[], b: readonly number[], seed: number, n = BOOTSTRAP_N): { diff: number; lo: number; hi: number; p: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  const rand = rng((Math.floor(seed) ^ 0x68e31da4) >>> 0);
  const ds = new Float64Array(n);
  let le = 0;
  for (let k = 0; k < n; k++) {
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[Math.floor(rand() * a.length)]!;
    for (let i = 0; i < b.length; i++) sb += b[Math.floor(rand() * b.length)]!;
    const d = sa / a.length - sb / b.length;
    ds[k] = d;
    if (d <= 0) le++;
  }
  ds.sort();
  return { diff: mean(a)! - mean(b)!, lo: q(ds, 0.05), hi: q(ds, 0.95), p: (le + 1) / (n + 1) };
}

/** Mittel der gepaarten Differenzen und ihre Spanne aus einer Neuziehung der Paare. */
export function bootstrapPaired(d: readonly number[], seed: number, n = BOOTSTRAP_N): { diff: number; lo: number; hi: number; p: number } | null {
  const m = d.length;
  if (m < 2) return null;
  const rand = rng((Math.floor(seed) ^ 0x1b873593) >>> 0);
  const ds = new Float64Array(n);
  let le = 0;
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += d[Math.floor(rand() * m)]!;
    ds[k] = s / m;
    if (s <= 0) le++;
  }
  ds.sort();
  return { diff: mean(d)!, lo: q(ds, 0.05), hi: q(ds, 0.95), p: (le + 1) / (n + 1) };
}

/** Wenigste gepaarte Einstiege für den gepaarten Vergleich. */
export const MIN_PAIRS = 8;

export interface StopRun {
  rule: StopRule;
  isRs: readonly number[];
  isScore: number | null;
  oosRs: readonly number[];
  /** Einstiegskerze je Endtest-Trade (gleiche Reihenfolge wie `oosRs`) */
  oosEs?: readonly number[];
}

/**
 * Die Stop-Führung des Siegers (`rule`) gegen ihren Partner im Endtest: „fest“, wenn der Sieger Einstand oder Nachziehen nutzt; sonst die
 * im Endtest bessere der beiden anderen. `passed` = Urteil der Suche (nur dann wird „besser“ ausgesprochen).
 */
export function compareStops(runs: readonly StopRun[], rule: StopRule, passed: boolean, seed: number, n = BOOTSTRAP_N): StopCompare {
  const line = (x: StopRun): StopLine => {
    const isAvg = mean(x.isRs);
    const oosAvg = mean(x.oosRs);
    return { rule: x.rule, isN: x.isRs.length, isAvgR: isAvg == null ? null : r4(isAvg), isScore: x.isScore == null ? null : r4(x.isScore), oosN: x.oosRs.length, oosAvgR: oosAvg == null ? null : r4(oosAvg), oosSumR: r4(x.oosRs.reduce((a, b) => a + b, 0)) };
  };
  const lines = runs.map(line);
  const win = runs.find((x) => x.rule === rule)!;
  const others = runs.filter((x) => x.rule !== rule);
  const partner =
    rule !== "fixed" ? runs.find((x) => x.rule === "fixed")! : others.reduce((a, b) => ((mean(b.oosRs) ?? -Infinity) > (mean(a.oosRs) ?? -Infinity) ? b : a));
  // gepaart: dieselbe Einstiegskerze in beiden Läufen (die Stop-Führung ändert nur den Ausstieg – und damit, ob später ein Einstieg frei ist)
  const pairs: number[] = [];
  if (win.oosEs && partner.oosEs) {
    const at = new Map<number, number>();
    partner.oosEs.forEach((e, i) => at.set(e, partner.oosRs[i]!));
    win.oosEs.forEach((e, i) => {
      const o = at.get(e);
      if (o != null) pairs.push(win.oosRs[i]! - o);
    });
  }
  const paired = pairs.length >= MIN_PAIRS;
  const bd = paired ? bootstrapPaired(pairs, seed, n) : bootstrapDiff(win.oosRs, partner.oosRs, seed, n);
  const all = mean(win.oosRs) != null && mean(partner.oosRs) != null ? mean(win.oosRs)! - mean(partner.oosRs)! : null;
  const isDiff = (mean(win.isRs) ?? 0) - (mean(partner.isRs) ?? 0);
  const edge = !!bd && bd.diff > 0 && all != null && all > 0 && bd.p <= STOP_MAX_P && isDiff > 0;
  return {
    rule,
    lines,
    vs: partner.rule,
    pairs: paired ? pairs.length : 0,
    diffAvgR: all == null ? null : r4(all),
    diffSumR: r4(win.oosRs.reduce((a, b) => a + b, 0) - partner.oosRs.reduce((a, b) => a + b, 0)),
    lo: bd ? r4(bd.lo) : null,
    hi: bd ? r4(bd.hi) : null,
    p: bd ? r4(bd.p) : null,
    edge,
    declared: passed && edge,
    n,
  };
}
