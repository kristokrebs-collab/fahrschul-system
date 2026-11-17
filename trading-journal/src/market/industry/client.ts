/**
 * The industry-data contract implemented against our own function (`/api/v1/industry/daily`, `netlify/functions/industry-daily.mts`).
 * Everything that can go wrong is a typed result (`ok | stale | unavailable(reason)`), never a thrown error and never invented data:
 *   - cache first (memory + IndexedDB, key `industry:daily`): the file changes about once a month, so a copy is fresh for 12 hours;
 *   - a failed refresh with a copy on the device is `stale` (the old data, its own stand, the reason);
 *   - without a copy it is `unavailable` with the reason in German (no server here, not signed in, plan, limit, the library down or
 *     changed its file, offline);
 *   - the answer is validated (`wire.ts`) and unpacked with length checks (`decode.ts`); a shape the app does not know is `bad-response`.
 * Nothing leaves the device: the request has no parameters.
 */
import { ApiError, apiFetch, FUNCTIONS_MISSING, type ApiFetchInit } from "@/cloud/api";
import type { IndustryDataset } from "@/domain/industryTrend";
import { idbKV, memoryKV, type KVStore } from "../cache";
import { DecodeError, decodeIndustry, type Gunzip } from "./decode";
import { INDUSTRY_REASON_TEXT, okResult, staleResult, unavailableResult, type IndustryReason, type IndustryResult, type IndustryStamp } from "./result";
import { INDUSTRY_SOURCE, industryPayloadOk, type IndustryDailyPayload } from "./wire";

type Api = <T>(path: string, init?: ApiFetchInit) => Promise<T>;

const H = 3_600_000;
const D = 24 * H;
export const INDUSTRY_AGES = { ttl: 12 * H, maxStale: 400 * D } as const;
export const INDUSTRY_CACHE_KEY = "industry:daily";

interface Entry {
  v: 1;
  data: IndustryDataset;
  stamp: IndustryStamp;
  storedAt: number;
}

const isEntry = (v: unknown): v is Entry => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Partial<Entry>;
  const d = e.data as Partial<IndustryDataset> | undefined;
  return e.v === 1 && typeof e.storedAt === "number" && typeof e.stamp === "object" && e.stamp !== null && !!d && Array.isArray(d.names) && d.dates instanceof Int32Array && d.returns instanceof Int16Array && d.returns.length === d.names.length * d.dates.length;
};

export interface IndustryDataDeps {
  api?: Api;
  now?: () => number;
  /** `undefined` = IndexedDB (memory only where it does not exist), `null` = memory only */
  kv?: KVStore | null;
  online?: () => boolean;
  gunzip?: Gunzip;
}

export interface IndustryReadOptions {
  signal?: AbortSignal;
  /** skip the cache once and ask the source */
  fresh?: boolean;
}

export interface IndustryData {
  load(opts?: IndustryReadOptions): Promise<IndustryResult>;
  clear(): Promise<void>;
}

interface Fail {
  reason: IndustryReason;
  message: string;
}

class BadResponse extends Error {}
const isAbort = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

export function industryFailFrom(e: unknown, online: () => boolean = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false)): Fail {
  const T = INDUSTRY_REASON_TEXT;
  if (isAbort(e)) return { reason: "aborted", message: T.aborted };
  if (e instanceof BadResponse || e instanceof DecodeError) return { reason: "bad-response", message: e instanceof DecodeError ? `${T["bad-response"]} (${e.message})` : T["bad-response"] };
  if (e instanceof ApiError) {
    const msg = e.message;
    if (e.status === 0) {
      if (msg === FUNCTIONS_MISSING || msg.startsWith("In der Offline-Datei")) return { reason: "no-server", message: T["no-server"] };
      return online() ? { reason: "network", message: T.network } : { reason: "offline", message: T.offline };
    }
    if (e.status === 401) return { reason: "login", message: msg };
    if (e.status === 402) return { reason: "plan", message: msg };
    if (e.code === "industry_format") return { reason: "format", message: msg };
    if (e.code === "industry_timeout") return { reason: "timeout", message: msg };
    if (e.status === 429 || e.code === "rate_limited") return { reason: "rate-limited", message: msg };
    if (e.status === 400) return { reason: "bad-response", message: msg };
    if (e.status === 404) return { reason: "no-server", message: T["no-server"] };
    return { reason: "upstream", message: msg };
  }
  return online() ? { reason: "network", message: T.network } : { reason: "offline", message: T.offline };
}

