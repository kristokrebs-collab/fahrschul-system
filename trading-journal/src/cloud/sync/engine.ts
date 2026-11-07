/**
 * The sync engine (P09): keeps the local journal (localStorage, always the source the app reads) and the user's
 * `journal_docs` rows in step. Local-first: every write lands locally first and synchronously; the engine uploads it
 * afterwards (outbox), pulls what other devices wrote (Realtime + catch-up), and reconciles everything three-way on
 * start and after every reconnect (`reconcile.ts`).
 *
 * - First sync of this browser with an account (no base, or a base of ANOTHER account): a safety snapshot of the local
 *   journal (`tj2-backup-import-<ISO>`, listed under Einstellungen → Daten → Wiederherstellen) is written first – without
 *   it nothing happens. Same account / never synced: local and cloud are MERGED with the import merge
 *   (`applyBackup(remote, local, "merge", ALL_PARTS)` – nothing is lost, newer `updatedAt` wins per record), written with
 *   `replaceAll`, uploaded, and a toast reports the conflicts. Another account: the local journal stays in the snapshot,
 *   the new account's journal replaces it (never uploaded into the wrong account).
 * - Settings: one row with an optimistic `rev`; a lost race refetches and `merge3`s (`base`, mine, theirs), then retries.
 * - Deletes are tombstones. Nothing local is ever deleted because a row is MISSING remotely.
 * - Every operation runs exclusively (one queue), so a realtime patch never interleaves with an upload.
 * - Offline / server errors: status `offline`, header "Offline", retry with backoff and on the `online` event; the
 *   local journal keeps working and the outbox (IndexedDB) keeps the queue across reloads.
 */
import type { DayNotes, Settings, StoreMode } from "@/domain/types";
import { normalizeSettings } from "@/domain/normalize";
import type { ToastInput } from "@/store/uiStore";
import type { LocalStorageAdapter, SnapshotPatch, StorageSnapshot } from "@/store/adapters/StoreApi";
import { jsonEqual, merge3 } from "@/store/merge3";
import { recordCloudQuarantine, SNAPSHOT_FAILED_TITLE, validateReadings, validateTrades } from "@/store/migrate";
import type { BaseStore, SyncBase } from "./base";
import { docKey, hashDoc, parseDocKey, tombstoneData, type DocKind, type DocRow } from "./docs";
import type { Outbox, OutboxEntry } from "./outbox";
import { applyPlanLocal, planReconcile, snapshotDocs, toRemoteDoc, type Plan, type RemoteDoc } from "./reconcile";
import { RemoteError, type RemoteJournal, type UpsertDoc } from "./remote";
import { patchSyncStatus, pingSync, type SyncStatus } from "./status";
import { computeTakeover, hasLocalData, needsDecision, previewTakeover, remoteSide, type TakeoverChoice, type TakeoverPreview, type TakeoverResult, type TakeoverStep } from "./takeover";
import { undoOpen, UNDO_WINDOW_MS, type UndoEntry, type UndoStorage } from "./undo";

export const SYNC_COPY = {
  firstTitle: "Sync aktiv",
  firstValue: (n: number) => `${n} Einträge`,
  conflictsTitle: (n: number) => (n === 1 ? "1 Konflikt zusammengeführt" : `${n} Konflikte zusammengeführt`),
  conflictsDetail: "Die neuere Version bleibt, nichts geht verloren.",
  otherOwnerTitle: "Neues Konto – lokales Journal gesichert",
  otherOwnerDetail: "Einstellungen → Daten → Wiederherstellen",
  offline: "Offline – Änderungen werden gesendet, sobald du wieder online bist.",
  denied: "Die Cloud lehnt den Zugriff ab. Melde dich bitte neu an.",
  failed: "Sync gerade nicht möglich.",
  snapshotFailed: SNAPSHOT_FAILED_TITLE,
  keptLocalTitle: "Journal bleibt lokal",
  keptLocalDetail: "Der Sync ist auf diesem Gerät aus. Einschalten: Konto → Datenschutz.",
} as const;

