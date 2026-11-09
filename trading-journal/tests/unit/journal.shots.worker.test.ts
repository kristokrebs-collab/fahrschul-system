// @vitest-environment node
/**
 * The worker session of the screenshot intake (A2) with a fake `Worker`: one worker is shared by the intakes of a session,
 * started early by `warmShotSession`, ended `WORKER_IDLE_MS` after the last one closed; a worker that errors is dropped and
 * the same work runs on the main thread with the same result.
 */
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const instances: { posted: { op: string; id: number }[]; terminated: boolean }[] = [];
  const mode = { fail: false, silent: false };
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    posted: { op: string; id: number }[] = [];
    terminated = false;
    constructor() {
      instances.push(this);
    }
    postMessage(m: { op: string; id: number }) {
      this.posted.push(m);
      if (mode.silent) return;
      queueMicrotask(() => {
        if (mode.fail) return this.onerror?.();
        if (m.op === "derive") this.onmessage?.({ data: { id: m.id, ok: true, op: "derive", sha256: "ab".repeat(32), w: 10, h: 20, preview: null } });
        else this.onmessage?.({ data: { id: m.id, ok: true, op: "verify", found: true, sha256: "cd".repeat(32), size: 5 } });
      });
    }
    terminate() {
      this.terminated = true;
    }
  }
  return { instances, mode, FakeWorker };
});
vi.mock("@/journal/screenshots/shot.worker?worker&inline", () => ({ default: h.FakeWorker }));

const derive = await import("@/journal/screenshots/derive");
const store = await import("@/journal/screenshots/store");

const sha = (u: Uint8Array) => createHash("sha256").update(u).digest("hex");

beforeEach(() => {
  vi.stubGlobal("Worker", h.FakeWorker);
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store.resetShotStoreForTests();
  h.instances.length = 0;
  h.mode.fail = false;
  h.mode.silent = false;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(async () => {
  await derive.resetDeriveForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared worker session", () => {
  it("two intakes share ONE worker; it ends only after the idle time of the last one", async () => {
    const a = await derive.openShotSession();
    const b = await derive.openShotSession();
    expect(h.instances).toHaveLength(1);
    const d = await a.derive(new Blob([new Uint8Array(4)]), { w: 1, h: 2 });
    expect(d).toMatchObject({ sha256: "ab".repeat(32), w: 10, h: 20, via: "worker" });
    expect(await b.verify("shot_x")).toEqual({ sha256: "cd".repeat(32), size: 5 });
    // every call carries its own id
    expect(new Set(h.instances[0]!.posted.map((m) => m.id)).size).toBe(2);
    a.close();
    vi.advanceTimersByTime(derive.WORKER_IDLE_MS + 10);
    expect(h.instances[0]!.terminated, "b still uses it").toBe(false);
    b.close();
    b.close(); // closing twice counts once
    vi.advanceTimersByTime(derive.WORKER_IDLE_MS - 10);
    expect(h.instances[0]!.terminated).toBe(false);
    vi.advanceTimersByTime(20);
    expect(h.instances[0]!.terminated).toBe(true);
    // the next intake starts a fresh worker
    const c = await derive.openShotSession();
    expect(h.instances).toHaveLength(2);
    c.close();
  });

  it("warming starts the worker before the first picture and lets it rest when nobody comes", async () => {
    derive.warmShotSession();
    await vi.waitFor(() => expect(h.instances).toHaveLength(1));
    const s = await derive.openShotSession();
    expect(h.instances, "the warm worker serves the intake").toHaveLength(1);
    s.close();
    vi.advanceTimersByTime(derive.WORKER_IDLE_MS + 10);
    expect(h.instances[0]!.terminated).toBe(true);
    // warming alone: it ends by itself
    derive.warmShotSession();
    await vi.waitFor(() => expect(h.instances).toHaveLength(2));
    await Promise.resolve();
    vi.advanceTimersByTime(derive.WORKER_IDLE_MS + 10);
    expect(h.instances[1]!.terminated).toBe(true);
  });

  it("a worker that errors is dropped: the same work runs on the main thread with the same result, and no new worker is tried", async () => {
    h.mode.fail = true;
    const u = new Uint8Array(2048).map((_, i) => (i * 7) & 0xff);
    const s = await derive.openShotSession();
    const d = await s.derive(new Blob([u]));
    expect(d.via).toBe("main");
    expect(d.sha256).toBe(sha(u));
    expect(h.instances[0]!.terminated).toBe(true);
    s.close();
    const again = await derive.openShotSession();
    expect(await again.derive(new Blob([u]))).toMatchObject({ via: "main", sha256: sha(u) });
    expect(h.instances, "a broken worker is not retried").toHaveLength(1);
    // verify on the main thread reads the store
    await store.putShotBlob(new Blob([u]), "shot_v");
    expect(await again.verify("shot_v")).toEqual({ sha256: sha(u), size: u.length });
    expect(await again.verify("shot_missing")).toBeNull();
  });

  it("a worker that stays silent is given up after the silence time", async () => {
    h.mode.silent = true;
    const u = new Uint8Array(512).map((_, i) => i & 0xff);
    const s = await derive.openShotSession();
    const p = s.derive(new Blob([u]));
    await vi.advanceTimersByTimeAsync(derive.SHOT_WORKER_SILENCE_MS + 10);
    expect(await p).toMatchObject({ via: "main", sha256: sha(u) });
    expect(h.instances[0]!.terminated).toBe(true);
  });
});
