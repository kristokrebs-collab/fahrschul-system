/**
 * Hash, preview and read-back check of a screenshot original without blocking the page (A2).
 * - web builds: ONE inline module worker (`shot.worker.ts`, `?worker&inline` – no extra file) hashes the bytes, derives the
 *   preview and reads the stored copy back to prove it is the file. It is shared by the intakes of a session and ends
 *   `WORKER_IDLE_MS` after the last one; `warmShotSession()` starts it early (the editor does so when the trader reaches for
 *   the drop zone), so the first picture does not wait for the worker to spawn. The main thread only posts a blob / a key
 *   and receives small results;
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
/** The shared worker ends this long after the last intake closed. */
export const WORKER_IDLE_MS = 20_000;

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

type Reply = Extract<WorkerResponse, { ok: true }>;
/** A request without its id (the worker session numbers them). */
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

/** The running worker and who still uses it. */
interface Shared {
  call(req: Req): Promise<Reply>;
  users: number;
  idle: ReturnType<typeof setTimeout> | undefined;
  dead: boolean;
  stop(): void;
}

let shared: Promise<Shared | null> | null = null;

async function startShared(): Promise<Shared | null> {
  if (!shotWorkerAllowed()) return null;
  let w: Worker;
  try {
    const W: new (opts?: { name?: string }) => Worker = (await import("./shot.worker?worker&inline")).default;
    w = new W({ name: "tj-screenshot" });
  } catch {
    workerBroken = true;
    return null;
  }
  let seq = 0;
  const waiting = new Map<number, { resolve: (m: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const me: Shared = {
    users: 0,
    idle: undefined,
    dead: false,
    stop() {
      me.dead = true;
      clearTimeout(me.idle);
      for (const p of waiting.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("worker gone"));
      }
      waiting.clear();
      try {
        w.terminate();
      } catch {
        /* gone */
      }
      shared = null;
    },
    call(req) {
      return new Promise<Reply>((resolve, reject) => {
        if (me.dead) return reject(new Error("worker gone"));
        const id = (seq += 1);
        const timer = setTimeout(() => {
          workerBroken = true;
          me.stop();
        }, SHOT_WORKER_SILENCE_MS);
        waiting.set(id, { resolve, reject, timer });
        w.postMessage({ ...req, id } as WorkerRequest);
      });
    },
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
  w.onerror = () => {
    workerBroken = true;
    me.stop();
  };
  return me;
}

const rest = (s: Shared): void => {
  clearTimeout(s.idle);
  s.idle = setTimeout(() => s.stop(), WORKER_IDLE_MS);
};

/** Starts the worker ahead of the first picture (it ends by itself when nothing uses it). Never throws. */
export function warmShotSession(): void {
  if (!shotWorkerAllowed()) return;
  shared ??= startShared();
  void shared.then((s) => {
    if (s && !s.dead && s.users === 0) rest(s);
  }, () => undefined);
}

/** Opens an intake session: the shared worker when the page can run one, else the main thread. Always resolves. */
export async function openShotSession(): Promise<ShotSession> {
  shared ??= startShared();
  const s = await shared.catch(() => null);
  if (!s || s.dead) return mainSession;
  s.users += 1;
  clearTimeout(s.idle);
  let closed = false;
  return {
    async derive(blob, known) {
      try {
        const m = await s.call({ op: "derive", blob, w: known?.w, h: known?.h });
        if (m.op === "derive") return { sha256: m.sha256, w: m.w, h: m.h, preview: m.preview, via: "worker" };
      } catch {
        /* the main thread does it */
      }
      return mainSession.derive(blob, known);
    },
    async verify(key) {
      try {
        const m = await s.call({ op: "verify", db: SHOTS_DB, key });
        if (m.op === "verify") return m.found && m.sha256 && m.size !== undefined ? { sha256: m.sha256, size: m.size } : null;
      } catch {
        /* the main thread does it */
      }
      return mainSession.verify(key);
    },
    close() {
      if (closed) return;
      closed = true;
      s.users = Math.max(0, s.users - 1);
      if (s.users === 0 && !s.dead) rest(s);
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

/** Tests: end the worker and forget a broken-worker verdict. */
export async function resetDeriveForTests(): Promise<void> {
  workerBroken = false;
  const s = shared ? await shared.catch(() => null) : null;
  s?.stop();
  shared = null;
}
