/**
 * Runs the optimiser without blocking the page and without burning the battery:
 * - web builds: a fresh inline module worker per run (`evolve.worker.ts`, `?worker&inline`);
 * - single-file builds, `file:` pages, browsers without `Worker`, or a worker that cannot start: the same host on the main
 *   thread in tiny slices (8 ms, duty ≤ 0.35) so no frame waits on it.
 * Pause, resume, stop and abort are messages; the throttle (tab hidden, low battery, data saver, phone, the user's power
 * choice) is recomputed when the environment changes and sent as a message. It runs ONLY while the page is open: closing the tab
 * ends it (a worker lives as long as its page), and nothing is scheduled for later.
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import type { Power } from "./config";
import { readThrottleEnv, watchEnvironment } from "./environment";
import { createEvolveHost, type EvolveRequest, type EvolveResponse, type RunState } from "./host";
import { throttleFor, type Throttle } from "./throttle";
import type { LogEntry, MultiInput, MultiResult, MultiSnapshot } from "./types";

export interface RunHandlers {
  onProgress(snap: MultiSnapshot, entries: LogEntry[]): void;
  onState?(s: RunState): void;
  onThrottle?(t: Throttle): void;
}

export type EvolveOutcome = { kind: "done"; result: MultiResult; snap: MultiSnapshot } | { kind: "aborted" } | { kind: "error"; message: string };

export interface EvolveRun {
  pause(): void;
  resume(): void;
  /** end the search now; the finalists are still checked and the proposals delivered */
  stop(): void;
  /** throw everything away */
  abort(): void;
  setPower(p: Power): void;
  readonly via: "worker" | "inline";
  readonly done: Promise<EvolveOutcome>;
}

export interface RunOptions {
  power?: Power;
  /** `inline` forces the main-thread path (tests, single-file builds) */
  mode?: "auto" | "inline";
}

/** Slice and duty on the main thread: small enough to stay out of the way of a frame. */
const INLINE_SLICE_MS = 8;
const INLINE_MAX_DUTY = 0.35;

export const evolveWorkerAllowed = (): boolean => typeof Worker !== "undefined" && !IS_FILE_BUILD && !isFileProtocol();

interface Transport {
  send(m: EvolveRequest): void;
  close(): void;
}

export function startEvolve(input: MultiInput, h: RunHandlers, o: RunOptions = {}): EvolveRun {
  let power: Power = o.power ?? "normal";
  let resolve!: (v: EvolveOutcome) => void;
  const done = new Promise<EvolveOutcome>((r) => (resolve = r));
  let transport: Transport | null = null;
  let via: "worker" | "inline" = "inline";
  let settled = false;
  const pending: EvolveRequest[] = [];

  const finish = (v: EvolveOutcome): void => {
    if (settled) return;
    settled = true;
    unwatch();
    transport?.close();
    resolve(v);
  };

  const onMessage = (m: EvolveResponse): void => {
    if (settled) return;
    if (m.kind === "progress") h.onProgress(m.snap, m.entries);
    else if (m.kind === "state") {
      h.onState?.(m.state);
      if (m.state === "aborted") finish({ kind: "aborted" });
    } else if (m.kind === "done") {
      h.onProgress(m.snap, m.entries);
      finish({ kind: "done", result: m.result, snap: m.snap });
    } else finish({ kind: "error", message: m.message });
  };

  const throttleNow = (): Throttle => {
    const t = throttleFor(readThrottleEnv(power));
    return via === "inline" ? { ...t, sliceMs: INLINE_SLICE_MS, duty: Math.min(t.duty, INLINE_MAX_DUTY) } : t;
  };

  const send = (m: EvolveRequest): void => {
    if (settled) return;
    if (transport) transport.send(m);
    else pending.push(m);
  };

  const unwatch = watchEnvironment(() => {
    const t = throttleNow();
    h.onThrottle?.(t);
    send({ kind: "throttle", throttle: t });
  });

  const startInline = (): void => {
    via = "inline";
    const host = createEvolveHost({
      post: (m) => queueMicrotask(() => onMessage(m)),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      now: () => performance.now(),
      wall: () => Date.now(),
    });
    transport = { send: (m) => host.handle(m), close: () => host.handle({ kind: "abort" }) };
    begin();
  };

  const begin = (): void => {
    const t = throttleNow();
    h.onThrottle?.(t);
    transport!.send({ kind: "start", input, throttle: t });
    for (const m of pending.splice(0)) transport!.send(m);
  };

  const startWorker = async (): Promise<void> => {
    let W: new (opts?: { name?: string }) => Worker;
    try {
      W = (await import("./evolve.worker?worker&inline")).default;
    } catch {
      startInline();
      return;
    }
    if (settled) return;
    let w: Worker;
    try {
      w = new W({ name: "tj-optimierer" });
    } catch {
      startInline();
      return;
    }
    via = "worker";
    w.onmessage = (e: MessageEvent<EvolveResponse>) => onMessage(e.data);
    w.onerror = () => finish({ kind: "error", message: "Der Hintergrund-Rechner ist abgestürzt. Starte den Optimierer noch einmal." });
    transport = {
      send: (m) => w.postMessage(m),
      close: () => {
        try {
          w.terminate();
        } catch {
          /* gone */
        }
      },
    };
    begin();
  };

  if (o.mode !== "inline" && evolveWorkerAllowed()) void startWorker();
  else startInline();

  return {
    pause: () => send({ kind: "pause" }),
    resume: () => send({ kind: "resume" }),
    stop: () => send({ kind: "stop" }),
    abort: () => {
      if (settled) return;
      // a worker is terminated at once; the inline host is told
      send({ kind: "abort" });
      finish({ kind: "aborted" });
    },
    setPower(p) {
      power = p;
      const t = throttleNow();
      h.onThrottle?.(t);
      send({ kind: "throttle", throttle: t });
    },
    get via() {
      return via;
    },
    done,
  };
}
