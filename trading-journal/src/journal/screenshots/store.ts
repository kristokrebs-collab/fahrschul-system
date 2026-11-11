/**
 * Screenshot blobs (Journal v3, P06; A2 originals).
 *
 * - Local: IndexedDB database `storageKey("shots")` (`tj2-shots` / `tj2share-shots`), object store `blobs`, key =
 *   `ScreenshotRef.key` (`shot_…`) – the ORIGINAL bytes of the file the trader chose. The derived preview lives in a
 *   second database `storageKey("shots-preview")` under the same key (a cache: it can always be made again from the
 *   original and is never part of a backup). Without IndexedDB (private mode of some browsers, `file://` in Safari) the
 *   blobs live in memory for this session and `shotStorage()` says so – the UI shows an honest hint. A FULL store
 *   (`QuotaExceededError`) is told apart from a missing one: `putShotBlobChecked` reports `problem: "quota"`, keeps the
 *   file in memory for this session and never shrinks it.
 * - Cloud: `cloud.ts` uploads to Supabase Storage (bucket `screenshots`, `<uid>/<file>`) when signed in.
 * - The trade only stores the reference (`trade.screenshots`), never the image: JSON backups stay small, and a backup
 *   does NOT contain the pictures (documented in `src/journal/README.md`).
 *
 * `shotUrl(ref)` resolves any reference to a displayable URL (object URL for blobs, cached; a signed URL for cloud
 * objects; the link itself for `store: "url"`).
 */
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import type { ScreenshotRef } from "@/domain/types";
import { newId } from "@/lib/ids";
import { isQuotaError, storageKey } from "@/store/storage";

export const SHOTS_DB = storageKey("shots");
export const SHOT_PREVIEW_DB = storageKey("shots-preview");

let store: UseStore | null = null;
let previewStore: UseStore | null = null;
let idbBroken = false;
const memory = new Map<string, Blob>();
const memoryPreview = new Map<string, Blob>();

function idb(): UseStore | null {
  if (idbBroken || typeof indexedDB === "undefined") return null;
  try {
    store ??= createStore(SHOTS_DB, "blobs");
    return store;
  } catch {
    idbBroken = true;
    return null;
  }
}

function idbPreview(): UseStore | null {
  if (idbBroken || typeof indexedDB === "undefined") return null;
  try {
    previewStore ??= createStore(SHOT_PREVIEW_DB, "previews");
    return previewStore;
  } catch {
    return null;
  }
}

/** Where new screenshots are kept on this device. */
export function shotStorage(): "idb" | "memory" {
  return idb() ? "idb" : "memory";
}

/** Whether `e` is the browser saying "the storage is full" (name and legacy codes as the journal's own check, plus engines that only say it in the message). */
export function isStorageFull(e: unknown): boolean {
  if (isQuotaError(e)) return true;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && /quota|storage.*full|disk.*full/i.test(m);
}

/** What `putShotBlobChecked` did: the file is on this device (`device`) or only in memory of this session (`ram`). */
export interface PutOutcome {
  key: string;
  where: "device" | "ram";
  /** Why it is only in memory: the store is full (`quota`) or there is none / it failed (`unavailable`). */
  problem?: "quota" | "unavailable";
}

/**
 * Stores a blob locally and says honestly where it went. A full store keeps the file in memory for this session (the
 * trader can still download it) and reports `quota` – nothing is shrunk or dropped silently, and the store is not
 * declared broken (space can be freed). Any other failure marks the store unusable for this session.
 */
export async function putShotBlobChecked(blob: Blob, key: string = newId("shot_")): Promise<PutOutcome> {
  const s = idb();
  if (!s) {
    memory.set(key, blob);
    return { key, where: "ram", problem: "unavailable" };
  }
  try {
    await set(key, blob, s);
    memory.delete(key);
    return { key, where: "device" };
  } catch (e) {
    const quota = isStorageFull(e);
    if (!quota) idbBroken = true;
    memory.set(key, blob);
    return { key, where: "ram", problem: quota ? "quota" : "unavailable" };
  }
}

/** Stores a blob locally and returns its key (memory when the store refuses; see `putShotBlobChecked` for the verdict). */
export async function putShotBlob(blob: Blob, key: string = newId("shot_")): Promise<string> {
  return (await putShotBlobChecked(blob, key)).key;
}

/** Whether the blob of `key` exists only in memory (lost with this page). */
export const isRamOnly = (key: string): boolean => memory.has(key);

/* ------------------------------------------------------- derived previews */

/** Keeps the derived preview of `key` (a cache: a refused write is silent, the original is shown instead). */
export async function putShotPreview(key: string, blob: Blob): Promise<boolean> {
  const s = idbPreview();
  if (s) {
    try {
      await set(key, blob, s);
      memoryPreview.delete(key);
      revokePreviewUrl(key);
      return true;
    } catch {
      /* full or unavailable: keep it for this session only */
    }
  }
  memoryPreview.set(key, blob);
  return false;
}

