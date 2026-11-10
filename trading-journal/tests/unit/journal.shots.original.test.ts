// @vitest-environment node
/**
 * Screenshot originals (A2): the file the trader adds is stored byte for byte (IndexedDB, with its SHA-256), the preview
 * is derived separately, a full or missing store says so instead of shrinking, a failed or refused cloud upload leaves the
 * original on the device, and the backup ZIP carries the bytes and the hashes through a restore into a fresh profile.
 * Runs on fake-indexeddb in the node environment (real `Blob`, `crypto.subtle`, structured clone).
 */
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonBackup, ScreenshotRef, Trade } from "@/domain/types";

/* ------------------------------------------------------------ cloud fake */
const bucket = new Map<string, Blob>();
const uploads: { path: string; type?: string }[] = [];
let failUpload = false;
vi.mock("@/cloud", async (orig) => ({
  ...(await orig<typeof import("@/cloud")>()),
  ensureCloud: async () => ({
    getClient: () => ({
      storage: {
        from: () => ({
          upload: async (path: string, blob: Blob, opts: { contentType?: string }) => {
            uploads.push({ path, type: opts.contentType });
            if (failUpload) return { error: { message: "network" } };
            bucket.set(path, blob);
            return { error: null };
          },
          createSignedUrl: async (path: string) => (bucket.has(path) ? { data: { signedUrl: `https://sb.test/${path}` }, error: null } : { data: null, error: { message: "gone" } }),
          remove: async () => ({ error: null }),
        }),
      },
    }),
  }),
}));
let entitled = true;
vi.mock("@/billing/entitlements", async (orig) => ({ ...(await orig<typeof import("@/billing/entitlements")>()), entitledNow: () => entitled }));

const { setCloudEnabledForTests } = await import("@/cloud/env");
const { resetCloudSession, useCloudSession } = await import("@/cloud/session");
const { Sha256, sha256Hex, sha256Incremental } = await import("@/journal/screenshots/sha256");
const { sniffImage } = await import("@/journal/screenshots/sniff");
const { IntakeError, prepareImage, MAX_INPUT_BYTES } = await import("@/journal/screenshots/image");
const { addShots, promoteShot, shotPlace, STORAGE_MESSAGES } = await import("@/journal/screenshots/shots");
const store = await import("@/journal/screenshots/store");
const { loadOriginal } = await import("@/journal/screenshots/original");
const info = await import("@/journal/screenshots/info");
const zip = await import("@/journal/screenshots/zip");
const bz = await import("@/journal/screenshots/backupZip");
const hl = await import("@/journal/screenshots/hashList");
const { normalizeTrade } = await import("@/domain/normalize");

const UID = "11111111-1111-4111-8111-111111111111";
const nodeHex = (u: Uint8Array) => createHash("sha256").update(u).digest("hex");

