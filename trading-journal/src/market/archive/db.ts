/**
 * Archive store (F26): its own IndexedDB (`tj2-archive` / `tj2share-archive`, one database per edition) with two object
 * stores – `points` (key `[series, symbol, t]`, so one series of one symbol is one contiguous key range and a ring
 * buffer is "delete from the lower end") and `ticks` (key `t`, the log that explains gaps).
 *
 * Browser storage can be missing (private window, blocked site data) or full: `openArchiveDb` rejects with
 * `ArchiveUnavailable`, a full disk surfaces as `ArchiveQuotaError` from a write – the collector pauses with a reason, the
 * app goes on. Nothing here talks to the network and nothing leaves the device.
 */
import type { ArchivePoint, SeriesId, SeriesInfo, TickRecord } from "@/domain/archive";
import { storageKey } from "@/store/storage";

export const ARCHIVE_DB_NAME = storageKey("archive");
const DB_VERSION = 1;
const POINTS = "points";
const TICKS = "ticks";

export class ArchiveUnavailable extends Error {
  constructor(message = "IndexedDB ist in diesem Browser nicht verfügbar.") {
    super(message);
    this.name = "ArchiveUnavailable";
  }
}
export class ArchiveQuotaError extends Error {
  constructor(message = "Der Browser-Speicher ist voll.") {
    super(message);
    this.name = "ArchiveQuotaError";
  }
}

type Key = [SeriesId, string, number];

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB-Fehler"));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB-Transaktion abgebrochen"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB-Fehler"));
  });

const isQuota = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "QuotaExceededError";

/** The range of one series of one symbol (every time). */
const rowRange = (series: SeriesId, symbol: string): IDBKeyRange => IDBKeyRange.bound([series, symbol, -Infinity], [series, symbol, Infinity]);

/** Key of the `n`-th record (1-based) of a range, or `null` when there are fewer. */
function nthKey(store: IDBObjectStore, range: IDBKeyRange, n: number): Promise<IDBValidKey | null> {
  return new Promise((resolve, reject) => {
    const r = store.openKeyCursor(range);
    let left = n;
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve(null);
      left -= 1;
      if (left <= 0) return resolve(c.primaryKey);
      c.continue();
    };
  });
}

export interface ArchiveDb {
  putPoints(points: readonly ArchivePoint[]): Promise<void>;
  putTick(tick: TickRecord): Promise<void>;
  /** points of one row with `from <= t <= to`, oldest first */
  range(series: SeriesId, symbol: string, from: number, to: number, limit?: number): Promise<ArchivePoint[]>;
  /** the newest `n` points of one row, oldest first */
  latest(series: SeriesId, symbol: string, n: number): Promise<ArchivePoint[]>;
  /** the times of one row (keys only – cheap), oldest first */
  times(series: SeriesId, symbol: string): Promise<number[]>;
  ticks(from?: number, to?: number): Promise<TickRecord[]>;
  /** every series × symbol that exists, with count and first / last time; sorted by series, symbol */
  overview(): Promise<SeriesInfo[]>;
  /** keeps at most `cap(series)` newest points per row, returns how many were removed */
  trim(cap: (series: SeriesId, symbol: string) => number): Promise<number>;
  trimTicks(cap: number): Promise<number>;
  /** removes one series (of one symbol, or of all), returns how many points went */
  deleteRow(series: SeriesId, symbol?: string): Promise<number>;
  deleteAll(): Promise<void>;
  close(): void;
}

export interface OpenOptions {
  /** the IndexedDB factory (tests); `null` = none; omitted = the browser's */
  factory?: IDBFactory | null;
  name?: string;
}

export function openArchiveDb(opts: OpenOptions = {}): Promise<ArchiveDb> {
  const factory = opts.factory === undefined ? (typeof indexedDB === "undefined" ? null : indexedDB) : opts.factory;
  const name = opts.name ?? ARCHIVE_DB_NAME;
  if (!factory) return Promise.reject(new ArchiveUnavailable());
  return new Promise<IDBDatabase>((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(name, DB_VERSION);
    } catch (e) {
      return reject(new ArchiveUnavailable(e instanceof Error ? e.message : undefined));
    }
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(POINTS)) db.createObjectStore(POINTS, { keyPath: ["series", "symbol", "t"] });
      if (!db.objectStoreNames.contains(TICKS)) db.createObjectStore(TICKS, { keyPath: "t" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(new ArchiveUnavailable(open.error?.message));
    open.onblocked = () => reject(new ArchiveUnavailable("Die Archiv-Datenbank ist in einem anderen Tab gesperrt."));
  }).then((db) => {
    db.onversionchange = () => db.close();
    return build(db);
  });
}

