/**
 * `StorageAdapter` for a signed-in user with sync (P09). Local-first: it wraps a fresh local adapter – every write goes
 * to localStorage exactly as in local mode (synchronous persist + full-list patch, so `saveTradeNow().persisted` stays
 * true) – and tells the sync engine which record changed. Remote changes reach the store as full-list patches through
 * the local adapter (`replaceParts`). `mode` is `cloud`; the engine reports `connecting` / `cloud` / `error` as
 * `status` events.
 */
import type { StoreApi } from "@/domain/types";
import { newId } from "@/lib/ids";
import { createLocalAdapter } from "@/store/adapters/localAdapter";
import type { AdapterEvent, LocalStorageAdapter, StorageAdapter } from "@/store/adapters/StoreApi";
import { createSyncEngine, type EngineDeps, type SyncEngine } from "./engine";

export interface SupabaseAdapter extends StorageAdapter {
  readonly engine: SyncEngine;
}

export type SupabaseAdapterDeps = Omit<EngineDeps, "local" | "onMode"> & { local?: LocalStorageAdapter };

export function createSupabaseAdapter(deps: SupabaseAdapterDeps): SupabaseAdapter {
  const local = deps.local ?? createLocalAdapter();
  local.load();
  const listeners = new Set<(e: AdapterEvent) => void>();
  const emit = (e: AdapterEvent) => {
    for (const l of listeners) l(e);
  };
  const engine = createSyncEngine({ ...deps, local, onMode: (mode) => emit({ type: "status", mode }) });
  let offLocal: (() => void) | null = null;
  let started = false;

  const api: StoreApi = {
    async saveTrade(t) {
      const id = t.id || newId("t_");
      await local.api.saveTrade({ ...t, id });
      engine.markDirty("trade", id);
    },
    async deleteTrade(id) {
      await local.api.deleteTrade(id);
      engine.markDirty("trade", id);
    },
    async saveSettings(s) {
      await local.api.saveSettings(s);
      engine.markDirty("settings", "settings");
    },
    async saveHyblock(r) {
      const id = r.id || newId("h_");
      await local.api.saveHyblock({ ...r, id });
      engine.markDirty("hyblock", id);
    },
    async deleteHyblock(id) {
      await local.api.deleteHyblock(id);
      engine.markDirty("hyblock", id);
    },
    async saveDay(date, input) {
      await local.api.saveDay(date, input);
      engine.markDirty("day", date);
    },
    async deleteDay(date) {
      await local.api.deleteDay(date);
      engine.markDirty("day", date);
    },
  };

  return {
    mode: "cloud",
    engine,
    load: () => local.load(),
    fresh: () => local.fresh(),
    api,
    subscribe(listener) {
      listeners.add(listener);
      offLocal ??= local.subscribe(emit);
      if (!started) {
        started = true;
        void engine.start();
      }
      return () => listeners.delete(listener);
    },
    /** Import / restore: written locally, then a full reconcile uploads the differences (removed records → tombstones). */
    async replaceAll(snapshot) {
      await local.replaceAll(snapshot);
      void engine.syncNow();
    },
    dispose() {
      engine.stop();
      offLocal?.();
      offLocal = null;
      local.dispose();
      listeners.clear();
    },
  };
}