/** A PNG-looking file: real signature + IHDR (`w × h`), then pseudo-random bytes up to `bytes`. */
function fakePng(bytes: number, w = 3840, h = 2160, seed = 7): Uint8Array {
  const u = new Uint8Array(bytes);
  u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(u.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  let x = seed >>> 0 || 1;
  for (let i = 24; i < bytes; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    u[i] = x & 0xff;
  }
  return u;
}
const fileOf = (u: Uint8Array, name = "chart.png", type = "image/png") => new File([u as BlobPart], name, { type });
const bytesOfBlob = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const trade = (id: string, shots: ScreenshotRef[]): Trade => ({ ...normalizeTrade({ id, pair: "BTCUSDT", side: "long", entry: 1, exit: 2, size: 1, date: "2026-03-01T10:00" }), screenshots: shots });

/** Fresh browser profile: a new IndexedDB, empty memory, nothing cached. */
function freshProfile(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store.resetShotStoreForTests();
}

beforeEach(() => {
  freshProfile();
  bucket.clear();
  uploads.length = 0;
  failUpload = false;
  entitled = true;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCloudEnabledForTests(null);
  resetCloudSession();
});

function signIn(): void {
  setCloudEnabledForTests(true);
  useCloudSession.setState({ phase: "signedIn", user: { id: UID, email: "t@example.com", aal: "aal1", mfaEnrolled: false }, needsMfa: false });
}

describe("SHA-256", () => {
  it("matches the FIPS vectors, in one go and in odd slices", () => {
    const hexOf = (s: string, cut = 0) => {
      const h = new Sha256();
      const u = new TextEncoder().encode(s);
      if (cut) for (let i = 0; i < u.length; i += cut) h.update(u.subarray(i, i + cut));
      else h.update(u);
      return h.hex();
    };
    expect(hexOf("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hexOf("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const long = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(hexOf(long)).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(hexOf(long, 7)).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("subtle and the incremental fallback agree with node:crypto on a 3 MB file", async () => {
    const u = fakePng(3 * 1024 * 1024 + 13);
    const blob = new Blob([u as BlobPart]);
    expect(await sha256Hex(blob)).toBe(nodeHex(u));
    expect(await sha256Incremental(blob)).toBe(nodeHex(u));
  });

  it("without crypto.subtle the hash is still exact", async () => {
    const u = fakePng(700_000);
    vi.stubGlobal("crypto", {});
    expect(await sha256Hex(new Blob([u as BlobPart]))).toBe(nodeHex(u));
  });
});

describe("intake keeps the file", () => {
  it("reads type and size from the header, returns the SAME blob, refuses non-images and over-size", async () => {
    const f = fileOf(fakePng(5000, 1920, 1080));
    const r = await prepareImage(f);
    expect(r.blob).toBe(f);
    expect(r).toMatchObject({ mime: "image/png", w: 1920, h: 1080 });
    await expect(prepareImage(new Blob(["hello"], { type: "text/plain" }))).rejects.toMatchObject({ problem: "type" });
    await expect(prepareImage({ type: "image/png", size: MAX_INPUT_BYTES + 1 } as Blob)).rejects.toBeInstanceOf(IntakeError);
    // a paste without a usable type is recognised by its bytes
    const untyped = await prepareImage(new Blob([fakePng(900, 640, 480) as BlobPart]));
    expect(untyped).toMatchObject({ mime: "image/png", w: 640, h: 480 });
  });

  it("sniffs JPEG, GIF, WebP and BMP headers", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x02, 0x58, 0x03, 0x20, 3, 1, 0x11, 0]);
    expect(sniffImage(jpeg)).toEqual({ mime: "image/jpeg", w: 800, h: 600 });
    const gif = new Uint8Array([...new TextEncoder().encode("GIF89a"), 0x40, 0x01, 0xc8, 0x00, 0, 0]);
    expect(sniffImage(gif)).toEqual({ mime: "image/gif", w: 320, h: 200 });
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode("RIFF"), 0);
    webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
    webp.set([0xff, 0x03, 0x00], 24); // 1024 - 1
    webp.set([0xff, 0x01, 0x00], 27); // 512 - 1
    expect(sniffImage(webp)).toEqual({ mime: "image/webp", w: 1024, h: 512 });
    const bmp = new Uint8Array(30);
    bmp.set([0x42, 0x4d], 0);
    new DataView(bmp.buffer).setUint32(18, 100, true);
    new DataView(bmp.buffer).setUint32(22, 50, true);
    expect(sniffImage(bmp)).toEqual({ mime: "image/bmp", w: 100, h: 50 });
    expect(sniffImage(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe("original bytes survive saving, reload and the cloud", () => {
  it("12 MB PNG: hash before = hash stored = hash after a reload; fields are set; nothing is shrunk", async () => {
    const u = fakePng(12 * 1024 * 1024);
    const before = nodeHex(u);
    const r = await addShots([fileOf(u, "BTC 4h – Einstieg.png")]);
    expect(r.errors).toEqual([]);
    expect(r.notes).toEqual([]);
    const ref = r.refs[0]!;
    expect(ref).toMatchObject({ store: "idb", mime: "image/png", sha256: before, bytes: u.length, originalName: "BTC 4h – Einstieg.png", original: true, storage: "device", w: 3840, h: 2160 });
    // the stored file IS the file
    const stored = (await store.getShotBlob(ref.key!))!;
    expect(stored.size).toBe(u.length);
    expect(sameBytes(await bytesOfBlob(stored), u)).toBe(true);
    expect(await sha256Hex(stored)).toBe(before);
    // "reload": the page forgets everything it held in memory, the database stays
    store.resetShotStoreForTests();
    const again = (await store.getShotBlob(ref.key!))!;
    expect(nodeHex(await bytesOfBlob(again))).toBe(before);
    expect(store.isRamOnly(ref.key!)).toBe(false);
    expect(shotPlace(ref)).toBe("Lokal");
  });

  it("a JPEG, a GIF and a tiny PNG are kept exactly too (no re-encoding for any size)", async () => {
    const small = fakePng(2000, 100, 100, 3);
    const gif = new Uint8Array([...new TextEncoder().encode("GIF89a"), 10, 0, 10, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const r = await addShots([fileOf(small), fileOf(gif, "anim.gif", "image/gif")]);
    expect(r.refs.map((x) => x.sha256)).toEqual([nodeHex(small), nodeHex(gif)]);
    for (const [i, u] of [small, gif].entries()) expect(sameBytes(await bytesOfBlob((await store.getShotBlob(r.refs[i]!.key!))!), u)).toBe(true);
  });

  it("a read-back that differs from the file is refused and cleaned up, never stored as the original", async () => {
    const u = fakePng(50_000);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, _value: unknown, key?: IDBValidKey) {
      // the database hands back something else than we gave it
      return put.call(this, new Blob([new Uint8Array(u.length)]), key);
    });
    const r = await addShots([fileOf(u)]);
    expect(r.refs).toEqual([]);
    expect(r.errors).toEqual([STORAGE_MESSAGES.verify]);
    vi.restoreAllMocks();
    expect(await store.listShotKeys()).toEqual([]);
  });

  it("a signed-in upload sends the ORIGINAL blob unchanged; a copy fetched back has the same hash; a tampered copy is flagged", async () => {
    signIn();
    const u = fakePng(1_500_000, 1600, 900, 11);
    const { refs } = await addShots([fileOf(u)]);
    const res = await promoteShot(refs[0]!);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("upload");
    expect(res.ref).toMatchObject({ store: "cloud", storage: "cloud", cacheKey: refs[0]!.key, sha256: nodeHex(u), original: true });
    expect(uploads).toEqual([{ path: `${UID}/${refs[0]!.id}.png`, type: "image/png" }]);
    expect(sameBytes(await bytesOfBlob(bucket.get(res.ref.key!)!), u)).toBe(true);
    // the offline copy is gone (new device): the cloud object comes back through a signed link, hash checked
    vi.stubGlobal("fetch", async (url: string) => new Response(bucket.get(url.replace("https://sb.test/", "")), { status: 200 }));
    const cloudOnly: ScreenshotRef = { ...res.ref, cacheKey: undefined };
    const back = await loadOriginal(cloudOnly);
    expect(back).toMatchObject({ from: "cloud", hashOk: true });
    expect(nodeHex(await bytesOfBlob(back!.blob))).toBe(nodeHex(u));
    const bad = fakePng(1_500_000, 1600, 900, 99);
    bucket.set(res.ref.key!, new Blob([bad as BlobPart]));
    expect((await loadOriginal(cloudOnly))!.hashOk).toBe(false);
  });

  it("signed in but without the plan's cloud screenshots (or signed out): nothing is uploaded and nothing is promised", async () => {
    signIn();
    entitled = false;
    const { refs } = await addShots([fileOf(fakePng(30_000))]);
    expect(await promoteShot(refs[0]!)).toEqual({ ok: false, problem: "unavailable" });
    expect(uploads).toEqual([]);
    expect(refs[0]).toMatchObject({ store: "idb", storage: "device", original: true });
    entitled = true;
    expect((await promoteShot(refs[0]!)).ok).toBe(true);
    expect(uploads).toHaveLength(1);
  });

  it("a failed upload keeps the original on the device and says why; too big / wrong type are not uploaded at all", async () => {
    signIn();
    failUpload = true;
    const { refs } = await addShots([fileOf(fakePng(40_000))]);
    expect(await promoteShot(refs[0]!)).toEqual({ ok: false, problem: "failed" });
    expect((await store.getShotBlob(refs[0]!.key!))?.size).toBe(40_000);
    expect(bucket.size).toBe(0);
    failUpload = false;
    const big = await addShots([fileOf(fakePng(6 * 1024 * 1024))]);
    expect(big.refs[0]!.sha256).toBe(nodeHex(fakePng(6 * 1024 * 1024)));
    uploads.length = 0;
    expect(await promoteShot(big.refs[0]!)).toEqual({ ok: false, problem: "tooLarge" });
    const avif = new Uint8Array(40);
    avif.set(new TextEncoder().encode("ftypavif"), 4);
    const a = await addShots([fileOf(avif, "x.avif", "image/avif")]);
    expect(await promoteShot(a.refs[0]!)).toEqual({ ok: false, problem: "type" });
    expect(uploads).toEqual([]);
    // signed out: nothing was promised, nothing is said
    resetCloudSession();
    expect(await promoteShot(a.refs[0]!)).toEqual({ ok: false, problem: "unavailable" });
  });
});

describe("a full or missing store never shrinks the picture", () => {
  it("quota: the file stays whole in memory, the verdict says quota, the store is not declared broken", async () => {
    const u = fakePng(300_000);
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    const r = await addShots([fileOf(u)]);
    expect(r.errors).toEqual([]);
    expect(r.notes).toEqual([{ id: r.refs[0]!.id, kind: "quota" }]);
    const ref = r.refs[0]!;
    expect(ref).toMatchObject({ storage: "ram", original: true, sha256: nodeHex(u), bytes: u.length });
    expect(shotPlace(ref)).toBe("Nur Sitzung");
    expect(store.isRamOnly(ref.key!)).toBe(true);
    expect(sameBytes(await bytesOfBlob((await store.getShotBlob(ref.key!))!), u)).toBe(true); // not a byte less
    expect(STORAGE_MESSAGES.quota).toMatch(/Speicher voll/);
    expect(STORAGE_MESSAGES.quota).toMatch(/Nichts wurde verkleinert/);
    // space was freed: the next picture goes to the device again
    spy.mockRestore();
    const next = await addShots([fileOf(fakePng(10_000, 10, 10, 5))]);
    expect(next.refs[0]!.storage).toBe("device");
    expect(next.notes).toEqual([]);
  });

  it("no IndexedDB (private mode, file://): RAM fallback, flagged as not durable, bytes intact", async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    store.resetShotStoreForTests();
    expect(store.shotStorage()).toBe("memory");
    const u = fakePng(80_000);
    const r = await addShots([fileOf(u)]);
    expect(r.notes).toEqual([{ id: r.refs[0]!.id, kind: "ram" }]);
    expect(r.refs[0]).toMatchObject({ storage: "ram", sha256: nodeHex(u) });
    expect(sameBytes(await bytesOfBlob((await store.getShotBlob(r.refs[0]!.key!))!), u)).toBe(true);
    expect(info.STORAGE_LABELS.ram).toBe("Nicht dauerhaft gespeichert");
  });

  it("another storage error marks the store unusable for the session (not quota)", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("broken", "UnknownError");
    });
    const r = await addShots([fileOf(fakePng(20_000))]);
    expect(r.notes[0]!.kind).toBe("ram");
    expect(store.shotStorage()).toBe("memory");
  });
});

describe("older references stay labelled as shrunk versions", () => {
  const legacy: ScreenshotRef = { id: "old", store: "idb", key: "shot_old", mime: "image/webp", w: 2000, h: 1000, at: "2026-03-01T00:00:00Z" };

  it("only references written since A2 call themselves originals", () => {
    expect(info.isOriginal(legacy)).toBe(false);
    expect(info.isShrunkVersion(legacy)).toBe(true);
    expect(info.isOriginal({ ...legacy, original: true })).toBe(true);
    expect(info.isOriginal({ id: "u", store: "url", url: "https://x/a.png", original: true })).toBe(false);
    expect(info.shotFacts(legacy)).toBe("Version (verkleinert) · WEBP · 2000 × 1000");
    expect(info.shotFacts({ ...legacy, original: true, bytes: 12_400_000, mime: "image/png", w: 3840, h: 2160 })).toBe("Original · PNG · 3840 × 2160 · 11,8 MB");
  });

  it("normalisation keeps good fields and drops malformed ones; old trades load unchanged", () => {
    const t = normalizeTrade({
      id: "t",
      pair: "BTCUSDT",
      side: "long",
      entry: 1,
      exit: 2,
      size: 1,
      date: "2026-03-01T10:00",
      screenshots: [
        { id: "a", store: "idb", key: "shot_a", sha256: "ab".repeat(32), bytes: 10, original: true, storage: "device", originalName: "x.png" },
        { id: "b", store: "idb", key: "shot_b", sha256: "NOT-A-HASH", bytes: -4, original: "yes", storage: "disk", originalName: "  " },
        legacy,
      ],
    });
    expect(t.screenshots![0]).toMatchObject({ sha256: "ab".repeat(32), bytes: 10, original: true, storage: "device", originalName: "x.png" });
    const b = t.screenshots![1]!;
    for (const k of ["sha256", "bytes", "original", "storage", "originalName"] as const) expect(b[k], k).toBeUndefined();
    expect(t.screenshots![2]).toEqual(legacy);
  });

  it("the hash list computes a hash for an old picture from its stored bytes and marks it as a version", async () => {
    const u = fakePng(30_000, 2000, 1000, 21);
    await store.putShotBlob(new Blob([u as BlobPart], { type: "image/webp" }), "shot_old");
    const rows = await hl.collectHashRows([trade("t1", [legacy, { id: "n", store: "idb", key: "shot_new", sha256: "cd".repeat(32), bytes: 5, mime: "image/png", original: true, originalName: "n.png" }])]);
    expect(rows[0]).toMatchObject({ tradeId: "t1", shotId: "old", sha256: nodeHex(u), bytes: 30_000, level: "Version (verkleinert)" });
    expect(rows[0]!.note).toMatch(/älteren App-Fassung/);
    expect(rows[1]).toMatchObject({ sha256: "cd".repeat(32), level: "Original", name: "n.png", storage: "Auf diesem Gerät" });
    const csv = hl.hashRowsToCsv(rows);
    expect(csv.split("\n")[0]).toBe("﻿Trade-ID;Screenshot-ID;Dateiname;Typ;Bytes;SHA-256;Breite;Höhe;Speicher;Stufe;Hinweis");
    expect(csv).toContain(nodeHex(u));
    expect(csv.split("\n")).toHaveLength(3);
  });
});

describe("ZIP", () => {
  it("writes valid central-directory data (CRC-32 as zlib computes it) and reads it back lazily", async () => {
    const a = fakePng(70_000, 10, 10, 1);
    const z = await zip.buildZip([{ name: "a.txt", data: "grüße" }, { name: "shots/x.png", data: new Blob([a as BlobPart]) }]);
    const list = await zip.readZip(z);
    expect(list.map((e) => e.name)).toEqual(["a.txt", "shots/x.png"]);
    expect(list[1]!.crc).toBe(crc32(a));
    expect(await (await list[0]!.data()).text()).toBe("grüße");
    expect(sameBytes(await bytesOfBlob(await list[1]!.data()), a)).toBe(true);
    await expect(zip.readZip(new Blob(["not a zip at all, just text bytes here"]))).rejects.toThrow(zip.ZIP_MESSAGES.notZip);
  });

  it("refuses an archive that is compressed", async () => {
    const z = new Uint8Array(await bytesOfBlob(await zip.buildZip([{ name: "a", data: "x" }])));
    new DataView(z.buffer).setUint16(10, 8, true); // local header method → deflate
    // the central directory says "stored" still; flip it there too
    const cd = z.length - 22 - (46 + 1);
    new DataView(z.buffer).setUint16(cd + 10, 8, true);
    await expect(zip.readZip(new Blob([z as BlobPart]))).rejects.toThrow(zip.ZIP_MESSAGES.unsupported);
  });
});

describe("backup → restore in a fresh profile", () => {
  async function seed() {
    const a = fakePng(2_000_000, 3000, 1800, 31);
    const b = fakePng(900_000, 1600, 900, 32);
    const r = await addShots([fileOf(a, "a.png"), fileOf(b, "b.png")]);
    await store.putShotBlob(new Blob([fakePng(20_000, 800, 400, 33) as BlobPart], { type: "image/webp" }), "shot_old");
    const legacy: ScreenshotRef = { id: "old", store: "idb", key: "shot_old", mime: "image/webp", w: 800, h: 400 };
    const trades = [trade("t1", [r.refs[0]!, legacy]), trade("t2", [r.refs[1]!, { id: "u", store: "url", url: "https://example.com/c.png" }, { id: "gone", store: "idb", key: "shot_gone", mime: "image/png" }])];
    const backup = { exportedAt: "2026-03-02T00:00:00.000Z", settings: {}, trades, schemaVersion: 1 } as unknown as JsonBackup & Record<string, unknown>;
    return { a, b, r, trades, backup };
  }

  it("the ZIP carries every reachable original with its hash, names what is missing, and restores bytewise", async () => {
    const { a, b, trades, backup } = await seed();
    const built = await bz.buildBackupZip({ trades, backup }, new Date("2026-03-02T10:00:00Z"));
    expect(built.filename).toBe("trade-journal-2026-03-02-mit-bildern.zip");
    const m = built.manifest;
    expect(m.format).toBe("tj-backup-zip/1");
    expect(m.shots.map((s) => [s.sha256, s.original, s.matchesReference])).toEqual([
      [nodeHex(a), true, true],
      [nodeHex(fakePng(20_000, 800, 400, 33)), false, null],
      [nodeHex(b), true, true],
    ]);
    expect(m.missing).toEqual([{ tradeId: "t2", shotId: "gone", reason: "unreachable" }]);
    expect(bz.exportSummary(m)).toMatchObject({ kind: "error", title: "Backup mit Bildern – mit Hinweisen" });

    // a fresh browser profile opens the archive
    freshProfile();
    const file = new File([built.blob], built.filename, { type: "application/zip" });
    const opened = await bz.readBackupZip(file);
    expect(bz.zipShotInfo(opened)).toEqual({ embedded: 3, missing: 1 });
    const journal = JSON.parse(opened.journalText) as { trades: Trade[] };
    // the old picture got its hash on the way out and is still no original
    expect(journal.trades[0]!.screenshots![1]).toMatchObject({ id: "old", sha256: nodeHex(fakePng(20_000, 800, 400, 33)) });
    expect(journal.trades[0]!.screenshots![1]!.original).toBeUndefined();
    const res = await bz.restoreShotsFromZip(opened);
    expect(res).toEqual({ written: 3, corrupt: [], notSaved: 0, rejected: [], kept: [], alreadyThere: 0 });
    expect(bz.restoreSummary(res)).toMatchObject({ kind: "success", title: "Bilder wiederhergestellt" });
    for (const t of journal.trades.slice(0, 2)) for (const ref of t.screenshots!) {
      if (ref.store !== "idb" || ref.key === "shot_gone") continue;
      const blob = (await store.getShotBlob(ref.key!))!;
      expect(await sha256Hex(blob)).toBe(ref.sha256);
    }
    expect(sameBytes(await bytesOfBlob((await store.getShotBlob(journal.trades[0]!.screenshots![0]!.key!))!), a)).toBe(true);
  });

  it("a file that changed inside the ZIP is NOT restored and is named; a changed journal.json refuses the whole backup", async () => {
    const { b, trades, backup } = await seed();
    const built = await bz.buildBackupZip({ trades, backup });
    const bytes = new Uint8Array(await bytesOfBlob(built.blob));
    // flip one byte in the middle of the second picture's data (find it by its first bytes)
    const needle = (await store.getShotBlob(trades[1]!.screenshots![0]!.key!))!;
    const head = (await bytesOfBlob(needle)).subarray(24, 40);
    let at = -1;
    outer: for (let i = 0; i < bytes.length - 16; i++) {
      for (let j = 0; j < 16; j++) if (bytes[i + j] !== head[j]) continue outer;
      at = i;
      break;
    }
    expect(at).toBeGreaterThan(0);
    bytes[at + 5]! ^= 0xff;
    freshProfile();
    const opened = await bz.readBackupZip(new Blob([bytes as BlobPart]));
    const res = await bz.restoreShotsFromZip(opened);
    expect(res.written).toBe(2);
    expect(res.corrupt).toEqual([trades[1]!.screenshots![0]!.key]);
    expect(await store.getShotBlob(trades[1]!.screenshots![0]!.key!)).toBeUndefined();
    expect(bz.restoreSummary(res)).toMatchObject({ kind: "error", title: "Bilder nur teilweise wiederhergestellt" });
    void b;

    // journal.json edited: the manifest hash no longer fits
    const marker = new TextEncoder().encode('"settings"'); // only journal.json has it
    const tampered = new Uint8Array(bytes);
    let m = -1;
    outer2: for (let i = 0; i < tampered.length - marker.length; i++) {
      for (let j = 0; j < marker.length; j++) if (tampered[i + j] !== marker[j]) continue outer2;
      m = i;
      break;
    }
    expect(m).toBeGreaterThan(0);
    tampered[m + 3]! ^= 0x01;
    await expect(bz.readBackupZip(new Blob([tampered as BlobPart]))).rejects.toThrow(bz.ZIP_BACKUP_MESSAGES.journalChanged);
  });

  it("a cloud picture without an offline copy is fetched into the ZIP and gets an offline key on restore", async () => {
    signIn();
    const u = fakePng(500_000, 1280, 720, 41);
    const { refs } = await addShots([fileOf(u)]);
    const up = await promoteShot(refs[0]!);
    if (!up.ok) throw new Error("upload");
    await store.deleteShotBlob(refs[0]!.key!); // this device has no offline copy any more
    vi.stubGlobal("fetch", async (url: string) => new Response(bucket.get(url.replace("https://sb.test/", "")), { status: 200 }));
    const cloudRef: ScreenshotRef = { ...up.ref, cacheKey: undefined };
    const backup = { exportedAt: "2026-03-02T00:00:00.000Z", settings: {}, trades: [], schemaVersion: 1 } as unknown as JsonBackup & Record<string, unknown>;
    const built = await bz.buildBackupZip({ trades: [trade("t1", [cloudRef])], backup });
    expect(built.manifest.shots).toHaveLength(1);
    expect(built.manifest.shots[0]).toMatchObject({ key: `shot_${cloudRef.id}`, sha256: nodeHex(u), original: true });
    const opened = await bz.readBackupZip(built.blob);
    const journal = JSON.parse(opened.journalText) as { trades: Trade[] };
    expect(journal.trades[0]!.screenshots![0]!.cacheKey).toBe(`shot_${cloudRef.id}`);
    freshProfile();
    await bz.restoreShotsFromZip(opened);
    expect(nodeHex(await bytesOfBlob((await store.getShotBlob(`shot_${cloudRef.id}`))!))).toBe(nodeHex(u));
  });

  it("refuses a ZIP that is no backup of this journal", async () => {
    const z = await zip.buildZip([{ name: "hello.txt", data: "hi" }]);
    await expect(bz.readBackupZip(z)).rejects.toThrow(bz.ZIP_BACKUP_MESSAGES.noManifest);
  });
});
