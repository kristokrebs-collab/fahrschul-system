/**
 * Image type and size read straight from the first bytes of a file (A2) – no decoding, so the intake knows the mime type
 * and the pixel size of a 12 MB PNG without a long task. PNG, JPEG, GIF, WebP and BMP carry their size in the header; AVIF
 * is recognised by type only (its size comes from the decoder, when one exists).
 */

export interface Sniffed {
  mime: string;
  w?: number;
  h?: number;
}

/** How much of the file the sniffer reads (JPEG headers can hide the size behind an embedded EXIF thumbnail). */
export const SNIFF_BYTES = 512 * 1024;

const ascii = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n));
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32le = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

function jpegSize(b: Uint8Array): { w: number; h: number } | undefined {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o += 1;
      continue;
    }
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: u16be(b, o + 5), w: u16be(b, o + 7) };
    }
    if (len < 2) return undefined;
    o += 2 + len;
  }
  return undefined;
}

function webpSize(b: Uint8Array): { w: number; h: number } | undefined {
  const kind = ascii(b, 12, 4);
  if (kind === "VP8 " && b.length >= 30) return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  if (kind === "VP8L" && b.length >= 25) {
    const v = u32le(b, 21);
    return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X" && b.length >= 30) return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  return undefined;
}

/** Type (and size when the header says it) of image `bytes`, or `null` when they are no known image. */
export function sniffImage(b: Uint8Array): Sniffed | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return { mime: "image/png", w: u32be(b, 16), h: u32be(b, 20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const s = jpegSize(b);
    return { mime: "image/jpeg", ...s };
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return { mime: "image/gif", w: u16le(b, 6), h: u16le(b, 8) };
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { mime: "image/webp", ...webpSize(b) };
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    const h = u32le(b, 22) | 0;
    return { mime: "image/bmp", w: u32le(b, 18), h: Math.abs(h) };
  }
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp" && /^(avif|avis)$/.test(ascii(b, 8, 4))) return { mime: "image/avif" };
  return null;
}

/** Sniffs a blob (reads at most `SNIFF_BYTES`). */
export async function sniffBlob(blob: Blob): Promise<Sniffed | null> {
  const head = blob.slice(0, SNIFF_BYTES);
  const bytes = typeof head.arrayBuffer === "function" ? new Uint8Array(await head.arrayBuffer()) : await new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(head);
  });
  const s = sniffImage(bytes);
  if (s && (s.w === 0 || s.h === 0)) return { mime: s.mime };
  return s;
}
