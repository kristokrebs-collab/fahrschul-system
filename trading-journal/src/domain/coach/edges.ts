/**
 * Edge finder and leak detection (P04): which conditions make or cost the trader money – single factors (P03
 * dimensions + the coach's behaviours) and 2-way combinations – with honest uncertainty:
 *
 *  1. Every bucket with ≥ `minN` trades (and ≥ `minN` in the rest) is a candidate; a combination needs ≥ `minN` trades
 *     and must be smaller than both parents. Buckets with exactly the same trades are tested once (a behaviour first –
 *     "Revenge" says more than "Gefühl: Revenge").
 *  2. Welch test of the bucket against the rest (P03 `welch`) in the breakdown unit (R when ≥ 60 % carry one, else
 *     money per trade), Benjamini-Hochberg over ALL candidates tested (q = 10 %) – fifty buckets never produce a
 *     "klar" by chance.
 *  3. For the shortlisted candidates (single factors and combinations shortlisted separately): seeded percentile
 *     bootstraps (seed = hash of the id → identical numbers for the same journal) of the expectancy (P03
 *     `bootstrapCI`) and of the DIFFERENCE to the rest (both groups resampled), and the stability check: the
 *     difference to the rest has the same sign in the first and the second half of the time line.
 *  4. Confidence 0–100 = 40 % significance (1 − q / 0.5) + 25 % sample (1 − e^(−n/25)) + 20 % difference interval
 *     clear of zero + 15 % stability. Verdict: "klar" (q ≤ 10 %, interval clear, stable), "Tendenz" (q ≤ 30 % and
 *     interval clear), else "zu wenig Daten" – those are not listed ("trade the best, fuck the rest").
 *
 * Edge = positive expectancy AND better than the rest; leak = negative expectancy AND worse than the rest. Ranked by
 * confidence × |impact| (impact = n · (Ø bucket − Ø rest), "what it made / cost against your usual trade").
 * `findingCandidates` / the Auswertung's FindingsCard stay as they are – this is the coach's deeper pass.
 */
import type { EnrichedTrade, Settings } from "../types";
import { DIMENSIONS, NONE_KEY, bucketLabel, groupByDimension, type DimensionKey } from "../analytics/dimensions";
import { breakdownUnit, unitValue } from "../analytics/breakdowns";
import { benjaminiHochberg, bootRuns, bootstrapCI, CI_LEVEL, FDR_Q, mean, quantileSorted, rng, TENDENCY_P, welch, type Interval } from "../analytics/stats";
import { BEHAVIOR_LABEL, type BehaviorEvent, type BehaviorKey } from "./events";
import { triggerOf } from "./behaviors";
import { byEntry, hashSeed } from "./shared";

/** Trades a candidate needs (and the rest needs). */
export const EDGE_MIN_N = 8;
/** Dimensions the edge finder scans (the P03 dimensions that describe a decision, not bookkeeping). */
export const EDGE_DIMS: readonly DimensionKey[] = ["setup", "side", "session", "weekday", "hour", "hold", "regime", "volatility", "riskPct", "leverage", "timeframe", "conviction", "emotion", "box", "strength", "asset", "tag", "account"];
/** Dimensions combined pairwise (cheap, decision-relevant). */
const PAIR_DIMS: ReadonlySet<DimensionKey> = new Set(["setup", "side", "session", "weekday", "regime", "conviction", "emotion", "strength", "riskPct", "leverage", "hold", "box"]);
/** At most this many single factors take part in pairs (largest first), and this many pairs are tested. */
const PAIR_PARENTS = 36;
const PAIR_MAX = 700;
/** FDR level of a "Tendenz" (a "klar" needs `FDR_Q` = 10 %). */
export const TENDENCY_Q = 0.3;
/** Single factors / combinations that get bootstrap intervals. */
const SHORTLIST = 40;
const SHORTLIST_PAIRS = 24;

export type EdgeLabel = "klar" | "Tendenz" | "zu wenig Daten";

export interface EdgeFactor {
  dim: DimensionKey | "behavior";
  key: string;
  label: string;
}

