// @vitest-environment node
/**
 * Papierkorb (R11): a removed screenshot / draft can be taken back for six seconds – really. The store holds the removed
 * things, a screenshot's original bytes stay pinned (and verified by hash) until the window is over, an undo puts the SAME
 * reference back, a failed undo says so and keeps the entry, an owner that goes away settles its entries. Runs on
 * fake-indexeddb in the node environment (real `Blob`, `crypto.subtle`).
 */
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenshotRef } from "@/domain/types";

const { sha256Hex } = await import("@/journal/screenshots/sha256");
const store = await import("@/journal/screenshots/store");
const { insertShot, shotKeysOf, trashShot, assertOriginalIntact, SHOT_GONE } = await import("@/journal/screenshots/trash");
const { commitTrash, holdTrash, putTrash, resetTrashForTests, settleTrashOwner, TRASH_UNDO_MS, undoTrash, useTrash } = await import("@/motion/trash/trashStore");
const shotImport = await import("@/journal/extract/store");

const nodeHex = (u: Uint8Array) => createHash("sha256").update(u).digest("hex");
const bytes = (n: number, seed: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 17) & 0xff);
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** A shot as the editor holds it: the original is in IndexedDB with its hash. */
async function addShot(n: number, seed: number, id = `s${seed}`): Promise<{ ref: ScreenshotRef; data: Uint8Array }> {
  const data = bytes(n, seed);
  const blob = new Blob([data as BlobPart], { type: "image/png" });
  const out = await store.putShotBlobChecked(blob);
  const ref: ScreenshotRef = { id, store: "idb", key: out.key, mime: "image/png", sha256: await sha256Hex(blob), bytes: n, original: true, storage: "device" };
  return { ref, data };
}

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store.resetShotStoreForTests();
  resetTrashForTests();
  // only the clock the trash uses: fake-indexeddb runs on `setImmediate`, which must keep running
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  resetTrashForTests();
});

