/**
 * Hashes of the Zeitmaschine (pure, synchronous, no I/O): SHA-256 over bytes, over the candles a simulation was computed from, and
 * over a canonical JSON text. They tell two simulations apart, name one (`simulation_id`) and show whether a recomputation came out
 * the same. They are fingerprints, not secrets.
 */
import type { Bar } from "../backtest/types";

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Incremental SHA-256 (FIPS 180-4). */
export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private buf = new Uint8Array(64);
  private fill = 0;
  private total = 0;
  private w = new Uint32Array(64);

  private block(b: Uint8Array, o: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = ((b[o + 4 * i]! << 24) | (b[o + 4 * i + 1]! << 16) | (b[o + 4 * i + 2]! << 8) | b[o + 4 * i + 3]!) >>> 0;
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const c = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(c, 17) ^ rotr(c, 19) ^ (c >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b1, c, d, e, f, g, h] = this.h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b1) ^ (a & c) ^ (b1 & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b1;
      b1 = a;
      a = (t1 + t2) >>> 0;
    }
    const s = this.h;
    s[0] = (s[0]! + a) >>> 0;
    s[1] = (s[1]! + b1) >>> 0;
    s[2] = (s[2]! + c) >>> 0;
    s[3] = (s[3]! + d) >>> 0;
    s[4] = (s[4]! + e) >>> 0;
    s[5] = (s[5]! + f) >>> 0;
    s[6] = (s[6]! + g) >>> 0;
    s[7] = (s[7]! + h) >>> 0;
  }

  update(data: Uint8Array): this {
    this.total += data.length;
    let i = 0;
    if (this.fill > 0) {
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

  /** The digest as 64 lower-case hex characters. */
  hex(): string {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8);
    pad[0] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    let out = "";
    for (const v of this.h) out += v.toString(16).padStart(8, "0");
    return out;
  }
}

const enc = new TextEncoder();

export const sha256Hex = (data: Uint8Array | string): string => new Sha256().update(typeof data === "string" ? enc.encode(data) : data).hex();

/** JSON with sorted keys (numbers and strings as `JSON.stringify` writes them): one text per value, whatever the key order. */
export function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return v === undefined ? "null" : JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(",")}}`;
}

/**
 * SHA-256 of the candles a simulation was computed from: per candle open time, open, high, low, close as 64-bit floats (big endian),
 * in the order given. Volume is not part of it – the simulation never reads it. The same candles give the same hash on any machine.
 */
export function dataHashOf(bars: readonly Bar[]): string {
  const h = new Sha256();
  const chunk = new Uint8Array(40 * 256);
  const dv = new DataView(chunk.buffer);
  let n = 0;
  for (const b of bars) {
    const o = n * 40;
    dv.setFloat64(o, b.t);
    dv.setFloat64(o + 8, b.o);
    dv.setFloat64(o + 16, b.h);
    dv.setFloat64(o + 24, b.l);
    dv.setFloat64(o + 32, b.c);
    if (++n === 256) {
      h.update(chunk);
      n = 0;
    }
  }
  if (n) h.update(chunk.subarray(0, n * 40));
  return h.hex();
}