export interface EdgeCandidate {
  /** "setup=s_good" / "setup=s_good&session=london" / "behavior=revenge" */
  id: string;
  label: string;
  factors: EdgeFactor[];
  kind: "edge" | "leak" | "neutral";
  trades: EnrichedTrade[];
  n: number;
  unit: "R" | "money";
  /** expectancy of the bucket in the unit */
  mean: number;
  restMean: number;
  /** bucket − rest */
  diff: number;
  winRate: number;
  p: number | null;
  q: number | null;
  /** 80 % bootstrap interval of the expectancy */
  ci: Interval | null;
  /** 80 % bootstrap interval of bucket − rest */
  diffCi: Interval | null;
  /** difference to the rest in the first / second half of the time line, `null` below minN / 2 trades */
  halves: { first: number | null; second: number | null; stable: boolean | null };
  /** n · diff – what the bucket made / cost against the usual trade (unit) */
  impact: number;
  /** Σ of the bucket (unit) */
  total: number;
  confidence: number;
  verdict: EdgeLabel;
}

export interface EdgeReport {
  unit: "R" | "money";
  edges: EdgeCandidate[];
  leaks: EdgeCandidate[];
  /** candidates tested (the FDR family size) */
  tested: number;
  minN: number;
  /** closed trades considered */
  n: number;
}

export interface EdgeOptions {
  settings: Pick<Settings, "setups" | "capital">;
  /** behaviour events of the journal (adds "behavior=…" factors) */
  events?: readonly BehaviorEvent[];
  minN?: number;
  /** combinations on (default true) */
  pairs?: boolean;
  /** per list (default 6) */
  limit?: number;
}

