import type { HyblockReading, Trade } from "@/domain/types";
import { normalizeReading, normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { HyblockReadingSchema, TradeSchema } from "@/domain/schemas";
import { computePnlR } from "@/domain/derive";
import { hasKey, KEYS, listKeys, readJson, removeKey, writeJson } from "./storage";

export const SCHEMA_VERSION = 1;
export const APP_VERSION = "0.1.0";
export const MIGRATION_SNAPSHOT_PREFIX = `${KEYS.backupPrefix}v0-`;
export const MAX_MIGRATION_SNAPSHOTS = 3;

export interface Meta {
  schemaVersion: number;
  migratedAt?: string;
  appVersion?: string;
}

export interface QuarantineEntry {
  kind: "trade" | "hyblock" | "blob";
  key: string;
  raw: unknown;
  error: string;
  at: string;
}

export interface MigrationResult {
  from: number;
  to: number;
  changed: boolean;
  quarantined: number;
  snapshotTag: string | null;
}

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

function appendQuarantine(entries: QuarantineEntry[]): void {
  if (!entries.length) return;
  writeJson(KEYS.quarantine, readQuarantine().concat(entries));
}

function issueText(error: { issues?: Array<{ path: PropertyKey[]; message: string }> }): string {
  const first = error.issues?.[0];
  if (!first) return "invalid";
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * zod validation with `passthrough` (unknown fields survive), normalisation, recomputed `pnl`/`r`.
 * Pure – used by the v0→v1 migration and by the cloud adapter on read.
 */
export function validateTrades(raw: unknown): ValidationResult<Trade> {
  const list = Array.isArray(raw) ? raw : [];
  const out: ValidationResult<Trade> = { valid: [], invalid: [] };
  for (const item of list) {
    const parsed = TradeSchema.passthrough().safeParse(item);
    if (!parsed.success) {
      out.invalid.push({ raw: item, error: issueText(parsed.error) });
      continue;
    }
    const normalized = normalizeTrade(parsed.data);
    const trade: Trade = { ...(parsed.data as Record<string, unknown>), ...normalized, ...computePnlR(normalized) };
    out.valid.push(trade);
  }
  return out;
}

export function validateReadings(raw: unknown): ValidationResult<HyblockReading> {
  const list = Array.isArray(raw) ? raw : [];
  const out: ValidationResult<HyblockReading> = { valid: [], invalid: [] };
  for (const item of list) {
    const parsed = HyblockReadingSchema.passthrough().safeParse(item);
    if (!parsed.success) {
      out.invalid.push({ raw: item, error: issueText(parsed.error) });
      continue;
    }
    out.valid.push({ ...(parsed.data as Record<string, unknown>), ...normalizeReading(parsed.data) });
  }
  return out;
}

/** Keeps at most `MAX_MIGRATION_SNAPSHOTS` `tj2-backup-v0-*` keys (oldest removed). */
function rotateMigrationSnapshots(): void {
  const keys = listKeys(MIGRATION_SNAPSHOT_PREFIX);
  while (keys.length > MAX_MIGRATION_SNAPSHOTS) removeKey(keys.shift() as string);
}

function migrate_0_1(now: Date): { quarantined: number; snapshotTag: string | null } {
  const hasData = hasKey(KEYS.trades) || hasKey(KEYS.settings) || hasKey(KEYS.hyblock);
  if (!hasData) return { quarantined: 0, snapshotTag: null };

  const at = now.toISOString();
  const rawTrades = readJson<unknown>(KEYS.trades, null);
  const rawSettings = readJson<unknown>(KEYS.settings, null);
  const rawHyblock = readJson<unknown>(KEYS.hyblock, null);

  // 1. Snapshot before touching anything (raw values, not normalised).
  const snapshotTag = `v0-${at}`;
  writeJson(`${KEYS.backupPrefix}${snapshotTag}`, { settings: rawSettings, trades: rawTrades, hyblock: rawHyblock, at });
  rotateMigrationSnapshots();

  const quarantine: QuarantineEntry[] = [];

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
  return { quarantined: quarantine.length, snapshotTag };
}

/**
 * Runs all pending migrations on localStorage (synchronous, idempotent) and writes `tj2-meta`.
 * Version 0 = legacy data without meta. Later versions add `migrate_1_2(...)` etc.
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
    quarantined += r.quarantined;
    snapshotTag = r.snapshotTag;
    version = 1;
  }

  writeMeta({ schemaVersion: version, migratedAt: now.toISOString(), appVersion: APP_VERSION });
  return { from, to: version, changed: true, quarantined, snapshotTag };
}
