/**
 * Runs the Zeitmaschine for the card: the plan and candles of the props → `runTimeMachine` (worker, else slices on the main
 * thread) with progress and abort. A changed plan or option aborts the run in flight and – with `autoStart` – starts the next
 * after a short beat; without it the result on screen is marked as outdated until the button is pressed.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTmAbort, runTimeMachine, type TmPhase, type TmResult } from "@/domain/timemachine";
import { rememberTimeMachine } from "./lastResult";
import { inputOf, runKey } from "./model";
import type { TimeMachineProps } from "./types";

export type RunStatus = "idle" | "running" | "done" | "cancelled" | "error" | "invalid";

export interface TimeMachineRun {
  status: RunStatus;
  progress: number;
  phase: TmPhase | null;
  result: TmResult | null;
  /** German reason: why the plan cannot run (`invalid`) or why the run failed (`error`) */
  reason: string | null;
  /** the result on screen was computed for an older plan / options */
  stale: boolean;
  start(): void;
  cancel(): void;
}

/** Beat between the last change of the plan and the start of the next run (typing a price does not start ten runs). */
export const START_DELAY_MS = 250;

interface State {
  status: RunStatus;
  progress: number;
  phase: TmPhase | null;
  result: TmResult | null;
  /** `runKey` the result was computed for */
  resultKey: string | null;
  error: string | null;
  /** `runKey` of the run in flight */
  runningKey: string | null;
}

const INITIAL: State = { status: "idle", progress: 0, phase: null, result: null, resultKey: null, error: null, runningKey: null };

export function useTimeMachine(props: TimeMachineProps): TimeMachineRun {
  const autoStart = props.autoStart !== false;
  const key = runKey(props);
  const prepared = useMemo(
    () => inputOf(props),
    // `key` covers every field `inputOf` reads (the candles by their first / last / count)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const [state, setState] = useState<State>(INITIAL);
  const ctl = useRef<AbortController | null>(null);
  const source = props.source ?? null;
  const latest = useRef({ prepared, key, source });
  // the run that starts later (after the beat, or from the button) reads the plan of the LAST commit
  useLayoutEffect(() => {
    latest.current = { prepared, key, source };
  });

  const start = useCallback(() => {
    const { prepared: p, key: k, source: src } = latest.current;
    ctl.current?.abort();
    if (!p.ok) {
      ctl.current = null;
      setState((s) => ({ ...s, status: "idle", progress: 0, phase: null, runningKey: null }));
      return;
    }
    const mine = new AbortController();
    ctl.current = mine;
    setState((s) => ({ ...s, status: "running", progress: 0, phase: "pool", error: null, runningKey: k }));
    runTimeMachine(p.input, {
      signal: mine.signal,
      onProgress: (progress, phase) => {
        if (ctl.current === mine) setState((s) => (s.status === "running" ? { ...s, progress, phase } : s));
      },
    }).then(
      (result) => {
        if (ctl.current !== mine) return;
        ctl.current = null;
        rememberTimeMachine({ result, at: Date.now(), source: src });
        setState({ status: "done", progress: 1, phase: "done", result, resultKey: k, error: null, runningKey: null });
      },
      (e: unknown) => {
        if (ctl.current !== mine) return;
        ctl.current = null;
        if (isTmAbort(e)) setState((s) => ({ ...s, status: "cancelled", progress: 0, phase: null, runningKey: null }));
        else setState((s) => ({ ...s, status: "error", progress: 0, phase: null, error: e instanceof Error ? e.message : "Die Rechnung ist fehlgeschlagen.", runningKey: null }));
      },
    );
  }, []);

  const cancel = useCallback(() => {
    ctl.current?.abort();
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    const t = setTimeout(start, START_DELAY_MS);
    return () => {
      clearTimeout(t);
      // a run for the old plan is dropped without a trace (its late answer is ignored)
      const c = ctl.current;
      ctl.current = null;
      c?.abort();
    };
  }, [key, autoStart, start]);

  const invalid = !prepared.ok ? prepared.why : null;
  // a run for another plan than the one on screen no longer counts as running (the next one starts after the beat)
  const running = state.status === "running" && state.runningKey === key;
  const status: RunStatus = invalid ? "invalid" : running ? "running" : state.status === "running" ? "idle" : state.status;
  return {
    status,
    progress: running ? state.progress : 0,
    phase: running ? state.phase : null,
    result: state.result,
    reason: invalid ?? state.error,
    stale: state.result != null && state.resultKey !== key,
    start,
    cancel,
  };
}
