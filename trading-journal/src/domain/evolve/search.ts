/**
 * The search of ONE strategy (pure, stepped, seeded): an evolutionary loop with an elite, random restarts and learned
 * mutation weights.
 *
 *   0  the current version is evaluated first (trial 0) – every variant is compared with it, on the same windows and costs;
 *   1  search: a parent is drawn from the elite (rank-weighted, the current version always among the candidates); 1–2 small
 *      steps (`mutations.ts`) make a child; with a small chance a RANDOM RESTART jumps from the current version with 2–3
 *      steps instead; kinds are drawn by their learned weight (what the user accepted / what held up live is tried more);
 *      the child is scored on the walk-forward test windows only; a variant seen before is skipped, not re-run;
 *   2  wait: the search is over (budget, stagnation, stop); the scheduler (`multi.ts`) now has every variant's block series and
 *      computes the multiple-testing correction over ALL strategies;
 *   3  check: for the finalists – plateau (neighbouring numbers), the confirmation window, the proposal with its warnings.
 *
 * Determinism: all randomness comes from seeded generators consumed in a fixed order, a variant is generated before it is
 * evaluated and evaluation draws nothing – so the same data, rule set and seed always give the same trials, however the work
 * is cut into time slices (tested). The job reads no clock; the host stamps times.
 */
import { rng } from "../analytics/stats";
import type { Stepper } from "../backtest/strategies/types";
import { now } from "../backtest/strategies/types";
import { HIST_MS, type BarsBy } from "../backtest/types";
import { customKey, sanitizeCustom, validateCustom } from "../lab/rules/tree";
import type { CustomConfig, TfId } from "../lab/rules/types";
import { Evaluator, type Evaluated, type Facts } from "./evaluate";
import { freedomOf, lightOnly, mutateChain, type MutationCtx } from "./mutations";
import { neighborsOf, plateauOf } from "./plateau";
import { buildDraft, changeLines } from "./proposal";
import { holdoutFloor, inflateForPrior, naiveP } from "./significance";
import type { Evaluation, EvolveOpts, HoldoutPair, LeaderRow, LogEntry, MutationKind, ProposalDraft, Step, StrategyInput, StrategyResult, StrategySnapshot, TrialVia, WinMetrics } from "./types";

export const DEFAULT_OPTS: EvolveOpts = { folds: 4, sub: 6, trainFrac: 0.3, holdoutFrac: 0.2, elite: 6, restartP: 0.1, stagnation: 120, proposals: 3, boot: 400, neighbors: 12, minGain: 0.25 };

/** A stable 32-bit mix of a number and a string (the seed of one strategy's search). */
export function mixSeed(seed: number, s: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0 || 1;
}

type Phase = StrategySnapshot["phase"];

interface Cand {
  key: string;
  cfg: CustomConfig;
  ev: Evaluation;
  blocks: Float32Array;
  /** kinds of all steps from the current version to this variant */
  kinds: MutationKind[];
  i: number;
}

interface Task {
  purpose: "base" | "search" | "neighbor" | "holdout";
  cfg: CustomConfig;
  kinds: MutationKind[];
  text: string;
  parent: string | null;
  via: TrialVia;
  i: number;
  forKey?: string;
  prepStep?: Stepper<Facts>;
  prep?: Facts;
}

/** What the scheduler hands back after the correction over all strategies. */
export interface JobSignificance {
  /** adjusted p-value and z of every variant, in the order of `rcRows()` */
  p: readonly number[];
  z: readonly number[];
  trialsRun: number;
  trialsPrior: number;
  strategies: number;
}

export interface EvolveJobDeps {
  data: BarsBy;
  opts?: Partial<EvolveOpts>;
}

