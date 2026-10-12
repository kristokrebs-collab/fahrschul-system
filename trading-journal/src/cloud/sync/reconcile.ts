/**
 * Pure three-way reconciliation of the local journal with `journal_docs` (P09 sync).
 *
 * `base` = content hash of every record as it was at the last successful sync (`SyncBase.docs`), `local` = the
 * records in this browser now, `remote` = the rows in the cloud now. Per record:
 *
 * | local          | remote            | base            | → action                                    |
 * |----------------|-------------------|-----------------|---------------------------------------------|
 * | = remote       | live              | any             | same                                        |
 * | changed        | unchanged (= base)|                 | push                                        |
 * | unchanged      | changed           |                 | take                                        |
 * | changed        | changed           |                 | conflict: newer `updatedAt` wins, ties → hash (deterministic on every device) |
 * | present        | missing           | any             | push (never delete locally because a row is missing) |
 * | present, = base| tombstone         |                 | drop local                                  |
 * | present, ≠ base| tombstone         |                 | push (an edit beats a delete – lossless), conflict |
 * | missing        | live, = base      | set             | push tombstone (deleted here since the last sync) |
 * | missing        | live, ≠ base      | set             | take (edit beats delete), conflict          |
 * | missing        | live              | none            | take (new remote record)                    |
 *
 * Both sides are hashed in NORMALISED form (`canonRecord`), so the read-path normalisation never looks like a change.
 * Settings are not decided here – they are three-way merged (`merge3`) in the engine.
 */
import type { DayNote, DayNotes, HyblockReading, Trade } from "@/domain/types";
import { normalizeDayNote, normalizeReading, normalizeTrade, sortReadings } from "@/domain/normalize";
import type { StorageSnapshot } from "@/store/adapters/StoreApi";
import { docKey, hashDoc, parseDocKey, type DocKind, type DocRow } from "./docs";

export type RecordKind = Exclude<DocKind, "settings">;
export const RECORD_KINDS: readonly RecordKind[] = ["trade", "hyblock", "day"];

/** Normalised record of a kind (idempotent: canon(canon(x)) ≡ canon(x)). Day notes travel without their date key. */
export function canonRecord(kind: RecordKind, raw: unknown): Record<string, unknown> {
  if (kind === "trade") return normalizeTrade(raw) as unknown as Record<string, unknown>;
  if (kind === "hyblock") return normalizeReading(raw) as unknown as Record<string, unknown>;
  return normalizeDayNote(raw) as unknown as Record<string, unknown>;
}

/** `trade:t_1 → record`, `hyblock:h_1 → reading`, `day:2026-10-07 → note` of a snapshot (already normalised on read). */
export function snapshotDocs(s: Pick<StorageSnapshot, "trades" | "hyblock" | "days">): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const t of s.trades) if (t.id) out.set(docKey("trade", t.id), t as unknown as Record<string, unknown>);
  for (const r of s.hyblock) if (r.id) out.set(docKey("hyblock", r.id), r as unknown as Record<string, unknown>);
  for (const [d, n] of Object.entries(s.days ?? {})) out.set(docKey("day", d), n as unknown as Record<string, unknown>);
  return out;
}

