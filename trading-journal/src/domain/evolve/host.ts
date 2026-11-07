/**
 * The message protocol and the driver of a run (pure apart from the injected timer): the SAME code runs inside the Web Worker
 * (`evolve.worker.ts`) and, where there is no worker (single-file build, `file:`, old browser, a worker that failed), on the
 * main thread in short slices (`runner.ts`) – identical results either way.
 *
 *   page ─▶ host   start { input, throttle } · pause · resume · stop · abort · throttle { throttle }
 *   host ─▶ page   state { running | paused | stopping | aborted } · progress { snap, entries } · done { result, snap, entries } · error
 *
 * The driver works in slices of `throttle.sliceMs`; after each slice it rests so that busy time ÷ total time = `duty`
 * (`throttle.ts`). Between two slices the message queue is free, so pause / stop / throttle messages act within one slice.
 * Progress is posted at most every `PROGRESS_MS`. `stop` ends the SEARCH after the variant at hand – the check of the finalists
 * still runs and the proposals are delivered; `abort` throws everything away.
 */
import { EvolveMulti } from "./multi";
import { restAfter, type Throttle } from "./throttle";
import type { LogEntry, MultiInput, MultiResult, MultiSnapshot } from "./types";

export type EvolveRequest =
  | { kind: "start"; input: MultiInput; throttle: Throttle }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "stop" }
  | { kind: "abort" }
  | { kind: "throttle"; throttle: Throttle };

export type RunState = "running" | "paused" | "stopping" | "aborted";

export type EvolveResponse =
  | { kind: "state"; state: RunState }
  | { kind: "progress"; snap: MultiSnapshot; entries: LogEntry[] }
  | { kind: "done"; result: MultiResult; snap: MultiSnapshot; entries: LogEntry[] }
  | { kind: "error"; message: string };

export const PROGRESS_MS = 250;

export interface HostEnv {
  post(m: EvolveResponse): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
  /** monotonic ms (slice deadlines) */
  now(): number;
  /** wall clock ms (stamps the log entries) */
  wall(): number;
  /** test hook: another job factory */
  create?(input: MultiInput): EvolveMulti;
}

export interface Host {
  handle(m: EvolveRequest): void;
  /** the run is over or was aborted (nothing scheduled) */
  readonly idle: boolean;
}

export function createEvolveHost(env: HostEnv): Host {
  let multi: EvolveMulti | null = null;
  let state: "idle" | RunState | "done" = "idle";
  let timer: unknown;
  let th: Throttle = { duty: 0.6, sliceMs: 40, reason: null };
  let lastPost = -Infinity;

  const stamp = (es: LogEntry[]): LogEntry[] => {
    const at = env.wall();
    return es.map((e) => ({ ...e, at }));
  };
  const clear = (): void => {
    if (timer !== undefined) env.clearTimer(timer);
    timer = undefined;
  };
  const progress = (force = false): void => {
    if (!multi) return;
    const t = env.now();
    if (!force && t - lastPost < PROGRESS_MS) return;
    lastPost = t;
    env.post({ kind: "progress", snap: multi.snapshot(), entries: stamp(multi.drainEntries()) });
  };
  const schedule = (ms: number): void => {
    clear();
    timer = env.setTimer(tick, ms);
  };
  function tick(): void {
    timer = undefined;
    if (!multi || (state !== "running" && state !== "stopping")) return;
    try {
      const t0 = env.now();
      const finished = multi.step(t0 + th.sliceMs);
      const worked = env.now() - t0;
      if (finished) {
        const result = multi.result()!;
        const snap = multi.snapshot();
        state = "done";
        env.post({ kind: "done", result, snap, entries: stamp(multi.drainEntries()) });
        return;
      }
      progress();
      schedule(restAfter(worked, th.duty));
    } catch (e) {
      state = "done";
      env.post({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    get idle() {
      return state === "idle" || state === "done" || state === "aborted";
    },
    handle(m) {
      switch (m.kind) {
        case "start":
          clear();
          try {
            multi = env.create ? env.create(m.input) : new EvolveMulti(m.input);
          } catch (e) {
            state = "done";
            env.post({ kind: "error", message: e instanceof Error ? e.message : String(e) });
            return;
          }
          th = m.throttle;
          state = "running";
          lastPost = -Infinity;
          env.post({ kind: "state", state: "running" });
          schedule(0);
          return;
        case "pause":
          if (state !== "running" && state !== "stopping") return;
          clear();
          state = "paused";
          env.post({ kind: "state", state: "paused" });
          progress(true);
          return;
        case "resume":
          if (state !== "paused") return;
          state = multi && multi.snapshot().phase === "stopping" ? "stopping" : "running";
          env.post({ kind: "state", state: state === "stopping" ? "stopping" : "running" });
          schedule(0);
          return;
        case "stop":
          if (!multi || state === "idle" || state === "done" || state === "aborted") return;
          multi.requestStop();
          if (state === "paused" || state === "running") {
            state = "stopping";
            env.post({ kind: "state", state: "stopping" });
            schedule(0);
          }
          return;
        case "abort":
          clear();
          multi = null;
          state = "aborted";
          env.post({ kind: "state", state: "aborted" });
          return;
        case "throttle":
          th = m.throttle;
          return;
      }
    },
  };
}
