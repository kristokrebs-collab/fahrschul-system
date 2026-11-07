/**
 * SHA-256 of a file (A2: every screenshot carries the hash of its original bytes).
 *
 * - `crypto.subtle.digest` when the page is a secure context: the browser hashes on its own thread, the page only waits.
 * - Otherwise (plain-http LAN address, very old browsers, jsdom): an incremental pure-JS SHA-256 that reads the blob in
 *   256 KiB slices and hands the thread back between them, so even a 25 MB file never blocks a frame for long.
 * Both give the same hex digest (tested against the NIST vectors and `node:crypto`).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Incremental SHA-256 (FIPS 180-4). `update` any number of times, then `hex()`. */
export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private buf = new Uint8Array(64);
  private fill = 0;
  private total = 0;
  private w = new Uint32Array(64);

  update(data: Uint8Array): this {
    this.total += data.length;
    let i = 0;
    if (this.fill) {
      const take = Math.min(64 - this.fill, data.length);
      this.buf.set(data.subarray(0, take), this.fill);
      this.fill += take;
      i = take;
      if (this.fill === 64) {
        this.block(this.buf, 0);
        this.fill = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.fill = data.length - i;
    }
    return this;
  }

  private block(b: Uint8Array, o: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const j = o + t * 4;
      w[t] = ((b[j]! << 24) | (b[j + 1]! << 16) | (b[j + 2]! << 8) | b[j + 3]!) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]!;
      const y = w[t - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let [a, b1, c, d, e, f, g, hh] = this.h as unknown as number[] as [number, number, number, number, number, number, number, number];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b1) ^ (a & c) ^ (b1 & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b1;
      b1 = a;
      a = (t1 + t2) >>> 0;
    }
    const h = this.h;
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b1) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  /** The digest as 64 lower-case hex characters (finishes the hash; do not `update` afterwards). */
  hex(): string {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(bits / 0x100000000));
    view.setUint32(pad.length - 4, bits >>> 0);
    const total = this.total;
    this.update(pad);
    this.total = total;
    return [...this.h].map((n) => n.toString(16).padStart(8, "0")).join("");
  }
}

export const hexOfBytes = (bytes: Uint8Array): string => [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");

const SLICE = 256 * 1024;

/** Hands the thread back (a frame can run between two slices). */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((r) => setTimeout(r, 0));
}

/** Reads a blob slice as bytes (`Blob.arrayBuffer`, `FileReader` where a very old engine lacks it). */
export function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("read"));
    r.readAsArrayBuffer(blob);
  });
}

/** Pure-JS hash of a blob in slices (the fallback; also exported for the tests). */
export async function sha256Incremental(blob: Blob): Promise<string> {
  const h = new Sha256();
  for (let o = 0; o < blob.size; o += SLICE) {
    h.update(await bytesOf(blob.slice(o, o + SLICE)));
    if (o + SLICE < blob.size) await yieldToMain();
  }
  return h.hex();
}

/** SHA-256 of `blob` as 64 hex characters. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    try {
      const buf = await (typeof blob.arrayBuffer === "function" ? blob.arrayBuffer() : bytesOf(blob).then((u) => u.buffer as ArrayBuffer));
      return hexOfBytes(new Uint8Array(await subtle.digest("SHA-256", buf)));
    } catch {
      /* fall through to the incremental hash */
    }
  }
  return sha256Incremental(blob);
}

/** Whether `sha` looks like a SHA-256 hex digest. */
export const isSha256 = (sha: unknown): sha is string => typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha);
