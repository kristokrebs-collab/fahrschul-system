/**
 * Fixtures of the screenshot-original specs (A2): a REAL, decodable PNG of any size made of incompressible noise (so a
 * "12 MB PNG" is really 12 MB on disk and in the browser's decoder), and a minimal reader for the "stored" ZIP the
 * backup writes (to check the manifest and the file bytes from outside the app).
 */
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};

/** RGBA noise PNG of `w × h` (about `w * h * 4` bytes). Deterministic for a seed. */
export function noisePng(w: number, h: number, seed = 1): Buffer {
  const row = 1 + w * 4;
  const raw = Buffer.alloc(row * h);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let y = 0; y < h; y++) {
    const o = y * row;
    raw[o] = 0; // filter: none
    for (let i = 1; i < row; i++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      raw[o + i] = x & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
}

export const sha256 = (b: Buffer | Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Entries of a ZIP with "stored" entries only (what the app writes). */
export function readStoredZip(zip: Buffer): Map<string, Buffer> {
  let e = zip.length - 22;
  while (e >= 0 && zip.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("no end record");
  const count = zip.readUInt16LE(e + 10);
  let o = zip.readUInt32LE(e + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(o) !== 0x02014b50) throw new Error("bad central directory");
    const method = zip.readUInt16LE(o + 10);
    const size = zip.readUInt32LE(o + 24);
    const nameLen = zip.readUInt16LE(o + 28);
    const extra = zip.readUInt16LE(o + 30);
    const comment = zip.readUInt16LE(o + 32);
    const local = zip.readUInt32LE(o + 42);
    const name = zip.subarray(o + 46, o + 46 + nameLen).toString("utf8");
    if (method !== 0) throw new Error("not stored");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.set(name, zip.subarray(start, start + size));
    o += 46 + nameLen + extra + comment;
  }
  return out;
}
