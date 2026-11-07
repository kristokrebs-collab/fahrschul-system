/**
 * The stored history of the "Top-Trader: Netto Long/Short" card (C3, an extension of the data archive F26): the card keeps what it
 * has shown – one point per hour (or per period when that is longer) for each series and symbol, up to 180 days – in an IndexedDB
 * of THIS device (`tj2-net-archive`). It grows while the card is used; a stretch the card never saw is a gap and stays one.
 *
 * Why a small store of its own and not the collector of the data archive: the collector is a background job the user switches on
 * and that asks the exchange on its own. This store asks for nothing – it only keeps the points the card already holds, so it can
 * be on by default; a switch on the card turns it off, and the card can delete it. Nothing here leaves the device (not part of the
 * backup, not part of the cloud sync: public exchange numbers, re-creatable only forward in time).
 *
 * Browser storage can be missing (private window) or full: the card then works as before, without a history (`status`).
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ARCHIVE_KEEP_MS, archivedOf, pointsForArchive, type ArchivedNetPoint, type NetSeriesId } from "@/domain/signals/netSeries";
import type { NetPoint } from "@/domain/signals/traderNet";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const NET_ARCHIVE_DB = storageKey("net-archive");
export const NET_ARCHIVE_CFG_KEY = storageKey("net-archive-cfg");
const STORE = "rows";

/* ------------------------------------------------------------------------------------------------ switch */

let on: boolean | null = null;
const listeners = new Set<() => void>();

/** `true` unless the user turned the storing off on the card. */
export function getNetArchiveOn(): boolean {
  if (on === null) {
    const raw = readJson<unknown>(NET_ARCHIVE_CFG_KEY, null);
    on = !(typeof raw === "object" && raw !== null && (raw as { on?: unknown }).on === false);
  }
  return on;
}

export function setNetArchiveOn(next: boolean): void {
  if (getNetArchiveOn() === next) return;
  on = next;
  writeJson(NET_ARCHIVE_CFG_KEY, { v: 1, on: next });
  for (const l of [...listeners]) l();
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
export const useNetArchiveOn = (): boolean => useSyncExternalStore(subscribe, getNetArchiveOn, () => true);

/* ------------------------------------------------------------------------------------------------ the store */

export class NetArchiveUnavailable extends Error {
  constructor(message = "IndexedDB ist in diesem Browser nicht verfügbar.") {
    super(message);
    this.name = "NetArchiveUnavailable";
  }
}

export interface NetArchiveStore {
  put(series: NetSeriesId, symbol: string, rows: readonly ArchivedNetPoint[]): Promise<void>;
  /** the rows of one series and symbol with `t >= from`, oldest first */
  read(series: NetSeriesId, symbol: string, from?: number): Promise<ArchivedNetPoint[]>;
  /** removes the rows older than `before`, returns how many went */
  trim(series: NetSeriesId, symbol: string, before: number): Promise<number>;
  /** removes everything the card stored, returns how many rows went */
  clear(): Promise<number>;
  close(): void;
}

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
const rowRange = (series: NetSeriesId, symbol: string, from = -Infinity, to = Infinity): IDBKeyRange => IDBKeyRange.bound([series, symbol, from], [series, symbol, to]);

export function openNetArchive(factory: IDBFactory | null | undefined = typeof indexedDB === "undefined" ? null : indexedDB, name: string = NET_ARCHIVE_DB): Promise<NetArchiveStore> {
  if (!factory) return Promise.reject(new NetArchiveUnavailable());
  return new Promise<IDBDatabase>((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(name, 1);
    } catch (e) {
      return reject(new NetArchiveUnavailable(e instanceof Error ? e.message : undefined));
    }
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: ["series", "symbol", "t"] });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(new NetArchiveUnavailable(open.error?.message));
    open.onblocked = () => reject(new NetArchiveUnavailable("Die Datenbank ist in einem anderen Tab gesperrt."));
  }).then((db): NetArchiveStore => {
    db.onversionchange = () => db.close();
    return {
      async put(series, symbol, rows) {
        if (!rows.length) return;
        const tx = db.transaction(STORE, "readwrite");
        const finished = done(tx);
        const store = tx.objectStore(STORE);
        for (const r of rows) store.put({ series, symbol, t: r.t, l: r.long, p: r.price, s: r.s });
        await finished;
      },
      async read(series, symbol, from = -Infinity) {
        const store = db.transaction(STORE, "readonly").objectStore(STORE);
        const all = (await req(store.getAll(rowRange(series, symbol, from)))) as unknown[];
        const out: ArchivedNetPoint[] = [];
        for (const raw of all) {
          const p = archivedOf(raw);
          if (p) out.push(p);
        }
        return out;
      },
      async trim(series, symbol, before) {
        const range = rowRange(series, symbol, -Infinity, before - 1);
        const count = await req(db.transaction(STORE, "readonly").objectStore(STORE).count(range));
        if (!count) return 0;
        const tx = db.transaction(STORE, "readwrite");
        const finished = done(tx);
        tx.objectStore(STORE).delete(range);
        await finished;
        return count;
      },
      async clear() {
        const count = await req(db.transaction(STORE, "readonly").objectStore(STORE).count());
        const tx = db.transaction(STORE, "readwrite");
        const finished = done(tx);
        tx.objectStore(STORE).clear();
        await finished;
        return count;
      },
      close() {
        db.close();
      },
    };
  });
}

