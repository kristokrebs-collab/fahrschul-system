/**
 * `journal_docs` row vocabulary (P09) – shared by the client sync (`src/cloud/sync`) and the Netlify functions
 * (`netlify/functions/_lib/account.ts` imports this file by RELATIVE path). PURE: no imports, no `@/` alias, no build
 * defines, no DOM – it must compile in the functions' tsconfig too.
 *
 * One row per journal record: `(user_id, kind, id) → data jsonb`.
 * - `trade` / `hyblock`: `id` = the client id (`t_…`, `h_…`), `data` = the record verbatim (passthrough fields such as
 *   `signal` / `boxSnap` round-trip untouched).
 * - `day`: `id` = `YYYY-MM-DD`, `data` = the `DayNote`.
 * - `settings`: `id` = `"settings"`, `data` = the settings object; `rev` is its optimistic lock.
 * - Deletes are tombstones: `deleted = true`, `data = { deletedAt }` (never a hard delete – an offline device must not
 *   resurrect the record, and Realtime does not apply RLS to DELETE events).
 */

export const DOC_KINDS = ["trade", "hyblock", "day", "settings"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** `id` of the one settings row. */
export const SETTINGS_ID = "settings";

/** A row as PostgREST / Realtime deliver it (columns the client selects). */
export interface DocRow {
  kind: string;
  id: string;
  data: unknown;
  deleted: boolean;
  /** Server revision (bumped by the `journal_docs_stamp` trigger on every update). */
  rev?: number;
  /** Server time of the last write (trigger). */
  updated_at?: string;
}

/** Columns every client / function read selects. */
export const DOC_COLUMNS = "kind,id,data,deleted,rev,updated_at";

export const isDocKind = (v: unknown): v is DocKind => typeof v === "string" && (DOC_KINDS as readonly string[]).includes(v);

/** `trade:t_abc` – key of a record across local state, base hashes and the outbox. */
export function docKey(kind: DocKind, id: string): string {
  return `${kind}:${id}`;
}

/** Inverse of `docKey` (`null` for anything else). */
export function parseDocKey(key: string): { kind: DocKind; id: string } | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  return isDocKind(kind) && id ? { kind, id } : null;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Deterministic JSON: object keys sorted, `undefined` members dropped (as `JSON.stringify` does), non-finite numbers
 * as `null`. Two records with equal content always give the same string, whatever their key order.
 */
export function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined || typeof x === "function" ? "null" : stableStringify(x))).join(",")}]`;
  if (isPlain(v)) {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined && typeof v[k] !== "function")
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return "null";
}

/**
 * Content hash of a record (two 32-bit FNV-1a lanes over `stableStringify`, base 36). Used to tell "changed since the
 * last sync" without keeping a second copy of every record.
 */
export function hashDoc(v: unknown): string {
  const s = stableStringify(v);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36).padStart(7, "0")}`;
}

/** Tombstone payload. */
export function tombstoneData(deletedAt: string): { deletedAt: string } {
  return { deletedAt };
}

/** The backup shape `parseBackup` (src/store/backup.ts) accepts. */
export interface BackupShape {
  exportedAt: string;
  settings?: unknown;
  trades: Record<string, unknown>[];
  hyblock: Record<string, unknown>[];
  days: Record<string, unknown>;
}

/**
 * Live rows → a journal backup (tombstones and unknown kinds skipped). The record id always follows the row id, so a
 * record never travels under another id than the one it is stored under.
 */
export function rowsToBackup(rows: readonly DocRow[], exportedAt: string): BackupShape {
  const out: BackupShape = { exportedAt, trades: [], hyblock: [], days: {} };
  for (const r of rows) {
    if (r.deleted || !isPlain(r.data)) continue;
    if (r.kind === "trade") out.trades.push({ ...r.data, id: r.id });
    else if (r.kind === "hyblock") out.hyblock.push({ ...r.data, id: r.id });
    else if (r.kind === "day") out.days[r.id] = r.data;
    else if (r.kind === "settings" && r.id === SETTINGS_ID) out.settings = r.data;
  }
  out.hyblock.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  return out;
}