export function createIndustryData(deps: IndustryDataDeps = {}): IndustryData {
  const api: Api = deps.api ?? ((path, init) => apiFetch(path, init));
  const now = deps.now ?? (() => Date.now());
  const store: KVStore | null = deps.kv === undefined ? idbKV() : deps.kv;
  const mem = memoryKV();
  const online = deps.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  let inflight: Promise<IndustryResult> | null = null;

  const read = async (): Promise<Entry | null> => {
    const m = await mem.get(INDUSTRY_CACHE_KEY);
    if (isEntry(m)) return m;
    if (!store) return null;
    try {
      const v = await store.get(INDUSTRY_CACHE_KEY);
      if (isEntry(v)) {
        await mem.set(INDUSTRY_CACHE_KEY, v);
        return v;
      }
    } catch {
      /* unreadable: treated as not cached */
    }
    return null;
  };
  const write = async (data: IndustryDataset, stamp: IndustryStamp): Promise<void> => {
    const entry: Entry = { v: 1, data, stamp, storedAt: now() };
    await mem.set(INDUSTRY_CACHE_KEY, entry);
    if (!store) return;
    try {
      await store.set(INDUSTRY_CACHE_KEY, entry);
    } catch {
      /* quota / private mode: the cache is best effort */
    }
  };

  const run = async (opts: IndustryReadOptions): Promise<IndustryResult> => {
    const cached = await read();
    const t0 = now();
    if (!opts.fresh && cached && t0 - cached.storedAt <= INDUSTRY_AGES.ttl) return okResult(cached.data, cached.stamp);
    let payload: IndustryDailyPayload;
    let data: IndustryDataset;
    try {
      const init: ApiFetchInit = { ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.fresh ? { cache: "no-cache" as RequestCache } : {}) };
      const raw = await api<unknown>("/industry/daily", init);
      if (!industryPayloadOk(raw)) throw new BadResponse();
      payload = raw;
      data = await decodeIndustry(payload, deps.gunzip);
    } catch (e) {
      const f = industryFailFrom(e, online);
      const t = now();
      if (cached && f.reason !== "aborted" && t - cached.storedAt <= INDUSTRY_AGES.maxStale) return staleResult(cached.data, cached.stamp, f.reason, f.message, t);
      return unavailableResult(f.reason, t, f.message);
    }
    const received = now();
    const stamp: IndustryStamp = { source: INDUSTRY_SOURCE, asOf: payload.lastDay, database: payload.database, fileTime: payload.fileTime, receivedAt: received, fetchedAt: payload.fetchedAt };
    if (payload.stale) {
      // the server could not read the library and sent its older copy: say so, and do not store it as fresh
      return staleResult(data, stamp, "upstream", "Die Ken-French-Bibliothek war gerade nicht erreichbar. Gezeigt wird die Kopie, die der Server zuletzt lesen konnte.", received);
    }
    await write(data, stamp);
    return okResult(data, stamp);
  };

  return {
    load(opts = {}) {
      // one request at a time: a second caller shares the first one's answer (a "fresh" caller waits for it and then asks again)
      if (inflight && !opts.fresh) return inflight;
      const p = run(opts).finally(() => {
        if (inflight === p) inflight = null;
      });
      inflight = p;
      return p;
    },
    async clear() {
      await mem.keys().then((ks) => Promise.all(ks.map((k) => mem.del(k))));
      if (!store) return;
      try {
        await store.del(INDUSTRY_CACHE_KEY);
      } catch {
        /* best effort */
      }
    },
  };
}

let instance: IndustryData | null = null;
/** The app's one instance (real API, IndexedDB cache). */
export function industryData(): IndustryData {
  return (instance ??= createIndustryData());
}
