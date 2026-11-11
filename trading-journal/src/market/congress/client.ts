/**
 * The Congress data contract implemented against our own functions (`/api/v1/congress/index`, `/api/v1/congress/ptr`,
 * `netlify/functions/congress-*.mts`). Everything that can go wrong is a typed result (`ok | stale | unavailable(reason)`), never
 * a thrown error and never invented data:
 *   - cache first (memory + IndexedDB, keys `congress:…`): the index is fresh for 10 minutes; a posted report never changes, so it
 *     is kept for weeks (a report the reader could not read is asked again after 12 hours – the reader may have improved);
 *   - one request per index, one per four reports, through a small throttle (the Clerk is an agency site, not an API);
 *   - a failed refresh with a cached answer is `stale` (the old data, its own stand, the reason);
 *   - without such an answer it is `unavailable` with the reason in German (no server here, not signed in, plan, limit, the Clerk
 *     down or changed its format);
 *   - answers are validated (`wire.ts`); a shape the app does not know is `bad-response`, not partial data.
 * Only a year and document numbers leave the device.
 */
import { ApiError, apiFetch, FUNCTIONS_MISSING, type ApiFetchInit } from "@/cloud/api";
import { idbKV, memoryKV, type KVStore } from "../cache";
import { createLimiter, type Limiter } from "../stocks/throttle";
import { CONGRESS_LIMITS, CONGRESS_SOURCE, indexPayloadOk, ptrPayloadOk, type CongressIndexPayload, type CongressPtrResult, type CongressReport } from "./wire";
import { CONGRESS_REASON_TEXT, okResult, staleResult, unavailableResult, type CongressReason, type CongressResult, type CongressStamp } from "./result";

type Api = <T>(path: string, init?: ApiFetchInit) => Promise<T>;

/** Bump when the reader (server) learns to read more: cached "unreadable" reports are then asked again. */
export const CONGRESS_READER_VERSION = 1;

const MIN = 60_000;
const H = 3_600_000;
const D = 24 * H;
export const INDEX_AGES = { ttl: 10 * MIN, maxStale: 14 * D } as const;
export const REPORT_AGES = { ttl: 30 * D, maxStale: 120 * D, ttlUnreadable: 12 * H } as const;
/** Pause after a limit (the server asks for 30 s). */
export const RATE_BACKOFF_MS = 30_000;

export const CACHE_PREFIX = "congress:";
const indexKey = (year: number): string => `${CACHE_PREFIX}index:${year}`;
const reportKey = (year: number, docId: string): string => `${CACHE_PREFIX}ptr:${year}:${docId}`;

interface Entry<T> {
  v: 1;
  data: T;
  stamp: CongressStamp;
  storedAt: number;
  reader: number;
}

const isEntry = (v: unknown): v is Entry<unknown> => typeof v === "object" && v !== null && (v as { v?: unknown }).v === 1 && typeof (v as { storedAt?: unknown }).storedAt === "number" && typeof (v as { stamp?: unknown }).stamp === "object" && "data" in (v as object);

export interface CongressDataDeps {
  api?: Api;
  now?: () => number;
  /** `undefined` = IndexedDB (memory only where it does not exist), `null` = memory only */
  kv?: KVStore | null;
  limiter?: Limiter;
  online?: () => boolean;
}

export interface ReadOptions {
  signal?: AbortSignal;
  /** skip the cache once and ask the source */
  fresh?: boolean;
}

export interface ReportsOptions extends ReadOptions {
  /** called for every report as soon as it is known (cache hits first, then each answered batch) */
  onResult?: (docId: string, result: CongressResult<CongressReport>) => void;
}

export interface CongressData {
  index(year: number, opts?: ReadOptions): Promise<CongressResult<CongressIndexPayload>>;
  reports(year: number, docIds: readonly string[], opts?: ReportsOptions): Promise<Record<string, CongressResult<CongressReport>>>;
  /** what is stored for these reports, without asking the network (`null` = nothing usable) */
  stored(year: number, docIds: readonly string[]): Promise<Record<string, CongressResult<CongressReport> | null>>;
  clear(): Promise<void>;
}

interface Fail {
  reason: CongressReason;
  message: string;
}

class BadResponse extends Error {}
const isAbort = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

