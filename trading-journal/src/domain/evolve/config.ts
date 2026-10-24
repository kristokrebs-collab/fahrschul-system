/**
 * `settings.evolve` – the versioned passthrough key of the background optimiser: `{ v: 1, learn, stats, proposals, lineages,
 * prefs }`. Same pattern as `settings.forward` / `settings.keyLevels`:
 *
 * - reading is strict per proposal (an entry that cannot be read goes to `rejected` and is written back untouched, never
 *   repaired silently), lenient for the small counters (anything unreadable falls back to zero);
 * - writing keeps every unknown key of the root and the `rejected` entries, and returns the SAME object when nothing
 *   changes (the caller then skips the save);
 * - `proposals` is an id list, so the cloud / two-tab merge (`merge3`) works per proposal; `learn` / `stats` / `lineages` are
 *   plain objects (merged per key – a counter changed on two devices at once keeps this device's value, which is the
 *   price of a counter without a server).
 *
 * What lives here is what the user DECIDED and what the optimiser LEARNED from it – not the search itself. The trial log is
 * local to the device (`protocol.ts`), the search state is memory only.
 */
import { sanitizeCustom } from "../lab/rules/tree";
import type { CustomConfig } from "../lab/rules/types";
import { emptyKind, type KindStats, type LearnMap } from "./learn";
import { EVOLVE_VERSION, MUTATION_KINDS, isMutationKind, type Decision, type MutationKind, type StoredProposal, type WinMetrics } from "./types";

export const MAX_PROPOSALS = 30;
export const MAX_OPEN = 9;
export const MAX_LINEAGES = 40;
export const MAX_REASON = 200;
const POWERS = ["gentle", "normal", "full"] as const;
export type Power = (typeof POWERS)[number];

/** Cumulative counters (they outlive the trimmed proposal list). */
export interface EvolveStats {
  proposed: number;
  accepted: number;
  rejected: number;
  /** live verdicts: confirmed / below */
  confirmed: number;
  below: number;
  /** Σ and count of (actual − expected) percent per 30 days over the live verdicts */
  devSum: number;
  devN: number;
}

/** The trials of one strategy on (mostly) the same candles: they raise the bar of the multiple-testing correction. */
export interface Lineage {
  /** earlier trials, already weighted by the overlap at the time of the last run */
  trials: number;
  /** end of the candles of the last run (ms) */
  to: number;
  runs: number;
}

export interface EvolveSettings {
  v: typeof EVOLVE_VERSION;
  learn: LearnMap;
  stats: EvolveStats;
  proposals: StoredProposal[];
  lineages: Record<string, Lineage>;
  prefs: { power: Power };
  /** stored proposals this version cannot read – written back untouched */
  rejected: unknown[];
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cnt = (v: unknown): number => (fin(v) && v >= 0 ? Math.min(1e9, Math.round(v)) : 0);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export const EMPTY_STATS: EvolveStats = Object.freeze({ proposed: 0, accepted: 0, rejected: 0, confirmed: 0, below: 0, devSum: 0, devN: 0 });

export const EMPTY_EVOLVE: EvolveSettings = Object.freeze({
  v: EVOLVE_VERSION,
  learn: {},
  stats: EMPTY_STATS,
  proposals: [],
  lineages: {},
  prefs: { power: "normal" as Power },
  rejected: [],
}) as EvolveSettings;

// ── readers ──────────────────────────────────────────────────────────────────────────────────────────────────

function learnOf(raw: unknown): LearnMap {
  const out: LearnMap = {};
  if (!isObj(raw)) return out;
  for (const k of MUTATION_KINDS) {
    const r = raw[k];
    if (!isObj(r)) continue;
    const s: KindStats = { ...emptyKind(), acc: cnt(r.acc), rej: cnt(r.rej), good: cnt(r.good), bad: cnt(r.bad) };
    if (s.acc || s.rej || s.good || s.bad) out[k] = s;
  }
  return out;
}

function statsOf(raw: unknown): EvolveStats {
  if (!isObj(raw)) return EMPTY_STATS;
  return { proposed: cnt(raw.proposed), accepted: cnt(raw.accepted), rejected: cnt(raw.rejected), confirmed: cnt(raw.confirmed), below: cnt(raw.below), devSum: fin(raw.devSum) ? raw.devSum : 0, devN: cnt(raw.devN) };
}

function lineagesOf(raw: unknown): Record<string, Lineage> {
  const out: Record<string, Lineage> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw).slice(0, MAX_LINEAGES * 2)) {
    if (!/^[\w:.-]{1,60}$/.test(id) || !isObj(v) || !fin(v.to)) continue;
    out[id] = { trials: cnt(v.trials), to: v.to, runs: cnt(v.runs) };
  }
  // the newest lineages stay
  const keep = Object.entries(out).sort((a, b) => b[1].to - a[1].to).slice(0, MAX_LINEAGES);
  return Object.fromEntries(keep);
}