describe("trash store (generic)", () => {
  const entry = (extra: Partial<Parameters<typeof putTrash>[0]> = {}) => {
    const restore = vi.fn();
    const commit = vi.fn();
    const id = putTrash({ subject: "Ding", kind: "item", restore, commit, ...extra });
    return { id, restore, commit };
  };

  it("holds an entry for six seconds, then lets go once", async () => {
    const { id, restore, commit } = entry();
    expect(TRASH_UNDO_MS).toBe(6000);
    expect(useTrash.getState().entries.map((e) => e.id)).toEqual([id]);
    await vi.advanceTimersByTimeAsync(5900);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    expect(useTrash.getState().entries).toHaveLength(0);
    // a late undo finds nothing
    expect(await undoTrash(id)).toBe(false);
  });

  it("undo runs restore, removes the entry, never commits, and says so for the screen reader", async () => {
    const { id, restore, commit } = entry({ subject: "Screenshot 2" });
    expect(useTrash.getState().announce.text).toMatch(/Screenshot 2 entfernt/);
    expect(await undoTrash(id)).toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(useTrash.getState().entries).toHaveLength(0);
    expect(useTrash.getState().announce.text).toBe("Screenshot 2 wiederhergestellt.");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(commit).not.toHaveBeenCalled();
  });

  it("a restore that throws keeps the entry (and its bytes) and announces the failure; the clock starts again", async () => {
    const { id, commit } = entry({
      restore: () => {
        throw new Error("weg");
      },
    });
    expect(await undoTrash(id)).toBe(false);
    const e = useTrash.getState().entries[0]!;
    expect(e.state).toBe("failed");
    expect(useTrash.getState().announce.text).toMatch(/konnte nicht wiederhergestellt werden/);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6100);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("hover / focus holds the clock; leaving resumes it with the time that was left", async () => {
    const { id, commit } = entry();
    await vi.advanceTimersByTimeAsync(4000);
    holdTrash(id, true);
    expect(useTrash.getState().entries[0]!.state).toBe("held");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(commit).not.toHaveBeenCalled();
    holdTrash(id, false);
    await vi.advanceTimersByTimeAsync(1900);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("an owner that goes away settles its entries at once (no undo that could not put anything back)", () => {
    const a = entry({ owner: "editor" });
    const b = entry({ owner: "other" });
    settleTrashOwner("editor");
    expect(a.commit).toHaveBeenCalledTimes(1);
    expect(b.commit).not.toHaveBeenCalled();
    expect(useTrash.getState().entries).toHaveLength(1);
  });

  it("commit and undo are exclusive and each runs at most once", async () => {
    const { id, restore, commit } = entry();
    await Promise.all([undoTrash(id), commitTrash(id), undoTrash(id)]);
    expect(restore.mock.calls.length + commit.mock.calls.length).toBeLessThanOrEqual(2);
    expect(restore.mock.calls.length).toBeLessThanOrEqual(1);
    expect(commit.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("a removed screenshot: the original bytes come back", () => {
  it("undo puts the same reference back at its place, and the bytes are exactly the original", async () => {
    const a = await addShot(4096, 1);
    const b = await addShot(2048, 2);
    const c = await addShot(1024, 3);
    let list: ScreenshotRef[] = [a.ref, c.ref]; // b was removed from the middle (index 1)
    const id = trashShot({ ref: b.ref, index: 1, owner: "f", put: (ref, at) => (list = insertShot(list, ref, at)) });
    expect(useTrash.getState().entries[0]).toMatchObject({ subject: "Screenshot 2", kind: "shot" });

    expect(await undoTrash(id)).toBe(true);
    expect(list.map((r) => r.id)).toEqual(["s1", "s2", "s3"]);
    expect(list[1]).toBe(b.ref);
    const back = await store.getShotBlob(b.ref.key!);
    expect(back).toBeDefined();
    expect(nodeHex(await bytesOf(back!))).toBe(b.ref.sha256);
    expect(await bytesOf(back!)).toEqual(b.data);
  });

  it("while the window is open a garbage sweep leaves the bytes alone; after the window they are collectable", async () => {
    const a = await addShot(3000, 4);
    expect(shotKeysOf(a.ref)).toEqual([a.ref.key]);
    trashShot({ ref: a.ref, index: 0, owner: "f", put: () => undefined });
    // the editor no longer references it: an unpinned sweep would delete it
    expect(await store.collectShotGarbage(new Set())).toBe(0);
    expect(await store.getShotBlob(a.ref.key!)).toBeDefined();
    await vi.advanceTimersByTimeAsync(6100);
    expect(store.isShotPinned(a.ref.key!)).toBe(false);
    expect(await store.collectShotGarbage(new Set())).toBe(1);
    expect(await store.getShotBlob(a.ref.key!)).toBeUndefined();
  });

  it("an undo whose bytes are gone fails honestly, keeps the entry and does not put anything back", async () => {
    const a = await addShot(2500, 5);
    const put = vi.fn();
    const id = trashShot({ ref: a.ref, index: 0, owner: "f", put });
    await store.deleteShotBlob(a.ref.key!); // e.g. the browser cleaned its storage meanwhile
    expect(await undoTrash(id)).toBe(false);
    expect(put).not.toHaveBeenCalled();
    expect(useTrash.getState().entries[0]!.state).toBe("failed");
    await expect(assertOriginalIntact(a.ref)).rejects.toThrow(SHOT_GONE);
  });

  it("bytes that no longer hash to the stored SHA-256 are not passed off as the original", async () => {
    const a = await addShot(2500, 6);
    await store.putShotBlob(new Blob([bytes(2500, 99) as BlobPart], { type: "image/png" }), a.ref.key!); // the same key now holds other bytes
    const put = vi.fn();
    const id = trashShot({ ref: a.ref, index: 0, owner: "f", put });
    expect(await undoTrash(id)).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it("the field unmounting settles its pictures: the pin is released at once and the sweep may collect them", async () => {
    const a = await addShot(1800, 7);
    trashShot({ ref: a.ref, index: 0, owner: "field-1", put: () => undefined });
    settleTrashOwner("field-1");
    expect(store.isShotPinned(a.ref.key!)).toBe(false);
    expect(useTrash.getState().entries).toHaveLength(0);
    expect(await store.collectShotGarbage(new Set())).toBe(1);
  });

  it("a link has no bytes to check and can always be put back", async () => {
    const link: ScreenshotRef = { id: "u1", store: "url", url: "https://example.com/a.png" };
    await expect(assertOriginalIntact(link)).resolves.toBeUndefined();
  });

  it("insertShot is pure, clamps the index and never duplicates", () => {
    const mk = (id: string): ScreenshotRef => ({ id, store: "url", url: `https://e.test/${id}` });
    const base = [mk("a"), mk("b")];
    expect(insertShot(base, mk("x"), 1).map((r) => r.id)).toEqual(["a", "x", "b"]);
    expect(insertShot(base, mk("x"), 99).map((r) => r.id)).toEqual(["a", "b", "x"]);
    expect(insertShot(base, mk("x"), -5).map((r) => r.id)).toEqual(["x", "a", "b"]);
    expect(insertShot(base, mk("a"), 0).map((r) => r.id)).toEqual(["a", "b"]);
    expect(base.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("discarding the waiting drafts is undoable", () => {
  it("empties the queue, keeps the pictures pinned for the window, and the undo brings the drafts back in front", async () => {
    const a = await addShot(2200, 8);
    const draft = (n: string) => ({ pair: n, screenshots: [a.ref] });
    shotImport.useShotImport.setState({ queue: [draft("BTCUSDT"), draft("ETHUSDT")] as never });
    store.pinShotKeys([a.ref.key!]);

    shotImport.discardQueueToTrash();
    expect(shotImport.useShotImport.getState().queue).toHaveLength(0);
    expect(useTrash.getState().entries[0]).toMatchObject({ subject: "2 Entwürfe", kind: "draft" });
    expect(store.isShotPinned(a.ref.key!)).toBe(true);
    expect(await store.collectShotGarbage(new Set())).toBe(0);

    // a new import queued meanwhile stays behind the restored drafts
    shotImport.useShotImport.setState({ queue: [{ pair: "SOLUSDT" }] as never });
    expect(await undoTrash(useTrash.getState().entries[0]!.id)).toBe(true);
    expect(shotImport.useShotImport.getState().queue.map((d) => d.pair)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(nodeHex(await bytesOf((await store.getShotBlob(a.ref.key!))!))).toBe(a.ref.sha256);
  });

  it("at the end of the window the pictures are released", async () => {
    const a = await addShot(1500, 9);
    shotImport.useShotImport.setState({ queue: [{ pair: "BTCUSDT", screenshots: [a.ref] }] as never });
    store.pinShotKeys([a.ref.key!]);
    shotImport.discardQueueToTrash();
    await vi.advanceTimersByTimeAsync(6100);
    expect(store.isShotPinned(a.ref.key!)).toBe(false);
  });

  it("an undo with a vanished picture fails and leaves the queue empty (nothing half-restored)", async () => {
    const a = await addShot(1500, 10);
    shotImport.useShotImport.setState({ queue: [{ pair: "BTCUSDT", screenshots: [a.ref] }] as never });
    store.pinShotKeys([a.ref.key!]);
    shotImport.discardQueueToTrash();
    await store.deleteShotBlob(a.ref.key!);
    expect(await undoTrash(useTrash.getState().entries[0]!.id)).toBe(false);
    expect(shotImport.useShotImport.getState().queue).toHaveLength(0);
  });
});