export class EvolveJob {
  phase: Phase = "prepare";
  readonly opts: EvolveOpts;
  readonly seed: number;
  private readonly rand: () => number;
  private readonly nrand: () => number;
  private readonly ev: Evaluator;
  private readonly ctx: MutationCtx;
  private readonly weights: Partial<Record<MutationKind, number>>;
  private base: Cand | null = null;
  private baseFreedom = 0;
  private readonly archive = new Map<string, Cand>();
  /** every variant evaluated by the search, in order (the matrix of the reality check) */
  private readonly series: Cand[] = [];
  private elite: Cand[] = [];
  private trials = 0;
  private dupes = 0;
  private bestScore = -Infinity;
  private sinceBest = 0;
  private task: Task | null = null;
  private stopRequested = false;
  private reason: StrategyResult["reason"] = "budget";
  private error: string | null = null;
  private readonly entries: LogEntry[] = [];
  private lastText: string | null = null;
  private windowsMs: StrategySnapshot["windows"] = null;
  private testDays = 0;
  private dataTo = 0;
  private interval: TfId;
  private readonly notes: string[] = [];
  // check phase
  private queue: Task[] = [];
  private queued = 0;
  private finalists: Cand[] = [];
  private readonly nbScores = new Map<string, (number | null)[]>();
  private readonly holds = new Map<string, WinMetrics>();
  private sig: JobSignificance | null = null;
  private proposals: ProposalDraft[] = [];
  private neighborNo = 0;
  private readonly changesCache = new Map<string, string[]>();

  constructor(
    readonly input: StrategyInput,
    deps: EvolveJobDeps,
    seed: number,
  ) {
    this.opts = { ...DEFAULT_OPTS, ...deps.opts };
    this.seed = seed;
    this.rand = rng(seed);
    this.nrand = rng(mixSeed(seed, "neighbors"));
    const cfg = sanitizeCustom(input.base);
    this.interval = cfg.interval;
    const f = input.engine.costs.funding;
    const funding = f.kind === "history" ? f.points : null;
    this.ev = new Evaluator({ data: deps.data, signal: input.signal, funding, fromMs: input.fromMs, engine: input.engine, opts: this.opts });
    const tfs = new Set<TfId>((Object.keys(deps.data) as TfId[]).filter((k) => (deps.data[k]?.length ?? 0) > 0));
    const exec = deps.data[cfg.interval] ?? [];
    this.ctx = { rng: this.rand, hasVolume: exec.slice(0, 400).some((b) => typeof b.v === "number"), tfs, funding: funding != null };
    this.weights = input.weights ?? {};
    const bad = validateCustom(cfg, { funding: funding != null }).find((i) => i.level === "error");
    if (bad) this.fail(`Die Regeln lassen sich so nicht testen: ${bad.text}`);
    else if (!exec.length) this.fail("Für diese Strategie wurden keine Kerzen geladen.");
    else {
      this.task = { purpose: "base", cfg, kinds: [], text: "Aktuelle Version (Ausgangspunkt)", parent: null, via: "baseline", i: 0 };
      if (lightOnly(cfg)) this.notes.push("Die Regeln enthalten einen rechenintensiven Baustein (MCB-Leiter oder RSI-Trendlinie). Der Optimierer ändert hier nur Stop, Ziel und Ausstieg – jede Regeländerung würde den Baustein für die ganze Historie neu rechnen.");
    }
  }

  private fail(msg: string): void {
    this.phase = "failed";
    this.error = msg;
    this.reason = "failed";
  }

  // ── the loop ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Works until the deadline; true when there is nothing left to do for now (waiting for the correction, or finished). */
  step(deadline: number): boolean {
    let worked = false;
    for (;;) {
      if (this.phase === "done" || this.phase === "failed" || this.phase === "wait") return true;
      if (worked && now() >= deadline) return false;
      if (!this.task) {
        this.task = this.nextTask();
        if (!this.task) {
          this.afterQueue();
          continue;
        }
      }
      const t = this.task;
      if (!t.prep) {
        t.prepStep ??= this.ev.prepare(t.cfg);
        if (!t.prepStep.step(deadline)) return false;
        t.prep = t.prepStep.result();
      }
      this.task = null;
      this.complete(t);
      worked = true;
    }
  }