export async function getShotPreview(key: string): Promise<Blob | undefined> {
  const mem = memoryPreview.get(key);
  if (mem) return mem;
  const s = idbPreview();
  if (!s) return undefined;
  try {
    const v = await get<Blob>(key, s);
    return v instanceof Blob ? v : undefined;
  } catch {
    return undefined;
  }
}

async function deleteShotPreview(key: string): Promise<void> {
  memoryPreview.delete(key);
  revokePreviewUrl(key);
  const s = idbPreview();
  if (!s) return;
  try {
    await del(key, s);
  } catch {
    /* already gone */
  }
}

export async function getShotBlob(key: string): Promise<Blob | undefined> {
  const mem = memory.get(key);
  if (mem) return mem;
  const s = idb();
  if (!s) return undefined;
  try {
    const v = await get<Blob>(key, s);
    return v instanceof Blob ? v : undefined;
  } catch {
    return undefined;
  }
}

export async function deleteShotBlob(key: string): Promise<void> {
  memory.delete(key);
  revokeUrl(key);
  await deleteShotPreview(key);
  const s = idb();
  if (!s) return;
  try {
    await del(key, s);
  } catch {
    /* already gone */
  }
}

/** Every local blob key (IndexedDB + memory). */
export async function listShotKeys(): Promise<string[]> {
  const out = new Set(memory.keys());
  const s = idb();
  if (s) {
    try {
      for (const k of await keys<string>(s)) out.add(String(k));
    } catch {
      /* unreadable → nothing listed, nothing collected */
    }
  }
  return [...out];
}

/* ----------------------------------------------------------- display URLs */

const objectUrls = new Map<string, string>();
const previewUrls = new Map<string, string>();

function revokeUrl(key: string): void {
  const url = objectUrls.get(key);
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  objectUrls.delete(key);
}

function revokePreviewUrl(key: string): void {
  const url = previewUrls.get(key);
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  previewUrls.delete(key);
}

/** Object URL of the derived preview of a local blob, or `null` when there is none (the caller shows the original). */
export async function localPreviewUrl(key: string): Promise<string | null> {
  const cached = previewUrls.get(key);
  if (cached) return cached;
  const blob = await getShotPreview(key);
  if (!blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(blob);
  previewUrls.set(key, url);
  return url;
}

/** Object URL of a local blob (created once per key and kept for the session). */
export async function localShotUrl(key: string): Promise<string | null> {
  const cached = objectUrls.get(key);
  if (cached) return cached;
  const blob = await getShotBlob(key);
  if (!blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  return url;
}

/** The local cache key of a reference: its blob key (idb) or the cached copy of a cloud object. */
export function localKeyOf(ref: ScreenshotRef): string | null {
  if (ref.store === "idb") return ref.key ?? null;
  const cache = ref.cacheKey;
  return typeof cache === "string" && cache ? cache : null;
}

/**
 * Keys kept alive although no saved trade references them yet: the pictures of drafts waiting in the screenshot
 * import's queue (`journal/extract/store.ts`). `pinShotKeys` / `unpinShotKeys` are called by that queue only.
 */
const pinned = new Set<string>();
export const pinShotKeys = (keys: Iterable<string>): void => void [...keys].forEach((k) => pinned.add(k));
export const unpinShotKeys = (keys: Iterable<string>): void => void [...keys].forEach((k) => pinned.delete(k));
/** Whether a local key or cloud path is pinned (the cloud release honours it too). */
export const isShotPinned = (key: string): boolean => pinned.has(key);

/**
 * Collects local blobs no trade references any more (a screenshot removed from a trade, a deleted trade, an editor
 * closed without saving). `referenced` = every local key of every trade. Returns the number of removed blobs.
 */
export async function collectShotGarbage(referenced: ReadonlySet<string>): Promise<number> {
  let n = 0;
  for (const k of await listShotKeys()) {
    if (referenced.has(k) || pinned.has(k)) continue;
    await deleteShotBlob(k);
    n += 1;
  }
  return n;
}

/** Every local key referenced by `trades`. */
export function referencedShotKeys(trades: readonly { screenshots?: readonly ScreenshotRef[] }[]): Set<string> {
  const out = new Set<string>();
  for (const t of trades) for (const r of t.screenshots ?? []) {
    const k = localKeyOf(r);
    if (k) out.add(k);
  }
  return out;
}

/** Tests: forget the IndexedDB handle and the memory store. */
export function resetShotStoreForTests(): void {
  store = null;
  previewStore = null;
  idbBroken = false;
  memory.clear();
  memoryPreview.clear();
  pinned.clear();
  for (const k of [...objectUrls.keys()]) revokeUrl(k);
  for (const k of [...previewUrls.keys()]) revokePreviewUrl(k);
}
