/**
 * localStorage keys and the `g`/`h` read/write helpers of the original bundle.
 * Every localStorage access in `src/store` goes through this file (try/catch everywhere).
 *
 * Namespaces: the personal edition (web root, "persönlich" file) uses `tj2-*` – the same keys as the other journal
 * version, so existing data is picked up. The share edition ("zum Teilen": Netlify `/teilen/`, share file) uses
 * `tj2share-*`, so testing it on the same origin / browser never reads or writes the personal journal.
 * Other modules that persist their own flags should build their key with `storageKey("name")`.
 *
 * Storage availability: when the browser grants no usable localStorage (an HTML file opened from an Android
 * `content://` URL, sandboxed frames, blocked site data) the journal keeps working on an in-memory store for this
 * session and `storageStatus()` reports `"unavailable"` (the banner offers backup import/export).
 */
import { IS_SHARE } from "@/edition";

/** `tj2-` (personal) or `tj2share-` (share edition). */
export const KEY_PREFIX: string = IS_SHARE ? "tj2share-" : "tj2-";

/** Edition-namespaced storage key, e.g. `storageKey("fill-setups")` → `tj2-fill-setups` / `tj2share-fill-setups`. */
export function storageKey(name: string): string {
  return `${KEY_PREFIX}${name}`;
}

export const KEYS = {
  trades: storageKey("trades"),
  settings: storageKey("settings"),
  hyblock: storageKey("hyblock"),
  /** Day journal `{ "YYYY-MM-DD": DayNote }` (NEW). */
  days: storageKey("days"),
  meta: storageKey("meta"),
  ui: storageKey("ui"),
  quarantine: storageKey("quarantine"),
  triggerLast: storageKey("trigger-last"),
  backupPrefix: storageKey("backup-"),
} as const;

/** The journal data keys other tabs may change (`storage` event sync, see `localAdapter`). */
export const DATA_KEYS: readonly string[] = [KEYS.trades, KEYS.settings, KEYS.hyblock, KEYS.days];

/* ------------------------------------------------------------ availability */

export type StorageStatus = "ok" | "unavailable";

/** In-memory `Storage` used for the session when localStorage is not usable (nothing persists). */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

let fallback: MemoryStorage | null = null;
let probed: { status: StorageStatus; target: Storage | null } | null = null;
const PROBE_KEY = storageKey("probe");

/**
 * Probes localStorage once: access + setItem/removeItem of a probe key. A quota error on a store that already holds
 * data counts as usable (full, not missing – writes then fail with `StorageWriteError`); a quota error on an EMPTY
 * store (Safari private mode) or any other error counts as unavailable.
 */
function probe(): { status: StorageStatus; target: Storage | null } {
  if (probed) return probed;
  let ls: Storage | null;
  try {
    ls = typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    ls = null;
  }
  let ok = false;
  if (ls) {
    try {
      ls.setItem(PROBE_KEY, "1");
      ls.removeItem(PROBE_KEY);
      ok = true;
    } catch (e) {
      let length: number;
      try {
        length = ls.length;
      } catch {
        length = 0;
      }
      ok = isQuotaError(e) && length > 0;
    }
  }
  if (ok) probed = { status: "ok", target: ls };
  else {
    fallback ??= new MemoryStorage();
    probed = { status: "unavailable", target: fallback };
  }
  return probed;
}

/** `"unavailable"` when nothing persists in this browser/file (the journal then runs on a session-only store). */
export function storageStatus(): StorageStatus {
  return probe().status;
}

/** Tests: forget the cached probe (and the session store). */
export function resetStorageProbe(): void {
  probed = null;
  fallback = null;
}

function storage(): Storage | null {
  return probe().target;
}

/** Result of `readJsonDetailed`: the key is absent, parsed fine, or holds a string that is not JSON. */
export type JsonRead<T> = { status: "missing" } | { status: "ok"; value: T } | { status: "corrupt"; raw: string };

/**
 * Raw read + parse without side effects. `corrupt` carries the raw string so callers can preserve it
 * (migration snapshot, quarantine) instead of silently treating it as the fallback.
 */
export function readJsonDetailed<T>(key: string): JsonRead<T> {
  let raw: string | null;
  try {
    raw = storage()?.getItem(key) ?? null;
  } catch {
    return { status: "missing" };
  }
  if (raw === null || raw === "") return { status: "missing" };
  try {
    return { status: "ok", value: JSON.parse(raw) as T };
  } catch {
    return { status: "corrupt", raw };
  }
}

