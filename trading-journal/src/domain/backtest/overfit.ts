/**
 * Overfitting check of the lab (P07, pure):
 *
 * - Deflated Sharpe Ratio (Bailey & López de Prado 2014): the probability that the selected parameter set's true
 *   Sharpe is above what the BEST of N random trials would show by luck alone. SR₀ = √V[SRₙ] · ((1 − γ) Φ⁻¹(1 − 1/N)
 *   + γ Φ⁻¹(1 − 1/(N·e))), DSR = Φ((SR − SR₀) √(T − 1) / √(1 − γ₃ SR + (γ₄ − 1)/4 · SR²)) with γ₃ skewness and γ₄
 *   (non-excess) kurtosis of the selected trades' R. Per-trade Sharpe, T = its trades.
 * - PBO-lite (CSCV, Bailey et al. 2015): the period is cut into S = 8 time blocks; for each of the C(8,4) = 70 ways to
 *   pick half of them as in-sample, the best set in-sample is ranked out-of-sample. PBO = share of splits where that
 *   winner lands in the lower half (logit λ ≤ 0). Performance per block = Ø R of the trades closed in it.
 * - Parameter stability: the grid as a heat map over two parameters (the others at the chosen values); a plateau
 *   (neighbours almost as good as the best cell) is robust, a lone spike is a fit to noise.
 * - Verdict: robust / fraglich / überangepasst / zu wenig Daten – combining DSR, PBO, the out-of-sample result and the
 *   walk-forward efficiency. Thresholds are named constants.
 */
import { kurtosis, normCdf, normQuantile, skewness, variance } from "../analytics/stats";
import type { Trial } from "./optimize";
import type { ParamSpec, ParamValue, Params } from "./strategies/types";
import type { BtTrade } from "./types";

const EULER_GAMMA = 0.5772156649015329;

export interface Dsr {
  /** probability 0…1 */
  dsr: number;
  /** Sharpe threshold the luck of N trials reaches */
  sr0: number;
  sr: number;
  trials: number;
  trades: number;
}

/** Expected maximum Sharpe of N trials with variance `v` of their Sharpes (the DSR threshold SR₀). */
export function expectedMaxSharpe(v: number, n: number): number {
  if (n <= 1 || !(v > 0)) return 0;
  return Math.sqrt(v) * ((1 - EULER_GAMMA) * normQuantile(1 - 1 / n) + EULER_GAMMA * normQuantile(1 - 1 / (n * Math.E)));
}

/** Deflated Sharpe of the selected trial among `trials` (per-trade Sharpe of R); null under `DSR_MIN_TRADES`. */
export function deflatedSharpe(selected: readonly number[], trialSharpes: readonly number[]): Dsr | null {
  const T = selected.length;
  if (T < DSR_MIN_TRADES) return null;
  const m = selected.reduce((a, b) => a + b, 0) / T;
  const v = variance(selected);
  if (v == null || !(v > 1e-12)) return null;
  const sr = m / Math.sqrt(v);
  const finite = trialSharpes.filter((s) => Number.isFinite(s));
  const N = Math.max(1, finite.length);
  const vs = finite.length >= 2 ? (variance(finite) ?? 0) : 0;
  const sr0 = expectedMaxSharpe(vs, N);
  const g3 = skewness(selected) ?? 0;
  const g4 = (kurtosis(selected) ?? 0) + 3;
  const den = 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr;
  const z = ((sr - sr0) * Math.sqrt(T - 1)) / Math.sqrt(Math.max(den, 1e-6));
  return { dsr: normCdf(z), sr0, sr, trials: N, trades: T };
}

/** Fewest trades of the most active trial before a PBO is computed (≈ 2 per block). */
export const PBO_MIN_TRADES = 16;
/** Fewest trades of the selected trial before a Deflated Sharpe is computed. */
export const DSR_MIN_TRADES = 10;

export interface Pbo {
  /** probability of backtest overfitting, 0…1 */
  pbo: number;
  /** logits of every split (for the distribution) */
  logits: number[];
  splits: number;
  blocks: number;
}

/** All k-subsets of 0…n−1 (n ≤ 16). */
export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (s: number) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = s; i <= n - (k - cur.length); i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