export function failFrom(e: unknown, online: () => boolean = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false)): Fail {
  const T = CONGRESS_REASON_TEXT;
  if (isAbort(e)) return { reason: "aborted", message: T.aborted };
  if (e instanceof BadResponse) return { reason: "bad-response", message: T["bad-response"] };
  if (e instanceof ApiError) {
    const msg = e.message;
    if (e.status === 0) {
      if (msg === FUNCTIONS_MISSING || msg.startsWith("In der Offline-Datei")) return { reason: "no-server", message: T["no-server"] };
      return online() ? { reason: "network", message: T.network } : { reason: "offline", message: T.offline };
    }
    if (e.status === 401) return { reason: "login", message: msg };
    if (e.status === 402) return { reason: "plan", message: msg };
    if (e.code === "congress_no_index") return { reason: "no-index", message: msg };
    if (e.code === "congress_format") return { reason: "format", message: msg };
    if (e.code === "congress_timeout") return { reason: "timeout", message: msg };
    if (e.status === 429 || e.code === "rate_limited" || e.code === "congress_busy") return { reason: "rate-limited", message: msg };
    if (e.status === 400) return { reason: "bad-response", message: msg };
    if (e.status === 404) return { reason: "no-server", message: T["no-server"] };
    return { reason: "upstream", message: msg };
  }
  return online() ? { reason: "network", message: T.network } : { reason: "offline", message: T.offline };
}

const FAILURE_REASON: Readonly<Record<Extract<CongressPtrResult, { ok: false }>["reason"], CongressReason>> = {
  "not-found": "no-data",
  timeout: "timeout",
  upstream: "upstream",
  busy: "rate-limited",
};

