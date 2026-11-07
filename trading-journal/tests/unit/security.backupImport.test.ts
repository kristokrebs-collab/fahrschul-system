// @vitest-environment node
/**
 * Security round 11, package C – importing a FOREIGN backup must not be a way around the checks of a normal screenshot intake:
 * real image bytes only (no SVG / HTML under an `image/…` label), size and pixel limits, no overwriting of a picture the device
 * already holds, no duplicate rows in the manifest, CRC-32 of the archive, and honest wording ("unversehrt", not "echt").
 * Runs on fake-indexeddb in the node environment, like `journal.shots.original.test.ts`.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

const store = await import("@/journal/screenshots/store");
const zip = await import("@/journal/screenshots/zip");
const bz = await import("@/journal/screenshots/backupZip");
const bs = await import("@/journal/screenshots/backupShots");
const guard = await import("@/journal/screenshots/restoreGuard");
const { sha256Hex } = await import("@/journal/screenshots/sha256");

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store.resetShotStoreForTests();
});

/** A PNG-looking file: signature + IHDR (`w × h`), then `bytes` in total (the pixels are never decoded here). */
function png(w: number, h: number, bytes = 400, seed = 1): Uint8Array {
  const u = new Uint8Array(Math.max(bytes, 33));
  u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(u.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  for (let i = 24; i < u.length; i++) u[i] = (i * 31 + seed) & 0xff;
  return u;
}
const blobOf = (u: Uint8Array, type = "image/png") => new Blob([u as BlobPart], { type });
const text = (s: string, type: string) => new Blob([s], { type });

interface Row {
  key: string;
  bytes: Blob;
  mime?: string;
  file?: string;
}

/** A syntactically perfect backup ZIP: manifest + journal + the given files, every hash right (a forger can do the same). */
async function craft(rows: Row[], opts: { manifestShots?: unknown[] } = {}): Promise<Blob> {
  const journal = new Blob([JSON.stringify({ exportedAt: "2026-03-02T00:00:00.000Z", settings: {}, trades: [], schemaVersion: 1 })], { type: "application/json" });
  const shots = await Promise.all(
    rows.map(async (r) => ({ key: r.key, file: r.file ?? `shots/${r.key}.png`, sha256: await sha256Hex(r.bytes), bytes: r.bytes.size, mime: r.mime ?? "image/png", original: true, tradeIds: [], shotIds: [], matchesReference: null })),
  );
  const manifest = { format: "tj-backup-zip/1", exportedAt: "2026-03-02T00:00:00.000Z", journal: "journal.json", journalSha256: await sha256Hex(journal), journalBytes: journal.size, tradeCount: 0, shots: opts.manifestShots ?? shots, missing: [] };
  const files = new Map<string, Blob>();
  for (const [i, r] of rows.entries()) files.set(shots[i]!.file, r.bytes);
  return zip.buildZip([{ name: "manifest.json", data: JSON.stringify(manifest) }, { name: "journal.json", data: journal }, ...[...files].map(([name, data]) => ({ name, data }))]);
}

describe("ZIP restore – entry checks", () => {
  it("an SVG (or HTML) under an image/ label is refused, not stored", async () => {
    const svg = text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>', "image/svg+xml");
    const html = text("<html><script>alert(1)</script></html>", "image/png");
    const z = await bz.readBackupZip(await craft([{ key: "shot_svg", bytes: svg, mime: "image/svg+xml", file: "shots/shot_svg.svg" }, { key: "shot_html", bytes: html }]));
    const res = await bz.restoreShotsFromZip(z);
    expect(res.written).toBe(0);
    expect(res.rejected).toEqual([{ key: "shot_svg", reason: "type" }, { key: "shot_html", reason: "type" }]);
    expect(await store.getShotBlob("shot_svg")).toBeUndefined();
    expect(await store.getShotBlob("shot_html")).toBeUndefined();
    expect(bz.restoreSummary(res)).toMatchObject({ kind: "error", title: "Bilder nur teilweise wiederhergestellt" });
  });

  it("a tiny PNG with enormous measures is refused (decompression bomb), a normal screenshot is written", async () => {
    const bomb = blobOf(png(60_000, 60_000, 600));
    const ok = blobOf(png(3840, 2160, 5_000, 2));
    const res = await bz.restoreShotsFromZip(await bz.readBackupZip(await craft([{ key: "shot_bomb", bytes: bomb }, { key: "shot_ok", bytes: ok }])));
    expect(res.rejected).toEqual([{ key: "shot_bomb", reason: "dimensions" }]);
    expect(res.written).toBe(1);
    expect(await store.getShotBlob("shot_bomb")).toBeUndefined();
    expect((await store.getShotBlob("shot_ok"))?.size).toBe(5_000);
    // the limits are the documented ones
    expect(guard.RESTORE_MAX_PIXELS).toBe(100_000_000);
    expect((await guard.inspectRestoredImage(blobOf(png(10_000, 10_000))))).toMatchObject({ ok: true });
    expect((await guard.inspectRestoredImage(blobOf(png(10_001, 10_000))))).toEqual({ ok: false, reason: "dimensions" });
    expect((await guard.inspectRestoredImage(blobOf(png(0, 100))))).toEqual({ ok: false, reason: "dimensions" });
  });

  it("a file over 25 MB is refused", async () => {
    const big = blobOf(png(100, 100, 25 * 1024 * 1024 + 1));
    const res = await bz.restoreShotsFromZip(await bz.readBackupZip(await craft([{ key: "shot_big", bytes: big }])));
    expect(res.rejected).toEqual([{ key: "shot_big", reason: "size" }]);
    expect(res.written).toBe(0);
  });

  it("the stored type is the one the bytes show, not the manifest's claim", async () => {
    const res = await bz.restoreShotsFromZip(await bz.readBackupZip(await craft([{ key: "shot_t", bytes: blobOf(png(10, 10), "image/webp"), mime: "image/webp" }])));
    expect(res.written).toBe(1);
    expect((await store.getShotBlob("shot_t"))?.type).toBe("image/png");
  });

  it("a picture the device already holds is NEVER replaced; the same bytes are simply 'already there'", async () => {
    const mine = png(1920, 1080, 800, 7);
    await store.putShotBlob(blobOf(mine), "shot_evidence");
    await store.putShotBlob(blobOf(png(640, 480, 300, 9)), "shot_same");
    const forged = blobOf(png(1920, 1080, 800, 99));
    const z = await bz.readBackupZip(await craft([{ key: "shot_evidence", bytes: forged }, { key: "shot_same", bytes: blobOf(png(640, 480, 300, 9)) }, { key: "shot_new", bytes: blobOf(png(50, 50, 200, 3)) }]));
    const res = await bz.restoreShotsFromZip(z);
    expect(res).toMatchObject({ written: 1, kept: ["shot_evidence"], alreadyThere: 1, corrupt: [], rejected: [] });
    const still = new Uint8Array(await (await store.getShotBlob("shot_evidence"))!.arrayBuffer());
    expect(Array.from(still)).toEqual(Array.from(mine));
    expect(bz.restoreSummary(res)).toMatchObject({ kind: "error" });
    expect(bz.restoreSummary(res)!.detail).toContain("nicht überschrieben");
  });
});

describe("ZIP manifest", () => {
  it("rows that name the same key or the same archive file are dropped (one entry cannot be read again and again)", async () => {
    const a = blobOf(png(10, 10, 300, 1));
    const row = async (key: string, file: string) => ({ key, file, sha256: await sha256Hex(a), bytes: a.size, mime: "image/png", original: true, tradeIds: [], shotIds: [], matchesReference: null });
    const rows = [await row("shot_a", "shots/shot_a.png"), await row("shot_a", "shots/other.png"), await row("shot_b", "shots/shot_a.png"), await row("shot_c", "shots/shot_c.png")];
    const z = await bz.readBackupZip(await craft([{ key: "shot_a", bytes: a }, { key: "shot_c", bytes: a, file: "shots/shot_c.png" }], { manifestShots: rows }));
    expect(z.manifest.shots.map((s) => s.key)).toEqual(["shot_a", "shot_c"]);
    const res = await bz.restoreShotsFromZip(z);
    expect(res.written).toBe(2);
  });

  it("archive paths outside shots/<name> are not accepted", async () => {
    const a = blobOf(png(10, 10));
    const sha = await sha256Hex(a);
    const bad = ["shots/../manifest.json", "shots/a/b.png", "/etc/passwd", "shots/", "shots/..", "../shots/x.png"].map((file, i) => ({ key: `shot_${i}`, file, sha256: sha, bytes: a.size, mime: "image/png" }));
    const z = await bz.readBackupZip(await craft([], { manifestShots: bad }));
    expect(z.manifest.shots).toEqual([]);
  });

  it("a manifest that lists more pictures than any journal can have is refused", async () => {
    const sha = "a".repeat(64);
    const many = Array.from({ length: guard.RESTORE_MAX_FILES + 1 }, (_, i) => ({ key: `shot_${i}`, file: `shots/shot_${i}.png`, sha256: sha, bytes: 1, mime: "image/png" }));
    await expect(bz.readBackupZip(await craft([], { manifestShots: many }))).rejects.toThrow(bz.ZIP_BACKUP_MESSAGES.tooMany);
  });
});

describe("ZIP CRC-32", () => {
  /** Flips one byte of the entry called `name` (found by its text) inside a stored archive. */
  async function flip(z: Blob, marker: string): Promise<Blob> {
    const bytes = new Uint8Array(await z.arrayBuffer());
    const needle = new TextEncoder().encode(marker);
    outer: for (let i = 0; i < bytes.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      bytes[i + needle.length - 1]! ^= 0x01; // last character of the marker, so a digit stays a digit and the JSON stays valid
      return new Blob([bytes as BlobPart]);
    }
    throw new Error("marker not found");
  }

  it("checkedData() rejects an entry whose bytes differ from the archive's CRC, data() does not look", async () => {
    const z = await zip.buildZip([{ name: "a.txt", data: "hello world" }]);
    const broken = await flip(z, "hello world");
    const [e] = await zip.readZip(broken);
    expect(await (await e!.data()).text()).not.toBe("hello world");
    await expect(e!.checkedData()).rejects.toThrow(zip.ZIP_MESSAGES.crc);
    const [ok] = await zip.readZip(z);
    expect(await (await ok!.checkedData()).text()).toBe("hello world");
  });

  it("a manifest that was damaged but is still valid JSON is refused with the CRC message", async () => {
    const z = await craft([{ key: "shot_a", bytes: blobOf(png(10, 10)) }]);
    // "2026-03-02T00:00:00.000Z" exists in manifest.json and in journal.json; the first hit is the manifest
    await expect(bz.readBackupZip(await flip(z, '"exportedAt":"2026-03-02'))).rejects.toThrow(zip.ZIP_MESSAGES.crc);
  });

  it("a picture damaged in the archive is named as corrupt, not written", async () => {
    const z = await craft([{ key: "shot_a", bytes: blobOf(png(10, 10, 600, 5)) }]);
    const bytes = new Uint8Array(await z.arrayBuffer());
    // the PNG signature starts with 0x89 'P' 'N' 'G': damage the byte after the IHDR
    const sig = [0x89, 0x50, 0x4e, 0x47];
    const at = bytes.findIndex((_, i) => sig.every((b, k) => bytes[i + k] === b));
    bytes[at + 100]! ^= 0xff;
    const res = await bz.restoreShotsFromZip(await bz.readBackupZip(new Blob([bytes as BlobPart])));
    expect(res.corrupt).toEqual(["shot_a"]);
    expect(res.written).toBe(0);
  });
});

describe("old JSON backup with base64 pictures", () => {
  const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
  const backup = (screenshots: Record<string, { mime: string; data: string }>) => JSON.stringify({ exportedAt: "2026-03-02", settings: {}, trades: [], screenshots });

  it("writes real images, refuses SVG, bombs and non-images, and never replaces a picture of this device", async () => {
    await store.putShotBlob(blobOf(png(800, 600, 500, 1)), "shot_mine");
    const text = backup({
      shot_ok: { mime: "image/png", data: b64(png(1280, 720, 900, 2)) },
      shot_svg: { mime: "image/svg+xml", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64") },
      shot_bomb: { mime: "image/png", data: b64(png(70_000, 70_000, 500, 3)) },
      shot_mine: { mime: "image/png", data: b64(png(800, 600, 500, 77)) },
      shot_junk: { mime: "image/png", data: "!!!not base64!!!" },
    });
    const res = await bs.restoreShotsFromBackupReport(text);
    expect(res.written).toBe(1);
    expect(res.rejected).toEqual([{ key: "shot_svg", reason: "type" }, { key: "shot_bomb", reason: "dimensions" }]);
    expect(res.kept).toEqual(["shot_mine"]);
    expect(res.corrupt).toEqual(["shot_junk"]);
    expect(await store.getShotBlob("shot_svg")).toBeUndefined();
    expect(await store.getShotBlob("shot_bomb")).toBeUndefined();
    const mine = new Uint8Array(await (await store.getShotBlob("shot_mine"))!.arrayBuffer());
    expect(Array.from(mine)).toEqual(Array.from(png(800, 600, 500, 1)));
    // the plain count API still answers with the number written
    expect(await bs.restoreShotsFromBackup(backup({ shot_two: { mime: "image/png", data: b64(png(10, 10, 100, 4)) } }))).toBe(1);
  });

  it("an oversized base64 text is refused before it is decoded", async () => {
    const huge = "A".repeat(guard.MAX_BASE64_CHARS + 8);
    const res = await bs.restoreShotsFromBackupReport(backup({ shot_huge: { mime: "image/png", data: huge } }));
    expect(res.rejected).toEqual([{ key: "shot_huge", reason: "size" }]);
  });
});

describe("honest wording", () => {
  it("says 'unversehrt' and that the hash is no proof of origin – never 'bytegleich' / 'echt' for a restore", async () => {
    const r = guard.emptyReport();
    r.written = 2;
    const s = guard.restoreSummary(r)!;
    expect(s.detail).toContain("unversehrt");
    expect(s.detail).not.toMatch(/bytegleich|echt|rechtskräftig/i);
  });
});