/** Ranks 1…N (ascending, ties averaged). */
function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = r;
    i = j + 1;
  }
  return out;
}

/**
 * CSCV PBO over full-period trials. `blockOf(trade)` → block index 0…S−1 (by exit time). Null with fewer than 2
 * trials or when no split has a qualified in-sample winner.
 */
export function pboOf(trials: readonly { trades: readonly BtTrade[] }[], blockOf: (t: BtTrade) => number, S = 8): Pbo | null {
  const N = trials.length;
  if (N < 2) return null;
  // too few trades to fill the blocks: no honest ranking possible
  if (Math.max(...trials.map((t) => t.trades.length)) < PBO_MIN_TRADES) return null;
  // per trial and block: Σ R and count
  const sumR = trials.map(() => new Float64Array(S));
  const cnt = trials.map(() => new Uint32Array(S));
  trials.forEach((tr, j) => {
    for (const t of tr.trades) {
      const b = blockOf(t);
      if (b < 0 || b >= S) continue;
      sumR[j]![b]! += t.r;
      cnt[j]![b]! += 1;
    }
  });
  const perf = (j: number, blocks: readonly number[]): number => {
    let s = 0;
    let c = 0;
    for (const b of blocks) {
      s += sumR[j]![b]!;
      c += cnt[j]![b]!;
    }
    return c ? s / c : 0;
  };
  const logits: number[] = [];
  const all = Array.from({ length: S }, (_, i) => i);
  for (const isBlocks of combinations(S, S / 2)) {
    const oosBlocks = all.filter((b) => !isBlocks.includes(b));
    const isPerf = trials.map((_, j) => perf(j, isBlocks));
    let best = -1;
    for (let j = 0; j < N; j++) if (best < 0 || isPerf[j]! > isPerf[best]!) best = j;
    if (best < 0) continue;
    const oosPerf = trials.map((_, j) => perf(j, oosBlocks));
    const w = ranks(oosPerf)[best]! / (N + 1);
    logits.push(Math.log(w / (1 - w)));
  }
  if (!logits.length) return null;
  return { pbo: logits.filter((l) => l <= 0).length / logits.length, logits, splits: logits.length, blocks: S };
}

export interface HeatCell {
  row: number;
  col: number;
  rowValue: ParamValue;
  colValue: ParamValue;
  meanR: number | null;
  n: number;
  /** fewer than the minimum trades: shown, but never the best cell */
  thin: boolean;
  /** this cell holds the chosen parameter set */
  chosen: boolean;
}

export interface Heat {
  rows: ParamSpec;
  cols: ParamSpec;
  cells: HeatCell[];
  /** best cell (highest Ø R with ≥ MIN trades) */
  best: HeatCell | null;
  /** Ø R of the best cell's neighbours ÷ the best cell's (1 = a plateau, ≤ 0 = a lone spike) */
  stability: number | null;
}

/** Heat map of the first two grid parameters; the other parameters at `chosen`. */
export function paramHeat(specs: readonly ParamSpec[], trials: readonly Trial[], chosen: Params, minTrades = 5): Heat | null {
  const grid = specs.filter((s) => s.grid);
  if (grid.length < 2) return null;
  const [rows, cols] = [grid[0]!, grid[1]!];
  const others = grid.slice(2).map((s) => s.key);
  const cells: HeatCell[] = [];
  rows.options.forEach((rv, r) =>
    cols.options.forEach((cv, c) => {
      const t = trials.find((x) => x.params[rows.key] === rv && x.params[cols.key] === cv && others.every((k) => x.params[k] === chosen[k]));
      const n = t?.n ?? 0;
      cells.push({ row: r, col: c, rowValue: rv, colValue: cv, meanR: t && n > 0 ? t.meanR : null, n, thin: n < minTrades, chosen: chosen[rows.key] === rv && chosen[cols.key] === cv });
    }),
  );
  let best: HeatCell | null = null;
  for (const c of cells) if (c.meanR != null && !c.thin && (!best || c.meanR > best.meanR!)) best = c;
  let stability: number | null = null;
  if (best && best.meanR! > 0) {
    const nb = cells.filter((c) => c !== best && Math.abs(c.row - best!.row) <= 1 && Math.abs(c.col - best!.col) <= 1 && c.meanR != null && !c.thin);
    if (nb.length) stability = nb.reduce((s, c) => s + c.meanR!, 0) / nb.length / best.meanR!;
  }
  return { rows, cols, cells, best, stability };
}