const interval = (v: unknown): { lo: number; hi: number } | null => (isObj(v) && fin(v.lo) && fin(v.hi) ? { lo: v.lo, hi: v.hi } : null);
const numOrNull = (v: unknown): number | null => (fin(v) ? v : null);

function metrics(raw: unknown): WinMetrics | null {
  if (!isObj(raw) || !fin(raw.n) || !fin(raw.sumR)) return null;
  return {
    n: Math.max(0, Math.round(raw.n)),
    sumR: raw.sumR,
    avgR: numOrNull(raw.avgR),
    avgRCI: interval(raw.avgRCI),
    winRate: numOrNull(raw.winRate),
    maxDdR: fin(raw.maxDdR) ? raw.maxDdR : 0,
    netPct: fin(raw.netPct) ? raw.netPct : 0,
    // an infinite profit factor is stored as null by JSON
    pf: numOrNull(raw.pf),
  };
}

function config(raw: unknown): CustomConfig | null {
  return isObj(raw) && raw.version === 1 ? sanitizeCustom(raw) : null;
}

const DECISIONS: readonly Decision[] = ["open", "saved", "challenger", "rejected"];

/** One stored proposal → `StoredProposal`, or `null` when it cannot be read. */
export function proposalOf(raw: unknown): StoredProposal | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== "string" || !/^[\w-]{1,40}$/.test(raw.id) || !fin(raw.createdAt)) return null;
  if (!(DECISIONS as readonly unknown[]).includes(raw.decision)) return null;
  const cfg = config(raw.config);
  const baseCfg = config(raw.baseConfig);
  if (!cfg || !baseCfg || typeof raw.sid !== "string" || typeof raw.key !== "string" || typeof raw.baseKey !== "string") return null;
  const t = isObj(raw.test) ? raw.test : {};
  const tb = metrics(t.base);
  const tc = metrics(t.cand);
  const o = isObj(raw.overfit) ? raw.overfit : {};
  if (!tb || !tc || !fin(o.p) || !fin(raw.score)) return null;
  const kinds = (Array.isArray(raw.kinds) ? raw.kinds : []).filter(isMutationKind) as MutationKind[];
  const windows = (Array.isArray(raw.windows) ? raw.windows : []).filter(isObj).map((w) => ({ from: fin(w.from) ? w.from : 0, to: fin(w.to) ? w.to : 0, baseN: cnt(w.baseN), baseSumR: fin(w.baseSumR) ? w.baseSumR : 0, candN: cnt(w.candN), candSumR: fin(w.candSumR) ? w.candSumR : 0 })).slice(0, 12);
  const hold = isObj(raw.holdout) ? raw.holdout : null;
  const hb = hold ? metrics(hold.base) : null;
  const hc = hold ? metrics(hold.cand) : null;
  const w = hold && isObj(hold.window) ? hold.window : {};
  const pl = isObj(raw.plateau) && fin(raw.plateau.checked) && fin(raw.plateau.ok) ? { checked: raw.plateau.checked, ok: raw.plateau.ok } : null;
  const fr = isObj(raw.freedom) ? raw.freedom : {};
  const ex = isObj(raw.expected) ? raw.expected : {};
  const tr = isObj(raw.train) ? raw.train : {};
  const trSide = (v: unknown): { n: number; avgR: number | null } => (isObj(v) ? { n: cnt(v.n), avgR: numOrNull(v.avgR) } : { n: 0, avgR: null });
  const out: StoredProposal = {
    id: raw.id,
    createdAt: raw.createdAt,
    decision: raw.decision as Decision,
    sid: raw.sid.slice(0, 60),
    strategyName: str(raw.strategyName, 60),
    symbol: str(raw.symbol, 24),
    interval: cfg.interval,
    seed: fin(raw.seed) ? raw.seed : 0,
    baseKey: raw.baseKey.slice(0, 20),
    baseConfig: baseCfg,
    config: cfg,
    key: raw.key.slice(0, 20),
    kinds,
    changes: (Array.isArray(raw.changes) ? raw.changes : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 260)).slice(0, 14),
    windows,
    test: { base: tb, cand: tc },
    train: { base: trSide(tr.base), cand: trSide(tr.cand) },
    holdout: hb && hc ? { window: { from: fin(w.from) ? w.from : 0, to: fin(w.to) ? w.to : 0 }, base: hb, cand: hc } : null,
    score: raw.score,
    baseScore: numOrNull(raw.baseScore),
    windowsBetter: cnt(raw.windowsBetter),
    overfit: { p: Math.min(1, Math.max(0, o.p)), pRun: fin(o.pRun) ? o.pRun : o.p, pNaive: numOrNull(o.pNaive), trialsRun: cnt(o.trialsRun), trialsPrior: cnt(o.trialsPrior), strategiesInRun: Math.max(1, cnt(o.strategiesInRun)) },
    plateau: pl,
    freedom: { base: cnt(fr.base), cand: cnt(fr.cand) },
    expected: { avgR: numOrNull(ex.avgR), avgRCI: interval(ex.avgRCI), pctPer30d: numOrNull(ex.pctPer30d), n: cnt(ex.n), days: fin(ex.days) ? ex.days : 0 },
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 12),
    dataTo: fin(raw.dataTo) ? raw.dataTo : 0,
  };
  if (fin(raw.decidedAt)) out.decidedAt = raw.decidedAt;
  if (typeof raw.reason === "string" && raw.reason.trim()) out.reason = raw.reason.trim().slice(0, MAX_REASON);
  if (typeof raw.savedAs === "string") out.savedAs = raw.savedAs.slice(0, 120);
  if (typeof raw.challengerId === "string" && /^[\w-]{1,40}$/.test(raw.challengerId)) out.challengerId = raw.challengerId;
  if (isObj(raw.outcome) && (raw.outcome.level === "confirmed" || raw.outcome.level === "below") && fin(raw.outcome.at)) {
    out.outcome = { at: raw.outcome.at, level: raw.outcome.level, avgR: numOrNull(raw.outcome.avgR), pctPer30d: numOrNull(raw.outcome.pctPer30d), n: cnt(raw.outcome.n), days: fin(raw.outcome.days) ? raw.outcome.days : 0 };
  }
  return out;
}

