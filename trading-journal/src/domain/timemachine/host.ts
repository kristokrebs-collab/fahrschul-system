/**
 * Message protocol and driver of a Zeitmaschine run (pure apart from the injected timer): the SAME code runs inside the Web
 * Worker (`tm.worker.ts`) and, where there is no worker (single-file build, `file:`, old browser, a worker that failed), on the
 * main thread in short slices (`tmRunner.ts`) – identical results either way.
 *
 *   page ─▶ host   run { input, slice } · abort
 *   host ─▶ page   progress { progress, phase } · done { result } · error { message } · aborted
 *
 * The driver works in slices of `slice.workMs`, then rests `slice.restMs` (so a phone is never kept at full load and the
 * message queue is free: an `abort` acts within one slice). Progress is posted at most every `PROGRESS_MS`.
 */
import { createTmJob, type TmJob } from "./job";
import type { TmInput, TmPhase, TmResult } from "./types";

export interface TmSlice {
  workMs: number;
  restMs: number;
}

/** Desktop: long slices, no rest. Phones / coarse pointers: short slices with a rest (the page chooses). */
export const SLICE_DESKTOP: TmSlice = { workMs: 40, restMs: 0 };
export const SLICE_MOBILE: TmSlice = { workMs: 14, restMs: 6 };
export const PROGRESS_MS = 120;

export type TmRequest = { kind: "run"; input: TmInput; slice: TmSlice } | { kind: "abort" };

export type TmResponse = { kind: "progress"; progress: number; phase: TmPhase } | { kind: "done"; result: TmResult } | { kind: "error"; message: string } | { kind: "aborted" };

export interface TmHostEnv {
  post(m: TmResponse): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
  /** monotonic ms */
  now(): number;
  /** test hook: another job factory */
  create?(input: TmInput): TmJob;
}

export interface TmHost {
  handle(m: TmRequest): void;
  readonly idle: boolean;
}

export function createTmHost(env: TmHostEnv): TmHost {
  let job: TmJob | null = null;
  let state: "idle" | "running" | "done" | "aborted" = "idle";
  let timer: unknown;
  let slice: TmSlice = SLICE_DESKTOP;
  let lastPost = -Infinity;

  const clear = (): void => {
    if (timer !== undefined) env.clearTimer(timer);
    timer = undefined;
  };
  const tick = (): void => {
    timer = undefined;
    if (!job || state !== "running") return;
    try {
      const t0 = env.now();
      const finished = job.step(t0 + slice.workMs);
      if (finished) {
        state = "done";
        env.post({ kind: "done", result: job.result()! });
        return;
      }
      const t = env.now();
      if (t - lastPost >= PROGRESS_MS) {
        lastPost = t;
        env.post({ kind: "progress", progress: job.progress(), phase: job.phase() });
      }
      timer = env.setTimer(tick, slice.restMs);
    } catch (e) {
      state = "done";
      env.post({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
    get idle() {
      return state !== "running";
    },
    handle(m) {
      if (m.kind === "abort") {
        if (state === "running") {
          clear();
          state = "aborted";
          env.post({ kind: "aborted" });
        }
        return;
      }
      clear();
      try {
        job = env.create ? env.create(m.input) : createTmJob(m.input);
      } catch (e) {
        state = "done";
        env.post({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      slice = { workMs: Math.max(4, m.slice.workMs), restMs: Math.max(0, m.slice.restMs) };
      state = "running";
      lastPost = -Infinity;
      timer = env.setTimer(tick, 0);
    },
  };
}
