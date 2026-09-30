import type { HyblockReading, Trade } from "@/domain/types";
import { normalizeReading, normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { HyblockReadingSchema, TradeSchema } from "@/domain/schemas";
import { computePnlR } from "@/domain/derive";
import { hasKey, KEYS, listKeys, readJson, readJsonDetailed, removeKey, writeJson } from "./storage";

export const SCHEMA_VERSION = 1;
export const APP_VERSION = "0.1.0";
export const MIGRATION_SNAPSHOT_PREFIX = `${KEYS.backupPrefix}v0-`;
export const MAX_MIGRATION_SNAPSHOTS = 3;

export interface Meta {
  schemaVersion: number;
  migratedAt?: string;
  appVersion?: string;
}

/**
 * One preserved record in `tj2-quarantine`.
 * - `trade` / `hyblock`: a record that failed validation even after normalising (local migration or import; `key` = storage key or `"import"`)
 * - `blob`: a whole key whose value was not an array/object (`raw` = parsed value) or not JSON at all (`raw` = the raw string)
 * - `cloud`: an invalid document from the claude.ai db (`collection`, `id`)
 */
export interface QuarantineEntry {
  kind: "trade" | "hyblock" | "blob" | "cloud";
  key: string;
  raw: unknown;
  error: string;
  at: string;
  collection?: "trades" | "hyblock";
  id?: string;
}

export interface MigrationResult {
  from: number;
  to: number;
  changed: boolean;
  quarantined: number;
  snapshotTag: string | null;
  /** The migration snapshot could not be stored; nothing was changed and `schemaVersion` stays at `from`. */
  aborted?: boolean;
}

/** Toast title when a snapshot (migration / import / restore) could not be written. */
export const SNAPSHOT_FAILED_TITLE = "Snapshot konnte nicht angelegt werden";

export interface ValidationResult<T> {
  valid: T[];
  invalid: Array<{ raw: unknown; error: string }>;
}

/** German toast text for `n` quarantined records (Plan 8.3). */
export function quarantineToastTitle(n: number): string {
  return `${n} Einträge konnten nicht gelesen werden`;
}

export function readMeta(): Meta {
  const meta = readJson<Partial<Meta> | null>(KEYS.meta, null);
  if (!meta || typeof meta !== "object" || typeof meta.schemaVersion !== "number") return { schemaVersion: 0 };
  return { schemaVersion: meta.schemaVersion, migratedAt: meta.migratedAt, appVersion: meta.appVersion };
}

export function writeMeta(meta: Meta): void {
  writeJson(KEYS.meta, meta);
}

export function readQuarantine(): QuarantineEntry[] {
  const q = readJson<unknown>(KEYS.quarantine, []);
  return Array.isArray(q) ? (q as QuarantineEntry[]) : [];
}

export function appendQuarantine(entries: QuarantineEntry[]): boolean {
  if (!entries.length) return true;
  return writeJson(KEYS.quarantine, readQuarantine().concat(entries));
}

/**
 * Records invalid cloud documents as `{ kind:"cloud", collection, id, raw }` so `Quarantäne ansehen` shows them.
 * Idempotent per `collection`+`id` (snapshots re-fire): an existing entry for the same doc is replaced.
 */
export function recordCloudQuarantine(
  collection: "trades" | "hyblock",
  invalid: ReadonlyArray<{ raw: unknown; error: string }>,
  at: string = new Date().toISOString(),
): boolean {
  if (!invalid.length) return true;
  const fresh: QuarantineEntry[] = invalid.map((inv) => {
    const id = inv.raw && typeof inv.raw === "object" && typeof (inv.raw as { id?: unknown }).id === "string" ? (inv.raw as { id: string }).id : "";
    return { kind: "cloud", key: collection, collection, id, raw: inv.raw, error: inv.error, at };
  });
  const ids = new Set(fresh.map((e) => `${e.collection}/${e.id}`));
  const kept = readQuarantine().filter((e) => !(e.kind === "cloud" && ids.has(`${e.collection}/${e.id}`)));
  return writeJson(KEYS.quarantine, kept.concat(fresh));
}

function issueText(error: { issues?: Array<{ path: PropertyKey[]; message: string }> }): string {
  const first = error.issues?.[0];
  if (!first) return "invalid";
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Normalise FIRST, validate AFTER (`TradeSchema.safeParse(normalizeTrade(item))`): everything the old app read
 * fine (`entry:"100"`, `notes:null`, missing fields) stays valid; only records that are not an object or have no
 * `id` are invalid. Unknown fields survive (`passthrough` + the normaliser's spread), `pnl`/`r` are recomputed.
 * Pure – used by the v0→v1 migration, backup import/restore and the cloud adapter on read.
 */
export function validateTrades(raw: unknown): ValidationResult<Trade> {
  const list = Array.isArray(raw) ? raw : [];
  const out: ValidationResult<Trade> = { valid: [], invalid: [] };
  for (const item of list) {
    if (!isRecord(item)) {
      out.invalid.push({ raw: item, error: "not an object" });
      continue;
    }
    const normalized = normalizeTrade(item);
    const parsed = TradeSchema.safeParse(normalized);
    if (!parsed.success) {
      out.invalid.push({ raw: item, error: issueText(parsed.error) });
      continue;
    }
    out.valid.push({ ...normalized, ...computePnlR(normalized) });
  }
  return out;
}

/** Same contract as `validateTrades` for Hyblock readings (`id` and `at` required after normalising). */
export function validateReadings(raw: unknown): ValidationResult<HyblockReading> {
  const list = Array.isArray(raw) ? raw : [];
  const out: ValidationResult<HyblockReading> = { valid: [], invalid: [] };
  for (const item of list) {
    if (!isRecord(item)) {
      out.invalid.push({ raw: item, error: "not an object" });
      continue;
    }
    const normalized = normalizeReading(item);
    const parsed = HyblockReadingSchema.safeParse(normalized);
    if (!parsed.success) {
      out.invalid.push({ raw: item, error: issueText(parsed.error) });
      continue;
    }
    out.valid.push(normalized);
  }
  return out;
}

/** Keeps at most `MAX_MIGRATION_SNAPSHOTS` `tj2-backup-v0-*` keys (oldest removed). */
function rotateMigrationSnapshots(): void {
  const keys = listKeys(MIGRATION_SNAPSHOT_PREFIX);
  while (keys.length > MAX_MIGRATION_SNAPSHOTS) removeKey(keys.shift() as string);
}

interface LegacyKey {
  /** Parsed value, `null` when the key is absent or unparseable. */
  value: unknown;
  /** The raw string when the key holds something that is not JSON. */
  corrupt: string | null;
}

/** Reads a legacy key without side effects; the raw string of an unparseable key is kept for the snapshot. */
function readLegacy(key: string): LegacyKey {
  const r = readJsonDetailed<unknown>(key);
  if (r.status === "ok") return { value: r.value, corrupt: null };
  if (r.status === "corrupt") return { value: null, corrupt: r.raw };
  return { value: null, corrupt: null };
}

function migrate_0_1(now: Date): { quarantined: number; snapshotTag: string | null; aborted: boolean } {
  const hasData = hasKey(KEYS.trades) || hasKey(KEYS.settings) || hasKey(KEYS.hyblock);
  if (!hasData) return { quarantined: 0, snapshotTag: null, aborted: false };

  const at = now.toISOString();
  const legacyTrades = readLegacy(KEYS.trades);
  const legacySettings = readLegacy(KEYS.settings);
  const legacyHyblock = readLegacy(KEYS.hyblock);
  const rawTrades = legacyTrades.value;
  const rawSettings = legacySettings.value;
  const rawHyblock = legacyHyblock.value;

  // 1. Snapshot before touching anything (raw values, not normalised; an unparseable key is stored as its raw string).
  //    When the snapshot cannot be written the migration is aborted – nothing below runs, schemaVersion stays 0.
  const snapshotTag = `v0-${at}`;
  const snapshotOk = writeJson(`${KEYS.backupPrefix}${snapshotTag}`, {
    settings: legacySettings.corrupt ?? rawSettings,
    trades: legacyTrades.corrupt ?? rawTrades,
    hyblock: legacyHyblock.corrupt ?? rawHyblock,
    at,
  });
  if (!snapshotOk) return { quarantined: 0, snapshotTag: null, aborted: true };
  rotateMigrationSnapshots();

  const quarantine: QuarantineEntry[] = [];

  // 1b. Unparseable keys: keep the raw string in the quarantine; the key itself is left untouched
  //     (the adapter refuses to overwrite it until the raw string is quarantined, see `assertWritable`).
  for (const [key, legacy] of [
    [KEYS.trades, legacyTrades],
    [KEYS.settings, legacySettings],
    [KEYS.hyblock, legacyHyblock],
  ] as const) {
    if (legacy.corrupt !== null) quarantine.push({ kind: "blob", key, raw: legacy.corrupt, error: "invalid JSON", at });
  }

  // 2. Trades: validate, keep unknown fields, recompute pnl/r; invalid → quarantine (never deleted).
  if (rawTrades !== null) {
    if (Array.isArray(rawTrades)) {
      const v = validateTrades(rawTrades);
      for (const inv of v.invalid) quarantine.push({ kind: "trade", key: KEYS.trades, raw: inv.raw, error: inv.error, at });
      writeJson(KEYS.trades, v.valid);
    } else {
      quarantine.push({ kind: "blob", key: KEYS.trades, raw: rawTrades, error: "not an array", at });
      writeJson(KEYS.trades, []);
    }
  }

  // 3. Hyblock readings.
  if (rawHyblock !== null) {
    if (Array.isArray(rawHyblock)) {
      const v = validateReadings(rawHyblock);
      for (const inv of v.invalid) quarantine.push({ kind: "hyblock", key: KEYS.hyblock, raw: inv.raw, error: inv.error, at });
      writeJson(KEYS.hyblock, v.valid);
    } else {
      quarantine.push({ kind: "blob", key: KEYS.hyblock, raw: rawHyblock, error: "not an array", at });
      writeJson(KEYS.hyblock, []);
    }
  }

  // 4. Settings only through `normalizeSettings`; unknown top-level keys survive.
  if (rawSettings !== null) {
    if (rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)) {
      writeJson(KEYS.settings, { ...(rawSettings as Record<string, unknown>), ...normalizeSettings(rawSettings) });
    } else {
      quarantine.push({ kind: "blob", key: KEYS.settings, raw: rawSettings, error: "not an object", at });
      removeKey(KEYS.settings);
    }
  }

  appendQuarantine(quarantine);
  return { quarantined: quarantine.length, snapshotTag, aborted: false };
}

/**
 * Runs all pending migrations on localStorage (synchronous, idempotent) and writes `tj2-meta`.
 * Version 0 = legacy data without meta. Later versions add `migrate_1_2(...)` etc.
 * `aborted: true` (snapshot could not be stored) leaves everything untouched; the next start retries.
 */
export function migrate(now: Date = new Date()): MigrationResult {
  const meta = readMeta();
  const from = meta.schemaVersion;
  if (from >= SCHEMA_VERSION) return { from, to: from, changed: false, quarantined: 0, snapshotTag: null };

  let version = from;
  let quarantined = 0;
  let snapshotTag: string | null = null;

  if (version === 0) {
    const r = migrate_0_1(now);
    if (r.aborted) return { from, to: from, changed: false, quarantined: 0, snapshotTag: null, aborted: true };
    quarantined += r.quarantined;
    snapshotTag = r.snapshotTag;
    version = 1;
  }

  writeMeta({ schemaVersion: version, migratedAt: now.toISOString(), appVersion: APP_VERSION });
  return { from, to: version, changed: true, quarantined, snapshotTag };
}
