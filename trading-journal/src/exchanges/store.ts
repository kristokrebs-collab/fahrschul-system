/**
 * Exchange state of the client (P11) – a light zustand store, no secrets. It mirrors the server (`/api/v1/exchange/*`)
 * and runs the flows: connect, manual sync (continues while the server says `more`), dry run, first import in the
 * background (polled), pull + local merge for devices without cloud sync, disconnect.
 *
 * Available only with a cloud (`cloudEnabled()`, not on claude.ai) and a signed-in session; otherwise every action is a
 * no-op and the UI shows the honest state. The CSV import (`csvOpen`) works in every build.
 */
import { create } from "zustand";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { hasClaudeRuntime } from "@/store/capability";
import { pushToast } from "@/store/uiStore";
import { connectExchange, disconnectExchange, fetchExchangeStatus, patchConnection, runExchangeSync, startBackfill } from "./api";
import { pullAndMerge, type PullOutcome } from "./localMerge";
import { CONNECT, EX } from "./strings";
import type { ConnectInput, ConnectResult, ExchangeConnection, ExchangeStatus, JournalAccount, SyncCounts, SyncResult, SyncRun } from "./types";

export type ExchangeBusy = "connect" | "sync" | "dry" | "backfill" | "disconnect" | "patch";

export interface UiError {
  code: string;
  message: string;
}

export interface BackfillJob {
  runId: string;
  connectionId: string;
  from: string;
  startedAt: number;
  run: SyncRun | null;
  done: boolean;
}

/** Outcome of the last sync / merge – drives the counters and the effects (`key` changes per outcome). */
export interface SyncOutcome {
  key: number;
  connectionId: string;
  counts: SyncCounts;
  merged: number;
  more: boolean;
  at: number;
}

export interface ExchangeState {
  status: ExchangeStatus | null;
  load: "idle" | "loading" | "ready" | "error";
  error: UiError | null;
  busy: ExchangeBusy | null;
  /** Per-connection error of the last action (sync / patch / disconnect). */
  actionError: UiError | null;
  outcome: SyncOutcome | null;
  dryRun: SyncResult | null;
  dryOpen: boolean;
  connectOpen: boolean;
  /** Reconnect of an invalid connection: the sheet replaces it after a successful connect. */
  replaceId: string | null;
  backfill: BackfillJob | null;
  csvOpen: boolean;
}

const INITIAL: ExchangeState = {
  status: null,
  load: "idle",
  error: null,
  busy: null,
  actionError: null,
  outcome: null,
  dryRun: null,
  dryOpen: false,
  connectOpen: false,
  replaceId: null,
  backfill: null,
  csvOpen: false,
};

export const useExchange = create<ExchangeState>()(() => ({ ...INITIAL }));

/** Tests. */
export function resetExchangeStore(): void {
  stopBackfillPolling();
  useExchange.setState({ ...INITIAL });
}

/** The build can talk to the exchange functions (cloud configured, not inside claude.ai). */
export function exchangeEnabled(): boolean {
  return cloudEnabled() && !hasClaudeRuntime();
}

const signedInUserId = (): string | null => {
  const s = useCloudSession.getState();
  return s.phase === "signedIn" ? (s.user?.id ?? null) : null;
};

/** German UI error of anything an API call can throw. */
export function toUiError(e: unknown): UiError {
  if (e instanceof ApiError) {
    if (e.status === 0) return { code: "unavailable", message: e.message || FUNCTIONS_MISSING };
    return { code: e.code, message: e.message };
  }
  return { code: "error", message: e instanceof Error && e.message ? e.message : "Das hat nicht geklappt. Bitte erneut versuchen." };
}

let seq = 0;

/* ------------------------------------------------------------------ status */

export async function loadExchangeStatus(): Promise<void> {
  if (!exchangeEnabled() || !signedInUserId()) {
    useExchange.setState({ status: null, load: "idle", error: null });
    return;
  }
  useExchange.setState((s) => ({ load: s.status ? s.load : "loading" }));
  try {
    const status = await fetchExchangeStatus();
    useExchange.setState({ status, load: "ready", error: null });
    followBackfill(status);
  } catch (e) {
    useExchange.setState({ load: "error", error: toUiError(e) });
  }
}

