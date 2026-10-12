/**
 * Runs a lab job without blocking the page (P07):
 * - web builds: a fresh inline module worker per run (`lab.worker.ts`, `?worker&inline` – no extra file); cancelling
 *   terminates it at once;
 * - single-file builds, `file:` pages, browsers without `Worker`, or a worker that fails to start / crashes: the same
 *   job (`createLabJob`) in idle chunks (`requestIdleCallback`, else 8 ms timer slices), so no frame waits on it.
 * Identical results either way (the job is deterministic). Progress is reported at most once per slice.
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { createLabJob, type LabJobInput, type LabPhase, type LabResult } from "./job";
import type { LabRequest, LabResponse } from "./labProtocol";

export type LabRunMode = "auto" | "idle";

export interface LabRunOptions {
  signal?: AbortSignal;
  mode?: LabRunMode;
  onProgress?: (progress: number, phase: LabPhase) => void;
}

const FALLBACK_SLICE_MS = 8;
/** A worker that sends nothing for this long is given up (fallback to idle chunks). */
export const LAB_WORKER_SILENCE_MS = 20_000;

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });
export const isLabAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

let workerBroken = false;
let seq = 0;

export function labWorkerAllowed(): boolean {
  return !workerBroken && typeof Worker !== "undefined" && !IS_FILE_BUILD && !isFileProtocol();
}

class WorkerFailed extends Error {}

async function viaWorker(input: LabJobInput, o: LabRunOptions): Promise<LabResult> {
  let W: new (opts?: { name?: string }) => Worker;
  try {
    W = (await import("./lab.worker?worker&inline")).default;
  } catch {
    workerBroken = true;
    throw new WorkerFailed("no worker");
  }
  if (o.signal?.aborted) throw abortError();
  return new Promise<LabResult>((resolve, reject) => {
    let w: Worker;
    try {
      w = new W({ name: "tj-labor" });
    } catch {
      workerBroken = true;
      reject(new WorkerFailed("worker could not start"));
      return;
    }
    const id = ++seq;
    let silence: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(silence);
      o.signal?.removeEventListener("abort", onAbort);
      try {
        w.terminate();
      } catch {
        /* gone */
      }
      fn();
    };
    const arm = () => {
      clearTimeout(silence);
      silence = setTimeout(() => done(() => reject(new WorkerFailed("silent"))), LAB_WORKER_SILENCE_MS);
    };
    const onAbort = () => done(() => reject(abortError()));
    o.signal?.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<LabResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      arm();
      if (m.kind === "progress") o.onProgress?.(m.progress, m.phase);
      else if (m.kind === "done") done(() => resolve(m.result));
      else done(() => reject(new Error(m.message)));
    };
    w.onerror = () => {
      workerBroken = true;
      done(() => reject(new WorkerFailed("worker error")));
    };
    arm();
    const msg: LabRequest = { kind: "run", id, input };
    w.postMessage(msg);
  });
}

type Deadline = { timeRemaining(): number };
type IdleHost = { requestIdleCallback?: (cb: (d: Deadline) => void, o?: { timeout: number }) => number };

function nextSlice(cb: (deadlineMs: number) => void): void {
  const host = globalThis as IdleHost;
  if (typeof host.requestIdleCallback === "function") {
    host.requestIdleCallback((d) => cb(performance.now() + Math.max(4, d.timeRemaining() - 1)), { timeout: 200 });
    return;
  }
  setTimeout(() => cb(performance.now() + FALLBACK_SLICE_MS), 0);
}

/** The job in idle chunks on the main thread. */
export function runLabIdle(input: LabJobInput, o: LabRunOptions = {}): Promise<LabResult> {
  const job = createLabJob(input);
  return new Promise((resolve, reject) => {
    const slice = (deadline: number) => {
      if (o.signal?.aborted) return reject(abortError());
      let finished: boolean;
      try {
        finished = job.step(deadline);
      } catch (e) {
        return reject(e instanceof Error ? e : new Error(String(e)));
      }
      if (finished) return resolve(job.result());
      o.onProgress?.(job.progress(), job.phase());
      nextSlice(slice);
    };
    nextSlice(slice);
  });
}

/** Runs the lab job: worker when allowed, else (or when the worker fails) idle chunks. */
export async function runLab(input: LabJobInput, o: LabRunOptions = {}): Promise<LabResult> {
  if (o.signal?.aborted) throw abortError();
  if (o.mode !== "idle" && labWorkerAllowed()) {
    try {
      return await viaWorker(input, o);
    } catch (e) {
      if (isLabAbort(e)) throw e;
      if (!(e instanceof WorkerFailed)) throw e;
      // worker unavailable → idle chunks below
    }
  }
  return runLabIdle(input, o);
}

/** Test hook: forget a recorded worker failure. */
export function __resetLabRunner(): void {
  workerBroken = false;
}
