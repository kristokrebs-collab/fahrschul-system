/**
 * The miner (Auftrag B): finds patterns in the features of the entries – and tests, hard, whether they are more than chance.
 *
 *  1. Table: the features of every trade as they were known at its entry (`table.ts`).
 *  2. Split: the OLDEST 60 % of the trades search (discovery), the newest 40 % only judge (confirmation).
 *  3. Hypotheses: every class of every feature (terciles, quintiles from 300 trades, categories) and every pair of features
 *     (halves × halves, halves × category, …), triples only from 400 trades and only among a few core features. A hypothesis is
 *     "the trades with this pattern have a different mean R than the strategy as a whole". Classes with fewer than 15 trades
 *     inside or outside are not tested at all (counted as skipped). The cut points come from the discovery part.
 *  4. Test: label permutation (`perm.ts`) for every hypothesis, the feature (pair, triple) as a whole by the best of its classes
 *     against the same shuffles, and Benjamini-Hochberg over ALL tested hypotheses – the number is reported.
 *  5. Confirmation: a hypothesis that survives goes to the confirmation part with the SAME cut points: the sign must be the
 *     same, the one-sided permutation p ≤ 0.05; then the sign must hold in 3 of 4 chronological time blocks over all trades.
 *     Stages: `confirmed` · `hint` (survived the discovery only, or not clear enough later) · `rejected` (chance).
 *
 * The miner is a generator so a worker (or an idle-chunk loop) can step it, report progress and stop. Same input and seed give
 * the same result, always.
 */
import { benjaminiHochberg, bootRuns, bootstrapCI, rng, wilsonCI } from "../analytics/stats";
import { catBinning, classOf, condHolds, condOf, condsKey, hash32, isPostEntry, numBinning, type Binning } from "./cond";
import { FEATURES, FEATURE_IDS } from "./features";
import { blockSigns, momentsOf, PooledNull, shuffle, zScale } from "./perm";
import { buildTable, type FeatureTable } from "./table";
import { LIMITS, type CellStats, type Cond, type DiscoveryCounts, type DiscoveryInput, type DiscoveryResult, type FeatureId, type Finding, type Reason, type Tier } from "./types";

// ── internals ─────────────────────────────────────────────────────────────────────────────────────────────────

interface Group {
  key: string;
  /** trade indices (in the discovery part) of the population */
  pos: Int32Array;
  N: number;
  labels0: Float64Array;
  work: Float64Array;
  mu: number;
  sigma: number;
  parents: Parent[];
}

interface Parent {
  kind: "single" | "pair" | "triple";
  feats: FeatureId[];
  group: Group;
  /** class per population member (−1 = in no class) */
  cls: Int16Array;
  nCls: number;
  /** conditions per class (built on demand) */
  condsOf: (c: number) => Cond[];
  nIn: Int32Array;
  /** classes that are tested, and the global index of the first one */
  tested: number[];
  first: number;
  scale: Float64Array;
  sums: Float64Array;
  obsMax: number;
  nullMax: Float64Array;
}

/** Holm step-down adjusted p-values; `null` entries (untestable) stay `null` and are not part of the family. */
export function holmAdjusted(ps: readonly (number | null)[]): (number | null)[] {
  const idx = ps.map((p, i) => [p, i] as const).filter((x): x is readonly [number, number] => x[0] != null);
  const K = idx.length;
  const out: (number | null)[] = ps.map(() => null);
  const sorted = [...idx].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let run = 0;
  sorted.forEach(([p, i], rank) => {
    run = Math.max(run, Math.min(1, (K - rank) * p));
    out[i] = run;
  });
  return out;
}

const sgn = (x: number): 1 | -1 => (x >= 0 ? 1 : -1);
const meanOf = (a: readonly number[]): number | null => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** The features triples are built from (a fixed list, chosen before looking at any data). */
const CORE: readonly FeatureId[] = ["side", "session", "rsi", "emaDist50", "volRegime", "htfTrend"];

/** Pairs inside the clock group are skipped: session, weekday and part of the day are the same clock three times. */
const SAME_CLOCK = (a: FeatureId, b: FeatureId): boolean => FEATURES[a].group === "time" && FEATURES[b].group === "time" && a !== "side" && b !== "side";

