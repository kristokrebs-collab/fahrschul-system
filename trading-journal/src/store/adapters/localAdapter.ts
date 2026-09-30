import type { HyblockReading, Settings, StoreApi, Trade } from "@/domain/types";
import { normalizeReading, normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { newId } from "@/lib/ids";
import { KEYS, readJson, StorageWriteError, writeJsonStrict } from "../storage";
import type { AdapterEvent, StorageAdapter, StorageSnapshot } from "./StoreApi";

function sortReadings(list: HyblockReading[]): HyblockReading[] {
  return [...list].sort((a, b) => a.at.localeCompare(b.at));
}

/** Reads the three `tj2-*` keys and normalises them (normalisation happens on read only, as in the bundle `qM`). */
export function readLocalSnapshot(): StorageSnapshot {
  const rawTrades = readJson<unknown>(KEYS.trades, []);
  const rawHyblock = readJson<unknown>(KEYS.hyblock, []);
  const trades = Array.isArray(rawTrades) ? rawTrades.map((t) => normalizeTrade(t)) : [];
  const hyblock = Array.isArray(rawHyblock) ? rawHyblock.map((r) => normalizeReading(r)) : [];
  return {
    trades,
    settings: normalizeSettings(readJson<unknown>(KEYS.settings, null)),
    hyblock: sortReadings(hyblock),
  };
}

function persist(key: string, value: unknown): void {
  try {
    writeJsonStrict(key, value);
  } catch (e) {
    throw new StorageWriteError(e);
  }
}

/**
 * localStorage adapter – semantics 1:1 with the bundle's local branch:
 * upsert `filter(id≠).concat`, whole settings object replaced, values written verbatim.
 * A failed write (quota, blocked storage) throws `StorageWriteError` and leaves memory untouched.
 */
export function createLocalAdapter(): StorageAdapter {
  let trades: Trade[] = [];
  let settings: Settings = normalizeSettings(null);
  let hyblock: HyblockReading[] = [];
  const listeners = new Set<(event: AdapterEvent) => void>();

  const emit = (event: AdapterEvent) => {
    for (const l of listeners) l(event);
  };

  const api: StoreApi = {
    async saveTrade(w) {
      const id = w.id || newId("t_");
      const next = trades.filter((p) => p.id !== id).concat([{ ...w, id }]);
      persist(KEYS.trades, next);
      trades = next;
      emit({ type: "patch", patch: { trades } });
    },
    async deleteTrade(id) {
      const next = trades.filter((t) => t.id !== id);
      persist(KEYS.trades, next);
      trades = next;
      emit({ type: "patch", patch: { trades } });
    },
    async saveSettings(s) {
      persist(KEYS.settings, s);
      settings = s;
      emit({ type: "patch", patch: { settings } });
    },
    async saveHyblock(r) {
      const id = r.id || newId("h_");
      const next = hyblock.filter((p) => p.id !== id).concat([{ ...r, id }]);
      persist(KEYS.hyblock, next);
      hyblock = sortReadings(next);
      emit({ type: "patch", patch: { hyblock } });
    },
    async deleteHyblock(id) {
      const next = hyblock.filter((r) => r.id !== id);
      persist(KEYS.hyblock, next);
      hyblock = next;
      emit({ type: "patch", patch: { hyblock } });
    },
  };

  return {
    mode: "local",
    load() {
      const snap = readLocalSnapshot();
      trades = snap.trades;
      settings = snap.settings;
      hyblock = snap.hyblock;
      return snap;
    },
    api,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async replaceAll(snapshot) {
      persist(KEYS.trades, snapshot.trades);
      persist(KEYS.settings, snapshot.settings);
      persist(KEYS.hyblock, snapshot.hyblock);
      trades = snapshot.trades;
      settings = snapshot.settings;
      hyblock = sortReadings(snapshot.hyblock);
      emit({ type: "patch", patch: { trades, settings, hyblock } });
    },
    dispose() {
      listeners.clear();
    },
  };
}
