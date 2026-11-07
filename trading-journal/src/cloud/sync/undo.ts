/**
 * Undo window of the data takeover (B1): for a short time after the user chose what happens to the local journal at the
 * first login, "Rückgängig" puts everything back – this device's journal as it was, and the account's rows the takeover
 * changed (records it added become tombstones, records it overwrote get their previous content again).
 *
 * The entry lives in IndexedDB (`idb-keyval`, like the outbox) so it survives a reload; without IndexedDB it lives in
 * memory for this page only. It is written by the engine right before the first upload and removed when the window ends,
 * when the user undoes, or when the sign-in changes.
 */
import { createStore, del, get, set, type UseStore } from "idb-keyval";
import type { TakeoverChoice } from "./takeover";

/** How long the takeover can be undone (ms). */
export const UNDO_WINDOW_MS = 15 * 60_000;

export interface UndoEntry {
  v: 1;
  owner: string;
  choice: TakeoverChoice;
  at: string;
  expiresAt: string;
  /** This device's journal before the takeover (records + settings). */
  local: { trades: unknown; hyblock: unknown; days: unknown; settings: unknown };
  /** `kind:id` → the account's row before the takeover (`null` = it did not exist) for every row the takeover wrote. */
  cloudBefore: Record<string, { data: unknown; deleted: boolean } | null>;
  /** The account's settings before (`null` = no settings row), and whether the takeover wrote them. */
  settingsBefore: unknown;
  settingsPushed: boolean;
}

export interface UndoStorage {
  read(): Promise<UndoEntry | undefined>;
  write(e: UndoEntry): Promise<void>;
  clear(): Promise<void>;
}

export const undoOpen = (e: UndoEntry | undefined | null, now: Date = new Date()): e is UndoEntry => !!e && e.v === 1 && Date.parse(e.expiresAt) > now.getTime();

/** IndexedDB storage of one user's undo entry, or `null` when IndexedDB is unavailable. */
export function idbUndoStorage(dbName: string, userId: string): UndoStorage | null {
  let store: UseStore;
  try {
    if (typeof indexedDB === "undefined") return null;
    store = createStore(dbName, "takeover-undo");
  } catch {
    return null;
  }
  const key = `undo:${userId}`;
  return {
    read: () => get<UndoEntry>(key, store),
    write: (e) => set(key, e, store),
    clear: () => del(key, store),
  };
}

/** In-memory storage (tests, and the fallback without IndexedDB). */
export function memoryUndoStorage(): UndoStorage & { value: UndoEntry | undefined } {
  const s = {
    value: undefined as UndoEntry | undefined,
    read: async () => (s.value ? structuredClone(s.value) : undefined),
    write: async (e: UndoEntry) => {
      s.value = structuredClone(e);
    },
    clear: async () => {
      s.value = undefined;
    },
  };
  return s;
}