/** Entry written to `tj2-quarantine` for an unparseable key (same shape as `QuarantineEntry` in `migrate.ts`). */
export interface CorruptBlobEntry {
  kind: "blob";
  key: string;
  raw: string;
  error: string;
  at: string;
}

/** Keys whose corruption is not copied into the quarantine (the quarantine itself is preserved under a side key). */
function quarantineSideKey(at: string): string {
  return `${KEYS.quarantine}-corrupt-${at}`;
}

/** True when `tj2-quarantine` already holds this raw string for `key`. */
export function isRawQuarantined(key: string, raw: string): boolean {
  const q = readJsonDetailed<unknown>(KEYS.quarantine);
  if (q.status !== "ok" || !Array.isArray(q.value)) return false;
  return q.value.some((e) => {
    const entry = e as Partial<CorruptBlobEntry> | null;
    return !!entry && typeof entry === "object" && entry.kind === "blob" && entry.key === key && entry.raw === raw;
  });
}

/**
 * Copies the unparseable raw string of `key` into `tj2-quarantine` as `{ kind:"blob", key, raw, error, at }`
 * (once per key+raw). Returns whether the raw string is now preserved. A corrupt quarantine key itself is moved
 * aside to `tj2-quarantine-corrupt-{at}` first so nothing is lost.
 */
export function quarantineRaw(key: string, raw: string, at: string = new Date().toISOString()): boolean {
  if (isRawQuarantined(key, raw)) return true;
  const existing = readJsonDetailed<unknown>(KEYS.quarantine);
  let list: unknown[] = [];
  if (existing.status === "ok" && Array.isArray(existing.value)) list = existing.value;
  else if (existing.status === "corrupt") {
    if (key === KEYS.quarantine) return false;
    if (!writeJson(quarantineSideKey(at), existing.raw)) return false;
  }
  if (key === KEYS.quarantine) return writeJson(quarantineSideKey(at), raw);
  const entry: CorruptBlobEntry = { kind: "blob", key, raw, error: "invalid JSON", at };
  return writeJson(KEYS.quarantine, list.concat([entry]));
}

/**
 * Bundle `g`: parse JSON or return the fallback (also on invalid JSON / blocked storage).
 * An unparseable value is copied to `tj2-quarantine` before the fallback is returned, so a later write to the
 * same key can never destroy the only copy (see `assertWritable`).
 */
export function readJson<T>(key: string, fallback: T): T {
  const r = readJsonDetailed<T>(key);
  if (r.status === "ok") return r.value;
  if (r.status === "corrupt") quarantineRaw(key, r.raw);
  return fallback;
}

/**
 * Write guard for adapters: when `key` currently holds a string that is not JSON, the raw string must be in
 * the quarantine before it may be overwritten. Throws `StorageWriteError` when it cannot be preserved.
 */
export function assertWritable(key: string): void {
  const r = readJsonDetailed<unknown>(key);
  if (r.status !== "corrupt") return;
  if (!quarantineRaw(key, r.raw)) throw new StorageWriteError(new Error(`unparseable value under ${key} could not be quarantined`));
}

/** Raw string read (used for backups and quarantine sizes). */
export function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Raw string write (rollback of a previous value). Returns whether it succeeded. */
export function writeRaw(key: string, raw: string): boolean {
  try {
    storage()?.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function hasKey(key: string): boolean {
  return readRaw(key) !== null;
}

/** Bundle `h`: write JSON, swallow errors. Returns whether the write succeeded. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    storage()?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Like `writeJson` but rethrows so callers can react to `QuotaExceededError`. */
export function writeJsonStrict(key: string, value: unknown): void {
  const s = storage();
  if (!s) throw new Error("localStorage unavailable");
  s.setItem(key, JSON.stringify(value));
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** All keys starting with `prefix`, sorted ascending (ISO / date tags sort chronologically). */
export function listKeys(prefix: string): string[] {
  const s = storage();
  if (!s) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch {
    return out;
  }
  return out.sort();
}

export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; code?: number };
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 ||
    err.code === 1014
  );
}

/** Error thrown by adapters when a write could not be persisted. Message is the toast title. */
export class StorageWriteError extends Error {
  readonly quota: boolean;
  constructor(cause: unknown) {
    super("Speichern fehlgeschlagen");
    this.name = "StorageWriteError";
    this.quota = isQuotaError(cause);
  }
}
