/**
 * Web worker of the screenshot intake (A2): hashes the original, derives the preview and checks the stored copy off the
 * main thread, so a 12 MB PNG never blocks a frame.
 *
 * - `derive`: `{ op, id, blob, w?, h? }` → `{ id, ok, op, sha256, w?, h?, preview }`
 * - `verify`: `{ op, id, db, key }` → `{ id, ok, op, found, sha256?, size? }` – reads the blob back out of IndexedDB
 *   (`db`, object store `blobs`) and hashes it, so the editor can prove the stored bytes are the file it was given.
 */
import { derivePreview } from "./preview";
import { sha256Hex } from "./sha256";

export type WorkerRequest = { op: "derive"; id: number; blob: Blob; w?: number; h?: number } | { op: "verify"; id: number; db: string; key: string };
export type WorkerResponse =
  | { id: number; ok: true; op: "derive"; sha256: string; w?: number; h?: number; preview: Blob | null }
  | { id: number; ok: true; op: "verify"; found: boolean; sha256?: string; size?: number }
  | { id: number; ok: false; message: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(m: WorkerResponse): void };

/** The blob stored under `key` in the idb-keyval database `db` (object store `blobs`), or `undefined`. */
function readStored(db: string, key: string): Promise<Blob | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(db);
    open.onerror = () => reject(open.error ?? new Error("open"));
    open.onsuccess = () => {
      const conn = open.result;
      if (!conn.objectStoreNames.contains("blobs")) {
        conn.close();
        resolve(undefined);
        return;
      }
      const get = conn.transaction("blobs").objectStore("blobs").get(key);
      get.onerror = () => {
        conn.close();
        reject(get.error ?? new Error("get"));
      };
      get.onsuccess = () => {
        conn.close();
        resolve(get.result instanceof Blob ? get.result : undefined);
      };
    };
  });
}

scope.onmessage = (e) => {
  const m = e.data;
  const fail = (err: unknown) => scope.postMessage({ id: m.id, ok: false, message: err instanceof Error ? err.message : "failed" });
  if (m.op === "derive") {
    void Promise.all([sha256Hex(m.blob), derivePreview(m.blob, { w: m.w, h: m.h })]).then(
      ([sha256, p]) => scope.postMessage({ id: m.id, ok: true, op: "derive", sha256, w: p.w, h: p.h, preview: p.preview }),
      fail,
    );
  } else {
    void readStored(m.db, m.key)
      .then(async (blob) => scope.postMessage(blob ? { id: m.id, ok: true, op: "verify", found: true, sha256: await sha256Hex(blob), size: blob.size } : { id: m.id, ok: true, op: "verify", found: false }))
      .catch(fail);
  }
};