const chunks = <T>(list: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

export function createCongressData(deps: CongressDataDeps = {}): CongressData {
  const api: Api = deps.api ?? ((path, init) => apiFetch(path, init));
  const now = deps.now ?? (() => Date.now());
  const store: KVStore | null = deps.kv === undefined ? idbKV() : deps.kv;
  const mem = memoryKV();
  const limiter = deps.limiter ?? createLimiter({ now });
  const online = deps.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  const read = async <T>(key: string): Promise<Entry<T> | null> => {
    const m = await mem.get(key);
    if (isEntry(m)) return m as Entry<T>;
    if (!store) return null;
    try {
      const v = await store.get(key);
      if (isEntry(v)) {
        await mem.set(key, v);
        return v as Entry<T>;
      }
    } catch {
      /* unreadable: treated as not cached */
    }
    return null;
  };
  const write = async <T>(key: string, data: T, stamp: CongressStamp): Promise<void> => {
    const entry: Entry<T> = { v: 1, data, stamp, storedAt: now(), reader: CONGRESS_READER_VERSION };
    await mem.set(key, entry);
    if (!store) return;
    try {
      await store.set(key, entry);
    } catch {
      /* quota / private mode: the cache is best effort */
    }
  };
  const call = <T>(path: string, query: Record<string, string>, o: ReadOptions): Promise<T> => {
    const init: ApiFetchInit = { query, ...(o.signal ? { signal: o.signal } : {}), ...(o.fresh ? { cache: "no-cache" as RequestCache } : {}) };
    return limiter.run(() => api<T>(path, init), o.signal ? { signal: o.signal } : {});
  };
  const noteFail = (f: Fail): void => {
    if (f.reason === "rate-limited") limiter.backoff(RATE_BACKOFF_MS);
  };

  const reportFresh = (e: Entry<CongressReport>, t: number): boolean => {
    if (e.data.status === "ok") return t - e.storedAt <= REPORT_AGES.ttl;
    return e.reader === CONGRESS_READER_VERSION && t - e.storedAt <= REPORT_AGES.ttlUnreadable;
  };
  const reportUsable = (e: Entry<CongressReport> | null, t: number): e is Entry<CongressReport> => !!e && t - e.storedAt <= REPORT_AGES.maxStale;

  return {
    async index(year, opts = {}) {
      const key = indexKey(year);
      const cached = await read<CongressIndexPayload>(key);
      const t0 = now();
      if (!opts.fresh && cached && t0 - cached.storedAt <= INDEX_AGES.ttl) return okResult(cached.data, cached.stamp);
      let raw: unknown;
      try {
        raw = await call<unknown>("/congress/index", { year: String(year) }, opts);
        if (!indexPayloadOk(raw)) throw new BadResponse();
      } catch (e) {
        const f = failFrom(e, online);
        noteFail(f);
        const t = now();
        if (cached && f.reason !== "aborted" && f.reason !== "no-index" && t - cached.storedAt <= INDEX_AGES.maxStale) return staleResult(cached.data, cached.stamp, f.reason, f.message, t);
        return unavailableResult(f.reason, t, f.message);
      }
      const received = now();
      const stamp: CongressStamp = { source: CONGRESS_SOURCE, asOf: raw.fileTime, receivedAt: received, fetchedAt: raw.fetchedAt };
      if (raw.stale) {
        // the server could not read the Clerk and sent its older copy: say so, and do not store it as fresh
        return staleResult(raw, stamp, "upstream", `Der House Clerk war gerade nicht erreichbar. Gezeigt wird die Kopie, die der Server zuletzt lesen konnte.`, received);
      }
      await write(key, raw, stamp);
      return okResult(raw, stamp);
    },

    async stored(year, docIds) {
      const out: Record<string, CongressResult<CongressReport> | null> = {};
      const t = now();
      await Promise.all(
        docIds.map(async (d) => {
          const e = await read<CongressReport>(reportKey(year, d));
          out[d] = reportUsable(e, t) ? (reportFresh(e, t) ? okResult(e.data, e.stamp) : staleResult(e.data, e.stamp, "upstream", "Nicht neu geprüft.", t)) : null;
        }),
      );
      return out;
    },

    async reports(year, docIds, opts = {}) {
      const list = [...new Set(docIds)];
      const out: Record<string, CongressResult<CongressReport>> = {};
      const emit = (d: string, r: CongressResult<CongressReport>): void => {
        out[d] = r;
        opts.onResult?.(d, r);
      };
      const t0 = now();
      const cached = new Map<string, Entry<CongressReport> | null>();
      await Promise.all(list.map(async (d) => void cached.set(d, await read<CongressReport>(reportKey(year, d)))));
      const todo: string[] = [];
      for (const d of list) {
        const e = cached.get(d) ?? null;
        if (!opts.fresh && e && reportFresh(e, t0)) emit(d, okResult(e.data, e.stamp));
        else todo.push(d);
      }
      const fallback = (d: string, f: Fail): CongressResult<CongressReport> => {
        const e = cached.get(d) ?? null;
        const t = now();
        return e && f.reason !== "aborted" && reportUsable(e, t) ? staleResult(e.data, e.stamp, f.reason, f.message, t) : unavailableResult(f.reason, t, f.message);
      };
      for (const chunk of chunks(todo, CONGRESS_LIMITS.docsPerRequest)) {
        if (opts.signal?.aborted) {
          for (const d of chunk) emit(d, unavailableResult("aborted", now()));
          continue;
        }
        let payload: unknown;
        try {
          payload = await call<unknown>("/congress/ptr", { year: String(year), docs: chunk.join(",") }, opts);
          if (!ptrPayloadOk(payload)) throw new BadResponse();
        } catch (e) {
          const f = failFrom(e, online);
          noteFail(f);
          for (const d of chunk) emit(d, fallback(d, f));
          continue;
        }
        const received = now();
        for (const d of chunk) {
          const r = payload.results[d];
          if (!r) emit(d, fallback(d, { reason: "bad-response", message: CONGRESS_REASON_TEXT["bad-response"] }));
          else if (!r.ok) {
            const f: Fail = { reason: FAILURE_REASON[r.reason], message: r.message };
            noteFail(f);
            emit(d, fallback(d, f));
          } else {
            const stamp: CongressStamp = { source: CONGRESS_SOURCE, asOf: null, receivedAt: received, fetchedAt: r.report.readAt };
            await write(reportKey(year, d), r.report, stamp);
            emit(d, okResult(r.report, stamp));
          }
        }
      }
      return out;
    },

    async clear() {
      await mem.keys().then((ks) => Promise.all(ks.map((k) => mem.del(k))));
      if (!store) return;
      try {
        for (const key of await store.keys()) if (key.startsWith(CACHE_PREFIX)) await store.del(key);
      } catch {
        /* best effort */
      }
    },
  };
}

let instance: CongressData | null = null;
/** The app's one instance (real API, IndexedDB cache, own throttle). */
export function congressData(): CongressData {
  return (instance ??= createCongressData());
}
