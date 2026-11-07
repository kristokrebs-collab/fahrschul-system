/**
 * Where the saved simulations of the Zeitmaschine live (A3).
 *
 * - **IndexedDB** (`idb-keyval`, database `<prefix>timemachine`, store `simulations`, key = `simulationId`) is the first and always
 *   available copy: a reload or a restart of the browser gives the same simulation back for the same trade (`forTrade`). Without
 *   IndexedDB (private modes, tests) the records live in memory for the session and `persistent` says `false` – the card then
 *   tells that the simulation is not kept.
 * - **Cloud** (table `simulations`, migration 0011) only while signed in with the sync allowed (`canSyncSimulations`): the record's
 *   figures and hashes go up (never the paths); `sync` on the record says `local` · `pending` · `synced`. A failed upload leaves
 *   `pending` and is tried again with the next save or `flush()`. Signed out, nothing talks to a server.
 * - Records that belong to a trade (or a paper position) are never removed by the store; free simulations of the Labor are kept up to
 *   `KEEP_FREE` (the oldest go first).
 */
import { createStore, del, entries, set, type UseStore } from "idb-keyval";
import { parseRecord, type SimulationRecord } from "@/domain/timemachine/record";
import { storageKey } from "@/store/storage";

/** Free simulations (no trade) kept on the device. */
export const KEEP_FREE = 100;

export interface SimStorage {
  /** `true` = survives a reload */
  readonly persistent: boolean;
  all(): Promise<SimulationRecord[]>;
  put(r: SimulationRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memorySimStorage(): SimStorage {
  const m = new Map<string, SimulationRecord>();
  return {
    persistent: false,
    all: async () => [...m.values()],
    put: async (r) => void m.set(r.simulationId, r),
    remove: async (id) => void m.delete(id),
  };
}

/** IndexedDB storage, or `null` when the browser has none. */
export function idbSimStorage(dbName: string = storageKey("timemachine")): SimStorage | null {
  let store: UseStore;
  try {
    if (typeof indexedDB === "undefined") return null;
    store = createStore(dbName, "simulations");
  } catch {
    return null;
  }
  return {
    persistent: true,
    async all() {
      const out: SimulationRecord[] = [];
      for (const [, v] of await entries(store)) {
        const r = parseRecord(v);
        if (r) out.push(r);
      }
      return out;
    },
    put: (r) => set(r.simulationId, r, store),
    remove: (id) => del(id, store),
  };
}

/* ------------------------------------------------------------------------------------------------ cloud side (injected) */

export interface SimulationRemote {
  upsert(rows: readonly SimulationRecord[]): Promise<void>;
  pull(): Promise<SimulationRecord[]>;
  remove(id: string): Promise<void>;
}

export interface SimCloud {
  /** signed in, 2FA done, sync switched on, plan allows it – checked at every use */
  allowed(): boolean;
  remote(): Promise<SimulationRemote>;
}

export type SaveResult = { ok: true; record: SimulationRecord; persistent: boolean } | { ok: false; message: string };

export interface SimulationStore {
  readonly persistent: boolean;
  save(r: SimulationRecord): Promise<SaveResult>;
  get(id: string): Promise<SimulationRecord | null>;
  /** the newest simulation that belongs to the trade (or paper position) */
  forTrade(tradeId: string): Promise<SimulationRecord | null>;
  list(): Promise<SimulationRecord[]>;
  remove(id: string): Promise<void>;
  /** uploads what is `local` / `pending` (when the cloud is allowed); the number uploaded */
  flush(): Promise<number>;
  /** copies cloud records this device does not have (without their paths); the number added */
  pull(): Promise<number>;
  /** a save, removal or sync changed something (the trade detail re-reads) */
  subscribe(fn: () => void): () => void;
}

const newer = (a: SimulationRecord, b: SimulationRecord): number => Date.parse(b.createdAt) - Date.parse(a.createdAt);

export function createSimulationStore(storage: SimStorage, cloud: SimCloud | null = null): SimulationStore {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of listeners) l();
  };
  // writes one after the other, so two saves of one trade never interleave
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const pushToCloud = async (records: SimulationRecord[]): Promise<number> => {
    if (!cloud || !records.length || !cloud.allowed()) return 0;
    try {
      const remote = await cloud.remote();
      await remote.upsert(records);
    } catch {
      for (const r of records) if (r.sync !== "pending") await storage.put({ ...r, sync: "pending" }).catch(() => undefined);
      return 0;
    }
    for (const r of records) await storage.put({ ...r, sync: "synced" }).catch(() => undefined);
    return records.length;
  };

  const all = async (): Promise<SimulationRecord[]> => (await storage.all()).sort(newer);

  return {
    get persistent() {
      return storage.persistent;
    },

    save(r) {
      return queue(async () => {
        try {
          const old = (await storage.all()).find((x) => x.simulationId === r.simulationId);
          // the same simulation again keeps its first time and a link to a trade it already had
          const merged: SimulationRecord = { ...r, createdAt: old?.createdAt ?? r.createdAt, tradeId: r.tradeId ?? old?.tradeId ?? null, sync: "local" };
          await storage.put(merged);
          // free simulations beyond the limit: the oldest go (records of a trade are never touched)
          const free = (await storage.all()).filter((x) => !x.tradeId).sort(newer);
          for (const x of free.slice(KEEP_FREE)) await storage.remove(x.simulationId);
          changed();
          const up = cloud?.allowed() ? await pushToCloud([merged]) : 0;
          const record = up ? { ...merged, sync: "synced" as const } : cloud?.allowed() ? { ...merged, sync: "pending" as const } : merged;
          changed();
          return { ok: true as const, record, persistent: storage.persistent };
        } catch (e) {
          return { ok: false as const, message: e instanceof Error && /quota/i.test(e.message) ? "Der Speicher dieses Browsers ist voll – die Simulation wurde nicht gespeichert." : "Die Simulation konnte nicht gespeichert werden." };
        }
      });
    },

    async get(id) {
      return (await storage.all()).find((x) => x.simulationId === id) ?? null;
    },
    async forTrade(tradeId) {
      return (await all()).find((x) => x.tradeId === tradeId) ?? null;
    },
    list: all,

    remove(id) {
      return queue(async () => {
        const r = (await storage.all()).find((x) => x.simulationId === id);
        await storage.remove(id);
        if (r && cloud?.allowed()) {
          try {
            await (await cloud.remote()).remove(id);
          } catch {
            /* the cloud copy stays until the next sign-in – the local copy is gone */
          }
        }
        changed();
      });
    },

    flush() {
      return queue(async () => {
        if (!cloud?.allowed()) return 0;
        const todo = (await storage.all()).filter((x) => x.sync !== "synced");
        const n = await pushToCloud(todo);
        if (n) changed();
        return n;
      });
    },

    pull() {
      return queue(async () => {
        if (!cloud?.allowed()) return 0;
        let rows: SimulationRecord[];
        try {
          rows = await (await cloud.remote()).pull();
        } catch {
          return 0;
        }
        const have = new Set((await storage.all()).map((x) => x.simulationId));
        let n = 0;
        for (const r of rows) {
          if (have.has(r.simulationId)) continue;
          await storage.put({ ...r, result: null, sync: "synced" });
          n++;
        }
        if (n) changed();
        return n;
      });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}