/** A remote row reduced to what the decision needs, its data normalised. */
export interface RemoteDoc {
  kind: DocKind;
  id: string;
  deleted: boolean;
  /** Normalised record (live rows) or the tombstone payload. */
  data: Record<string, unknown>;
  hash: string;
  rev: number;
  updatedAt: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Row → `RemoteDoc` (`null` for unknown kinds / malformed rows). Live records are normalised before hashing. */
export function toRemoteDoc(row: DocRow): RemoteDoc | null {
  const parsed = parseDocKey(`${row.kind}:${row.id}`);
  if (!parsed) return null;
  const rev = typeof row.rev === "number" ? row.rev : 0;
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
  if (row.deleted) return { kind: parsed.kind, id: parsed.id, deleted: true, data: isObj(row.data) ? row.data : {}, hash: "", rev, updatedAt };
  if (parsed.kind === "settings") return { kind: "settings", id: parsed.id, deleted: false, data: isObj(row.data) ? row.data : {}, hash: hashDoc(row.data), rev, updatedAt };
  if (!isObj(row.data)) return null;
  const withId = parsed.kind === "day" ? row.data : { ...row.data, id: parsed.id };
  const data = canonRecord(parsed.kind, withId);
  return { kind: parsed.kind, id: parsed.id, deleted: false, data, hash: hashDoc(data), rev, updatedAt };
}

export type Action = "same" | "take" | "push" | "drop" | "pushDelete" | "none";

export interface Decision {
  action: Action;
  conflict: boolean;
}

/** `updatedAt` of a record (trades, day notes), `null` when it has none (readings). */
function stamp(rec: Record<string, unknown> | undefined): string | null {
  const v = rec?.updatedAt;
  return typeof v === "string" && v ? v : null;
}

/** The decision table above for one record. */
export function decide(base: string | undefined, local: Record<string, unknown> | undefined, remote: RemoteDoc | undefined): Decision {
  const lh = local ? hashDoc(local) : undefined;
  if (!local && !remote) return { action: "none", conflict: false };
  if (!local) {
    if (!remote || remote.deleted) return { action: "none", conflict: false };
    if (base === undefined) return { action: "take", conflict: false };
    if (base === remote.hash) return { action: "pushDelete", conflict: false };
    return { action: "take", conflict: true };
  }
  if (!remote) return { action: "push", conflict: false };
  if (remote.deleted) {
    if (base !== undefined && base === lh) return { action: "drop", conflict: false };
    return { action: "push", conflict: true };
  }
  if (lh === remote.hash) return { action: "same", conflict: false };
  if (base === lh) return { action: "take", conflict: false };
  if (base === remote.hash) return { action: "push", conflict: false };
  const ls = stamp(local);
  const rs = stamp(remote.data);
  if (ls && rs && ls !== rs) return { action: ls > rs ? "push" : "take", conflict: true };
  return { action: (lh as string) > remote.hash ? "push" : "take", conflict: true };
}

export interface Plan {
  /** Records to write locally (key → normalised remote record). */
  take: Map<string, Record<string, unknown>>;
  /** Local records to remove (remote tombstone). */
  drop: Set<string>;
  /** Local records to upload. */
  push: string[];
  /** Tombstones to upload (deleted locally since the last sync). */
  pushDelete: string[];
  conflicts: number;
  /** Base after the plan is applied (pushes included – the engine keeps them only when the upload succeeds). */
  base: Record<string, string>;
}

/** Decides every record of the union of base, local and remote (settings excluded). */
export function planReconcile(base: Readonly<Record<string, string>>, local: ReadonlyMap<string, Record<string, unknown>>, remote: ReadonlyMap<string, RemoteDoc>): Plan {
  const plan: Plan = { take: new Map(), drop: new Set(), push: [], pushDelete: [], conflicts: 0, base: {} };
  const keys = new Set<string>([...Object.keys(base), ...local.keys(), ...remote.keys()]);
  for (const key of keys) {
    const parsed = parseDocKey(key);
    if (!parsed || parsed.kind === "settings") continue;
    const l = local.get(key);
    const r = remote.get(key);
    const d = decide(base[key], l, r);
    if (d.conflict) plan.conflicts++;
    switch (d.action) {
      case "same":
      case "push":
        plan.base[key] = hashDoc(l);
        if (d.action === "push") plan.push.push(key);
        break;
      case "take":
        plan.take.set(key, (r as RemoteDoc).data);
        plan.base[key] = (r as RemoteDoc).hash;
        break;
      case "drop":
        plan.drop.add(key);
        break;
      case "pushDelete":
        plan.pushDelete.push(key);
        break;
      case "none":
        break;
    }
  }
  return plan;
}

/** True when the plan changes anything locally. */
export function changesLocal(plan: Pick<Plan, "take" | "drop">): boolean {
  return plan.take.size > 0 || plan.drop.size > 0;
}

/**
 * Applies the local half of a plan to a snapshot: taken records replace theirs in place (new ones appended), dropped
 * ones leave; readings stay sorted by `at`. Returns only the parts that changed.
 */
export function applyPlanLocal(s: Pick<StorageSnapshot, "trades" | "hyblock" | "days">, plan: Pick<Plan, "take" | "drop">): Partial<Pick<StorageSnapshot, "trades" | "hyblock" | "days">> {
  const out: Partial<Pick<StorageSnapshot, "trades" | "hyblock" | "days">> = {};
  const touched = (kind: RecordKind) => [...plan.take.keys(), ...plan.drop].some((k) => k.startsWith(`${kind}:`));
  const list = <T extends { id: string }>(kind: "trade" | "hyblock", cur: readonly T[]): T[] => {
    const seen = new Set<string>();
    const next: T[] = [];
    for (const rec of cur) {
      const key = docKey(kind, rec.id);
      seen.add(key);
      if (plan.drop.has(key)) continue;
      next.push((plan.take.get(key) as T | undefined) ?? rec);
    }
    for (const [key, rec] of plan.take) if (key.startsWith(`${kind}:`) && !seen.has(key)) next.push(rec as T);
    return next;
  };
  if (touched("trade")) out.trades = list<Trade>("trade", s.trades);
  if (touched("hyblock")) out.hyblock = sortReadings(list<HyblockReading>("hyblock", s.hyblock));
  if (touched("day")) {
    const days: DayNotes = { ...(s.days ?? {}) };
    for (const key of plan.drop) if (key.startsWith("day:")) delete days[key.slice(4)];
    for (const [key, rec] of plan.take) if (key.startsWith("day:")) days[key.slice(4)] = rec as unknown as DayNote;
    out.days = days;
  }
  return out;
}

/** Remote rows → normalised journal snapshot parts (live rows only) + the settings row. */
export function remoteSnapshot(rows: ReadonlyMap<string, RemoteDoc>): { trades: Trade[]; hyblock: HyblockReading[]; days: DayNotes } {
  const trades: Trade[] = [];
  const hyblock: HyblockReading[] = [];
  const days: DayNotes = {};
  for (const doc of rows.values()) {
    if (doc.deleted) continue;
    if (doc.kind === "trade") trades.push(doc.data as unknown as Trade);
    else if (doc.kind === "hyblock") hyblock.push(doc.data as unknown as HyblockReading);
    else if (doc.kind === "day") days[doc.id] = doc.data as unknown as DayNote;
  }
  trades.sort((a, b) => (a.createdAt || a.date || "").localeCompare(b.createdAt || b.date || ""));
  return { trades, hyblock: sortReadings(hyblock), days };
}
