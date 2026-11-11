/**
 * Unpacks the wire block of `IndustryDailyPayload` into an `IndustryDataset`: base64 → gunzip → the dates and the returns. Every
 * length and order is checked against what the answer promised; a block that does not add up is refused (`DecodeError`), never
 * half-used.
 */
import type { IndustryDataset } from "@/domain/industryTrend";
import type { IndustryDailyPayload } from "./wire";

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

/** Gunzips bytes; injectable so tests and old engines can bring their own. */
export type Gunzip = (bytes: Uint8Array) => Promise<Uint8Array>;

export const browserGunzip: Gunzip = async (bytes) => {
  if (typeof DecompressionStream === "undefined") throw new DecodeError("Dieser Browser kann gzip nicht entpacken (DecompressionStream fehlt).");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export function base64ToBytes(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new DecodeError("Die Daten sind nicht gültig kodiert.");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function decodeIndustry(p: IndustryDailyPayload, gunzip: Gunzip = browserGunzip): Promise<IndustryDataset> {
  let raw: Uint8Array;
  try {
    raw = await gunzip(base64ToBytes(p.data));
  } catch (e) {
    if (e instanceof DecodeError) throw e;
    throw new DecodeError("Die Daten lassen sich nicht entpacken.");
  }
  const T = p.days;
  const N = p.names.length;
  if (raw.length !== p.bytes) throw new DecodeError("Die entpackten Daten haben nicht die angekündigte Größe.");
  // copy into a fresh buffer: typed-array views need aligned offsets, and the unpacked block may sit anywhere
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  const dv = new DataView(buf);
  const dates = new Int32Array(T);
  for (let t = 0; t < T; t++) dates[t] = dv.getInt32(t * 4, true);
  const returns = new Int16Array(N * T);
  const base = T * 4;
  for (let k = 0; k < returns.length; k++) returns[k] = dv.getInt16(base + k * 2, true);
  if (dates[0] !== p.firstDay || dates[T - 1] !== p.lastDay) throw new DecodeError("Erster und letzter Tag stimmen nicht mit der Ankündigung überein.");
  for (let t = 1; t < T; t++) if (dates[t]! <= dates[t - 1]!) throw new DecodeError("Die Handelstage sind nicht aufsteigend.");
  return { names: p.names.slice(), dates, returns };
}
