/**
 * Runs the Zeitmaschine for the card: the plan and candles of the props → `runTimeMachineFull` (worker, else slices on the main
 * thread) with progress and abort. A changed plan or option aborts the run in flight and – with `autoStart` – starts the next
 * after a short beat; without it the result on screen is marked as outdated until the button is pressed.
 *
 * Saving (A3): every finished run becomes a `SimulationRecord` (id, seed, model version, data hash, costs, size, figures) in the
 * simulation store (IndexedDB; the cloud only while signed in). Before a run starts, the store is asked for the SAME simulation
 * (same id = same plan, options, seed, costs, candles, model, trade): a hit is shown at once, nothing is recomputed – a reload
 * or a restart gives the same simulation back. „Neu rechnen“ always computes again and says whether the figures came out equal.
 * Every simulated path (for the canvas mode) comes with a fresh run; a restored simulation computes them on demand, same seed.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTmAbort, runTimeMachineFull, type TmPaths, type TmPhase, type TmResult } from "@/domain/timemachine";
import { dataHashOf } from "@/domain/timemachine/hash";
import { buildRecord, sameFigures, simulationIdOf, type SimulationRecord } from "@/domain/timemachine/record";
import { rememberTimeMachine } from "./lastResult";
import { inputOf, runKey } from "./model";
import { simulations } from "./simulations";
import type { TimeMachineProps } from "./types";

export type RunStatus = "idle" | "running" | "done" | "cancelled" | "error" | "invalid";
export type PathsStatus = "none" | "loading" | "ready" | "error";

export interface TimeMachineRun {
  status: RunStatus;
  progress: number;
  phase: TmPhase | null;
  result: TmResult | null;
  /** German reason: why the plan cannot run (`invalid`) or why the run failed (`error`) */
  reason: string | null;
  /** the result on screen was computed for an older plan / options */
  stale: boolean;
  /** every simulated path of the result on screen (canvas mode); `null` until computed */
  paths: TmPaths | null;
  pathsStatus: PathsStatus;
  /** the saved record of the result on screen (`null` before it was saved / when saving is off) */
  record: SimulationRecord | null;
  /** the result on screen was loaded from the store, not computed in this visit */
  restored: boolean;
  /** a recomputation against the saved record: same figures or not (`null` = not compared) */
  check: "same" | "differs" | null;
  /** the store keeps records across a reload (IndexedDB) */
  persistent: boolean;
  saveError: string | null;
  start(): void;
  cancel(): void;
  loadPaths(): void;
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
  paths: TmPaths | null;
  pathsStatus: PathsStatus;
  record: SimulationRecord | null;
  restored: boolean;
  check: "same" | "differs" | null;
  persistent: boolean;
  saveError: string | null;
}

const INITIAL: State = { status: "idle", progress: 0, phase: null, result: null, resultKey: null, error: null, runningKey: null, paths: null, pathsStatus: "none", record: null, restored: false, check: null, persistent: true, saveError: null };