/** `settings.evolve` (anything) → the full, clean value. A duplicated proposal id keeps the first entry. */
export function evolveCfgOf(raw: unknown): EvolveSettings {
  if (!isObj(raw)) return EMPTY_EVOLVE;
  const proposals: StoredProposal[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw.proposals) ? raw.proposals : []) {
    const p = proposalOf(e);
    if (!p) rejected.push(e);
    else if (!seen.has(p.id) && proposals.length < MAX_PROPOSALS) {
      seen.add(p.id);
      proposals.push(p);
    }
  }
  const prefs = isObj(raw.prefs) ? raw.prefs : {};
  return {
    v: EVOLVE_VERSION,
    learn: learnOf(raw.learn),
    stats: statsOf(raw.stats),
    proposals,
    lineages: lineagesOf(raw.lineages),
    prefs: { power: (POWERS as readonly unknown[]).includes(prefs.power) ? (prefs.power as Power) : "normal" },
    rejected,
  };
}

export const evolveOfSettings = (s: { evolve?: unknown } | null | undefined): EvolveSettings => evolveCfgOf(s?.evolve);

// ── writer ───────────────────────────────────────────────────────────────────────────────────────────────────

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/** Keeps the newest decided proposals and at most `MAX_OPEN` open ones; the list stays under `MAX_PROPOSALS`. */
export function trimProposals(list: readonly StoredProposal[]): StoredProposal[] {
  const open = list.filter((p) => p.decision === "open").sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_OPEN);
  const decided = list.filter((p) => p.decision !== "open").sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt)).slice(0, MAX_PROPOSALS - open.length);
  const keep = new Set([...open, ...decided].map((p) => p.id));
  return list.filter((p) => keep.has(p.id));
}

export type EvolvePatch = Partial<Pick<EvolveSettings, "learn" | "stats" | "proposals" | "lineages" | "prefs">>;

/**
 * `settings.evolve` with the patched parts replaced – unknown keys of the root and the unreadable proposals survive. Returns
 * the SAME object when nothing changes.
 */
export function withEvolve(raw: unknown, patch: EvolvePatch): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = evolveCfgOf(raw);
  const proposals = trimProposals(patch.proposals ?? cur.proposals);
  const next: Record<string, unknown> = {
    ...prev,
    v: EVOLVE_VERSION,
    learn: patch.learn ?? cur.learn,
    stats: patch.stats ?? cur.stats,
    proposals: [...proposals, ...cur.rejected],
    lineages: patch.lineages ?? cur.lineages,
    prefs: patch.prefs ?? cur.prefs,
  };
  return isObj(raw) && canon(prev) === canon(next) ? (raw as Record<string, unknown>) : next;
}

// ── the effect of earlier trials ─────────────────────────────────────────────────────────────────────────────

/**
 * Earlier trials of a strategy that still count: they were run on candles that mostly are still part of today's test span, so
 * they were also "looked at" there. Every candle that has been added since makes them less relevant: the share shrinks
 * linearly to zero when the test span consists of new candles only.
 */
export function effectivePrior(l: Lineage | undefined, dataTo: number, testSpanMs: number): number {
  if (!l || !(testSpanMs > 0)) return 0;
  const newer = Math.max(0, dataTo - l.to);
  return l.trials * Math.min(1, Math.max(0, 1 - newer / testSpanMs));
}

/** The lineage after a run: the weighted earlier trials plus this run's trials, up to the end of today's candles. */
export function nextLineage(prior: number, runTrials: number, dataTo: number, runs: number): Lineage {
  return { trials: Math.round(prior + runTrials), to: dataTo, runs: runs + 1 };
}