export type RobustVerdict = "robust" | "fraglich" | "overfit" | "wenig";

export const VERDICT_TEXT: Readonly<Record<RobustVerdict, string>> = {
  robust: "Robust",
  fraglich: "Fraglich",
  overfit: "Überangepasst",
  wenig: "Zu wenig Trades",
};

/** Thresholds of the verdict. */
export const ROBUST = { minTrades: 20, dsrGood: 0.9, dsrBad: 0.5, pboGood: 0.25, pboBad: 0.5, wfeGood: 0.5 } as const;

export interface RobustInput {
  trades: number;
  dsr: number | null;
  pbo: number | null;
  /** Ø R in-sample (optimised) and out-of-sample */
  isMeanR: number | null;
  oosMeanR: number | null;
  wfe: number | null;
  wfMeanR: number | null;
}

export interface Robustness {
  verdict: RobustVerdict;
  /** German one-liner */
  text: string;
  /** the findings behind it, strongest first */
  reasons: { text: string; ok: boolean }[];
}

export function robustness(x: RobustInput): Robustness {
  const reasons: { text: string; ok: boolean }[] = [];
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const r = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2).replace(".", ",")} R`;
  if (x.trades < ROBUST.minTrades) {
    return { verdict: "wenig", text: `Erst ${x.trades} Trades. Für ein Urteil braucht es mindestens ${ROBUST.minTrades}.`, reasons: [{ text: `${x.trades} von ${ROBUST.minTrades} Trades`, ok: false }] };
  }
  let bad = 0;
  let good = 0;
  if (x.pbo != null) {
    const ok = x.pbo < ROBUST.pboGood;
    reasons.push({ text: `PBO ${pct(x.pbo)}${ok ? ": der In-Sample-Sieger hält meist auch außerhalb" : x.pbo > ROBUST.pboBad ? ": der Sieger fällt außerhalb meist zurück" : ""}`, ok });
    if (ok) good++;
    else if (x.pbo > ROBUST.pboBad) bad += 2;
  }
  if (x.dsr != null) {
    const ok = x.dsr >= ROBUST.dsrGood;
    reasons.push({ text: `Deflated Sharpe ${pct(x.dsr)}${ok ? ": Vorteil bleibt nach Abzug des Suchglücks" : ": Vorteil kann Suchglück sein"}`, ok });
    if (ok) good++;
    else if (x.dsr < ROBUST.dsrBad) bad++;
  }
  if (x.isMeanR != null && x.oosMeanR != null) {
    const ok = x.oosMeanR > 0;
    reasons.push({ text: `Out-of-Sample ${r(x.oosMeanR)} pro Trade (In-Sample ${r(x.isMeanR)})`, ok });
    if (ok) good++;
    else if (x.isMeanR > 0) bad += 2;
  }
  if (x.wfe != null) {
    const ok = x.wfe >= ROBUST.wfeGood;
    reasons.push({ text: `Walk-forward-Effizienz ${pct(x.wfe)}`, ok });
    if (ok) good++;
    else bad++;
  } else if (x.wfMeanR != null) {
    reasons.push({ text: `Walk-forward ${r(x.wfMeanR)} pro Trade`, ok: x.wfMeanR > 0 });
    if (x.wfMeanR > 0) good++;
    else bad++;
  }
  reasons.sort((a, b) => Number(a.ok) - Number(b.ok));
  const verdict: RobustVerdict = bad >= 2 ? "overfit" : bad === 0 && good >= 2 ? "robust" : "fraglich";
  const text =
    verdict === "robust"
      ? "Hält auch auf Daten, die die Optimierung nie gesehen hat."
      : verdict === "overfit"
        ? "Die Parameter passen zur Vergangenheit, nicht zum Markt. So nicht handeln."
        : "Teilweise belastbar. Mehr Historie oder weniger Parameter würden helfen.";
  return { verdict, text, reasons };
}
