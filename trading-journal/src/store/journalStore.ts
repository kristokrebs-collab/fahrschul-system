import { useMemo } from "react";
import { create } from "zustand";
import type { AccountId, EnrichedTrade, HyblockReading, Settings, StoreApi, StoreMode, Trade } from "@/domain/types";
import { enrichTrades } from "@/domain/enrich";
import { accountView, type AccountView } from "@/domain/account";
import { normalizeSettings } from "@/domain/normalize";
import { hasClaudeRuntime } from "./capability";
import { createLocalAdapter } from "./adapters/localAdapter";
import { createClaudeDbAdapter, probeClaudeDb } from "./adapters/claudeDbAdapter";
import type { AdapterEvent, StorageAdapter, StorageSnapshot } from "./adapters/StoreApi";
import { migrate, quarantineToastTitle, readQuarantine, SNAPSHOT_FAILED_TITLE } from "./migrate";
import { autoBackup } from "./backup";
import { pushToast } from "./uiStore";

/* ---------------------------------------------------------------- labels */

/** Header pill labels + tones per persistence mode (bundle, unchanged). */
export const MODE_LABELS: Record<StoreMode, { text: string; tone: "win" | "warn" | "loss" | "faint" }> = {
  cloud: { text: "Synchronisiert", tone: "win" },
  local: { text: "Nur dieser Browser", tone: "warn" },
  error: { text: "Offline", tone: "loss" },
  connecting: { text: "Verbinde …", tone: "faint" },
};

/* ----------------------------------------------------------------- state */

export interface JournalState {
  trades: Trade[];
  settings: Settings;
  hyblock: HyblockReading[];
  mode: StoreMode;
  loaded: boolean;
  /** Write API of the active adapter (`null` until hydrated). */
  api: StoreApi | null;
  /** Number of records moved to `tj2-quarantine` (shows `Quarantäne ansehen` on the `Daten` card). */
  quarantined: number;

  saveTrade: StoreApi["saveTrade"];
  deleteTrade: StoreApi["deleteTrade"];
  saveSettings: StoreApi["saveSettings"];
  saveHyblock: StoreApi["saveHyblock"];
  deleteHyblock: StoreApi["deleteHyblock"];
  /** Bulk write (backup import / restore). */
  replaceAll(snapshot: StorageSnapshot): Promise<void>;
  /** Replaces state with a snapshot (the cloud snapshot REPLACES local state, never merges). */
  applySnapshot(patch: Partial<StorageSnapshot>): void;
  setMode(mode: StoreMode): void;
}

const NO_API = (): never => {
  throw new Error("Journal not booted");
};

let adapter: StorageAdapter | null = null;
let unsubscribeAdapter: (() => void) | null = null;

export const useJournal = create<JournalState>()((set, get) => ({
  trades: [],
  settings: normalizeSettings(null),
  hyblock: [],
  mode: "connecting",
  loaded: false,
  api: null,
  quarantined: 0,

  saveTrade: (t) => (get().api ?? NO_API()).saveTrade(t),
  deleteTrade: (id) => (get().api ?? NO_API()).deleteTrade(id),
  saveSettings: (s) => (get().api ?? NO_API()).saveSettings(s),
  saveHyblock: (r) => (get().api ?? NO_API()).saveHyblock(r),
  deleteHyblock: (id) => (get().api ?? NO_API()).deleteHyblock(id),
  replaceAll: (snapshot) => (adapter ?? NO_API()).replaceAll(snapshot),
  applySnapshot: (patch) => set(patch),
  setMode: (mode) => set({ mode }),
}));

/* --------------------------------------------------------------- selectors */

const enrichedCache = new WeakMap<Trade[], WeakMap<Settings, EnrichedTrade[]>>();

/** Memoised `enrichTrades(trades, settings)` keyed on the identity of both inputs. */
export function getEnriched(trades: Trade[], settings: Settings): EnrichedTrade[] {
  let bySettings = enrichedCache.get(trades);
  if (!bySettings) {
    bySettings = new WeakMap();
    enrichedCache.set(trades, bySettings);
  }
  let enriched = bySettings.get(settings);
  if (!enriched) {
    enriched = enrichTrades(trades, settings);
    bySettings.set(settings, enriched);
  }
  return enriched;
}

export type { AccountView };
type AccKey = "all" | AccountId;
const viewCache = new WeakMap<EnrichedTrade[], WeakMap<Settings, Map<AccKey, AccountView>>>();

/** Memoised `accountView(enriched, settings, acc)`. */
export function getAccountView(enriched: EnrichedTrade[], settings: Settings, acc: AccKey): AccountView {
  let bySettings = viewCache.get(enriched);
  if (!bySettings) {
    bySettings = new WeakMap();
    viewCache.set(enriched, bySettings);
  }
  let byAcc = bySettings.get(settings);
  if (!byAcc) {
    byAcc = new Map();
    bySettings.set(settings, byAcc);
  }
  let view = byAcc.get(acc);
  if (!view) {
    view = accountView(enriched, settings, acc);
    byAcc.set(acc, view);
  }
  return view;
}