/** The connection a card shows (first non-revoked). */
export function primaryConnection(status: ExchangeStatus | null): ExchangeConnection | null {
  return status?.connections.find((c) => c.status !== "revoked") ?? null;
}

/* ------------------------------------------------------------------ connect */

export function openConnect(replaceId: string | null = null): void {
  useExchange.setState({ connectOpen: true, replaceId, actionError: null });
}

export function closeConnect(): void {
  useExchange.setState({ connectOpen: false });
}

export type ConnectOutcome = { ok: true; result: ConnectResult } | { ok: false; error: UiError };

export async function connectAccount(input: ConnectInput): Promise<ConnectOutcome> {
  useExchange.setState({ busy: "connect" });
  try {
    const replaceId = useExchange.getState().replaceId;
    if (replaceId) {
      // reconnect: the old (invalid) connection goes first so the label stays free; its trades stay in the journal
      await disconnectExchange(replaceId).catch(() => undefined);
    }
    const result = await connectExchange(input);
    useExchange.setState({ replaceId: null });
    await loadExchangeStatus();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: toUiError(e) };
  } finally {
    useExchange.setState({ busy: null });
  }
}

/* ------------------------------------------------------------------ sync */

const ZERO: SyncCounts = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
const addCounts = (a: SyncCounts, b: SyncCounts): SyncCounts => ({
  fetched: a.fetched + b.fetched,
  inserted: a.inserted + b.inserted,
  updated: a.updated + b.updated,
  unchanged: a.unchanged + b.unchanged,
  skipped: a.skipped + b.skipped,
});

/** Server → this device (no-op with live cloud sync); toasts what arrived. */
export async function pullNow(opts: { toast?: boolean } = {}): Promise<PullOutcome | null> {
  const uid = signedInUserId();
  if (!exchangeEnabled() || !uid) return null;
  try {
    const out = await pullAndMerge(uid);
    const n = out.added + out.updated;
    if (n && opts.toast !== false) pushToast({ kind: "success", title: EX.merged(n) });
    return out;
  } catch (e) {
    if (opts.toast !== false) pushToast({ kind: "error", title: "Übernahme fehlgeschlagen", detail: toUiError(e).message });
    return null;
  }
}

/** Calls in a row while the server reports `more` (each ≈ 8 s). */
const MAX_CONTINUES = 6;

export async function syncNow(connectionId: string, opts: { from?: string } = {}): Promise<SyncOutcome | null> {
  if (useExchange.getState().busy) return null;
  useExchange.setState({ busy: "sync", actionError: null });
  try {
    let counts = ZERO;
    let more = false;
    let from = opts.from;
    for (let i = 0; i < MAX_CONTINUES; i++) {
      const res = await runExchangeSync({ connectionId, from });
      counts = addCounts(counts, res.counts);
      more = res.more;
      from = undefined; // continuing a window resumes from the server's cursor
      if (!res.more) break;
    }
    const pulled = await pullNow({ toast: false });
    const outcome: SyncOutcome = { key: ++seq, connectionId, counts, merged: (pulled?.added ?? 0) + (pulled?.updated ?? 0), more, at: Date.now() };
    useExchange.setState({ outcome });
    pushToast({ kind: "success", title: EX.syncDone(counts.inserted), detail: more ? EX.more : EX.syncDetail(counts.updated) });
    void loadExchangeStatus();
    return outcome;
  } catch (e) {
    const err = toUiError(e);
    useExchange.setState({ actionError: err });
    pushToast({ kind: "error", title: "Sync fehlgeschlagen", detail: err.message });
    void loadExchangeStatus();
    return null;
  } finally {
    useExchange.setState({ busy: null });
  }
}

export async function runDryRun(connectionId: string): Promise<SyncResult | null> {
  if (useExchange.getState().busy) return null;
  useExchange.setState({ busy: "dry", actionError: null });
  try {
    const res = await runExchangeSync({ connectionId, dryRun: true });
    useExchange.setState({ dryRun: res, dryOpen: true });
    void loadExchangeStatus();
    return res;
  } catch (e) {
    const err = toUiError(e);
    useExchange.setState({ actionError: err });
    pushToast({ kind: "error", title: "Probelauf fehlgeschlagen", detail: err.message });
    return null;
  } finally {
    useExchange.setState({ busy: null });
  }
}