export function useTimeMachine(props: TimeMachineProps): TimeMachineRun {
  const autoStart = props.autoStart !== false;
  const persist = props.persist !== false;
  const tradeId = props.tradeId ?? null;
  const key = runKey(props) + (tradeId ? `|${tradeId}` : "");
  const prepared = useMemo(
    () => inputOf(props),
    // `key` covers every field `inputOf` reads (the candles by their first / last / count)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  // the id this plan, with these candles, would get – a saved simulation with it is the same simulation
  const expectedId = useMemo(() => (prepared.ok && persist ? simulationIdOf(prepared.input, dataHashOf(prepared.input.bars), tradeId) : null), [prepared, persist, tradeId]);
  const [state, setState] = useState<State>(INITIAL);
  const ctl = useRef<AbortController | null>(null);
  const pathsCtl = useRef<AbortController | null>(null);
  const source = props.source ?? null;
  const fetchedAt = props.fetchedAt ?? null;
  const latest = useRef({ prepared, key, source, fetchedAt, tradeId, persist, expectedId });
  // the run that starts later (after the beat, or from the button) reads the plan of the LAST commit
  useLayoutEffect(() => {
    latest.current = { prepared, key, source, fetchedAt, tradeId, persist, expectedId };
  });

  const start = useCallback(() => {
    const { prepared: p, key: k, source: src, fetchedAt: at, tradeId: tid, persist: keep } = latest.current;
    ctl.current?.abort();
    // the paths of the old result are no longer wanted: forget the request so its late answer is ignored
    pathsCtl.current?.abort();
    pathsCtl.current = null;
    if (!p.ok) {
      ctl.current = null;
      setState((s) => ({ ...s, status: "idle", progress: 0, phase: null, runningKey: null }));
      return;
    }
    const mine = new AbortController();
    ctl.current = mine;
    setState((s) => ({ ...s, status: "running", progress: 0, phase: "pool", error: null, runningKey: k }));
    runTimeMachineFull(p.input, {
      signal: mine.signal,
      withPaths: true,
      onProgress: (progress, phase) => {
        if (ctl.current === mine) setState((s) => (s.status === "running" ? { ...s, progress, phase } : s));
      },
    }).then(
      ({ result, paths }) => {
        if (ctl.current !== mine) return;
        ctl.current = null;
        rememberTimeMachine({ result, at: Date.now(), source: src });
        const record = keep ? buildRecord(p.input, result, { tradeId: tid, source: src, fetchedAt: at }) : null;
        setState((s) => {
          // the same simulation as the one on screen / in the store: do the figures agree?
          const before = s.record && record && s.record.simulationId === record.simulationId ? s.record : null;
          return { ...s, status: "done", progress: 1, phase: "done", result, resultKey: k, error: null, runningKey: null, paths, pathsStatus: paths ? "ready" : "none", record, restored: false, check: before ? (sameFigures(before, result) ? "same" : "differs") : null, saveError: null };
        });
        if (record) {
          void simulations()
            .save(record)
            .then((r) => {
              if (ctl.current && ctl.current !== mine) return;
              setState((s) => (s.record?.simulationId === record.simulationId ? (r.ok ? { ...s, record: { ...r.record, result: s.record.result }, persistent: r.persistent, saveError: null } : { ...s, saveError: r.message }) : s));
            });
        }
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

  /** The paths of a restored simulation: the same run again (same seed, same candles); also checks the figures against the record. */
  const loadPaths = useCallback(() => {
    const { prepared: p, key: k } = latest.current;
    if (!p.ok || pathsCtl.current) return;
    const mine = new AbortController();
    pathsCtl.current = mine;
    setState((s) => ({ ...s, pathsStatus: "loading" }));
    runTimeMachineFull(p.input, { signal: mine.signal, withPaths: true }).then(
      ({ result, paths }) => {
        if (pathsCtl.current !== mine) return;
        pathsCtl.current = null;
        setState((s) => (s.resultKey === k ? { ...s, paths, pathsStatus: paths ? "ready" : "error", check: s.record ? (sameFigures(s.record, result) ? "same" : "differs") : s.check } : s));
      },
      () => {
        if (pathsCtl.current !== mine) return;
        pathsCtl.current = null;
        setState((s) => ({ ...s, pathsStatus: "error" }));
      },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        const { expectedId: id, persist: keep } = latest.current;
        let hit: SimulationRecord | null = null;
        if (keep && id) {
          try {
            const r = await simulations().get(id);
            hit = r?.result ? r : null;
          } catch {
            hit = null;
          }
        }
        if (cancelled) return;
        if (hit?.result) {
          const k = latest.current.key;
          rememberTimeMachine({ result: hit.result, at: Date.parse(hit.createdAt) || Date.now(), source: hit.source });
          setState((s) => ({ ...s, status: "done", progress: 1, phase: "done", result: hit.result, resultKey: k, error: null, runningKey: null, paths: null, pathsStatus: "none", record: hit, restored: true, check: null, persistent: simulations().persistent, saveError: null }));
        } else if (autoStart) start();
      })();
    }, autoStart ? START_DELAY_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      // a run for the old plan is dropped without a trace (its late answer is ignored)
      const c = ctl.current;
      ctl.current = null;
      c?.abort();
      const pc = pathsCtl.current;
      pathsCtl.current = null;
      pc?.abort();
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
    paths: state.paths,
    pathsStatus: state.pathsStatus,
    record: state.record,
    restored: state.restored,
    check: state.check,
    persistent: state.persistent,
    saveError: state.saveError,
    start,
    cancel,
    loadPaths,
  };
}
