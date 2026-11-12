/**
 * Screenshot hash list of the account export (B1, DSGVO Art. 15 / 20, A2 "Bild-Hashes"): which pictures belong to which
 * trade, the SHA-256 the app recorded when the picture was added, and – for the files that live in the private bucket –
 * the SHA-256 the SERVER computes from the stored bytes, so an exported list can be checked against the downloaded file
 * with any hash tool, and a difference between "recorded" and "stored" is visible.
 *
 * - `entries`: one row per picture reference of a live trade (device-only pictures are listed too: their bytes are not in
 *   the account, `inBucket: false`).
 * - `orphans`: bucket files no trade refers to (e.g. a trade deleted while offline).
 * - `missing`: cloud references whose file is not in the bucket.
 * Hashing is bounded (`MAX_HASHED` files of at most `MAX_BYTES`, `BUDGET_MS` in total) – a file beyond the bound keeps
 * `serverSha256: null` and the manifest says how many were not hashed. Never throws.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";

export const SHOTS_BUCKET = "screenshots" as const;
export const MAX_HASHED = 40;
export const MAX_BYTES = 5 * 1024 * 1024;
export const BUDGET_MS = 6_000;

const SHA = /^[0-9a-f]{64}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface ShotEntry {
  tradeId: string;
  shotId: string;
  name: string | null;
  mime: string | null;
  bytes: number | null;
  /** SHA-256 the app recorded when the picture was added (`null` for pictures from before the hash existed). */
  recordedSha256: string | null;
  /** SHA-256 of the bytes stored in the bucket, computed by the server (`null` = not in the bucket or not hashed). */
  serverSha256: string | null;
  /** `true` equal, `false` different, `null` one side missing. */
  match: boolean | null;
  store: "idb" | "cloud" | "url";
  /** Bucket path (`<uid>/<file>`) of a cloud picture. */
  path: string | null;
  inBucket: boolean;
}

export interface ShotManifest {
  /** Pictures referenced by live trades. */
  entries: ShotEntry[];
  /** Bucket files without a reference. */
  orphans: string[];
  /** Cloud references whose file is not in the bucket. */
  missing: string[];
  hashed: number;
  notHashed: number;
  note: string;
}

/** Picture references of the journal's live trades (`journal.trades`, the backup shape). */
export function shotRefs(trades: readonly Record<string, unknown>[]): { tradeId: string; ref: Record<string, unknown> }[] {
  const out: { tradeId: string; ref: Record<string, unknown> }[] = [];
  for (const t of trades) {
    const id = str(t.id);
    if (!id || !Array.isArray(t.screenshots)) continue;
    for (const ref of t.screenshots) if (isObj(ref) && str(ref.id)) out.push({ tradeId: id, ref });
  }
  return out;
}

async function serverHash(path: string, sb: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await sb.storage.from(SHOTS_BUCKET).download(path);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return buf.length > MAX_BYTES ? null : createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

/** Builds the manifest. `files` = every object path below the user's folder (`listUserFiles("screenshots", …)`). */
export async function screenshotManifest(trades: readonly Record<string, unknown>[], files: readonly string[], sb: SupabaseClient = supabaseAdmin(), now: () => number = Date.now): Promise<ShotManifest> {
  const inBucket = new Set(files);
  const refs = shotRefs(trades);
  const started = now();
  let hashed = 0;
  let notHashed = 0;
  const entries: ShotEntry[] = [];
  const referenced = new Set<string>();
  const missing: string[] = [];
  const hashes = new Map<string, string | null>();
  for (const { tradeId, ref } of refs) {
    const store = ref.store === "cloud" || ref.store === "url" ? ref.store : "idb";
    const path = store === "cloud" ? str(ref.key) : null;
    const present = !!path && inBucket.has(path);
    if (path) referenced.add(path);
    if (store === "cloud" && path && !present) missing.push(path);
    let server: string | null = null;
    if (present && path) {
      if (!hashes.has(path)) {
        if (hashed < MAX_HASHED && now() - started < BUDGET_MS) {
          hashes.set(path, await serverHash(path, sb));
          if (hashes.get(path)) hashed++;
          else notHashed++;
        } else {
          hashes.set(path, null);
          notHashed++;
        }
      }
      server = hashes.get(path) ?? null;
    }
    const recorded = SHA.test(String(ref.sha256 ?? "")) ? String(ref.sha256).toLowerCase() : null;
    entries.push({
      tradeId,
      shotId: String(ref.id),
      name: str(ref.originalName),
      mime: str(ref.mime),
      bytes: num(ref.bytes),
      recordedSha256: recorded,
      serverSha256: server,
      match: recorded && server ? recorded === server : null,
      store,
      path,
      inBucket: present,
    });
  }
  const orphans = files.filter((p) => !referenced.has(p));
  return {
    entries,
    orphans,
    missing,
    hashed,
    notHashed,
    note: "recordedSha256 hat die App beim Hinzufügen des Bildes festgehalten, serverSha256 der Server aus den gespeicherten Bytes. Bilder, die nur auf einem Gerät liegen, stehen in der Liste, ihre Bytes sind nicht im Konto.",
  };
}