export function closeDryRun(): void {
  useExchange.setState({ dryOpen: false });
}

/* ------------------------------------------------------------------ first import (background) */

const POLL_MS = 3_000;
const POLL_MAX_MS = 16 * 60_000;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

export function stopBackfillPolling(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll(): void {
  stopBackfillPolling();
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void loadExchangeStatus();
  }, POLL_MS);
}

function followBackfill(status: ExchangeStatus): void {
  const job = useExchange.getState().backfill;
  if (!job || job.done) return;
  const run = status.runs.find((r) => r.id === job.runId) ?? null;
  const finished = !!run && run.status !== "running";
  const expired = Date.now() - job.startedAt > POLL_MAX_MS;
  if (!finished && !expired) {
    useExchange.setState({ backfill: { ...job, run } });
    schedulePoll();
    return;
  }
  useExchange.setState({ backfill: { ...job, run, done: true } });
  if (run?.status === "error") {
    pushToast({ kind: "error", title: "Erstimport fehlgeschlagen", detail: run.error ?? undefined });
    return;
  }
  void pullNow({ toast: false }).then((pulled) => {
    const counts = run ? { fetched: run.fetched, inserted: run.inserted, updated: run.updated, unchanged: run.unchanged, skipped: run.skipped } : ZERO;
    useExchange.setState({
      outcome: {
        key: ++seq,
        connectionId: job.connectionId,
        counts,
        merged: (pulled?.added ?? 0) + (pulled?.updated ?? 0),
        more: run?.more ?? false,
        at: Date.now(),
      },
    });
    pushToast({ kind: "success", title: CONNECT.importDone(counts.inserted), detail: EX.syncDetail(counts.updated) });
  });
}

/** Starts the first import of the last `days` days in the background and follows it. */
export async function startFirstImport(connectionId: string, days: number): Promise<boolean> {
  if (useExchange.getState().busy) return false;
  const runId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  useExchange.setState({ busy: "backfill", actionError: null });
  try {
    await startBackfill(connectionId, from, runId);
    useExchange.setState({ backfill: { runId, connectionId, from, startedAt: Date.now(), run: null, done: false } });
    pushToast({ kind: "info", title: CONNECT.importRunning });
    schedulePoll();
    return true;
  } catch (e) {
    const err = toUiError(e);
    useExchange.setState({ actionError: err });
    pushToast({ kind: "error", title: "Erstimport fehlgeschlagen", detail: err.message });
    return false;
  } finally {
    useExchange.setState({ busy: null });
  }
}

/* ------------------------------------------------------------------ settings / disconnect */

export async function updateConnection(connectionId: string, patch: { journalAccount?: JournalAccount; syncEnabled?: boolean }): Promise<boolean> {
  // optimistic: the switch / segment moves at once, a failure moves it back
  const before = useExchange.getState().status;
  if (before) {
    useExchange.setState({
      status: { ...before, connections: before.connections.map((c) => (c.id === connectionId ? { ...c, ...patch } : c)) },
    });
  }
  try {
    const { connection } = await patchConnection(connectionId, patch);
    const now = useExchange.getState().status;
    if (now) useExchange.setState({ status: { ...now, connections: now.connections.map((c) => (c.id === connectionId ? connection : c)) } });
    return true;
  } catch (e) {
    if (before) useExchange.setState({ status: before });
    pushToast({ kind: "error", title: "Nicht gespeichert", detail: toUiError(e).message });
    return false;
  }
}

export async function disconnectAccount(connectionId: string): Promise<boolean> {
  useExchange.setState({ busy: "disconnect", actionError: null });
  try {
    await disconnectExchange(connectionId);
    pushToast({ kind: "success", title: "Verbindung getrennt", detail: EX.disconnectDone });
    useExchange.setState({ outcome: null });
    await loadExchangeStatus();
    return true;
  } catch (e) {
    const err = toUiError(e);
    useExchange.setState({ actionError: err });
    pushToast({ kind: "error", title: "Trennen fehlgeschlagen", detail: err.message });
    return false;
  } finally {
    useExchange.setState({ busy: null });
  }
}

/* ------------------------------------------------------------------ CSV */

export function openCsvImport(): void {
  useExchange.setState({ csvOpen: true });
}

export function closeCsvImport(): void {
  useExchange.setState({ csvOpen: false });
}
