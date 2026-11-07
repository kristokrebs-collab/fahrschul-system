/**
 * Hash, preview and read-back check of a screenshot original without blocking the page (A2).
 * - web builds: ONE short-lived inline module worker per intake (`shot.worker.ts`, `?worker&inline` – no extra file)
 *   hashes the bytes, derives the preview and reads the stored copy back to prove it is the file; the main thread only
 *   posts a blob / a key and receives small results;
 * - single-file builds, `file:` pages, no `Worker`, or a worker that fails / falls silent: the same work on the main
 *   thread (`sha256Hex` hashes on the browser's own thread via `crypto.subtle`, or in 256 KiB slices with rests; the
 *   decoder scales off-thread), so the result is identical.
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { derivePreview } from "./preview";
import { sha256Hex } from "./sha256";
import type { WorkerRequest, WorkerResponse } from "./shot.worker";
import { getShotBlob, SHOTS_DB } from "./store";

export interface Derived {
  sha256: string;
  w?: number;
  h?: number;
  /** The derived preview; `null` = show the original. */
  preview: Blob | null;
  /** Which path ran (tests, diagnostics). */
  via: "worker" | "main";
}

export interface Stored {
  sha256: string;
  size: number;
}

/** One intake: derive the preview + hash of a file, then check what ended up in the store. */
export interface ShotSession {
  derive(blob: Blob, known?: { w?: number; h?: number }): Promise<Derived>;
  /** Hash and size of the blob stored under `key` (`null` = nothing there). */
  verify(key: string): Promise<Stored | null>;
  close(): void;
}

/** A worker that stays silent for this long is given up (the work continues on the main thread). */
export const SHOT_WORKER_SILENCE_MS = 30_000;

let workerBroken = false;

export function shotWorkerAllowed(): boolean {
  return !workerBroken && typeof Worker !== "undefined" && !IS_FILE_BUILD && !isFileProtocol();
}

/** The same work on the main thread. */
const mainSession: ShotSession = {
  async derive(blob, known) {
    const [sha256, p] = await Promise.all([sha256Hex(blob), derivePreview(blob, known)]);
    return { sha256, w: p.w ?? known?.w, h: p.h ?? known?.h, preview: p.preview, via: "main" };
  },
  async verify(key) {
    const back = await getShotBlob(key);
    return back ? { sha256: await sha256Hex(back), size: back.size } : null;
  },
  close() {},
};

async function startWorker(): Promise<Worker | null> {
  if (!shotWorkerAllowed()) return null;
  try {
    const W: new (opts?: { name?: string }) => Worker = (await import("./shot.worker?worker&inline")).default;
    return new W({ name: "tj-screenshot" });
  } catch {
    workerBroken = true;
    return null;
  }
}

type Reply = Extract<WorkerResponse, { ok: true }>;

/** Opens an intake session: a worker when the page can run one, else the main thread. Always resolves. */
export async function openShotSession(): Promise<ShotSession> {
  const w = await startWorker();
  if (!w) return mainSession;
  let seq = 0;
  let dead = false;
  const waiting = new Map<number, { resolve: (m: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const kill = (why: string) => {
    dead = true;
    workerBroken = true;
    for (const p of waiting.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(why));
    }
    waiting.clear();
    try {
      w.terminate();
    } catch {
      /* gone */
    }
  };
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m);
    else p.reject(new Error(m.message));
  };
  w.onerror = () => kill("worker error");
  const call = (req: WorkerRequest): Promise<Reply> =>
    new Promise((resolve, reject) => {
      if (dead) return reject(new Error("worker gone"));
      const timer = setTimeout(() => kill("silent"), SHOT_WORKER_SILENCE_MS);
      waiting.set(req.id, { resolve, reject, timer });
      w.postMessage(req);
    });
  return {
    async derive(blob, known) {
      try {
        const m = await call({ op: "derive", id: (seq += 1), blob, w: known?.w, h: known?.h });
        if (m.op === "derive") return { sha256: m.sha256, w: m.w, h: m.h, preview: m.preview, via: "worker" };
      } catch {
        /* the main thread does it */
      }
      return mainSession.derive(blob, known);
    },
    async verify(key) {
      try {
        const m = await call({ op: "verify", id: (seq += 1), db: SHOTS_DB, key });
        if (m.op === "verify") return m.found && m.sha256 && m.size !== undefined ? { sha256: m.sha256, size: m.size } : null;
      } catch {
        /* the main thread does it */
      }
      return mainSession.verify(key);
    },
    close() {
      dead = true;
      for (const p of waiting.values()) clearTimeout(p.timer);
      try {
        w.terminate();
      } catch {
        /* gone */
      }
    },
  };
}

/** Hash and preview of `blob` in a session of its own. */
export async function deriveShot(blob: Blob, known?: { w?: number; h?: number }): Promise<Derived> {
  const s = await openShotSession();
  try {
    return await s.derive(blob, known);
  } finally {
    s.close();
  }
}

/** Tests: forget a broken-worker verdict. */
export function resetDeriveForTests(): void {
  workerBroken = false;
}
