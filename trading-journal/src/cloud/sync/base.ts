/**
 * Sync base (P09): what this browser last agreed on with the cloud – the three-way reconcile needs it to tell "changed
 * here" from "changed there" (`reconcile.ts`). Stored per edition under `KEYS.cloudBase` (localStorage).
 * `owner` is the account the local journal was last synced with: a different account signing in never gets the
 * previous account's journal uploaded (`engine.ts` first login).
 */
import type { Settings } from "@/domain/types";
import { KEYS, readJson, removeKey, writeJson } from "@/store/storage";

export interface SyncBase {
  v: 1;
  owner: string;
  /** Last successful sync (ISO). */
  at: string;
  /** `kind:id` → content hash. */
  docs: Record<string, string>;
  /** Settings as last synced (merge3 base). */
  settings: Settings | null;
  /** Server `rev` of the settings row (optimistic lock). */
  settingsRev: number | null;
  /** Newest server `updated_at` seen (catch-up `pullSince`). */
  serverAt: string | null;
}

export interface BaseStore {
  read(): SyncBase | null;
  write(b: SyncBase): void;
  clear(): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses a stored base (`null` for anything malformed – the next sync then runs as a first login, lossless). */
export function parseBase(raw: unknown): SyncBase | null {
  if (!isObj(raw) || raw.v !== 1 || typeof raw.owner !== "string" || !raw.owner || !isObj(raw.docs)) return null;
  const docs: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.docs)) if (typeof v === "string") docs[k] = v;
  return {
    v: 1,
    owner: raw.owner,
    at: typeof raw.at === "string" ? raw.at : "",
    docs,
    settings: isObj(raw.settings) ? (raw.settings as unknown as Settings) : null,
    settingsRev: typeof raw.settingsRev === "number" ? raw.settingsRev : null,
    serverAt: typeof raw.serverAt === "string" ? raw.serverAt : null,
  };
}

/** localStorage-backed base of this edition. */
export const localBaseStore: BaseStore = {
  read: () => parseBase(readJson<unknown>(KEYS.cloudBase, null)),
  write: (b) => {
    writeJson(KEYS.cloudBase, b);
  },
  clear: () => removeKey(KEYS.cloudBase),
};

/** In-memory base (tests). */
export function memoryBaseStore(initial: SyncBase | null = null): BaseStore & { value: SyncBase | null } {
  const store = {
    value: initial,
    read: () => (store.value ? structuredClone(store.value) : null),
    write: (b: SyncBase) => {
      store.value = structuredClone(b);
    },
    clear: () => {
      store.value = null;
    },
  };
  return store;
}