export interface EngineDeps {
  userId: string;
  local: LocalStorageAdapter;
  remote: RemoteJournal;
  outbox: Outbox;
  base: BaseStore;
  /** Safety snapshot before the first merge (`writeSnapshot` of the backup module). */
  snapshot: (tag: string, snap: StorageSnapshot & { at: string }) => boolean;
  now?: () => Date;
  notify?: (t: ToastInput) => void;
  status?: (p: Partial<SyncStatus>) => void;
  ping?: () => void;
  /** The store mode the adapter should report (`connecting` / `cloud` / `error`). */
  onMode?: (mode: StoreMode) => void;
  /** Upload delay after a local write (ms). */
  flushDelayMs?: number;
  /** Realtime batching window (ms). */
  batchMs?: number;
  /**
   * B1 – the first login of this browser: asks the user what happens to the journal on this device (dialog). Only
   * called when there is something to decide (`needsDecision`); without it the engine merges (the pre-B1 behaviour).
   * `keep` stops the sync for this device (`onKeepLocal`), nothing is read or written in the account.
   */
  decideTakeover?: (preview: TakeoverPreview) => Promise<TakeoverChoice>;
  /** Progress / result of an applied takeover (the dialog's working and done screens). */
  takeover?: { step?: (s: TakeoverStep) => void; done?: (r: TakeoverResult) => void; undone?: () => void; failed?: (message: string) => void };
  /** Undo journal of the takeover (`undo.ts`); without it nothing can be undone. */
  undo?: UndoStorage | null;
  /** The user chose "Lokal behalten": the sync is switched off for this device. */
  onKeepLocal?: () => void;
  /** Event target for `online` / `offline` / `visibilitychange` (default `window` / `document`). */
  events?: { win?: Pick<Window, "addEventListener" | "removeEventListener">; doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> };
  isOnline?: () => boolean;
}

export interface SyncEngine {
  /** Initial reconcile + realtime. Resolves when the first reconcile finished (or failed → retrying). */
  start(): Promise<void>;
  stop(): void;
  /** A local record changed: queue it and upload soon. */
  markDirty(kind: DocKind, id: string): void;
  /** Uploads the queue now. */
  flush(): Promise<void>;
  /** Full reconcile now ("Jetzt synchronisieren"). */
  syncNow(): Promise<void>;
  /** Puts the takeover back (device journal + the account rows it changed) while the undo window is open; then asks again. */
  undoTakeover(): Promise<boolean>;
  /** The open undo entry, if any. */
  pendingUndo(): Promise<UndoEntry | null>;
  readonly running: boolean;
}

export const RETRY_MS = [3_000, 10_000, 30_000, 60_000, 300_000] as const;
export const POLL_MS = 60_000;

class SyncAbort extends Error {}
/** The user chose to keep the journal local: not an error, the sync just does not run on this device. */
class SyncPaused extends Error {}

function newerIso(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  return !a || b > a ? b : a;
}