function build(db: IDBDatabase): ArchiveDb {
  const write = async (stores: string[], fn: (tx: IDBTransaction) => void): Promise<void> => {
    try {
      const tx = db.transaction(stores, "readwrite");
      const finished = done(tx);
      fn(tx);
      await finished;
    } catch (e) {
      throw isQuota(e) ? new ArchiveQuotaError() : e;
    }
  };

  const overview = async (): Promise<SeriesInfo[]> => {
    const tx = db.transaction(POINTS, "readonly");
    const store = tx.objectStore(POINTS);
    const heads: Array<{ series: SeriesId; symbol: string; first: number }> = [];
    await new Promise<void>((resolve, reject) => {
      const r = store.openKeyCursor();
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return resolve();
        const [series, symbol, first] = c.primaryKey as Key;
        heads.push({ series, symbol, first });
        // jump over the rest of this row
        c.continue([series, symbol, Infinity]);
      };
    });
    const out: SeriesInfo[] = [];
    for (const h of heads) {
      const range = rowRange(h.series, h.symbol);
      const count = await req(store.count(range));
      const lastKey = await new Promise<Key | null>((resolve, reject) => {
        const r = store.openKeyCursor(range, "prev");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => resolve((r.result?.primaryKey as Key | undefined) ?? null);
      });
      if (count > 0 && lastKey) out.push({ series: h.series, symbol: h.symbol, count, first: h.first, last: lastKey[2] });
    }
    return out;
  };

  return {
    async putPoints(points) {
      if (!points.length) return;
      await write([POINTS], (tx) => {
        const store = tx.objectStore(POINTS);
        for (const p of points) store.put({ series: p.series, symbol: p.symbol, t: p.t, d: p.d });
      });
    },
    async putTick(tick) {
      await write([TICKS], (tx) => void tx.objectStore(TICKS).put(tick));
    },
    async range(series, symbol, from, to, limit) {
      const store = db.transaction(POINTS, "readonly").objectStore(POINTS);
      return (await req(store.getAll(IDBKeyRange.bound([series, symbol, from], [series, symbol, to]), limit))) as ArchivePoint[];
    },
    async latest(series, symbol, n) {
      const store = db.transaction(POINTS, "readonly").objectStore(POINTS);
      const out: ArchivePoint[] = [];
      await new Promise<void>((resolve, reject) => {
        const r = store.openCursor(rowRange(series, symbol), "prev");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const c = r.result;
          if (!c || out.length >= n) return resolve();
          out.push(c.value as ArchivePoint);
          if (out.length >= n) return resolve();
          c.continue();
        };
      });
      return out.reverse();
    },
    async times(series, symbol) {
      const store = db.transaction(POINTS, "readonly").objectStore(POINTS);
      const keys = (await req(store.getAllKeys(rowRange(series, symbol)))) as Key[];
      return keys.map((k) => k[2]);
    },
    async ticks(from = -Infinity, to = Infinity) {
      const store = db.transaction(TICKS, "readonly").objectStore(TICKS);
      return (await req(store.getAll(IDBKeyRange.bound(from, to)))) as TickRecord[];
    },
    overview,
    async trim(cap) {
      const rows = await overview();
      let removed = 0;
      for (const row of rows) {
        const keep = Math.max(0, Math.floor(cap(row.series, row.symbol)));
        const excess = row.count - keep;
        if (excess <= 0) continue;
        await write([POINTS], (tx) => {
          const store = tx.objectStore(POINTS);
          const range = rowRange(row.series, row.symbol);
          void nthKey(store, range, excess).then((upper) => {
            if (upper) store.delete(IDBKeyRange.bound([row.series, row.symbol, -Infinity], upper));
          });
        });
        removed += excess;
      }
      return removed;
    },
    async trimTicks(cap) {
      const store = db.transaction(TICKS, "readonly").objectStore(TICKS);
      const count = await req(store.count());
      const excess = count - Math.max(0, cap);
      if (excess <= 0) return 0;
      await write([TICKS], (tx) => {
        const s = tx.objectStore(TICKS);
        void nthKey(s, IDBKeyRange.lowerBound(-Infinity), excess).then((upper) => {
          if (upper) s.delete(IDBKeyRange.upperBound(upper));
        });
      });
      return excess;
    },
    async deleteRow(series, symbol) {
      const range = symbol ? rowRange(series, symbol) : IDBKeyRange.bound([series, "", -Infinity], [series, "￿", Infinity]);
      const count = await req(db.transaction(POINTS, "readonly").objectStore(POINTS).count(range));
      if (count === 0) return 0;
      await write([POINTS], (tx) => void tx.objectStore(POINTS).delete(range));
      return count;
    },
    async deleteAll() {
      await write([POINTS, TICKS], (tx) => {
        tx.objectStore(POINTS).clear();
        tx.objectStore(TICKS).clear();
      });
    },
    close() {
      db.close();
    },
  };
}

/** The browser's storage numbers for this origin (the whole site, not only the archive), `null` when it does not tell. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e && typeof e.usage === "number" && typeof e.quota === "number" && e.quota > 0) return { usage: e.usage, quota: e.quota };
  } catch {
    /* some browsers refuse the estimate */
  }
  return null;
}
