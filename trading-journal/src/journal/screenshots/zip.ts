/**
 * A tiny ZIP writer / reader for "Backup mit Bildern" (A2) – no dependency, no compression: screenshots are already
 * compressed, and "stored" entries are plain slices of the file, so building and reading a backup never copies the
 * image bytes into memory (a `Blob` of parts is only references; entries are read back with `Blob.slice`).
 *
 * Writer: local headers + data + central directory + end record, UTF-8 names, CRC-32 computed in 256 KiB slices with
 * rests (the page stays free). Reader: finds the end record, reads the central directory and hands out each entry as a
 * lazy slice; only unencrypted, unsplit, "stored" archives of at most 65,535 entries and 4 GiB (no ZIP64) are accepted –
 * exactly what the writer produces. Every other archive is refused with a clear German message.
 */
import { bytesOf, yieldToMain } from "./sha256";

const SLICE = 256 * 1024;
const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** CRC-32 (IEEE) of `bytes`, continuing from `crc` (start with 0). */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

export async function crc32OfBlob(blob: Blob): Promise<number> {
  let crc = 0;
  for (let o = 0; o < blob.size; o += SLICE) {
    crc = crc32Update(crc, await bytesOf(blob.slice(o, o + SLICE)));
    if (o + SLICE < blob.size) await yieldToMain();
  }
  return crc;
}

export interface ZipInput {
  name: string;
  data: Blob | Uint8Array | string;
}

const enc = new TextEncoder();
const LIMIT = 0xffffffff;

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** Builds the archive (stored entries). Rejects with a German message when it would exceed the classic ZIP limits. */
export async function buildZip(inputs: readonly ZipInput[], now: Date = new Date()): Promise<Blob> {
  if (inputs.length > 0xffff) throw new Error("Zu viele Dateien für ein ZIP.");
  const { time, date } = dosDateTime(now);
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const input of inputs) {
    const name = enc.encode(input.name);
    const data = typeof input.data === "string" ? new Blob([enc.encode(input.data)]) : input.data instanceof Blob ? input.data : new Blob([input.data as BlobPart]);
    const size = data.size;
    if (size > LIMIT || offset > LIMIT) throw new Error("Das Backup ist größer als 4 GB und passt nicht in ein ZIP.");
    const crc = await crc32OfBlob(data);
    const head = new Uint8Array(30 + name.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 0x0800, true); // UTF-8 names
    hv.setUint16(8, 0, true); // stored
    hv.setUint16(10, time, true);
    hv.setUint16(12, date, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, size, true);
    hv.setUint32(22, size, true);
    hv.setUint16(26, name.length, true);
    hv.setUint16(28, 0, true);
    head.set(name, 30);
    parts.push(head, data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += head.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + cdSize > LIMIT) throw new Error("Das Backup ist größer als 4 GB und passt nicht in ein ZIP.");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, inputs.length, true);
  ev.setUint16(10, inputs.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

export interface ZipEntry {
  name: string;
  size: number;
  crc: number;
  /** The entry's bytes as a lazy slice of the archive (nothing is copied). */
  data(): Promise<Blob>;
}

export const ZIP_MESSAGES = {
  notZip: "Das ist keine ZIP-Datei.",
  unsupported: "Dieses ZIP ist nicht von diesem Journal erzeugt (komprimiert, verschlüsselt oder ZIP64). Entpacke es nicht neu und wähle die Original-Datei.",
  broken: "Das ZIP ist beschädigt oder unvollständig.",
} as const;

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/** Whether `file` starts like a ZIP archive. */
export async function looksLikeZip(file: Blob): Promise<boolean> {
  if (file.size < 22) return false;
  const head = await bytesOf(file.slice(0, 4));
  return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
}

/** Lists the entries of an archive written by `buildZip`. Rejects with a German message otherwise. */
export async function readZip(file: Blob): Promise<ZipEntry[]> {
  if (!(await looksLikeZip(file))) throw new Error(ZIP_MESSAGES.notZip);
  const tailStart = Math.max(0, file.size - (22 + 0xffff));
  const tail = await bytesOf(file.slice(tailStart));
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tv, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(ZIP_MESSAGES.broken);
  const count = u16(tv, eocd + 10);
  const cdSize = u32(tv, eocd + 12);
  const cdOffset = u32(tv, eocd + 16);
  if (count === 0xffff || cdSize === LIMIT || cdOffset === LIMIT) throw new Error(ZIP_MESSAGES.unsupported);
  if (cdOffset + cdSize > file.size) throw new Error(ZIP_MESSAGES.broken);
  const cd = await bytesOf(file.slice(cdOffset, cdOffset + cdSize));
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder("utf-8");
  const out: ZipEntry[] = [];
  let o = 0;
  for (let n = 0; n < count; n++) {
    if (o + 46 > cd.length || u32(cv, o) !== 0x02014b50) throw new Error(ZIP_MESSAGES.broken);
    const flags = u16(cv, o + 8);
    const method = u16(cv, o + 10);
    const crc = u32(cv, o + 16);
    const csize = u32(cv, o + 20);
    const usize = u32(cv, o + 24);
    const nameLen = u16(cv, o + 28);
    const extraLen = u16(cv, o + 30);
    const commentLen = u16(cv, o + 32);
    const local = u32(cv, o + 42);
    if (method !== 0 || (flags & 1) !== 0 || csize !== usize) throw new Error(ZIP_MESSAGES.unsupported);
    const name = dec.decode(cd.subarray(o + 46, o + 46 + nameLen));
    o += 46 + nameLen + extraLen + commentLen;
    out.push({
      name,
      size: usize,
      crc,
      async data() {
        const lh = await bytesOf(file.slice(local, local + 30));
        const lv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
        if (lh.length < 30 || u32(lv, 0) !== 0x04034b50) throw new Error(ZIP_MESSAGES.broken);
        const start = local + 30 + u16(lv, 26) + u16(lv, 28);
        if (start + usize > file.size) throw new Error(ZIP_MESSAGES.broken);
        return file.slice(start, start + usize);
      },
    });
  }
  return out;
}
