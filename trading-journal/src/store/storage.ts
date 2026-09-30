/**
 * localStorage keys and the `g`/`h` read/write helpers of the original bundle.
 * Every localStorage access in `src/store` goes through this file (try/catch everywhere).
 */
export const KEYS = {
  trades: "tj2-trades",
  settings: "tj2-settings",
  hyblock: "tj2-hyblock",
  meta: "tj2-meta",
  ui: "tj2-ui",
  quarantine: "tj2-quarantine",
  triggerLast: "tj2-trigger-last",
  backupPrefix: "tj2-backup-",
} as const;

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Bundle `g`: parse JSON or return the fallback (also on invalid JSON / blocked storage). */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Raw string read (used for backups and quarantine sizes). */
export function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
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
