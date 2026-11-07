/**
 * Several strategies at once (pure, stepped). Every strategy has its own search (`EvolveJob`): its own elite, trial log and seed
 * (derived from the run's seed and the strategy id, so a strategy's trials do not depend on which others run along). One
 * round-robin scheduler gives each busy job a short slice in turn – one timer, one worker, nothing hangs on a phone – and the
 * work of a job does not depend on how the slices fall (tested).
 *
 * Between the search and the check there is ONE barrier: when every search has ended, the Reality Check (see
 * `significance.ts`) runs over the block series of ALL variants of ALL strategies together, so a proposal's probability of
 * being luck counts every strategy and every variant that was tried in the run (plus the earlier trials, weighted).
 *
 * The tournament lists the current version and the proposals of every strategy next to each other on their confirmation
 * windows ("welche Strategie hat sich im Bestätigungsfenster am besten gehalten"), ranked by Ø R × √n. It recommends nothing:
 * the confirmation windows of different strategies are measured on their own markets and candles and a ranking of
 * a few trades is mostly noise – rows under 5 trades are listed without a rank.
 */
import { now } from "../backtest/strategies/types";
import type { BarsBy } from "../backtest/types";
import { DEFAULT_OPTS, EvolveJob, mixSeed } from "./search";
import { realityCheck } from "./significance";
import type { LogEntry, MultiInput, MultiResult, MultiSnapshot, StrategyResult, TournamentRow } from "./types";

/** Time a job gets per turn (ms). */
export const SLICE_MS = 10;
/** Fewest confirmation-window trades for a rank. */
export const RANK_MIN_TRADES = 5;
/** Most strategies in one run (a phone has to carry them all). */
export const MAX_STRATEGIES = 6;

export class EvolveMulti {
  readonly jobs: EvolveJob[];
  private rr = 0;
  private corrected = false;
  private final: MultiResult | null = null;
  private stopping = false;

  constructor(private readonly input: MultiInput) {
    const opts = { ...DEFAULT_OPTS, ...input.opts };
    this.jobs = input.strategies.slice(0, MAX_STRATEGIES).map((s) => {
      const data: BarsBy = input.datasets[s.datasetKey] ?? {};
      return new EvolveJob(s, { data, opts }, mixSeed(input.seed, s.id));
    });
  }

  /** Works until the deadline; true when the run is finished. */
  step(deadline: number): boolean {
    if (this.final) return true;
    for (;;) {
      const busy = this.jobs.filter((j) => j.busy);
      if (!busy.length) {
        if (!this.corrected && this.jobs.some((j) => j.phase === "wait")) {
          this.correct();
          continue;
        }
        this.finish();
        return true;
      }
      if (now() >= deadline) return false;
      const j = busy[this.rr++ % busy.length]!;
      j.step(Math.min(deadline, now() + SLICE_MS));
    }
  }

  requestStop(): void {
    this.stopping = true;
    for (const j of this.jobs) j.requestStop();
  }

  /** The correction over all variants of all strategies. */
  private correct(): void {
    this.corrected = true;
    const waiting = this.jobs.filter((j) => j.phase === "wait");
    const rows = waiting.map((j) => j.rcRows());
    const flat = rows.flat();
    const rc = realityCheck(flat, { seed: mixSeed(this.input.seed, "reality-check"), boot: this.input.opts?.boot ?? DEFAULT_OPTS.boot });
    const trialsRun = this.jobs.reduce((s, j) => s + j.trialsDone, 0);
    const trialsPrior = this.jobs.reduce((s, j) => s + j.input.priorTrials, 0);
    const strategies = this.jobs.filter((j) => j.phase !== "failed").length;
    let at = 0;
    waiting.forEach((j, i) => {
      const n = rows[i]!.length;
      j.setSignificance({ p: rc.p.slice(at, at + n), z: rc.z.slice(at, at + n), trialsRun, trialsPrior, strategies });
      at += n;
    });
  }

  private finish(): void {
    const strategies: StrategyResult[] = this.jobs.map((j) => j.result());
    const rows: TournamentRow[] = [];
    for (const j of this.jobs) {
      const hb = j.baseHoldout();
      const row = (label: string, key: string | null, m: { n: number; avgR: number | null; sumR: number }, p: number | null): TournamentRow => ({
        sid: j.input.id,
        strategyName: j.input.name,
        label,
        proposalKey: key,
        n: m.n,
        avgR: m.avgR,
        sumR: m.sumR,
        rankValue: m.n >= RANK_MIN_TRADES && m.avgR != null ? m.avgR * Math.sqrt(m.n) : null,
        p,
      });
      if (hb) rows.push(row("Jetzige Version", null, hb, null));
      j.result().proposals.forEach((pr, k) => {
        if (pr.holdout) rows.push(row(`Vorschlag ${k + 1}`, pr.key, pr.holdout.cand, pr.overfit.p));
      });
    }
    rows.sort((a, b) => (b.rankValue ?? -Infinity) - (a.rankValue ?? -Infinity));
    this.final = {
      strategies,
      tournament: rows,
      trialsRun: this.jobs.reduce((s, j) => s + j.trialsDone, 0),
      trialsPrior: this.jobs.reduce((s, j) => s + j.input.priorTrials, 0),
    };
  }

  drainEntries(): LogEntry[] {
    return this.jobs.flatMap((j) => j.drainEntries());
  }

  snapshot(): MultiSnapshot {
    const strategies = this.jobs.map((j) => j.snapshot());
    const trialsBudget = this.jobs.reduce((s, j) => s + j.input.maxTrials, 0);
    const trialsDone = this.jobs.reduce((s, j) => s + j.trialsDone, 0);
    const progress = this.final ? 1 : this.jobs.length ? this.jobs.reduce((s, j) => s + j.progress(), 0) / this.jobs.length : 1;
    const anyCheck = this.jobs.some((j) => j.phase === "check" || j.phase === "wait");
    return { phase: this.final ? "done" : this.stopping ? "stopping" : anyCheck ? "check" : "running", strategies, trialsDone, trialsBudget, progress };
  }

  result(): MultiResult | null {
    return this.final;
  }

  get finished(): boolean {
    return this.final != null;
  }
}