export function useEnriched(): EnrichedTrade[] {
  const trades = useJournal((s) => s.trades);
  const settings = useJournal((s) => s.settings);
  return useMemo(() => getEnriched(trades, settings), [trades, settings]);
}

export function useAccountView(acc: AccKey): AccountView {
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  return useMemo(() => getAccountView(enriched, settings, acc), [enriched, settings, acc]);
}

/** Hyblock readings sorted by `at` (adapters already sort; kept for parity with the bundle hook). */
export function useReadings(): HyblockReading[] {
  return useJournal((s) => s.hyblock);
}

/* ------------------------------------------------------------------- boot */

export interface BootOptions {
  /** Skip the claude.ai probe (tests / storybook). */
  probeCloud?: boolean;
  /** Skip the daily auto-backup. */
  autoBackup?: boolean;
  now?: () => Date;
  /** How long `use("db")` may take before the app falls back to local mode (default `PROBE_TIMEOUT_MS`). */
  probeTimeoutMs?: number;
}

/** `window.claude.use("db")` has no timeout of its own; after this the store goes local. */
export const PROBE_TIMEOUT_MS = 8000;

/** Resolves with `null` when `probe` has not settled within `ms` (the timer is cleared when it does). */
function withTimeout<T>(probe: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([probe, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

let booting: Promise<void> | null = null;

function bindAdapter(next: StorageAdapter, onEvent: (e: AdapterEvent) => void): void {
  unsubscribeAdapter?.();
  adapter?.dispose();
  adapter = next;
  unsubscribeAdapter = next.subscribe(onEvent);
}

/**
 * Start sequence (Plan 1.5):
 * 1. `migrate()` + synchronous hydrate from localStorage (state usable in the first render).
 * 2. Probe `window.claude?.use("db")`.
 *    Fall A – no `window.claude.use`: `mode:"local"`, `loaded:true` in the first microtask.
 *    Fall B – claude.ai: `mode` stays `connecting` (`loaded:false`) until `use("db")` resolves;
 *      `null` → local; handle → `cloud`, the cloud snapshots REPLACE local state, `loaded` only after
 *      the trades AND settings snapshot arrived.
 * Idempotent: a second call returns the running/finished promise. Returns a promise that settles when the
 * mode is decided (cloud: when subscriptions are wired, not when loaded).
 */
export function bootJournal(opts: BootOptions = {}): Promise<void> {
  if (booting) return booting;
  const now = opts.now ?? (() => new Date());
  const { set } = { set: useJournal.setState };

  // 1. migrate + hydrate (sync)
  const migration = migrate(now());
  const local = createLocalAdapter();
  const snapshot = local.load();
  const quarantined = readQuarantine().length;
  bindAdapter(local, (e) => {
    if (e.type === "patch") set(e.patch);
  });
  set({ ...snapshot, api: local.api, mode: "connecting", loaded: false, quarantined });
  if (migration.aborted) pushToast({ kind: "error", title: SNAPSHOT_FAILED_TITLE, detail: "Migration wird beim nächsten Start erneut versucht" });
  if (migration.quarantined > 0) pushToast({ kind: "error", title: quarantineToastTitle(migration.quarantined) });

  const goLocal = () => {
    set({ mode: "local", loaded: true });
    if (opts.autoBackup !== false) {
      try {
        autoBackup(now());
      } catch {
        /* never block the start */
      }
    }
  };

  const probe =
    opts.probeCloud === false || !hasClaudeRuntime() ? Promise.resolve(null) : withTimeout(probeClaudeDb(), opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS);

  booting = probe
    .then((db) => {
      if (!db) {
        goLocal();
        return;
      }
      const cloud = createClaudeDbAdapter(db);
      const seen = { trades: false, settings: false };
      bindAdapter(cloud, (e) => {
        if (e.type === "patch") {
          if (e.patch.trades) seen.trades = true;
          if (e.patch.settings) seen.settings = true;
          set({ ...e.patch, loaded: seen.trades && seen.settings });
        } else if (e.type === "error") {
          set({ mode: "error" });
        } else if (e.type === "quarantine") {
          // The adapter recorded the documents in `tj2-quarantine`; show what `Quarantäne ansehen` will list.
          set({ quarantined: Math.max(e.count, readQuarantine().length) });
        }
      });
      // Replace, never merge: locally hydrated data is not shown or uploaded in cloud mode.
      set({ ...cloud.load(), api: cloud.api, mode: "cloud", loaded: false });
    })
    .catch(() => {
      goLocal();
    });
  return booting;
}

/** Tears the adapter down and resets the store (tests, hot reload). */
export function resetJournal(): void {
  unsubscribeAdapter?.();
  adapter?.dispose();
  adapter = null;
  unsubscribeAdapter = null;
  booting = null;
  useJournal.setState({
    trades: [],
    settings: normalizeSettings(null),
    hyblock: [],
    mode: "connecting",
    loaded: false,
    api: null,
    quarantined: 0,
  });
}

/** Current adapter (backup module uses it for bulk writes). */
export function getAdapter(): StorageAdapter | null {
  return adapter;
}