export function createSyncEngine(d: EngineDeps): SyncEngine {
  const now = d.now ?? (() => new Date());
  const status = d.status ?? patchSyncStatus;
  const ping = d.ping ?? pingSync;
  const flushDelay = d.flushDelayMs ?? 400;
  const batchMs = d.batchMs ?? 120;
  const win = d.events?.win ?? (typeof window !== "undefined" ? window : undefined);
  const doc = d.events?.doc ?? (typeof document !== "undefined" ? document : undefined);
  const isOnline = d.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  let running = false;
  let queue: Promise<unknown> = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  let retryStep = 0;
  let realtimeLive = false;
  let realtimeEverLive = false;
  let unsubRealtime: (() => void) | null = null;
  let needsReconcile = true;
  let buffer: DocRow[] = [];
  const offOutbox = d.outbox.onChange((n) => status({ pending: n }));

  /** Runs `fn` after every operation queued before it (never two at once). */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  }

  /* ---------------------------------------------------------------- helpers */

  const iso = () => now().toISOString();

  function liveUpload(key: string, rec: Record<string, unknown>): UpsertDoc {
    const p = parseDocKey(key)!;
    return { kind: p.kind, id: p.id, data: rec, deleted: false, clientUpdatedAt: typeof rec.updatedAt === "string" && rec.updatedAt ? rec.updatedAt : null };
  }

  function tombstoneUpload(key: string): UpsertDoc {
    const p = parseDocKey(key)!;
    const at = iso();
    return { kind: p.kind, id: p.id, data: tombstoneData(at), deleted: true, clientUpdatedAt: at };
  }

  /** Splits rows into record docs and the settings row; tracks the newest server time. */
  function parseRows(rows: readonly DocRow[], serverAt: string | null) {
    const remote = new Map<string, RemoteDoc>();
    let settings: RemoteDoc | null = null;
    let at = serverAt;
    for (const r of rows) {
      at = newerIso(at, r.updated_at);
      const docRow = toRemoteDoc(r);
      if (!docRow) continue;
      if (docRow.kind === "settings") settings = docRow;
      else remote.set(docKey(docRow.kind, docRow.id), docRow);
    }
    return { remote, settings, serverAt: at };
  }

  /**
   * Drops taken trades / readings that fail validation (recorded in the quarantine like the claude.ai adapter does);
   * their keys keep the old base so the next sync looks at them again.
   */
  function validateTakes(plan: Plan, base: Readonly<Record<string, string>>): void {
    const check = (kind: "trade" | "hyblock") => {
      const keys = [...plan.take.keys()].filter((k) => k.startsWith(`${kind}:`));
      if (!keys.length) return;
      const raws = keys.map((k) => plan.take.get(k));
      const v = kind === "trade" ? validateTrades(raws) : validateReadings(raws);
      if (!v.invalid.length) return;
      const bad = new Set(v.invalid.map((i) => (i.raw as { id?: string } | null)?.id).filter(Boolean).map((id) => docKey(kind, id as string)));
      for (const k of bad) {
        plan.take.delete(k);
        if (base[k] === undefined) delete plan.base[k];
        else plan.base[k] = base[k]!;
      }
      recordCloudQuarantine(kind === "trade" ? "trades" : "hyblock", v.invalid);
    };
    check("trade");
    check("hyblock");
  }

  async function uploadAll(uploads: readonly UpsertDoc[], base: SyncBase, progress: boolean): Promise<void> {
    const CH = 200;
    if (progress && uploads.length) status({ progress: { done: 0, total: uploads.length } });
    for (let i = 0; i < uploads.length; i += CH) {
      const part = uploads.slice(i, i + CH);
      const stored = await d.remote.upsert(part);
      for (const u of part) {
        const key = docKey(u.kind, u.id);
        if (u.deleted) delete base.docs[key];
        else base.docs[key] = hashDoc(u.data);
      }
      for (const r of stored) base.serverAt = newerIso(base.serverAt, r.updated_at);
      if (progress) status({ progress: { done: Math.min(uploads.length, i + CH), total: uploads.length } });
    }
  }

  /** Writes the local settings with the optimistic rev; a lost race merges (`merge3`) and retries. */
  async function pushSettings(base: SyncBase): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const mine = d.local.fresh().settings;
      if (base.settingsRev !== null && base.settings && jsonEqual(mine, base.settings)) return;
      const res = await d.remote.writeSettings(mine, base.settingsRev, iso());
      if (res.ok) {
        base.settings = mine;
        base.settingsRev = typeof res.row.rev === "number" ? res.row.rev : base.settingsRev;
        base.serverAt = newerIso(base.serverAt, res.row.updated_at);
        return;
      }
      const cur = res.current;
      if (!cur || cur.deleted) {
        base.settingsRev = null;
        continue;
      }
      const theirs = normalizeSettings(cur.data);
      const merged = merge3(base.settings ?? theirs, mine, theirs) as Settings;
      if (!jsonEqual(merged, mine)) await d.local.replaceParts({ settings: merged });
      base.settings = theirs;
      base.settingsRev = typeof cur.rev === "number" ? cur.rev : null;
      base.serverAt = newerIso(base.serverAt, cur.updated_at);
      if (jsonEqual(merged, theirs)) return;
    }
    throw new RemoteError("settings: conflict retries exhausted", true);
  }

  /* ---------------------------------------------------------------- reconcile */

  async function firstSync(initialRows: readonly DocRow[], prev: SyncBase | null): Promise<void> {
    let snap = d.local.fresh();
    let parsed = parseRows(initialRows, null);
    const otherOwner = !!prev && prev.owner !== d.userId;
    let hasLocal = hasLocalData(snap);
    const step = (s: TakeoverStep) => d.takeover?.step?.(s);

    // B1: something to decide (data here that the account lacks, differs from it, or belongs to another account)?
    let choice: Exclude<TakeoverChoice, "keep"> = otherOwner ? "cloud" : "merge";
    let asked = false;
    if (hasLocal && d.decideTakeover) {
      const preview = previewTakeover({ local: snap, remote: parsed.remote, settingsRow: parsed.settings, otherOwner, now: iso() });
      if (needsDecision(preview)) {
        const picked = await d.decideTakeover(preview);
        if (!preview.allowed.includes(picked)) throw new SyncAbort("Ungültige Auswahl.");
        if (picked === "keep") throw new SyncPaused();
        choice = picked;
        asked = true;
        // the user may have taken minutes: both sides are read again, so nothing that changed meanwhile is overwritten
        parsed = parseRows(await d.remote.pullAll(), null);
        snap = d.local.fresh();
        hasLocal = hasLocalData(snap);
      }
    }
    const { remote, settings: settingsRow, serverAt } = parsed;

    step("snapshot");
    if (hasLocal && !d.snapshot(`import-${iso()}`, { ...snap, days: snap.days ?? {}, at: iso() })) throw new SyncAbort(SYNC_COPY.snapshotFailed);

    step("merge");
    const { settings: remoteSettings } = remoteSide(remote, settingsRow);
    const duplicates = asked ? previewTakeover({ local: snap, remote, settingsRow, otherOwner, now: iso() }).duplicates : 0;
    const { merged, conflicts } = computeTakeover(choice, { local: snap, remote, settingsRow, now: iso() });
    const days: DayNotes = merged.days ?? {};
    const localDocs = snapshotDocs(snap);
    const mergedDocs = snapshotDocs({ ...merged, days });
    const uploads: UpsertDoc[] = [];
    const cloudBefore: UndoEntry["cloudBefore"] = {};
    for (const [k, rec] of mergedDocs) {
      const r = remote.get(k);
      if (!r || r.deleted || r.hash !== hashDoc(rec)) {
        uploads.push(liveUpload(k, rec));
        cloudBefore[k] = r ? { data: r.data, deleted: r.deleted } : null;
      }
    }
    let pulled = 0;
    for (const [k, rec] of mergedDocs) {
      const l = localDocs.get(k);
      if (!l || hashDoc(l) !== hashDoc(rec)) pulled++;
    }
    const settingsPush = !remoteSettings || !jsonEqual(merged.settings, remoteSettings);

    // the undo journal is written BEFORE the first byte leaves the device
    const until = asked && d.undo ? new Date(now().getTime() + UNDO_WINDOW_MS).toISOString() : null;
    if (asked && d.undo) {
      try {
        // an earlier, interrupted attempt of the same takeover keeps its (older, truer) "before"
        const open = await d.undo.read().catch(() => undefined);
        const first = undoOpen(open, now()) && open.owner === d.userId ? open : null;
        await d.undo.write({
          v: 1,
          owner: d.userId,
          choice,
          at: first?.at ?? iso(),
          expiresAt: until!,
          local: first?.local ?? { trades: snap.trades, hyblock: snap.hyblock, days: snap.days ?? {}, settings: snap.settings },
          cloudBefore: { ...cloudBefore, ...(first?.cloudBefore ?? {}) },
          settingsBefore: first ? first.settingsBefore : remoteSettings,
          settingsPushed: (first?.settingsPushed ?? false) || (settingsPush && choice !== "cloud"),
        });
      } catch {
        throw new SyncAbort("Die Rückgängig-Sicherung konnte nicht angelegt werden.");
      }
    }
    await d.local.replaceAll({ ...merged, days });

    const base: SyncBase = { v: 1, owner: d.userId, at: iso(), docs: {}, settings: remoteSettings, settingsRev: remoteSettings ? settingsRow!.rev : null, serverAt };
    for (const [k, rec] of mergedDocs) {
      const r = remote.get(k);
      if (r && !r.deleted && r.hash === hashDoc(rec)) base.docs[k] = r.hash;
    }
    status({ phase: "syncing" });
    step("upload");
    await uploadAll(uploads, base, true);
    if (settingsPush) await pushSettings(base);
    base.at = iso();
    d.base.write(base);
    status({ conflicts, records: Object.keys(base.docs).length });
    step("finish");

    if (asked) {
      d.takeover?.done?.({ choice, pushed: uploads.length, pulled, conflicts, duplicates, undoUntil: until });
      return;
    }
    if (otherOwner && hasLocal) d.notify?.({ kind: "info", title: SYNC_COPY.otherOwnerTitle, detail: SYNC_COPY.otherOwnerDetail, duration: 7000 });
    else if (conflicts > 0) d.notify?.({ kind: "info", title: SYNC_COPY.conflictsTitle(conflicts), detail: SYNC_COPY.conflictsDetail });
    else d.notify?.({ kind: "success", title: SYNC_COPY.firstTitle, value: SYNC_COPY.firstValue(mergedDocs.size) });
  }

  /** Puts the takeover back: the account's rows it changed, then this device's journal; the next sync asks again. */
  async function undoNow(): Promise<boolean> {
    const entry = await d.undo?.read();
    if (!undoOpen(entry, now()) || entry.owner !== d.userId) {
      await d.undo?.clear();
      return false;
    }
    status({ phase: "syncing", error: null });
    const ups: UpsertDoc[] = [];
    for (const [key, before] of Object.entries(entry.cloudBefore)) {
      const p = parseDocKey(key);
      if (!p || p.kind === "settings") continue;
      if (before === null) ups.push(tombstoneUpload(key));
      else ups.push({ kind: p.kind, id: p.id, data: before.data, deleted: before.deleted, clientUpdatedAt: iso() });
    }
    if (ups.length) await d.remote.upsert(ups);
    if (entry.settingsPushed && entry.settingsBefore) {
      const cur = d.base.read();
      await d.remote.writeSettings(entry.settingsBefore, cur?.settingsRev ?? null, iso());
    }
    const now0 = d.local.fresh();
    d.snapshot(`undo-${iso()}`, { ...now0, days: now0.days ?? {}, at: iso() });
    const l = entry.local;
    await d.local.replaceAll({ trades: l.trades as StorageSnapshot["trades"], hyblock: l.hyblock as StorageSnapshot["hyblock"], days: l.days as DayNotes, settings: l.settings as Settings });
    d.base.clear();
    await d.outbox.clear();
    await d.undo?.clear();
    needsReconcile = true;
    d.takeover?.undone?.();
    return true;
  }

  async function threeWay(rows: readonly DocRow[], prev: SyncBase): Promise<void> {
    const { remote, settings: settingsRow, serverAt } = parseRows(rows, prev.serverAt);
    const snap = d.local.fresh();
    const plan = planReconcile(prev.docs, snapshotDocs(snap), remote);
    validateTakes(plan, prev.docs);
    const parts: SnapshotPatch = applyPlanLocal(snap, plan);

    const base: SyncBase = { ...prev, docs: {}, serverAt };
    // keys in sync now (same / take); pushes and tombstones join once their upload succeeded
    const pushing = new Set([...plan.push, ...plan.pushDelete]);
    for (const [k, h] of Object.entries(plan.base)) if (!pushing.has(k)) base.docs[k] = h;
    for (const k of plan.push) if (prev.docs[k] !== undefined) base.docs[k] = prev.docs[k]!;
    for (const k of plan.pushDelete) if (prev.docs[k] !== undefined) base.docs[k] = prev.docs[k]!;

    let pushSettingsNeeded: boolean;
    if (settingsRow && !settingsRow.deleted) {
      const theirs = normalizeSettings(settingsRow.data);
      const merged = merge3(prev.settings ?? theirs, snap.settings, theirs) as Settings;
      if (!jsonEqual(merged, snap.settings)) parts.settings = merged;
      base.settings = theirs;
      base.settingsRev = settingsRow.rev;
      pushSettingsNeeded = !jsonEqual(merged, theirs);
    } else {
      base.settingsRev = null;
      pushSettingsNeeded = true;
    }
    if (Object.keys(parts).length) {
      await d.local.replaceParts(parts);
      ping();
    }

    const after = snapshotDocs({ trades: parts.trades ?? snap.trades, hyblock: parts.hyblock ?? snap.hyblock, days: parts.days ?? snap.days });
    const uploads: UpsertDoc[] = [
      ...plan.push.flatMap((k) => {
        const rec = after.get(k);
        return rec ? [liveUpload(k, rec)] : [];
      }),
      ...plan.pushDelete.map(tombstoneUpload),
    ];
    if (uploads.length) status({ phase: "syncing" });
    await uploadAll(uploads, base, uploads.length > 20);
    if (pushSettingsNeeded) await pushSettings(base);
    base.at = iso();
    d.base.write(base);
    status({ conflicts: plan.conflicts, records: Object.keys(base.docs).length });
    if (plan.conflicts > 0) d.notify?.({ kind: "info", title: SYNC_COPY.conflictsTitle(plan.conflicts), detail: SYNC_COPY.conflictsDetail });
    if (uploads.length) ping();
  }

  async function reconcile(): Promise<void> {
    status({ phase: "syncing", error: null });
    const before = await d.outbox.all();
    const rows = await d.remote.pullAll();
    const prev = d.base.read();
    if (!prev || prev.owner !== d.userId) await firstSync(rows, prev);
    else await threeWay(rows, prev);
    await d.outbox.settle(before);
    needsReconcile = false;
  }

  /* ---------------------------------------------------------------- incremental */

  async function flushNow(): Promise<void> {
    const entries: OutboxEntry[] = await d.outbox.all();
    if (!entries.length) return;
    const base = d.base.read();
    if (!base || base.owner !== d.userId) {
      await reconcile();
      return;
    }
    const snap = d.local.fresh();
    const docs = snapshotDocs(snap);
    const uploads: UpsertDoc[] = [];
    let settingsDirty = false;
    for (const e of entries) {
      const p = parseDocKey(e.key);
      if (!p) continue;
      if (p.kind === "settings") {
        settingsDirty = true;
        continue;
      }
      const rec = docs.get(e.key);
      if (rec) {
        if (base.docs[e.key] !== hashDoc(rec)) uploads.push(liveUpload(e.key, rec));
      } else if (base.docs[e.key] !== undefined) uploads.push(tombstoneUpload(e.key));
    }
    await uploadAll(uploads, base, false);
    if (settingsDirty) await pushSettings(base);
    base.at = iso();
    d.base.write(base);
    await d.outbox.settle(entries);
    if (uploads.length || settingsDirty) ping();
  }

  /** Applies remote rows (realtime batch / catch-up) to the local journal. */
  async function applyRows(rows: readonly DocRow[]): Promise<void> {
    const prev = d.base.read();
    if (!prev || prev.owner !== d.userId) {
      needsReconcile = true;
      return;
    }
    const { remote, settings: settingsRow, serverAt } = parseRows(rows, prev.serverAt);
    const keys = new Set(remote.keys());
    const snap = d.local.fresh();
    const localAll = snapshotDocs(snap);
    const local = new Map([...localAll].filter(([k]) => keys.has(k)));
    const baseSubset = Object.fromEntries(Object.entries(prev.docs).filter(([k]) => keys.has(k)));
    const plan = planReconcile(baseSubset, local, remote);
    validateTakes(plan, baseSubset);
    const parts: SnapshotPatch = applyPlanLocal(snap, plan);
    const base: SyncBase = { ...prev, docs: { ...prev.docs }, serverAt };
    for (const k of keys) {
      if (plan.push.includes(k) || plan.pushDelete.includes(k)) continue;
      if (plan.base[k] !== undefined) base.docs[k] = plan.base[k]!;
      else delete base.docs[k];
    }
    let settingsDirty = false;
    if (settingsRow && !settingsRow.deleted && (prev.settingsRev === null || settingsRow.rev > prev.settingsRev)) {
      const theirs = normalizeSettings(settingsRow.data);
      const merged = merge3(prev.settings ?? theirs, snap.settings, theirs) as Settings;
      if (!jsonEqual(merged, snap.settings)) parts.settings = merged;
      base.settings = theirs;
      base.settingsRev = settingsRow.rev;
      settingsDirty = !jsonEqual(merged, theirs);
    }
    if (Object.keys(parts).length) await d.local.replaceParts(parts);
    base.at = iso();
    d.base.write(base);
    for (const k of [...plan.push, ...plan.pushDelete]) void d.outbox.mark(k);
    if (settingsDirty) void d.outbox.mark(docKey("settings", "settings"));
    if (plan.push.length || plan.pushDelete.length || settingsDirty) scheduleFlush();
    if (Object.keys(parts).length) {
      ping();
      status({ lastSyncAt: iso() });
    }
  }

  async function catchUp(): Promise<void> {
    const prev = d.base.read();
    if (!prev || prev.owner !== d.userId || !prev.serverAt) {
      await reconcile();
      return;
    }
    const rows = await d.remote.pullSince(prev.serverAt);
    if (rows.length) await applyRows(rows);
  }

  /* ---------------------------------------------------------------- scheduling */

  function onFailure(e: unknown): void {
    if (!running) return;
    if (e instanceof SyncPaused) {
      // "Lokal behalten": not a failure – the controller switches this device back to the local adapter
      status({ phase: "paused", error: null, progress: null });
      d.notify?.({ kind: "info", title: SYNC_COPY.keptLocalTitle, detail: SYNC_COPY.keptLocalDetail, duration: 7000 });
      d.onKeepLocal?.();
      return;
    }
    if (e instanceof SyncAbort) {
      status({ phase: "error", error: e.message, progress: null });
      d.onMode?.("error");
      d.takeover?.failed?.(e.message);
      d.notify?.({ kind: "error", title: e.message, detail: "Sync abgebrochen – dein lokales Journal ist unverändert." });
      return;
    }
    d.takeover?.failed?.(SYNC_COPY.failed);
    const retryable = !(e instanceof RemoteError) || e.retryable;
    const offline = !isOnline() || (e instanceof RemoteError && e.retryable && !e.code);
    status({ phase: offline ? "offline" : "error", error: offline ? SYNC_COPY.offline : retryable ? SYNC_COPY.failed : SYNC_COPY.denied, progress: null });
    d.onMode?.("error");
    needsReconcile = true;
    if (!retryable) return;
    const delay = RETRY_MS[Math.min(retryStep, RETRY_MS.length - 1)]!;
    retryStep++;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void runCycle();
    }, delay);
  }

  function onSuccess(): void {
    if (!running) return;
    retryStep = 0;
    status({ phase: "live", error: null, progress: null, lastSyncAt: iso(), pending: d.outbox.size() });
    d.onMode?.("cloud");
  }

  /** Reconcile when needed, else flush; maps failures to the status. */
  function runCycle(): Promise<void> {
    return exclusive(async () => {
      if (!running) return;
      try {
        if (needsReconcile) await reconcile();
        else await flushNow();
        onSuccess();
      } catch (e) {
        onFailure(e);
      }
    });
  }

  function scheduleFlush(): void {
    if (!running) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!isOnline()) {
        status({ phase: "offline", error: SYNC_COPY.offline });
        d.onMode?.("error");
        return;
      }
      void runCycle();
    }, flushDelay);
  }

  function onRow(row: DocRow): void {
    if (!running) return;
    buffer.push(row);
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      const rows = buffer;
      buffer = [];
      void exclusive(async () => {
        if (!running) return;
        try {
          // a row without data (Realtime leaves out large unchanged values) → read the rows instead
          if (rows.some((r) => !("data" in r))) await catchUp();
          else await applyRows(rows);
        } catch (e) {
          onFailure(e);
        }
      });
    }, batchMs);
  }

  function onRealtime(s: "live" | "down"): void {
    if (!running) return;
    const was = realtimeLive;
    realtimeLive = s === "live";
    status({ realtime: realtimeLive });
    if (realtimeLive && !was && realtimeEverLive) {
      void exclusive(async () => {
        try {
          await catchUp();
        } catch (e) {
          onFailure(e);
        }
      });
    }
    if (realtimeLive) realtimeEverLive = true;
  }

  const onOnline = () => {
    retryStep = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    void runCycle();
  };
  const onOffline = () => {
    if (!running) return;
    status({ phase: "offline", error: SYNC_COPY.offline });
    d.onMode?.("error");
  };
  const onVisible = () => {
    if (doc?.visibilityState === "visible" && running && !realtimeLive) void runCycleCatchUp();
  };

  function runCycleCatchUp(): Promise<void> {
    return exclusive(async () => {
      if (!running) return;
      try {
        if (needsReconcile) await reconcile();
        else await catchUp();
        onSuccess();
      } catch (e) {
        onFailure(e);
      }
    });
  }

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      running = true;
      needsReconcile = true;
      status({ phase: "connecting", error: null, pending: d.outbox.size() });
      d.onMode?.("connecting");
      win?.addEventListener("online", onOnline);
      win?.addEventListener("offline", onOffline);
      doc?.addEventListener("visibilitychange", onVisible);
      await runCycle();
      if (!running) return;
      unsubRealtime = d.remote.subscribe(onRow, onRealtime);
      pollTimer = setInterval(() => {
        if (running && !realtimeLive && doc?.visibilityState !== "hidden") void runCycleCatchUp();
      }, POLL_MS);
    },
    stop() {
      if (!running) return;
      running = false;
      for (const t of [flushTimer, retryTimer, batchTimer]) if (t) clearTimeout(t);
      if (pollTimer) clearInterval(pollTimer);
      flushTimer = retryTimer = batchTimer = null;
      pollTimer = null;
      buffer = [];
      unsubRealtime?.();
      unsubRealtime = null;
      realtimeLive = false;
      offOutbox();
      win?.removeEventListener("online", onOnline);
      win?.removeEventListener("offline", onOffline);
      doc?.removeEventListener("visibilitychange", onVisible);
    },
    markDirty(kind, id) {
      void d.outbox.mark(docKey(kind, id)).then(scheduleFlush, scheduleFlush);
    },
    flush() {
      return runCycle();
    },
    syncNow() {
      needsReconcile = true;
      retryStep = 0;
      return runCycle();
    },
    async undoTakeover() {
      let ok = false;
      try {
        ok = await exclusive(undoNow);
      } catch (e) {
        onFailure(e);
        return false;
      }
      // the base is gone: the next cycle is a first login again and asks (the dialog opens once more)
      if (ok) await this.syncNow();
      return ok;
    },
    async pendingUndo() {
      const e = await d.undo?.read().catch(() => undefined);
      return undoOpen(e, now()) && e.owner === d.userId ? e : null;
    },
  };
}
