/**
 * Runs the Monte Carlo / risk of ruin without blocking the page (P03):
 * - web builds: one shared module worker (`mc.worker.ts`, inline – no extra file), loaded on the first job;
 * - single-file builds, `file:` pages, browsers without `Worker`, or a worker that fails (CSP, crash, no answer in
 *   `WORKER_TIMEOUT_MS`): the same engine (`createMonteCarlo`) in idle chunks (`requestIdleCallback`, else a short
 *   timer), a few paths per slice, so no frame waits on it.
 * Results are identical in both paths (same seeded engine). Every job takes an `AbortSignal` (a newer job of the
 * same view aborts the old one).
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { createMonteCarlo, riskOfRuin, type MonteCarloOptions, type MonteCarloResult, type RiskOfRuinInput, type RiskOfRuinResult } from "./montecarlo";
import type { McJob, McRequest, McResponse } from "./mcProtocol";

/** A worker that does not answer within this time is given up (fallback to idle chunks). */
export const WORKER_TIMEOUT_MS = 15_000;
/** Paths per idle slice step (re-checked against the slice deadline). */
const IDLE_BATCH = 20;
/** Slice budget when there is no `requestIdleCallback` (ms). */
const FALLBACK_SLICE_MS = 8;

export type McRunMode = "auto" | "idle";

export interface RunOptions {
  signal?: AbortSignal;
  /** "idle" forces the main-thread fallback (tests, comparisons) */
  mode?: McRunMode;
}

class WorkerUnavailable extends Error {}

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });
export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

// ── worker ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Pending = { resolve: (r: McResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Pending>();

/** Whether this runtime may use the worker at all. */
export function workerAllowed(): boolean {
  return !workerBroken && typeof Worker !== "undefined" && !IS_FILE_BUILD && !isFileProtocol();
}

function failWorker(): void {
  workerBroken = true;
  try {
    worker?.terminate();
  } catch {
    /* already gone */
  }
  worker = null;
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new WorkerUnavailable("worker failed"));
    pending.delete(id);
  }
}

async function getWorker(): Promise<Worker> {
  if (!workerAllowed()) throw new WorkerUnavailable("no worker");
  if (worker) return worker;
  try {
    const mod = await import("./mc.worker?worker&inline");
    const w = new mod.default({ name: "tj-montecarlo" });
    w.onmessage = (e: MessageEvent<McResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(e.data.id);
      p.resolve(e.data);
    };
    w.onerror = () => failWorker();
    worker = w;
    return w;
  } catch {
    failWorker();
    throw new WorkerUnavailable("worker could not start");
  }
}

async function viaWorker(req: McJob, signal?: AbortSignal): Promise<McResponse> {
  const w = await getWorker();
  const id = ++seq;
  return new Promise<McResponse>((resolve, reject) => {
    const timer = setTimeout(() => failWorker(), WORKER_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    signal?.addEventListener(
      "abort",
      () => {
        // the worker finishes the job anyway (it is short); its answer is dropped
        const p = pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(id);
        reject(abortError());
      },
      { once: true },
    );
    const msg: McRequest = { ...req, id };
    w.postMessage(msg);
  });
}

// ── idle chunks ─────────────────────────────────────────────────────────────────────────────────────────────────

type Deadline = { timeRemaining(): number };
type IdleHost = { requestIdleCallback?: (cb: (d: Deadline) => void, o?: { timeout: number }) => number };

function nextSlice(cb: (d: Deadline) => void): void {
  const host = globalThis as IdleHost;
  if (typeof host.requestIdleCallback === "function") {
    host.requestIdleCallback(cb, { timeout: 250 });
    return;
  }
  setTimeout(() => {
    const end = performance.now() + FALLBACK_SLICE_MS;
    cb({ timeRemaining: () => Math.max(0, end - performance.now()) });
  }, 0);
}

function monteCarloIdle(sample: readonly number[], opts: MonteCarloOptions, signal?: AbortSignal): Promise<MonteCarloResult> {
  const engine = createMonteCarlo(sample, opts);
  return new Promise((resolve, reject) => {
    const slice = (d: Deadline) => {
      if (signal?.aborted) return reject(abortError());
      // at least one batch per slice, so a busy page still makes progress
      let finished = engine.step(IDLE_BATCH);
      while (!finished && d.timeRemaining() > 1) finished = engine.step(IDLE_BATCH);
      if (finished) resolve(engine.result());
      else nextSlice(slice);
    };
    if (engine.runs === 0) resolve(engine.result());
    else nextSlice(slice);
  });
}

// ── public API ──────────────────────────────────────────────────────────────────────────────────────────────────

/** `monteCarlo` off the main thread (worker) or in idle chunks; same result either way. */
export async function runMonteCarlo(sample: readonly number[], opts: MonteCarloOptions = {}, run: RunOptions = {}): Promise<MonteCarloResult> {
  if (run.signal?.aborted) throw abortError();
  if (run.mode !== "idle" && workerAllowed()) {
    try {
      const res = await viaWorker({ kind: "mc", sample: [...sample], opts }, run.signal);
      if (res.kind === "mc") return res.result;
    } catch (e) {
      if (isAbort(e)) throw e;
      // worker unavailable / failed → idle chunks below
    }
  }
  return monteCarloIdle(sample, opts, run.signal);
}

/** `riskOfRuin` off the main thread (worker) or in one idle slice. */
export async function runRiskOfRuin(input: RiskOfRuinInput, opts: { runs?: number; trades?: number; seed?: number } = {}, run: RunOptions = {}): Promise<RiskOfRuinResult> {
  if (run.signal?.aborted) throw abortError();
  if (run.mode !== "idle" && workerAllowed()) {
    try {
      const res = await viaWorker({ kind: "ror", input: { ...input, sample: input.sample ? [...input.sample] : undefined }, opts }, run.signal);
      if (res.kind === "ror") return res.result;
    } catch (e) {
      if (isAbort(e)) throw e;
    }
  }
  return new Promise((resolve, reject) =>
    nextSlice(() => {
      if (run.signal?.aborted) reject(abortError());
      else resolve(riskOfRuin(input, opts));
    }),
  );
}

/** Test hook: forget the shared worker (and a recorded failure). */
export function __resetMcRunner(): void {
  failWorker();
  workerBroken = false;
}
