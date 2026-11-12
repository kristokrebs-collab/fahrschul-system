/**
 * „Börsenhistorie nachladen“ (F26/F07) – the controller the card talks to: starts ONE run at a time, keeps its progress in
 * a small store the card subscribes to (the run goes on while the user looks at another page of the settings), cancels on
 * request, and writes the finished run into the log (`./backfillLog`).
 *
 * A run opens its own connection to the archive database and closes it at the end; it bumps the archive's `rev` so the
 * overview reloads.
 */
import { useSyncExternalStore } from "react";
import type { BackfillRun } from "@/domain/archive";
import { defaultBackfillDeps, runBackfill, type BackfillDeps, type BackfillProgress } from "./backfill";
import { __resetBackfillLog, clearBackfillLog as clearLog, rememberBackfillRun } from "./backfillLog";
import { ArchiveUnavailable, openArchiveDb, type ArchiveDb } from "./db";
import { bumpArchiveRev } from "./store";

export interface BackfillState {
  phase: "idle" | "running";
  /** the newest report of the run that is going (or just ended) */
  progress: BackfillProgress | null;
  /** why a run could not even start (no IndexedDB …) */
  error: string | null;
  /** bumps when the log changed */
  logRev: number;
}

const IDLE: BackfillState = { phase: "idle", progress: null, error: null, logRev: 0 };
let state: BackfillState = IDLE;
let ctrl: AbortController | null = null;
const listeners = new Set<() => void>();

const emit = (patch: Partial<BackfillState>): void => {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
};

export const getBackfillState = (): BackfillState => state;
export function subscribeBackfill(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
export const useBackfillState = (): BackfillState => useSyncExternalStore(subscribeBackfill, getBackfillState, () => IDLE);

/** Forgets the log (the „Protokoll löschen“ of the card). */
export function clearBackfillLog(): void {
  clearLog();
  emit({ logRev: state.logRev + 1 });
}

export interface StartOverrides {
  open?: () => Promise<ArchiveDb>;
  deps?: (db: ArchiveDb, signal: AbortSignal) => BackfillDeps;
}

/** Starts a load (nothing happens while one is running). Resolves with the run, or `null` when it could not start. */
export async function startBackfill(symbols: readonly string[], days: number, over: StartOverrides = {}): Promise<BackfillRun | null> {
  if (ctrl) return null;
  const c = new AbortController();
  ctrl = c;
  emit({ phase: "running", progress: null, error: null });
  let db: ArchiveDb;
  try {
    db = await (over.open ?? openArchiveDb)();
  } catch (e) {
    ctrl = null;
    emit({ phase: "idle", error: e instanceof ArchiveUnavailable ? e.message : "Das Archiv kann in diesem Browser nicht gespeichert werden." });
    return null;
  }
  try {
    const deps = over.deps ? over.deps(db, c.signal) : defaultBackfillDeps(db, c.signal);
    const run = await runBackfill(deps, { symbols, days, signal: c.signal, onProgress: (progress) => emit({ progress }) });
    rememberBackfillRun(run);
    emit({ phase: "idle", logRev: state.logRev + 1 });
    return run;
  } finally {
    db.close();
    ctrl = null;
    bumpArchiveRev();
  }
}

/** Cancels the running load; what was stored before stays. */
export function cancelBackfill(): void {
  ctrl?.abort();
}

/** Tests: forget the in-memory copies. */
export function __resetBackfill(): void {
  ctrl?.abort();
  ctrl = null;
  state = IDLE;
  listeners.clear();
  __resetBackfillLog();
}
