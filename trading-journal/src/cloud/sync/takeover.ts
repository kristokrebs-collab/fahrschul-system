/**
 * Data takeover at the first login of a browser (B1, pure): the user chooses what happens to the journal that already
 * lives on this device when an account signs in for the first time. Nothing here touches the network or storage – the
 * engine (`engine.ts`) asks `previewTakeover`, shows the numbers through the dialog and applies `computeTakeover`.
 *
 * The four choices:
 * - `merge`  Zusammenführen: everything of both sides, per record the NEWER version wins, nothing is lost. Records that
 *   exist twice under different ids (same `date|entry|side`, nothing new in the copy) are not added twice
 *   (`applyBackup(…, "merge")` – the same rule as the backup import).
 * - `local`  Lokale Daten übernehmen: like `merge`, but where a record exists on both sides with DIFFERENT content, this
 *   device wins. Cloud records that do not exist here stay (nothing is deleted in the account).
 * - `cloud`  Nur Cloud: this device takes the account's journal; the local one stays in the safety snapshot (and in the
 *   undo window). Nothing is uploaded.
 * - `keep`   Lokal behalten: no sync on this device for now; nothing is read or written in the account.
 *
 * Duplicates are prevented three ways: stable record ids (`t_…`), the content hash (`hashDoc` – identical records are
 * counted as "gleich" and never uploaded again) and the trade signature of the import merge.
 */
import type { DayNote, DayNotes, HyblockReading, JsonBackup, Settings, Trade } from "@/domain/types";
import { normalizeSettings } from "@/domain/normalize";
import type { StorageSnapshot } from "@/store/adapters/StoreApi";
import { ALL_PARTS, applyBackup } from "@/store/backup";
import { hashDoc, parseDocKey } from "./docs";
import { remoteSnapshot, snapshotDocs, type RemoteDoc } from "./reconcile";

export type TakeoverChoice = "merge" | "local" | "cloud" | "keep";

export const TAKEOVER_CHOICES: readonly TakeoverChoice[] = ["merge", "local", "cloud", "keep"];

/** Where the engine is while it applies a choice (the dialog shows it next to the upload progress). */
export type TakeoverStep = "snapshot" | "merge" | "upload" | "finish";

/** What a finished takeover did – the dialog's summary and the toast. */
export interface TakeoverResult {
  choice: Exclude<TakeoverChoice, "keep">;
  /** Records written to the account. */
  pushed: number;
  /** Records written to this device (new or changed). */
  pulled: number;
  conflicts: number;
  /** Local copies of account trades that were not added twice. */
  duplicates: number;
  /** End of the undo window (ISO), `null` when nothing can be undone. */
  undoUntil: string | null;
}

/** Record counts per kind (settings are one object and not counted). */
export interface KindCount {
  trades: number;
  hyblock: number;
  days: number;
}

export const ZERO: Readonly<KindCount> = Object.freeze({ trades: 0, hyblock: 0, days: 0 });

export const totalOf = (c: KindCount): number => c.trades + c.hyblock + c.days;

export interface TakeoverPreview {
  /** The local journal was last synced with ANOTHER account (shared computer) – it must never flow into this one. */
  otherOwner: boolean;
  /** Records on this device. */
  local: KindCount;
  /** Live records in the account. */
  cloud: KindCount;
  /** Identical on both sides (same id, same content). */
  same: KindCount;
  /** Only here – would be added to the account. */
  localOnly: KindCount;
  /** Only in the account – would be added here. */
  cloudOnly: KindCount;
  /** Same id, different content – the choice decides who wins. */
  differ: KindCount;
  /** Local trades that are copies of an account trade under another id (skipped by the merge). */
  duplicates: number;
  /** Settings: identical, different, only here, only in the account, or on neither side. */
  settings: "same" | "differ" | "localOnly" | "cloudOnly" | "none";
  /** The account holds nothing yet. */
  cloudEmpty: boolean;
  /** The choices that make sense for these numbers (never one that would wipe a side for nothing). */
  allowed: TakeoverChoice[];
  recommended: TakeoverChoice;
}

type Snap = Pick<StorageSnapshot, "trades" | "hyblock" | "days" | "settings">;

const countOf = (s: Pick<StorageSnapshot, "trades" | "hyblock" | "days">): KindCount => ({ trades: s.trades.length, hyblock: s.hyblock.length, days: Object.keys(s.days ?? {}).length });

const bump = (c: KindCount, kind: string): void => {
  if (kind === "trade") c.trades++;
  else if (kind === "hyblock") c.hyblock++;
  else if (kind === "day") c.days++;
};

export const hasLocalData = (s: Pick<StorageSnapshot, "trades" | "hyblock" | "days">): boolean => totalOf(countOf(s)) > 0;

function backupOf(snap: Snap, at: string): JsonBackup {
  return { exportedAt: at, settings: snap.settings, trades: snap.trades, hyblock: snap.hyblock, days: snap.days ?? {} };
}

/** Remote side as snapshot parts + the account's settings (or `null`). */
export function remoteSide(remote: ReadonlyMap<string, RemoteDoc>, settingsRow: RemoteDoc | null): { parts: ReturnType<typeof remoteSnapshot>; settings: Settings | null } {
  return { parts: remoteSnapshot(remote), settings: settingsRow && !settingsRow.deleted ? normalizeSettings(settingsRow.data) : null };
}