  /** True while the job can use time (not waiting, not finished). */
  get busy(): boolean {
    return this.phase === "prepare" || this.phase === "search" || this.phase === "check";
  }

  /** Ask the search to end after the variant at hand; the correction and the check still run on what was found. */
  requestStop(): void {
    this.stopRequested = true;
    if (this.phase === "search") this.task = null;
  }

  private nextTask(): Task | null {
    if (this.phase === "prepare") return null; // the base task is created in the constructor; finishing it moves on
    if (this.phase === "search") return this.nextCandidate();
    if (this.phase === "check") return this.queue.shift() ?? null;
    return null;
  }

  private afterQueue(): void {
    if (this.phase === "search") {
      this.phase = "wait";
      return;
    }
    if (this.phase === "check") this.assemble();
    else if (this.phase === "prepare") this.fail(this.error ?? "Die aktuelle Version konnte nicht bewertet werden.");
  }

  // ── search ──────────────────────────────────────────────────────────────────────────────────────────────────

  private pickParent(): Cand {
    const items = [...this.elite, this.base!];
    const w = items.map((_, i) => (i === items.length - 1 ? 1 : this.elite.length - i + 1));
    let t = this.rand() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) {
      t -= w[i]!;
      if (t <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  private nextCandidate(): Task | null {
    if (this.stopRequested) return this.endSearch("stopped");
    if (this.trials >= this.input.maxTrials) return this.endSearch("budget");
    if (this.sinceBest >= this.opts.stagnation) return this.endSearch("converged");
    for (let attempt = 0; attempt < 40; attempt++) {
      const roll = this.rand();
      let parent: Cand;
      let n: number;
      let via: TrialVia = "mutation";
      if (roll < this.opts.restartP) {
        parent = this.base!;
        n = 2 + (this.rand() < 0.5 ? 1 : 0);
        via = "restart";
      } else if (roll < this.opts.restartP + 0.15) {
        parent = this.base!;
        n = 1;
      } else {
        parent = this.pickParent();
        n = this.rand() < 0.25 ? 2 : 1;
      }
      const m = mutateChain(parent.cfg, n, this.ctx, this.weights);
      if (!m) continue;
      const key = customKey(m.config);
      if (this.archive.has(key)) {
        this.dupes++;
        continue;
      }
      const kinds = [...new Set([...parent.kinds, ...m.steps.map((s: Step) => s.kind)])];
      return { purpose: "search", cfg: m.config, kinds, text: m.steps.map((s: Step) => s.text).join(" "), parent: parent.key, via, i: this.trials + 1 };
    }
    return this.endSearch("exhausted");
  }

  private endSearch(reason: StrategyResult["reason"]): null {
    this.reason = reason;
    return null;
  }

  // ── completing a task ───────────────────────────────────────────────────────────────────────────────────────

  private complete(t: Task): void {
    const prep = t.prep!;
    if (t.purpose === "holdout") {
      this.holds.set(t.forKey ?? "", this.ev.holdout(prep, t.cfg));
      return;
    }
    if (t.purpose === "base") {
      const w = this.ev.setWindows(prep);
      if (!w.ok) {
        this.fail(w.reason);
        return;
      }
      this.baseFreedom = freedomOf(t.cfg).total;
      const e = this.ev.evaluate(prep, t.cfg, this.baseFreedom);
      this.base = { key: e.ev.key, cfg: t.cfg, ev: e.ev, blocks: e.blocks, kinds: [], i: 0 };
      this.archive.set(e.ev.key, this.base);
      this.bestScore = e.ev.score ?? -Infinity;
      const win = this.ev.windows!;
      this.windowsMs = { train: this.ev.msOf(prep, win.train), tests: win.tests.map((x) => this.ev.msOf(prep, x)), holdout: this.ev.msOf(prep, win.holdout) };
      const secDays = HIST_MS[prep.interval] / 86_400_000;
      this.testDays = win.tests.reduce((s, x) => s + (x.to - x.from + 1), 0) * secDays;
      this.dataTo = this.windowsMs.holdout.to;
      this.log(t, e.ev);
      this.phase = "search";
      return;
    }
    const e: Evaluated = this.ev.evaluate(prep, t.cfg, this.baseFreedom);
    if (t.purpose === "neighbor") {
      const list = this.nbScores.get(t.forKey!) ?? [];
      list.push(e.ev.score);
      this.nbScores.set(t.forKey!, list);
      this.log(t, e.ev);
      return;
    }
    // a search variant
    this.trials++;
    const cand: Cand = { key: e.ev.key, cfg: t.cfg, ev: e.ev, blocks: e.blocks, kinds: t.kinds, i: this.trials };
    this.archive.set(cand.key, cand);
    this.series.push(cand);
    this.lastText = t.text;
    if (e.ev.score != null) {
      this.elite = [...this.elite, cand].sort((a, b) => b.ev.score! - a.ev.score!).slice(0, this.opts.elite);
      if (e.ev.score > this.bestScore + 1e-9) {
        this.bestScore = e.ev.score;
        this.sinceBest = 0;
      } else this.sinceBest++;
    } else this.sinceBest++;
    this.log(t, e.ev);
  }

  private log(t: Task, ev: Evaluation): void {
    this.entries.push({ sid: this.input.id, seed: this.seed, i: t.i, at: 0, key: ev.key, parent: t.parent, via: t.via, kinds: t.kinds, text: t.text, score: ev.score, n: ev.test.n, avgR: ev.test.avgR });
  }

  /** The log entries since the last call. */
  drainEntries(): LogEntry[] {
    return this.entries.splice(0, this.entries.length);
  }

  // ── the correction (called by the scheduler) ─────────────────────────────────────────────────────────────────

  /** Candidates of the reality check: the differences to the current version per time block. */
  rcRows(): Float32Array[] {
    if (!this.base) return [];
    const b = this.base.blocks;
    return this.series.map((c) => {
      const d = new Float32Array(b.length);
      for (let k = 0; k < b.length; k++) d[k] = c.blocks[k]! - b[k]!;
      return d;
    });
  }

  get trialsDone(): number {
    return this.trials;
  }

  setSignificance(sig: JobSignificance): void {
    this.sig = sig;
    if (this.phase !== "wait") return;
    this.startCheck();
    this.phase = "check";
  }

  private baseScoreEff(): number {
    return Math.max(0, this.base?.ev.score ?? 0);
  }

  private startCheck(): void {
    const need = this.baseScoreEff() + this.opts.minGain;
    this.finalists = this.elite.filter((c) => c.ev.score != null && c.ev.score >= need).slice(0, this.opts.proposals);
    this.queue = [];
    for (const f of this.finalists) {
      for (const nb of neighborsOf(f.cfg, this.nrand, this.opts.neighbors)) {
        this.queue.push({ purpose: "neighbor", cfg: nb.config, kinds: f.kinds, text: `Nachbarwert: ${nb.label}`, parent: f.key, via: "neighbor", i: ++this.neighborNo, forKey: f.key });
      }
    }
    // the confirmation window: the current version and every finalist, once
    this.queue.push({ purpose: "holdout", cfg: this.base!.cfg, kinds: [], text: "", parent: null, via: "baseline", i: 0, forKey: this.base!.key });
    for (const f of this.finalists) this.queue.push({ purpose: "holdout", cfg: f.cfg, kinds: f.kinds, text: "", parent: null, via: "mutation", i: f.i, forKey: f.key });
    this.queued = this.queue.length;
  }

  private assemble(): void {
    const sig = this.sig;
    const base = this.base!;
    const idx = new Map(this.series.map((c, i) => [c.key, i]));
    const out: ProposalDraft[] = [];
    for (const f of this.finalists) {
      const i = idx.get(f.key) ?? -1;
      const pRun = i >= 0 && sig ? (sig.p[i] ?? 1) : 1;
      const z = i >= 0 && sig ? (sig.z[i] ?? 0) : 0;
      const holdBase = this.holds.get(base.key);
      const holdCand = this.holds.get(f.key);
      const holdout: HoldoutPair | null = holdBase && holdCand && this.windowsMs ? { window: this.windowsMs.holdout, base: holdBase, cand: holdCand } : null;
      const floor = holdoutFloor(holdCand ?? null, holdBase ?? null);
      const plateau = plateauOf(f.ev.score!, this.nbScores.get(f.key) ?? []);
      out.push(
        buildDraft({
          sid: this.input.id,
          strategyName: this.input.name,
          symbol: this.input.symbol,
          interval: this.interval,
          seed: this.seed,
          baseConfig: base.cfg,
          baseEval: base.ev,
          cand: { config: f.cfg, ev: f.ev, kinds: f.kinds },
          windows: { tests: this.windowsMs!.tests },
          holdout,
          overfit: {
            p: Math.max(sig ? inflateForPrior(pRun, sig.trialsRun, sig.trialsPrior) : pRun, floor ?? 0),
            pRun,
            pNaive: i >= 0 ? naiveP(z) : null,
            floor,
            trialsRun: sig?.trialsRun ?? this.trials,
            trialsPrior: Math.round(sig?.trialsPrior ?? 0),
            strategiesInRun: sig?.strategies ?? 1,
          },
          plateau,
          baseScoreEff: this.baseScoreEff(),
          testDays: this.testDays,
          dataTo: this.dataTo,
          folds: this.opts.folds,
        }),
      );
    }
    this.proposals = out;
    this.phase = "done";
  }

  // ── what the outside sees ────────────────────────────────────────────────────────────────────────────────────

  progress(): number {
    if (this.phase === "done" || this.phase === "failed") return 1;
    if (this.phase === "prepare") return 0;
    if (this.phase === "check") return 0.9 + (0.1 * (this.queued - this.queue.length)) / Math.max(1, this.queued);
    if (this.phase === "wait") return 0.9;
    return 0.9 * Math.min(1, this.trials / Math.max(1, this.input.maxTrials));
  }

  private changesOf(c: Cand): string[] {
    let v = this.changesCache.get(c.key);
    if (!v) {
      v = changeLines(this.base!.cfg, c.cfg);
      this.changesCache.set(c.key, v);
    }
    return v;
  }

  snapshot(): StrategySnapshot {
    const b = this.base;
    const eff = this.baseScoreEff();
    const rows: LeaderRow[] = this.elite.slice(0, 8).map((c, i) => ({ key: c.key, rank: i + 1, score: c.ev.score!, gain: c.ev.score! - eff, n: c.ev.test.n, avgR: c.ev.test.avgR, freedom: c.ev.freedom, changes: this.changesOf(c).slice(0, 4) }));
    return {
      id: this.input.id,
      name: this.input.name,
      phase: this.phase,
      trials: this.trials,
      budget: this.input.maxTrials,
      stagnation: this.sinceBest,
      generation: Math.floor(this.trials / Math.max(1, this.opts.elite * 4)),
      base: b ? { score: b.ev.score, n: b.ev.test.n, avgR: b.ev.test.avgR, freedom: b.ev.freedom } : null,
      rows,
      lastText: this.lastText,
      priorTrials: this.input.priorTrials,
      error: this.error,
      windows: this.windowsMs,
      notes: this.notes,
    };
  }

  result(): StrategyResult {
    const b = this.base;
    return { id: this.input.id, reason: this.reason, trials: this.trials, dupes: this.dupes, error: this.error, proposals: this.proposals, base: b ? { score: b.ev.score, n: b.ev.test.n, avgR: b.ev.test.avgR } : null };
  }

  /** The current version's confirmation-window numbers (for the tournament). */
  baseHoldout(): WinMetrics | null {
    return this.base ? (this.holds.get(this.base.key) ?? null) : null;
  }
}