interface Raw {
  id: string;
  label: string;
  factors: EdgeFactor[];
  trades: EnrichedTrade[];
  set: Set<string>;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Confidence 0–100 and its verdict (see the module comment). */
export function edgeConfidence(c: Pick<EdgeCandidate, "n" | "p" | "q" | "diffCi" | "halves">): { confidence: number; verdict: EdgeLabel } {
  const sig = c.q != null ? clamp01(1 - c.q / 0.5) : 0;
  const size = 1 - Math.exp(-c.n / 25);
  const clear = c.diffCi != null && (c.diffCi.lo > 0 || c.diffCi.hi < 0);
  const stab = c.halves.stable === true ? 1 : c.halves.stable === null ? 0.4 : 0;
  const confidence = Math.round(100 * (0.4 * sig + 0.25 * size + 0.2 * (clear ? 1 : 0) + 0.15 * stab));
  const verdict: EdgeLabel = c.q != null && c.q <= FDR_Q && clear && c.halves.stable === true ? "klar" : c.q != null && c.q <= TENDENCY_Q && clear ? "Tendenz" : "zu wenig Daten";
  return { confidence, verdict };
}

/** Seeded percentile bootstrap of mean(a) − mean(b), both groups resampled; `null` below 2 values per side. */
export function bootstrapDiff(a: readonly number[], b: readonly number[], seed: number, level = CI_LEVEL): Interval | null {
  if (a.length < 2 || b.length < 2) return null;
  const runs = bootRuns(a.length + b.length);
  const rand = rng(seed);
  const out = new Float64Array(runs);
  for (let r = 0; r < runs; r++) {
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[Math.floor(rand() * a.length)]!;
    for (let i = 0; i < b.length; i++) sb += b[Math.floor(rand() * b.length)]!;
    out[r] = sa / a.length - sb / b.length;
  }
  out.sort();
  return { lo: quantileSorted(out, (1 - level) / 2)!, hi: quantileSorted(out, 1 - (1 - level) / 2)! };
}

/** Difference bucket − rest in each half of the time line (entry order of the whole set). */
function halvesOf(set: ReadonlySet<string>, closed: readonly EnrichedTrade[], values: ReadonlyMap<string, number | null>, minN: number): EdgeCandidate["halves"] {
  const cut = closed.length / 2;
  const acc = [
    { a: [] as number[], b: [] as number[] },
    { a: [] as number[], b: [] as number[] },
  ];
  closed.forEach((t, i) => {
    const v = values.get(t.id);
    if (v == null) return;
    const h = acc[i < cut ? 0 : 1]!;
    (set.has(t.id) ? h.a : h.b).push(v);
  });
  const need = Math.max(3, Math.ceil(minN / 2));
  const d = (h: { a: number[]; b: number[] }) => (h.a.length >= need && h.b.length >= need ? mean(h.a)! - mean(h.b)! : null);
  const first = d(acc[0]!);
  const second = d(acc[1]!);
  const stable = first == null || second == null ? null : Math.sign(first) === Math.sign(second) && first !== 0;
  return { first, second, stable };
}

/** Edges and leaks of the closed trades. */
export function findEdges(closedIn: readonly EnrichedTrade[], opts: EdgeOptions): EdgeReport {
  const minN = opts.minN ?? EDGE_MIN_N;
  const limit = opts.limit ?? 6;
  const closed = byEntry(closedIn.filter((t) => t.result !== "open"));
  const unit = breakdownUnit(closed);
  const order = new Map(closed.map((t, i) => [t.id, i]));
  const ctx = { settings: opts.settings };
  const total = closed.length;
  if (total < 2 * minN) return { unit, edges: [], leaks: [], tested: 0, minN, n: total };

  // identical trade sets are tested once (first wins: behaviours, then the dimensions in EDGE_DIMS order)
  const signatures = new Set<string>();
  const signature = (trades: readonly EnrichedTrade[]) => trades.map((t) => order.get(t.id)!).sort((x, y) => x - y).join(",");
  const fresh = (trades: readonly EnrichedTrade[]): boolean => {
    const s = signature(trades);
    if (signatures.has(s)) return false;
    signatures.add(s);
    return true;
  };

  // 1. single factors
  const singles: Raw[] = [];
  if (opts.events?.length) {
    const ids = new Map<BehaviorKey, Set<string>>();
    for (const e of opts.events) {
      const id = triggerOf(e);
      if (!order.has(id)) continue;
      const s = ids.get(e.key) ?? new Set<string>();
      s.add(id);
      ids.set(e.key, s);
    }
    for (const [key, set] of [...ids].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (set.size < minN || total - set.size < minN) continue;
      const trades = closed.filter((t) => set.has(t.id));
      if (fresh(trades)) singles.push({ id: `behavior=${key}`, label: BEHAVIOR_LABEL[key], factors: [{ dim: "behavior", key, label: BEHAVIOR_LABEL[key] }], trades, set });
    }
  }
  for (const dk of EDGE_DIMS) {
    const dim = DIMENSIONS[dk];
    for (const [key, trades] of groupByDimension(closed, dim, ctx)) {
      if (key === NONE_KEY || trades.length < minN || total - trades.length < minN || !fresh(trades)) continue;
      singles.push({ id: `${dk}=${key}`, label: `${dim.label}: ${bucketLabel(dim, key, ctx)}`, factors: [{ dim: dk, key, label: bucketLabel(dim, key, ctx) }], trades, set: new Set(trades.map((t) => t.id)) });
    }
  }

  // 2. pairs of different dimensions (largest parents first, capped)
  const raws: Raw[] = [...singles];
  if (opts.pairs !== false) {
    const parents = singles.filter((s) => s.factors[0]!.dim === "behavior" || PAIR_DIMS.has(s.factors[0]!.dim as DimensionKey)).sort((a, b) => b.trades.length - a.trades.length || (a.id < b.id ? -1 : 1)).slice(0, PAIR_PARENTS);
    let made = 0;
    outer: for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const a = parents[i]!;
        const b = parents[j]!;
        if (a.factors[0]!.dim === b.factors[0]!.dim) continue;
        const [small, big] = a.trades.length <= b.trades.length ? [a, b] : [b, a];
        const trades = small.trades.filter((t) => big.set.has(t.id));
        if (trades.length < minN || trades.length === a.trades.length || trades.length === b.trades.length || !fresh(trades)) continue;
        raws.push({ id: `${a.id}&${b.id}`, label: `${a.factors[0]!.label} · ${b.factors[0]!.label}`, factors: [a.factors[0]!, b.factors[0]!], trades, set: new Set(trades.map((t) => t.id)) });
        if (++made >= PAIR_MAX) break outer;
      }
    }
  }

  // 3. tests + FDR over the whole family
  const values = new Map(closed.map((t) => [t.id, unitValue(t, unit)]));
  const tested = raws.map((r) => {
    const a: number[] = [];
    const b: number[] = [];
    for (const t of closed) {
      const v = values.get(t.id);
      if (v == null) continue;
      (r.set.has(t.id) ? a : b).push(v);
    }
    const w = a.length >= minN && b.length >= minN ? welch(a, b) : null;
    const wins = r.trades.filter((t) => (t.pnl ?? 0) > 0).length;
    return { r, a, b, m: mean(a) ?? 0, rm: mean(b) ?? 0, p: w?.p ?? null, t: w ? Math.abs(w.t) : 0, wins };
  });
  const fdr = benjaminiHochberg(tested.map((x) => x.p));

  // 4. shortlist by |t| – single factors and combinations separately (one strong factor must not crowd every other
  //    single out through its many combinations), then bootstraps + halves + confidence
  const tOf = (i: number) => (Number.isFinite(tested[i]!.t) ? tested[i]!.t : 1e9);
  const byT = (i: number, j: number) => tOf(j) - tOf(i) || (tested[i]!.r.id < tested[j]!.r.id ? -1 : 1);
  const idx = tested.map((_, i) => i);
  const singleIdx = idx.filter((i) => tested[i]!.r.factors.length === 1).sort(byT).slice(0, SHORTLIST);
  const pairIdx = idx.filter((i) => tested[i]!.r.factors.length > 1 && (tested[i]!.p ?? 1) < TENDENCY_P).sort(byT).slice(0, SHORTLIST_PAIRS);
  const short = new Set([...singleIdx, ...pairIdx]);
  const out: EdgeCandidate[] = [];
  tested.forEach((x, i) => {
    if (!short.has(i)) return;
    const diff = x.m - x.rm;
    const kind: EdgeCandidate["kind"] = x.m > 0 && diff > 0 ? "edge" : x.m < 0 && diff < 0 ? "leak" : "neutral";
    if (kind === "neutral") return;
    const seed = hashSeed(x.r.id);
    const ci = bootstrapCI(x.a, (s) => mean(s), { runs: bootRuns(x.a.length), seed });
    const diffCi = bootstrapDiff(x.a, x.b, seed ^ 0x5bd1e995);
    const halves = halvesOf(x.r.set, closed, values, minN);
    const base = { n: x.r.trades.length, p: x.p, q: fdr.q[i] ?? null, ci, diffCi, halves };
    const { confidence, verdict } = edgeConfidence(base);
    out.push({
      id: x.r.id,
      label: x.r.label,
      factors: x.r.factors,
      kind,
      trades: x.r.trades,
      unit,
      mean: x.m,
      restMean: x.rm,
      diff,
      winRate: x.r.trades.length ? x.wins / x.r.trades.length : 0,
      impact: x.a.length * diff,
      total: x.a.reduce((s, v) => s + v, 0),
      confidence,
      verdict,
      ...base,
    });
  });

  // 5. a combination must add information over its parents (else the parent tells the story)
  const byId = new Map(out.map((c) => [c.id, c]));
  const informative = out.filter((c) => {
    if (c.factors.length < 2) return true;
    return c.id.split("&").every((pid) => {
      const p = byId.get(pid);
      return !p || p.kind !== c.kind || Math.abs(c.diff) > Math.abs(p.diff) * 1.25;
    });
  });

  const rank = (c: EdgeCandidate) => (c.confidence / 100) * Math.abs(c.impact);
  const sorted = informative.filter((c) => c.verdict !== "zu wenig Daten").sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : 1));
  return {
    unit,
    edges: sorted.filter((c) => c.kind === "edge").slice(0, limit),
    leaks: sorted.filter((c) => c.kind === "leak").slice(0, limit),
    tested: raws.length,
    minN,
    n: total,
  };
}
