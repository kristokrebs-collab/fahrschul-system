/**
 * Runs the pattern search without blocking the page:
 * - web builds: a fresh inline module worker per run (`discovery.worker.ts`); stopping terminates it at once;
 * - single-file builds, `file:` pages, browsers without `Worker`, or a worker that fails to start / crashes / stays silent:
 *   the same job in idle chunks (`requestIdleCallback`, else short timer slices) on the main thread.
 * Identical results either way (the job is deterministic). Progress is reported at most once per slice.
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { createDiscoveryJob } from "./job";
import type { DiscoveryRequest, DiscoveryResponse } from "./protocol";
import type { DiscoveryInput, DiscoveryResult } from "./types";

export interface DiscoveryRunOptions {
  signal?: AbortSignal;
  /** `idle` forces the main-thread fallback (tests, single file) */
  mode?: "auto" | "idle";
  onProgress?: (progress: number) => void;
}

/** A worker that sends nothing for this long is given up (fallback to idle chunks). */
export const DISCOVERY_WORKER_SILENCE_MS = 20_000;
const FALLBACK_SLICE_MS = 8;

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });
export const isDiscoveryAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

let workerBroken = false;
let seq = 0;

export function discoveryWorkerAllowed(): boolean {
  return !workerBroken && typeof Worker !== "undefined" && !IS_FILE_BUILD && !isFileProtocol();
}

class WorkerFailed extends Error {}

async function viaWorker(input: DiscoveryInput, o: DiscoveryRunOptions): Promise<DiscoveryResult> {
  let W: new (opts?: { name?: string }) => Worker;
  try {
    W = (await import("./discovery.worker?worker&inline")).default;
  } catch {
    workerBroken = true;
    throw new WorkerFailed("no worker");
  }
  if (o.signal?.aborted) throw abortError();
  return new Promise<DiscoveryResult>((resolve, reject) => {
    let w: Worker;
    try {
      w = new W({ name: "tj-muster" });
    } catch {
      workerBroken = true;
      reject(new WorkerFailed("worker could not start"));
      return;
    }
    const id = ++seq;
    let silence: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (fn: () => void): void => {
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
    const arm = (): void => {
      clearTimeout(silence);
      silence = setTimeout(() => done(() => reject(new WorkerFailed("silent"))), DISCOVERY_WORKER_SILENCE_MS);
    };
    const onAbort = (): void => done(() => reject(abortError()));
    o.signal?.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<DiscoveryResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      arm();
      if (m.kind === "progress") o.onProgress?.(m.progress);
      else if (m.kind === "done") done(() => resolve(m.result));
      else done(() => reject(new Error(m.message)));
    };
    w.onerror = () => {
      workerBroken = true;
      done(() => reject(new WorkerFailed("worker error")));
    };
    arm();
    const msg: DiscoveryRequest = { id, input };
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
export function runDiscoveryIdle(input: DiscoveryInput, o: DiscoveryRunOptions = {}): Promise<DiscoveryResult> {
  return new Promise((resolve, reject) => {
    let job: ReturnType<typeof createDiscoveryJob>;
    try {
      job = createDiscoveryJob(input);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const slice = (deadline: number): void => {
      if (o.signal?.aborted) return reject(abortError());
      let finished: boolean;
      try {
        finished = job.step(deadline);
      } catch (e) {
        return reject(e instanceof Error ? e : new Error(String(e)));
      }
      if (finished) return resolve(job.result());
      o.onProgress?.(job.progress());
      nextSlice(slice);
    };
    nextSlice(slice);
  });
}

/** Worker when allowed, else (or when the worker fails) idle chunks. */
export async function runDiscovery(input: DiscoveryInput, o: DiscoveryRunOptions = {}): Promise<DiscoveryResult> {
  if (o.signal?.aborted) throw abortError();
  if (o.mode !== "idle" && discoveryWorkerAllowed()) {
    try {
      return await viaWorker(input, o);
    } catch (e) {
      if (isDiscoveryAbort(e)) throw e;
      if (!(e instanceof WorkerFailed)) throw e;
      // worker unavailable → idle chunks below
    }
  }
  return runDiscoveryIdle(input, o);
}

/** Test hook: forget a recorded worker failure. */
export function __resetDiscoveryRunner(): void {
  workerBroken = false;
}
