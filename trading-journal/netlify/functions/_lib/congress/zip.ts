/**
 * Reads ONE entry out of a small ZIP (the Clerk's yearly index `<YEAR>FD.zip` holds `<YEAR>FD.xml` and `<YEAR>FD.txt`).
 * Server only (Node `zlib`). Central directory based, stored and deflate entries, no ZIP64, no encryption – anything else is a
 * typed `ZipError` and the caller reports a changed format.
 */
import { inflateRawSync } from "node:zlib";

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** the entry's DOS time as UTC ms epoch (the Clerk stamps its files), `null` when it is not a valid date */
  time: number | null;
}

const MAX_OUT = 24 * 1024 * 1024;

function dosTime(date: number, time: number): number | null {
  const y = ((date >> 9) & 0x7f) + 1980;
  const mo = (date >> 5) & 0x0f;
  const d = date & 0x1f;
  if (mo < 1 || mo > 12 || d < 1) return null;
  return Date.UTC(y, mo - 1, d, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

/** The first entry whose name matches. Throws `ZipError`. */
export function readZipEntry(buf: Buffer, match: RegExp): ZipEntry {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new ZipError("not a ZIP file");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("damaged central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const mtime = buf.readUInt16LE(p + 12);
    const mdate = buf.readUInt16LE(p + 14);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!match.test(name)) continue;
    if (flags & 1) throw new ZipError("encrypted entry");
    if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) throw new ZipError("ZIP64 is not supported");
    if (usize > MAX_OUT) throw new ZipError("entry too large");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError("damaged local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (raw.length !== csize) throw new ZipError("entry is cut off");
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: MAX_OUT });
      } catch {
        throw new ZipError("entry could not be decompressed");
      }
    } else throw new ZipError(`compression method ${method}`);
    if (data.length !== usize) throw new ZipError("entry has the wrong size");
    return { name, data, time: dosTime(mdate, mtime) };
  }
  throw new ZipError("no matching entry");
}
