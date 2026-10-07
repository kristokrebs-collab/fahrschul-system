import type { DayNote, DayNoteInput, DayNotes, HyblockReading, Settings, StoreApi, Trade } from "@/domain/types";
import { isDayKey, isEmptyDayNote, normalizeDayNote, normalizeDayNotes, normalizeReading, normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { newId } from "@/lib/ids";
import { merge3 } from "../merge3";
import { assertWritable, DATA_KEYS, KEYS, quarantineRaw, readJson, readJsonDetailed, readRaw, removeKey, StorageWriteError, writeJsonStrict, writeRaw } from "../storage";
import type { AdapterEvent, StorageAdapter, StorageSnapshot } from "./StoreApi";

function sortReadings(list: HyblockReading[]): HyblockReading[] {
  return [...list].sort((a, b) => a.at.localeCompare(b.at));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readTrades(): Trade[] {
  const raw = readJson<unknown>(KEYS.trades, []);
  return Array.isArray(raw) ? raw.map((t) => normalizeTrade(t)) : [];
}

function readReadings(): HyblockReading[] {
  const raw = readJson<unknown>(KEYS.hyblock, []);
  return sortReadings(Array.isArray(raw) ? raw.map((r) => normalizeReading(r)) : []);
}

function readSettings(): Settings {
  return normalizeSettings(readJson<unknown>(KEYS.settings, null));
}

function readDays(): DayNotes {
  return normalizeDayNotes(readJson<unknown>(KEYS.days, {}));
}

/** Reads the `tj2-*` data keys and normalises them (normalisation happens on read only, as in the bundle `qM`). */
export function readLocalSnapshot(): StorageSnapshot {
  return { trades: readTrades(), settings: readSettings(), hyblock: readReadings(), days: readDays() };
}

/**
 * Writes one key; an unparseable current value must be quarantined first (never overwrite the only copy). A list key
 * (`tj2-trades`, `tj2-hyblock`) that holds valid JSON which is not an array, or `tj2-days` holding a non-object, is
 * quarantined as a blob before it is replaced (the read path showed it as empty).
 */
function persist(key: string, value: unknown): void {
  assertWritable(key);
  const cur = readJsonDetailed<unknown>(key);
  if (cur.status === "ok" && cur.value !== null) {
    const wrongShape = key === KEYS.days ? !isObj(cur.value) : (key === KEYS.trades || key === KEYS.hyblock) && !Array.isArray(cur.value);
    if (wrongShape && !quarantineRaw(key, JSON.stringify(cur.value))) {
      throw new StorageWriteError(new Error(`unexpected value under ${key} could not be quarantined`));
    }
  }
  try {
    writeJsonStrict(key, value);
  } catch (e) {
    throw new StorageWriteError(e);
  }
}

/** Puts a previously read raw string back (or removes the key when there was none). */
function restoreRaw(key: string, raw: string | null): void {
  if (raw === null) removeKey(key);
  else writeRaw(key, raw);
}

/**
 * Writes several keys as a unit: on the first failure every key already written is rolled back to its
 * previous raw string and the error is rethrown. Nothing in memory changes until all succeeded.
 */
function persistAll(entries: ReadonlyArray<readonly [key: string, value: unknown]>): void {
  const previous = entries.map(([key]) => [key, readRaw(key)] as const);
  const written: string[] = [];
  try {
    for (const [key, value] of entries) {
      persist(key, value);
      written.push(key);
    }
  } catch (e) {
    for (const [key, raw] of previous) if (written.includes(key)) restoreRaw(key, raw);
    throw e;
  }
}

/** Raw `tj2-days` object (unknown / non-date keys included) – day writes touch only their own key. */
function readDaysRaw(): Record<string, unknown> {
  const raw = readJson<unknown>(KEYS.days, {});
  return isObj(raw) ? raw : {};
}

/**
 * localStorage adapter – semantics 1:1 with the bundle's local branch (upsert `filter(id≠).concat`, values written
 * verbatim), made safe for several open tabs / the other journal version on the same storage:
 * - **read-modify-write**: every write re-reads its key from storage first and upserts into that fresh list, so a
 *   trade or reading another tab saved in the meantime is never overwritten;
 * - **settings** are three-way merged (`merge3(lastKnown, mine, stored)`): keys and setups another tab changed
 *   survive a save of this tab that did not touch them;
 * - **`storage` events** (writes of other tabs) reload the changed key and emit a patch, so open tabs stay current.
 * A failed write (quota, blocked storage) throws `StorageWriteError` and leaves memory untouched.
 */
export function createLocalAdapter(): StorageAdapter {
  let trades: Trade[] = [];
  let settings: Settings = normalizeSettings(null);
  let hyblock: HyblockReading[] = [];
  let days: DayNotes = {};
  const listeners = new Set<(event: AdapterEvent) => void>();
  let detachStorage: (() => void) | null = null;

  const emit = (event: AdapterEvent) => {
    for (const l of listeners) l(event);
  };

  /** Reloads the keys another tab changed (`key === null`: storage was cleared → reload all). */
  const onStorage = (e: StorageEvent) => {
    try {
      if (typeof localStorage !== "undefined" && e.storageArea && e.storageArea !== localStorage) return;
    } catch {
      return;
    }
    const all = e.key === null;
    if (!all && !DATA_KEYS.includes(e.key as string)) return;
    const patch: Partial<StorageSnapshot> = {};
    if (all || e.key === KEYS.trades) patch.trades = trades = readTrades();
    if (all || e.key === KEYS.settings) patch.settings = settings = readSettings();
    if (all || e.key === KEYS.hyblock) patch.hyblock = hyblock = readReadings();
    if (all || e.key === KEYS.days) patch.days = days = readDays();
    emit({ type: "patch", patch });
  };

  const attachStorage = () => {
    if (detachStorage || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    window.addEventListener("storage", onStorage);
    detachStorage = () => window.removeEventListener("storage", onStorage);
  };

  const api: StoreApi = {
    async saveTrade(w) {
      const id = w.id || newId("t_");
      const next = readTrades().filter((p) => p.id !== id).concat([{ ...w, id }]);
      persist(KEYS.trades, next);
      trades = next;
      emit({ type: "patch", patch: { trades } });
    },
    async deleteTrade(id) {
      const next = readTrades().filter((t) => t.id !== id);
      persist(KEYS.trades, next);
      trades = next;
      emit({ type: "patch", patch: { trades } });
    },
    async saveSettings(s) {
      const merged = merge3(settings, s, readSettings()) as Settings;
      persist(KEYS.settings, merged);
      settings = merged;
      emit({ type: "patch", patch: { settings } });
    },
    async saveHyblock(r) {
      const id = r.id || newId("h_");
      const next = readReadings().filter((p) => p.id !== id).concat([{ ...r, id }]);
      persist(KEYS.hyblock, next);
      hyblock = sortReadings(next);
      emit({ type: "patch", patch: { hyblock } });
    },
    async deleteHyblock(id) {
      const next = readReadings().filter((r) => r.id !== id);
      persist(KEYS.hyblock, next);
      hyblock = next;
      emit({ type: "patch", patch: { hyblock } });
    },
    async saveDay(date, input) {
      if (!isDayKey(date)) throw new Error(`invalid day key ${date}`);
      const raw = readDaysRaw();
      const entry: DayNote = normalizeDayNote({ ...(isObj(raw[date]) ? raw[date] : {}), ...input, updatedAt: new Date().toISOString() });
      const next = { ...raw };
      if (isEmptyDayNote(entry)) delete next[date];
      else next[date] = entry;
      persist(KEYS.days, next);
      days = normalizeDayNotes(next);
      emit({ type: "patch", patch: { days } });
    },
    async deleteDay(date) {
      const raw = readDaysRaw();
      if (!(date in raw)) return;
      const next = { ...raw };
      delete next[date];
      persist(KEYS.days, next);
      days = normalizeDayNotes(next);
      emit({ type: "patch", patch: { days } });
    },
  };

  return {
    mode: "local",
    load() {
      const snap = readLocalSnapshot();
      trades = snap.trades;
      settings = snap.settings;
      hyblock = snap.hyblock;
      days = snap.days ?? {};
      return snap;
    },
    fresh() {
      return readLocalSnapshot();
    },
    api,
    subscribe(listener) {
      listeners.add(listener);
      attachStorage();
      return () => listeners.delete(listener);
    },
    async replaceAll(snapshot) {
      const entries: Array<readonly [string, unknown]> = [
        [KEYS.trades, snapshot.trades],
        [KEYS.settings, snapshot.settings],
        [KEYS.hyblock, snapshot.hyblock],
      ];
      // Day notes travel only when the snapshot carries them; non-date keys already in storage are kept.
      if (snapshot.days) {
        const extra = Object.fromEntries(Object.entries(readDaysRaw()).filter(([k]) => !isDayKey(k)));
        entries.push([KEYS.days, { ...extra, ...snapshot.days }]);
      }
      persistAll(entries);
      trades = snapshot.trades;
      settings = snapshot.settings;
      hyblock = sortReadings(snapshot.hyblock);
      if (snapshot.days) days = { ...snapshot.days };
      emit({ type: "patch", patch: snapshot.days ? { trades, settings, hyblock, days } : { trades, settings, hyblock } });
    },
    dispose() {
      detachStorage?.();
      detachStorage = null;
      listeners.clear();
    },
  };
}

export type { DayNoteInput };
