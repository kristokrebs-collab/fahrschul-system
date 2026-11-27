/**
 * Offline queue of the sync (P09): which records changed locally and still have to reach the cloud. Only KEYS are
 * queued (`trade:t_1`, `settings:settings`) – the content is read from the local journal at upload time, so a record
 * edited five times offline is uploaded once, in its latest state, and a record that no longer exists becomes a
 * tombstone. Every mark bumps the entry's generation; an upload removes an entry only if it was not marked again
 * meanwhile.
 *
 * Persisted in IndexedDB (`idb-keyval`, database `<prefix>cloud`, one value per user) so a queue survives closing the
 * tab while offline; without IndexedDB (private modes, tests) it lives in memory – the full reconcile at the next start
 * finds those changes anyway (the queue is a fast path, never the only record of a change).
 */
import { createStore, get, set, type UseStore } from "idb-keyval";

export interface OutboxEntry {
  key: string;
  gen: number;
  /** First time it was marked (ISO). */
  at: string;
}

export interface Outbox {
  /** Pending entries (loads the persisted queue on first use). */
  all(): Promise<OutboxEntry[]>;
  mark(key: string, at?: string): Promise<void>;
  /** Removes the given entries unless they were marked again after being read. */
  settle(entries: readonly OutboxEntry[]): Promise<void>;
  clear(): Promise<void>;
  /** Pending count (synchronous, from the in-memory copy). */
  size(): number;
  /** Called after every change of the queue. */
  onChange(fn: (size: number) => void): () => void;
}

export interface OutboxStorage {
  read(): Promise<Record<string, OutboxEntry> | undefined>;
  write(v: Record<string, OutboxEntry>): Promise<void>;
}

/** IndexedDB storage of one user's queue, or `null` when IndexedDB is unavailable. */
export function idbOutboxStorage(dbName: string, userId: string): OutboxStorage | null {
  let store: UseStore;
  try {
    if (typeof indexedDB === "undefined") return null;
    store = createStore(dbName, "outbox");
  } catch {
    return null;
  }
  const key = `outbox:${userId}`;
  return {
    read: () => get<Record<string, OutboxEntry>>(key, store),
    write: (v) => set(key, v, store),
  };
}

/** Queue on top of a storage (`null` = memory only). Writes are serialised; a failing IndexedDB degrades to memory. */
export function createOutbox(storage: OutboxStorage | null): Outbox {
  let entries: Record<string, OutboxEntry> = {};
  let loaded: Promise<void> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let store = storage;
  const listeners = new Set<(n: number) => void>();

  const notify = () => {
    const n = Object.keys(entries).length;
    for (const l of listeners) l(n);
  };
  const load = () =>
    (loaded ??= (async () => {
      if (!store) return;
      try {
        const v = await store.read();
        if (v && typeof v === "object") entries = { ...v, ...entries };
      } catch {
        store = null;
      }
      notify();
    })());
  const persist = () => {
    const snapshot = { ...entries };
    chain = chain.then(async () => {
      if (!store) return;
      try {
        await store.write(snapshot);
      } catch {
        store = null;
      }
    });
    return chain;
  };

  return {
    async all() {
      await load();
      return Object.values(entries).map((e) => ({ ...e }));
    },
    async mark(key, at = new Date().toISOString()) {
      await load();
      const cur = entries[key];
      entries = { ...entries, [key]: { key, gen: (cur?.gen ?? 0) + 1, at: cur?.at ?? at } };
      notify();
      await persist();
    },
    async settle(done) {
      await load();
      let changed = false;
      const next = { ...entries };
      for (const e of done) {
        if (next[e.key] && next[e.key]!.gen === e.gen) {
          delete next[e.key];
          changed = true;
        }
      }
      if (!changed) return;
      entries = next;
      notify();
      await persist();
    },
    async clear() {
      entries = {};
      notify();
      await persist();
    },
    size: () => Object.keys(entries).length,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