/** What would happen, in numbers – the dialog shows exactly these. */
export function previewTakeover(input: { local: Snap; remote: ReadonlyMap<string, RemoteDoc>; settingsRow: RemoteDoc | null; otherOwner: boolean; now?: string }): TakeoverPreview {
  const at = input.now ?? new Date().toISOString();
  const { parts, settings: remoteSettings } = remoteSide(input.remote, input.settingsRow);
  const localDocs = snapshotDocs(input.local);
  const same = { ...ZERO };
  const localOnly = { ...ZERO };
  const differ = { ...ZERO };
  const cloudOnly = { ...ZERO };
  for (const [key, rec] of localDocs) {
    const kind = parseDocKey(key)?.kind ?? "";
    const r = input.remote.get(key);
    if (!r || r.deleted) bump(localOnly, kind);
    else if (r.hash === hashDoc(rec)) bump(same, kind);
    else bump(differ, kind);
  }
  for (const [key, r] of input.remote) {
    if (r.deleted || r.kind === "settings") continue;
    if (!localDocs.has(key)) bump(cloudOnly, r.kind);
  }
  const local = countOf(input.local);
  const cloud = countOf(parts);

  // how many of the local-only trades the import merge would NOT add again (copies under another id)
  const merged = applyBackup({ ...parts, settings: remoteSettings ?? input.local.settings }, backupOf(input.local, at), "merge", ALL_PARTS);
  const duplicates = Math.max(0, localOnly.trades - (merged.trades.length - cloud.trades));

  const settings: TakeoverPreview["settings"] = !remoteSettings
    ? "localOnly"
    : hashDoc(remoteSettings) === hashDoc(input.local.settings)
      ? "same"
      : "differ";
  const cloudEmpty = totalOf(cloud) === 0 && !remoteSettings;
  let allowed: TakeoverChoice[];
  let recommended: TakeoverChoice;
  if (input.otherOwner) {
    allowed = ["cloud", "keep"];
    recommended = "cloud";
  } else if (cloudEmpty) {
    allowed = ["local", "keep"];
    recommended = "local";
  } else {
    allowed = ["merge", "local", "cloud", "keep"];
    recommended = "merge";
  }
  return { otherOwner: input.otherOwner, local, cloud, same, localOnly, cloudOnly, differ, duplicates, settings: cloudEmpty ? "none" : settings, cloudEmpty, allowed, recommended };
}

/**
 * Does the user have anything to decide? No when this device holds nothing, or when everything here is already in the
 * account (the merge then only adds the account's records here). Yes whenever the choice would change the account or
 * replace what is on this device.
 */
export function needsDecision(p: TakeoverPreview): boolean {
  if (totalOf(p.local) === 0) return false;
  if (p.otherOwner) return true;
  return totalOf(p.localOnly) > 0 || totalOf(p.differ) > 0;
}

export interface TakeoverComputed {
  /** The journal this device ends up with (and – except `cloud` – what the account ends up with). */
  merged: StorageSnapshot;
  /** Records that exist on both sides with different content. */
  conflicts: number;
}

/** The journal after `choice` (`keep` is not computed – the engine stops before). */
export function computeTakeover(choice: Exclude<TakeoverChoice, "keep">, input: { local: Snap; remote: ReadonlyMap<string, RemoteDoc>; settingsRow: RemoteDoc | null; now?: string }): TakeoverComputed {
  const at = input.now ?? new Date().toISOString();
  const { parts, settings: remoteSettings } = remoteSide(input.remote, input.settingsRow);
  const localDocs = snapshotDocs(input.local);
  let conflicts = 0;
  for (const [k, r] of input.remote) {
    const l = localDocs.get(k);
    if (l && !r.deleted && r.hash !== hashDoc(l)) conflicts++;
  }
  if (choice === "cloud") return { merged: { ...parts, settings: remoteSettings ?? normalizeSettings(null), days: parts.days }, conflicts: 0 };
  const current: StorageSnapshot = { ...parts, settings: remoteSettings ?? input.local.settings };
  let merged = applyBackup(current, backupOf(input.local, at), "merge", ALL_PARTS);
  if (choice === "local") {
    // this device wins where the content differs (same id) – the account's other records stay
    const winner = <T extends { id: string }>(list: readonly T[], kind: "trade" | "hyblock"): T[] =>
      list.map((rec) => {
        const key = `${kind}:${rec.id}`;
        const l = localDocs.get(key);
        const r = input.remote.get(key);
        return l && r && !r.deleted && r.hash !== hashDoc(l) ? (l as unknown as T) : rec;
      });
    const days: DayNotes = { ...(merged.days ?? {}) };
    for (const [date, note] of Object.entries(input.local.days ?? {})) {
      const r = input.remote.get(`day:${date}`);
      if (r && !r.deleted && r.hash !== hashDoc(note)) days[date] = note as DayNote;
    }
    merged = { ...merged, trades: winner<Trade>(merged.trades, "trade"), hyblock: winner<HyblockReading>(merged.hyblock, "hyblock"), days };
  }
  return { merged, conflicts };
}
