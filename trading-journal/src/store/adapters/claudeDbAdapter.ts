import type { DayNotes, HyblockReading, Settings, StoreApi, Trade } from "@/domain/types";
import { isDayKey, isEmptyDayNote, normalizeDayNote, normalizeDayNotes, normalizeSettings } from "@/domain/normalize";
import { requestCapability } from "../capability";
import { recordCloudQuarantine, validateReadings, validateTrades } from "../migrate";
import type { AdapterEvent, StorageAdapter, StorageSnapshot } from "./StoreApi";

/* ---- Loose typing of the claude.ai `db` capability (only the methods the bundle uses) ---- */

export interface ClaudeDocSnapshot {
  exists: boolean;
  data(): unknown;
}
export interface ClaudeQueryDoc {
  id: string;
  data(): unknown;
}
export interface ClaudeQuerySnapshot {
  docs: ClaudeQueryDoc[];
}
export interface ClaudeDocRef {
  set(value: unknown): Promise<unknown>;
  delete(): Promise<unknown>;
  onSnapshot(next: (snap: ClaudeDocSnapshot) => void, error: (e: unknown) => void): () => void;
}
export interface ClaudeCollection {
  doc(id: string): ClaudeDocRef;
  add(value: unknown): Promise<unknown>;
  onSnapshot(next: (snap: ClaudeQuerySnapshot) => void, error: (e: unknown) => void): () => void;
}
export interface ClaudeDb {
  collection(name: string): ClaudeCollection;
  doc(path: string): ClaudeDocRef;
}

/** `window.claude?.use("db")` – `null` when absent, rejected or unavailable (no-op outside claude.ai). */
export function probeClaudeDb(): Promise<ClaudeDb | null> {
  return requestCapability<ClaudeDb>("db").then((db) =>
    db && typeof db.collection === "function" && typeof db.doc === "function" ? db : null,
  );
}

/** Firestore-like data objects are cloned through JSON exactly like the bundle does. */
function clone<T>(v: unknown): T {
  return JSON.parse(JSON.stringify(v ?? null)) as T;
}

function stripId<T extends { id?: string }>(v: T): { id: string | undefined; rest: Omit<T, "id"> } {
  const { id, ...rest } = v;
  return { id, rest };
}

/**
 * Cloud adapter (claude.ai). Collections `trades`, `hyblock`, docs `config/settings` and `config/days` (day journal,
 * NEW – `{ "YYYY-MM-DD": DayNote }`, written whole), all via `onSnapshot`.
 * Snapshots are validated (Plan 8.3 "migration on read only") but never written back.
 * Subscriptions start on the first `subscribe()` call; `dispose()` tears them down.
 */
