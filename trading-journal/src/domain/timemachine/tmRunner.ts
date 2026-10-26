/**
 * Runs a Zeitmaschine job without blocking the page:
 * - web builds: a fresh inline module worker per run (`tm.worker.ts`, `?worker&inline` – no extra file); aborting terminates it
 *   at once;
 * - single-file builds, `file:` pages, browsers without `Worker`, or a worker that fails to start / crashes / falls silent: the
 *   same host (`host.ts`) on the main thread in short slices with rests, so no frame waits on it.
 * Identical results either way (the job is deterministic and its runs are seeded one by one). Progress is reported per slice.
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { createTmHost, SLICE_DESKTOP, SLICE_MOBILE, type TmRequest, type TmResponse, type TmSlice } from "./host";
import type { TmInput, TmPhase, TmResult } from "./types";

export type TmRunMode = "auto" | "idle";

export interface TmRunOptions {
  signal?: AbortSignal;
  mode?: TmRunMode;
  /** slices of the work; default: short ones on phones / coarse pointers */
  slice?: TmSlice;
  onProgress?: (progress: number, phase: TmPhase) => void;
}

/** A worker that sends nothing for this long is given up (the run continues on the main thread). */
export const TM_WORKER_SILENCE_MS = 20_000;

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });
export const isTmAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

let workerBroken = false;

export function tmWorkerAllowed(): boolean {
  return !workerBroken && typeof Worker !== "undefined" && !IS_FILE_BUILD && !isFileProtocol();
}

/** Short slices with rests on phones and coarse pointers (the page stays smooth and the battery calm), long ones elsewhere. */
export function sliceForDevice(): TmSlice {
  try {
    const mobile = typeof matchMedia === "function" && (matchMedia("(pointer: coarse)").matches || matchMedia("(max-width: 767px)").matches);
    return mobile ? SLICE_MOBILE : SLICE_DESKTOP;
  } catch {
    return SLICE_DESKTOP;
  }
}

class WorkerFailed extends Error {}

async function viaWorker(input: TmInput, slice: TmSlice, o: TmRunOptions): Promise<TmResult> {
  let W: new (opts?: { name?: string }) => Worker;
  try {
    W = (await import("./tm.worker?worker&inline")).default;
  } catch {
    workerBroken = true;
    throw new WorkerFailed("no worker");
  }
  if (o.signal?.aborted) throw abortError();
  return new Promise<TmResult>((resolve, reject) => {
    let w: Worker;
    try {
      w = new W({ name: "tj-zeitmaschine" });
    } catch {
      workerBroken = true;
      reject(new WorkerFailed("worker could not start"));
      return;
    }
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
      silence = setTimeout(() => done(() => reject(new WorkerFailed("silent"))), TM_WORKER_SILENCE_MS);
    };
    const onAbort = () => done(() => reject(abortError()));
    o.signal?.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<TmResponse>) => {
      const m = e.data;
      arm();
      if (m.kind === "progress") o.onProgress?.(m.progress, m.phase);
      else if (m.kind === "done") done(() => resolve(m.result));
      else if (m.kind === "aborted") done(() => reject(abortError()));
      else done(() => reject(new Error(m.message)));
    };
    w.onerror = () => {
      workerBroken = true;
      done(() => reject(new WorkerFailed("worker error")));
    };
    arm();
    const msg: TmRequest = { kind: "run", input, slice };
    w.postMessage(msg);
  });
}

/** The host on the main thread (timers instead of a worker loop). */
export function runTimeMachineIdle(input: TmInput, o: TmRunOptions = {}): Promise<TmResult> {
  return new Promise<TmResult>((resolve, reject) => {
    if (o.signal?.aborted) return reject(abortError());
    let host: ReturnType<typeof createTmHost> | null = null;
    const finish = (fn: () => void) => {
      o.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      host?.handle({ kind: "abort" });
      finish(() => reject(abortError()));
    };
    o.signal?.addEventListener("abort", onAbort, { once: true });
    host = createTmHost({
      post: (m) => {
        if (m.kind === "progress") o.onProgress?.(m.progress, m.phase);
        else if (m.kind === "done") finish(() => resolve(m.result));
        else if (m.kind === "error") finish(() => reject(new Error(m.message)));
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => performance.now(),
    });
    // on the main thread the rest between slices is never zero: a frame must be able to paint
    const base = o.slice ?? sliceForDevice();
    host.handle({ kind: "run", input, slice: { workMs: Math.min(base.workMs, 12), restMs: Math.max(base.restMs, 4) } });
  });
}

/** Worker when allowed, else (or when the worker fails) slices on the main thread. */
export async function runTimeMachine(input: TmInput, o: TmRunOptions = {}): Promise<TmResult> {
  if (o.signal?.aborted) throw abortError();
  if (o.mode !== "idle" && tmWorkerAllowed()) {
    try {
      return await viaWorker(input, o.slice ?? sliceForDevice(), o);
    } catch (e) {
      if (isTmAbort(e)) throw e;
      if (!(e instanceof WorkerFailed)) throw e;
      // worker unavailable → the main-thread host below
    }
  }
  return runTimeMachineIdle(input, o);
}

/** Test hook: forget a recorded worker failure. */
export function __resetTmRunner(): void {
  workerBroken = false;
}