function emptyStats(total: number): CellStats {
  return { n: 0, total, wins: 0, winRate: null, winCi: null, avgR: null, rCi: null, baseWinRate: null, baseAvgR: null, diffWinRate: null, diffR: null };
}

/** What the result carries besides the numbers. */
export interface MineContext {
  seed: number;
  label: string | null;
  source: "backtest" | "journal";
}

export function* discover(input: DiscoveryInput, prog: { value: number }): Generator<void, DiscoveryResult> {
  const table = buildTable(input);
  prog.value = 0.05;
  yield;
  return yield* mineTable(table, { seed: (input.seed ?? LIMITS.defaultSeed) >>> 0, label: input.label ?? null, source: input.source }, prog);
}

/** The search on a ready feature table (the tests feed synthetic columns through here). */
export function* mineTable(table: FeatureTable, ctx: MineContext, prog: { value: number }): Generator<void, DiscoveryResult> {
  const seed = ctx.seed >>> 0;
  const N = table.trades.length;
  const nd = Math.floor(N * LIMITS.discoveryShare);
  const nc = N - nd;
  const featuresEmpty: { id: FeatureId; reason: string }[] = [...table.empty];

  const counts: DiscoveryCounts = { tested: 0, singles: 0, pairs: 0, triples: 0, confirmed: 0, hint: 0, rejected: 0, redundant: 0, skippedSmall: 0 };
  const sumAll = table.r.reduce((s, x) => s + x, 0);
  const winsAll = table.r.reduce((s, x) => s + (x > 0 ? 1 : 0), 0);
  const result = (status: DiscoveryResult["status"], note: string | null, findings: Finding[] = [], used: FeatureId[] = [], perms = 0): DiscoveryResult => ({
    status,
    note,
    seed,
    label: ctx.label,
    source: ctx.source,
    n: N,
    nDisc: nd,
    nConf: nc,
    droppedNoR: table.droppedNoR,
    droppedCap: table.droppedCap,
    featuresUsed: used,
    featuresEmpty,
    permutations: perms,
    confPermutations: LIMITS.confPerms,
    base: { n: N, winRate: N ? winsAll / N : null, avgR: N ? sumAll / N : null },
    counts,
    findings,
    ms: 0,
  });

  if (N < LIMITS.minTrades) return result("tooFew", `Für eine saubere Prüfung braucht es mindestens ${LIMITS.minTrades} Trades mit bekanntem R – hier sind es ${N}.`);

  // ── classes of the features, from the discovery part only ────────────────────────────────────────────────
  const ids = FEATURE_IDS.filter((id) => table.cols[id]);
  const col = (f: FeatureId) => table.cols[f]!;
  interface FeatureBins {
    f: FeatureId;
    half?: Binning;
    ter?: Binning;
    qui?: Binning;
    cat?: Binning;
    /** classes per trade of the discovery part */
    clsHalf?: Int16Array;
    clsTer?: Int16Array;
    clsQui?: Int16Array;
    clsCat?: Int16Array;
    hasNull: boolean;
  }
  const bins = new Map<FeatureId, FeatureBins>();
  const classes = (b: Binning, c: readonly (string | number | null)[]): Int16Array => {
    const out = new Int16Array(nd);
    for (let i = 0; i < nd; i++) out[i] = classOf(b, c[i]);
    return out;
  };
  for (const f of ids) {
    const def = FEATURES[f];
    const c = col(f);
    const disc = c.slice(0, nd);
    const hasNull = disc.some((v) => v == null);
    if (def.kind === "num") {
      const vals = disc.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (vals.length < 2 * LIMITS.minCell) {
        featuresEmpty.push({ id: f, reason: "Im Entdeckungsteil gibt es zu wenige Werte." });
        continue;
      }
      const half = numBinning(f, vals, "half");
      if (half.cuts.length === 0) {
        featuresEmpty.push({ id: f, reason: "Der Wert schwankt kaum (fast alle Trades haben dasselbe)." });
        continue;
      }
      const fb: FeatureBins = { f, half, ter: numBinning(f, vals, "tercile"), hasNull, clsHalf: classes(half, c) };
      fb.clsTer = classes(fb.ter!, c);
      if (N >= LIMITS.quintilesFrom) {
        fb.qui = numBinning(f, vals, "quintile");
        fb.clsQui = classes(fb.qui, c);
      }
      bins.set(f, fb);
    } else {
      const strs = disc.map((v) => (typeof v === "string" ? v : null));
      const distinct = new Set(strs.filter((v): v is string => v != null));
      const cb = catBinning(f, strs, LIMITS.minCell);
      if (distinct.size < 2 || cb.size === 0) {
        featuresEmpty.push({ id: f, reason: distinct.size < 2 ? "Es gibt nur einen Wert." : "Keine Ausprägung kommt oft genug vor." });
        continue;
      }
      bins.set(f, { f, cat: cb, clsCat: classes(cb, c), hasNull });
    }
  }
  const usable = ids.filter((f) => bins.has(f));
  if (usable.length === 0) return result("noFeatures", "Kein Merkmal hat genug Werte und Streuung für eine Prüfung.");

  // ── hypotheses ────────────────────────────────────────────────────────────────────────────────────────────
  const groups = new Map<string, Group>();
  const groupFor = (feats: readonly FeatureId[]): Group => {
    const withNull = feats.filter((f) => bins.get(f)!.hasNull).sort();
    const key = withNull.join("|");
    let g = groups.get(key);
    if (!g) {
      const pos: number[] = [];
      for (let i = 0; i < nd; i++) if (withNull.every((f) => col(f)[i] != null)) pos.push(i);
      const labels0 = Float64Array.from(pos, (i) => table.r[i]!);
      const { mu, sigma } = momentsOf(labels0);
      g = { key, pos: Int32Array.from(pos), N: pos.length, labels0, work: Float64Array.from(labels0), mu, sigma, parents: [] };
      groups.set(key, g);
    }
    return g;
  };

  const parents: Parent[] = [];
  let testedCells = 0;
  const addParent = (kind: Parent["kind"], feats: FeatureId[], parts: { cls: Int16Array; b: Binning }[]): void => {
    if (testedCells >= LIMITS.maxHypotheses) return;
    const g = groupFor(feats);
    if (!(g.sigma > 0) || g.N < 2 * LIMITS.minCell) return;
    const sizes = parts.map((p) => p.b.size);
    const nCls = sizes.reduce((a, b) => a * b, 1);
    const cls = new Int16Array(g.N);
    const nIn = new Int32Array(nCls);
    for (let t = 0; t < g.N; t++) {
      const i = g.pos[t]!;
      let c = 0;
      for (let k = 0; k < parts.length; k++) {
        const x = parts[k]!.cls[i]!;
        if (x < 0) {
          c = -1;
          break;
        }
        c = c * sizes[k]! + x;
      }
      cls[t] = c;
      if (c >= 0) nIn[c]!++;
    }
    const tested: number[] = [];
    for (let c = 0; c < nCls; c++) {
      if (nIn[c]! === 0) continue;
      if (nIn[c]! >= LIMITS.minCell && g.N - nIn[c]! >= LIMITS.minCell) tested.push(c);
      else counts.skippedSmall++;
    }
    if (tested.length === 0) return;
    const condsOf = (c: number): Cond[] => {
      const out: Cond[] = [];
      let rest = c;
      for (let k = parts.length - 1; k >= 0; k--) {
        out[k] = condOf(parts[k]!.b, rest % sizes[k]!);
        rest = Math.floor(rest / sizes[k]!);
      }
      return out;
    };
    const p: Parent = { kind, feats, group: g, cls, nCls, condsOf, nIn, tested, first: testedCells, scale: new Float64Array(nCls), sums: new Float64Array(nCls), obsMax: 0, nullMax: new Float64Array(0) };
    for (const c of tested) p.scale[c] = zScale(g.N, nIn[c]!, g.sigma);
    testedCells += tested.length;
    if (kind === "single") counts.singles += tested.length;
    else if (kind === "pair") counts.pairs += tested.length;
    else counts.triples += tested.length;
    g.parents.push(p);
    parents.push(p);
  };

  // singles: terciles / categories
  for (const f of usable) {
    const b = bins.get(f)!;
    if (b.cat) addParent("single", [f], [{ cls: b.clsCat!, b: b.cat }]);
    else addParent("single", [f], [{ cls: b.clsTer!, b: b.ter! }]);
  }
  // pairs: halves × halves, halves × category, category × category
  const part = (f: FeatureId): { cls: Int16Array; b: Binning } => {
    const b = bins.get(f)!;
    return b.cat ? { cls: b.clsCat!, b: b.cat } : { cls: b.clsHalf!, b: b.half! };
  };
  for (let a = 0; a < usable.length; a++) {
    for (let c = a + 1; c < usable.length; c++) {
      const fa = usable[a]!;
      const fb = usable[c]!;
      if (SAME_CLOCK(fa, fb)) continue;
      addParent("pair", [fa, fb], [part(fa), part(fb)]);
    }
  }
  // quintiles of the numbers
  for (const f of usable) {
    const b = bins.get(f)!;
    if (b.qui && b.clsQui) addParent("single", [f], [{ cls: b.clsQui, b: b.qui }]);
  }
  // triples among the core features
  if (N >= LIMITS.triplesFrom) {
    const core = CORE.filter((f) => bins.has(f));
    for (let a = 0; a < core.length; a++)
      for (let b = a + 1; b < core.length; b++)
        for (let c = b + 1; c < core.length; c++) {
          const fs = [core[a]!, core[b]!, core[c]!];
          if (fs.some((x, i) => fs.some((y, j) => i < j && SAME_CLOCK(x, y)))) continue;
          addParent("triple", fs, fs.map(part));
        }
  }
  counts.tested = testedCells;
  if (testedCells === 0) return result("noFeatures", "Kein Muster hat genug Trades für eine Prüfung (mindestens 15 innen und außen).", [], usable);

  // ── observed statistics ───────────────────────────────────────────────────────────────────────────────────
  const cellParent: Parent[] = new Array(testedCells);
  const cellClass = new Int32Array(testedCells);
  const cellN = new Int32Array(testedCells);
  const zObs = new Float64Array(testedCells);
  for (const g of groups.values()) {
    for (const p of g.parents) {
      p.sums.fill(0);
      for (let t = 0; t < g.N; t++) {
        const c = p.cls[t]!;
        if (c >= 0) p.sums[c]! += g.labels0[t]!;
      }
      p.obsMax = 0;
      p.tested.forEach((c, k) => {
        const i = p.first + k;
        cellParent[i] = p;
        cellClass[i] = c;
        cellN[i] = p.nIn[c]!;
        zObs[i] = (p.sums[c]! / p.nIn[c]! - g.mu) * p.scale[c]!;
        p.obsMax = Math.max(p.obsMax, Math.abs(zObs[i]!));
      });
    }
  }

  // ── permutations ──────────────────────────────────────────────────────────────────────────────────────────
  let unit = 0;
  for (const g of groups.values()) unit += g.N * (1 + g.parents.length);
  const B = Math.max(LIMITS.minPerms, Math.min(LIMITS.maxPerms, Math.floor(LIMITS.workBudget / Math.max(1, unit))));
  const pool = new PooledNull(Array.from(cellN), B);
  const stratum = Array.from(cellN, (n) => pool.stratumOf(n));
  for (const p of parents) p.nullMax = new Float64Array(B);
  const rand = rng(seed);
  for (let b = 0; b < B; b++) {
    for (const g of groups.values()) {
      shuffle(g.work, rand); // any arrangement shuffled again is a uniform random permutation
      for (const p of g.parents) {
        p.sums.fill(0);
        for (let t = 0; t < g.N; t++) {
          const c = p.cls[t]!;
          if (c >= 0) p.sums[c]! += g.work[t]!;
        }
        let mx = 0;
        for (let k = 0; k < p.tested.length; k++) {
          const c = p.tested[k]!;
          const z = Math.abs((p.sums[c]! / p.nIn[c]! - g.mu) * p.scale[c]!);
          pool.add(stratum[p.first + k]!, z);
          if (z > mx) mx = z;
        }
        p.nullMax[b] = mx;
      }
    }
    prog.value = 0.05 + (0.7 * (b + 1)) / B;
    yield;
  }
  pool.finish();

  const pCell = Array.from(zObs, (z, i) => pool.p(stratum[i]!, Math.abs(z)));
  const parentP = new Map<Parent, number>();
  for (const p of parents) {
    let ge = 0;
    for (let b = 0; b < B; b++) if (p.nullMax[b]! >= p.obsMax - 1e-12) ge++;
    parentP.set(p, (1 + ge) / (B + 1));
  }
  const { q } = benjaminiHochberg(pCell, LIMITS.fdr);

  // ── per-pattern statistics ────────────────────────────────────────────────────────────────────────────────
  const membersOf = (conds: readonly Cond[], lo: number, hi: number): Int32Array => {
    const out: number[] = [];
    for (let i = lo; i < hi; i++) {
      let ok = true;
      for (const c of conds) if (!condHolds(c, col(c.f)[i])) {
        ok = false;
        break;
      }
      if (ok) out.push(i);
    }
    return Int32Array.from(out);
  };
  const part0 = { all: [0, N], disc: [0, nd], conf: [nd, N] } as const;
  const baseOf = (lo: number, hi: number): { n: number; wins: number; sum: number } => {
    let wins = 0;
    let sum = 0;
    for (let i = lo; i < hi; i++) {
      sum += table.r[i]!;
      if (table.r[i]! > 0) wins++;
    }
    return { n: hi - lo, wins, sum };
  };
  const bases = { all: baseOf(...part0.all), disc: baseOf(...part0.disc), conf: baseOf(...part0.conf) };
  const statsOf = (idx: Int32Array, which: keyof typeof bases, ci: boolean, seedKey: string): CellStats => {
    const base = bases[which];
    const n = idx.length;
    if (n === 0) return emptyStats(base.n);
    let wins = 0;
    let sum = 0;
    const rs: number[] = [];
    for (const i of idx) {
      const r = table.r[i]!;
      sum += r;
      if (r > 0) wins++;
      if (ci) rs.push(r);
    }
    const baseWin = base.n ? base.wins / base.n : null;
    const baseAvg = base.n ? base.sum / base.n : null;
    const winRate = wins / n;
    const avgR = sum / n;
    return {
      n,
      total: base.n,
      wins,
      winRate,
      winCi: wilsonCI(wins, n),
      avgR,
      rCi: ci && n >= 5 ? bootstrapCI(rs, (s) => meanOf(s), { runs: bootRuns(n), seed: (seed ^ hash32(seedKey)) >>> 0 }) : null,
      baseWinRate: baseWin,
      baseAvgR: baseAvg,
      diffWinRate: baseWin == null ? null : winRate - baseWin,
      diffR: baseAvg == null ? null : avgR - baseAvg,
    };
  };

  /** the four chronological blocks: +1 = same sign as the pattern's effect, −1 = opposite, 0 = too few trades */
  const blocksOf = (conds: readonly Cond[], dir: 1 | -1): (1 | -1 | 0)[] => blockSigns(table.r, (i) => conds.every((c) => condHolds(c, col(c.f)[i])), dir);

  const meanDelta = (conds: readonly Cond[]): { delta: number; n: number } => {
    const idx = membersOf(conds, 0, N);
    if (idx.length === 0) return { delta: 0, n: 0 };
    let s = 0;
    for (const i of idx) s += table.r[i]!;
    return { delta: s / idx.length - sumAll / N, n: idx.length };
  };

  /** confirmation test of one pattern: the same conditions on the newest 40 % */
  const confTest = (conds: readonly Cond[], dir: 1 | -1, key: string): { state: "small" | "flipped" | "tested"; p: number | null; idx: Int32Array } => {
    const popLabels: number[] = [];
    const idx: number[] = [];
    for (let i = nd; i < N; i++) {
      if (!conds.every((c) => col(c.f)[i] != null)) continue;
      popLabels.push(table.r[i]!);
      if (conds.every((c) => condHolds(c, col(c.f)[i]))) idx.push(i);
    }
    const Np = popLabels.length;
    const n = idx.length;
    const members = Int32Array.from(idx);
    if (n < LIMITS.minConfCell || Np - n < LIMITS.minConfCell) return { state: "small", p: null, idx: members };
    const lab = Float64Array.from(popLabels);
    const { mu, sigma } = momentsOf(lab);
    if (!(sigma > 0)) return { state: "small", p: null, idx: members };
    const scale = zScale(Np, n, sigma);
    let s = 0;
    for (const i of idx) s += table.r[i]!;
    const zc = (s / n - mu) * scale;
    if (dir * zc <= 0) return { state: "flipped", p: null, idx: members };
    const rr = rng((seed ^ hash32(`conf:${key}`)) >>> 0);
    let ge = 0;
    for (let b = 0; b < LIMITS.confPerms; b++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rr() * (Np - i));
        const t = lab[i]!;
        lab[i] = lab[j]!;
        lab[j] = t;
        sum += lab[i]!;
      }
      if (dir * ((sum / n - mu) * scale) >= dir * zc - 1e-12) ge++;
    }
    return { state: "tested", p: (1 + ge) / (LIMITS.confPerms + 1), idx: members };
  };

  interface Pre {
    ct: ReturnType<typeof confTest>;
    /** BH-adjusted p of the confirmation tests of all candidates, and whether it passed */
    confQ: number | null;
    ok: boolean;
  }
  const makeFinding = (i: number, level: "candidate" | "shown", pre?: Pre): Finding => {
    const p = cellParent[i]!;
    const conds = p.condsOf(cellClass[i]!);
    const key = condsKey(conds);
    const z = zObs[i]!;
    const dir = sgn(z);
    const all = statsOf(membersOf(conds, 0, N), "all", true, `all:${key}`);
    const discIdx = membersOf(conds, 0, nd);
    const disc = statsOf(discIdx, "disc", false, `disc:${key}`);
    const reasons: Reason[] = [];
    let tier: Tier;
    let conf: CellStats | null = null;
    let confP: number | null = null;
    let confQ: number | null = null;
    let blocks: (1 | -1 | 0)[] = blocksOf(conds, dir);
    const gate = parentP.get(p)!;

    if (level === "shown") {
      // a pattern that did not survive: its numbers are shown anyway, so nothing is hidden
      tier = "rejected";
      reasons.push("chance");
      const ci = membersOf(conds, nd, N);
      conf = ci.length ? statsOf(ci, "conf", false, `conf:${key}`) : null;
    } else {
      const ct = pre!.ct;
      const ci = ct.idx;
      conf = ci.length ? statsOf(ci, "conf", true, `conf:${key}`) : null;
      confP = ct.p;
      confQ = pre!.confQ;
      const agree = blocks.filter((b) => b === 1).length;
      const stable = agree >= LIMITS.blocksAgree;
      if (gate > LIMITS.parentGate) {
        tier = "rejected";
        reasons.push("gate");
      } else if (ct.state === "flipped") {
        tier = "rejected";
        reasons.push("flipped");
      } else if (pre!.ok && stable) tier = "confirmed";
      else {
        tier = "hint";
        if (ct.state === "small") reasons.push("confirmSmall");
        else if (!pre!.ok) reasons.push("confirmWeak");
        if (!stable) reasons.push("unstable");
      }
    }

    // combination: does it do more than its best part?
    let nonObvious = false;
    let redundant = false;
    if (conds.length >= 2 && level === "candidate" && tier !== "rejected") {
      const full = meanDelta(conds);
      let best = 0;
      const L = conds.length;
      for (let mask = 1; mask < (1 << L) - 1; mask++) {
        const sub = conds.filter((_, k) => (mask >> k) & 1);
        const d = meanDelta(sub);
        if (d.n >= 5 && sgn(d.delta) === sgn(full.delta)) best = Math.max(best, Math.abs(d.delta));
      }
      const syn = Math.abs(full.delta) - best;
      nonObvious = syn >= Math.max(0.05, 0.5 * Math.abs(full.delta));
      redundant = !nonObvious;
    }

    let winnersIn = 0;
    let losersIn = 0;
    for (const j of membersOf(conds, 0, N)) {
      if (table.r[j]! > 0) winnersIn++;
      else losersIn++;
    }
    const losersAll = N - winsAll;
    return {
      id: key,
      conds,
      side: z >= 0 ? "win" : "loss",
      tier,
      reasons,
      all,
      disc,
      conf,
      z,
      p: pCell[i]!,
      q: q[i] ?? 1,
      parentP: gate,
      confP,
      confQ,
      blocks,
      shareWinners: winsAll ? winnersIn / winsAll : null,
      shareLosers: losersAll ? losersIn / losersAll : null,
      nonObvious,
      redundant,
      obscure: conds.some((c) => FEATURES[c.f].obscure),
      postEntry: isPostEntry(conds),
    };
  };

  // ── candidates, confirmation, stability ───────────────────────────────────────────────────────────────────
  const order = Array.from({ length: testedCells }, (_, i) => i).sort((a, b) => (q[a] ?? 1) - (q[b] ?? 1) || Math.abs(zObs[b]!) - Math.abs(zObs[a]!) || a - b);
  const candidates = order.filter((i) => (q[i] ?? 1) <= LIMITS.fdr);
  const findings: Finding[] = [];
  const untested: Finding[] = [];
  // confirmation tests of the strongest candidates, corrected over all of them (Holm: a cluster of related patterns must not
  // get many chances to replicate by luck). Candidates the confirmation part is too small for are not in the family.
  const tested = candidates.slice(0, LIMITS.maxCandidates);
  const cts = tested.map((i) => {
    const conds = cellParent[i]!.condsOf(cellClass[i]!);
    return confTest(conds, sgn(zObs[i]!), condsKey(conds));
  });
  const adj = holmAdjusted(cts.map((c) => (c.state === "small" ? null : (c.p ?? 1))));
  for (let k = 0; k < candidates.length; k++) {
    const i = candidates[k]!;
    if (k < tested.length) findings.push(makeFinding(i, "candidate", { ct: cts[k]!, confQ: adj[k] ?? null, ok: cts[k]!.state === "tested" && adj[k] != null && adj[k]! <= LIMITS.confirmAlpha }));
    else {
      // beyond the limit of the confirmation test: described, never confirmed
      const f = makeFinding(i, "shown");
      untested.push({ ...f, tier: "hint", reasons: ["untested"] });
    }
    prog.value = 0.75 + (0.25 * (k + 1)) / Math.max(1, candidates.length);
    yield;
  }
  const all = [...findings, ...untested];
  const keep = all.filter((f) => !f.redundant);
  const confirmed = keep.filter((f) => f.tier === "confirmed");
  const hints = keep.filter((f) => f.tier === "hint");
  counts.confirmed = confirmed.length;
  counts.hint = hints.length;
  counts.redundant = all.filter((f) => f.redundant && f.tier !== "rejected").length;
  counts.rejected = testedCells - counts.confirmed - counts.hint - counts.redundant;

  // the closest misses (so the card can show what was thrown away)
  const candSet = new Set(candidates);
  const miss = order.filter((i) => !candSet.has(i)).slice(0, LIMITS.maxRejectedShown);
  const rejected = miss.map((i) => makeFinding(i, "shown"));
  // candidates the gate or the confirmation threw out are rejected too and shown with their reason
  const thrown = all.filter((f) => f.tier === "rejected").slice(0, LIMITS.maxRejectedShown);

  const byQ = (a: Finding, b: Finding): number => a.q - b.q || Math.abs(b.z) - Math.abs(a.z);
  const out = [...confirmed.sort(byQ), ...hints.sort(byQ).slice(0, LIMITS.maxHints), ...[...thrown, ...rejected].sort(byQ).slice(0, LIMITS.maxRejectedShown)];
  prog.value = 1;
  return result("ok", null, out, usable, B);
}