/* ------------------------------------------------------------------------------------------------ the hook */

/** One connection per page (tests swap the factory). */
let shared: Promise<NetArchiveStore> | null = null;
let factoryOverride: IDBFactory | null | undefined;
const connect = (): Promise<NetArchiveStore> => (shared ??= openNetArchive(factoryOverride === undefined ? undefined : factoryOverride));

/** Tests: use another IndexedDB factory (`null` = none) and forget the shared connection and the switch. */
export function __resetNetArchive(factory?: IDBFactory | null): void {
  void shared?.then((s) => s.close()).catch(() => undefined);
  shared = null;
  factoryOverride = factory;
  on = null;
  listeners.clear();
}

export type NetArchiveStatus = "off" | "loading" | "ready" | "unavailable" | "error";

export interface NetArchiveInput {
  series: NetSeriesId;
  /** market symbol (`BTCUSDT`); `null` = not known yet */
  symbol: string | null;
  /** the live points of the series (may be empty) */
  live: readonly NetPoint[];
  /** spacing of the live points (ms) */
  stepMs: number | null;
}

export interface NetArchiveState {
  status: NetArchiveStatus;
  /** switch: are new points being stored? */
  recording: boolean;
  rows: readonly ArchivedNetPoint[];
  /** removes everything the card stored (all series, all symbols) */
  clear(): Promise<void>;
}

const READ_TIMEOUT_MS = 3000;

const signature = (live: readonly NetPoint[]): string => (live.length ? `${live.length}:${live[0]!.t}:${live[live.length - 1]!.t}:${live[live.length - 1]!.longPct}` : "");

/**
 * The stored history of one series and symbol, and the storing of the live points into it (when the switch is on). Reading
 * happens once per series / symbol; storing whenever the live series changed (a new period, a new point).
 */
export function useNetArchive({ series, symbol, live, stepMs }: NetArchiveInput): NetArchiveState {
  const recording = useNetArchiveOn();
  const [rows, setRows] = useState<readonly ArchivedNetPoint[]>([]);
  const [status, setStatus] = useState<NetArchiveStatus>("loading");
  const [rev, setRev] = useState(0);
  const sig = signature(live);

  // read what is stored
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    connect()
      .then((db) => db.read(series, symbol, Date.now() - ARCHIVE_KEEP_MS))
      .then((got) => {
        if (cancelled) return;
        setRows(got);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows([]);
        setStatus(e instanceof NetArchiveUnavailable ? "unavailable" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [series, symbol, rev]);

  // a read that never answers (the database blocked by another tab) must not keep the card waiting
  useEffect(() => {
    const id = setTimeout(() => setStatus((s) => (s === "loading" ? "error" : s)), READ_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [series, symbol, rev]);

  // store the live points (after the read, so the stored rows are not overwritten by a late answer)
  useEffect(() => {
    const points = live;
    if (!symbol || !recording || !points.length || stepMs === null || status === "unavailable") return;
    const grid = pointsForArchive(points, stepMs);
    if (!grid.length) return;
    let cancelled = false;
    connect()
      .then(async (db) => {
        await db.put(series, symbol, grid);
        await db.trim(series, symbol, grid[grid.length - 1]!.t - ARCHIVE_KEEP_MS);
        if (cancelled) return;
        setRows((cur) => {
          const byT = new Map(cur.map((r) => [r.t, r] as const));
          for (const g of grid) byT.set(g.t, g);
          return [...byT.values()].sort((a, b) => a.t - b.t);
        });
        setStatus((s) => (s === "loading" ? "ready" : s));
      })
      .catch((e: unknown) => {
        if (!cancelled) setStatus(e instanceof NetArchiveUnavailable ? "unavailable" : "error");
      });
    return () => {
      cancelled = true;
    };
    // `sig` stands for the live series (a new period, a new point); `status` only to stop after "unavailable"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, symbol, recording, sig, rev, status === "unavailable"]);

  const clear = useCallback(async () => {
    try {
      const db = await connect();
      await db.clear();
      setRows([]);
      setRev((r) => r + 1);
    } catch (e) {
      setStatus(e instanceof NetArchiveUnavailable ? "unavailable" : "error");
    }
  }, []);

  return useMemo(() => ({ status, recording, rows, clear }), [status, recording, rows, clear]);
}