export function createClaudeDbAdapter(db: ClaudeDb): StorageAdapter {
  let trades: Trade[] = [];
  let settings: Settings = normalizeSettings(null);
  let hyblock: HyblockReading[] = [];
  let days: DayNotes = {};
  /** Raw `config/days` document (non-date keys survive a day write). */
  let daysRaw: Record<string, unknown> = {};
  const listeners = new Set<(event: AdapterEvent) => void>();
  let unsubs: Array<() => void> = [];
  let started = false;

  const emit = (event: AdapterEvent) => {
    for (const l of listeners) l(event);
  };
  const onError = (error: unknown) => emit({ type: "error", error });

  const start = () => {
    if (started) return;
    started = true;
    try {
      unsubs.push(
        db.collection("trades").onSnapshot((snap) => {
          const raw = snap.docs.map((d) => ({ id: d.id, ...clone<Record<string, unknown>>(d.data()) }));
          const v = validateTrades(raw);
          trades = v.valid;
          if (v.invalid.length) {
            recordCloudQuarantine("trades", v.invalid);
            emit({ type: "quarantine", count: v.invalid.length });
          }
          emit({ type: "patch", patch: { trades } });
        }, onError),
      );
      unsubs.push(
        db.collection("hyblock").onSnapshot((snap) => {
          const raw = snap.docs.map((d) => ({ id: d.id, ...clone<Record<string, unknown>>(d.data()) }));
          const v = validateReadings(raw);
          if (v.invalid.length) {
            recordCloudQuarantine("hyblock", v.invalid);
            emit({ type: "quarantine", count: v.invalid.length });
          }
          hyblock = v.valid.sort((a, b) => a.at.localeCompare(b.at));
          emit({ type: "patch", patch: { hyblock } });
        }, onError),
      );
      unsubs.push(
        db.doc("config/settings").onSnapshot((snap) => {
          settings = normalizeSettings(snap.exists ? clone<unknown>(snap.data()) : null);
          emit({ type: "patch", patch: { settings } });
        }, onError),
      );
      unsubs.push(
        db.doc("config/days").onSnapshot((snap) => {
          const raw = snap.exists ? clone<unknown>(snap.data()) : null;
          daysRaw = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
          days = normalizeDayNotes(daysRaw);
          emit({ type: "patch", patch: { days } });
        }, onError),
      );
    } catch (e) {
      onError(e);
    }
  };

  const api: StoreApi = {
    async saveTrade(t) {
      const { id, rest } = stripId(t);
      if (id) await db.collection("trades").doc(id).set(rest);
      else await db.collection("trades").add(rest);
    },
    async deleteTrade(id) {
      await db.collection("trades").doc(id).delete();
    },
    async saveSettings(s) {
      await db.doc("config/settings").set(s);
    },
    async saveHyblock(r) {
      const { id, rest } = stripId(r);
      if (id) await db.collection("hyblock").doc(id).set(rest);
      else await db.collection("hyblock").add(rest);
    },
    async deleteHyblock(id) {
      await db.collection("hyblock").doc(id).delete();
    },
    async saveDay(date, input) {
      if (!isDayKey(date)) throw new Error(`invalid day key ${date}`);
      const prev = daysRaw[date];
      const entry = normalizeDayNote({ ...(prev && typeof prev === "object" ? prev : {}), ...input, updatedAt: new Date().toISOString() });
      const next = { ...daysRaw };
      if (isEmptyDayNote(entry)) delete next[date];
      else next[date] = entry;
      await db.doc("config/days").set(next);
    },
    async deleteDay(date) {
      if (!(date in daysRaw)) return;
      const next = { ...daysRaw };
      delete next[date];
      await db.doc("config/days").set(next);
    },
  };

  return {
    mode: "cloud",
    load(): StorageSnapshot {
      return { trades, settings, hyblock, days };
    },
    fresh(): StorageSnapshot {
      return { trades, settings, hyblock, days };
    },
    api,
    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => listeners.delete(listener);
    },
    /** Upserts first, deletes leftovers last; a rejected upsert aborts before anything is deleted. */
    async replaceAll(snapshot) {
      const keepTrades = new Set(snapshot.trades.map((t) => t.id));
      const keepReadings = new Set(snapshot.hyblock.map((r) => r.id));
      const staleTrades = trades.filter((t) => !keepTrades.has(t.id)).map((t) => t.id);
      const staleReadings = hyblock.filter((r) => !keepReadings.has(r.id)).map((r) => r.id);
      const extraDays = Object.fromEntries(Object.entries(daysRaw).filter(([k]) => !isDayKey(k)));
      await Promise.all([
        ...snapshot.trades.map((t) => api.saveTrade(t)),
        ...snapshot.hyblock.map((r) => api.saveHyblock(r)),
        api.saveSettings(snapshot.settings),
        ...(snapshot.days ? [db.doc("config/days").set({ ...extraDays, ...snapshot.days })] : []),
      ]);
      await Promise.all([...staleTrades.map((id) => api.deleteTrade(id)), ...staleReadings.map((id) => api.deleteHyblock(id))]);
    },
    dispose() {
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
      unsubs = [];
      listeners.clear();
      started = false;
    },
  };
}
