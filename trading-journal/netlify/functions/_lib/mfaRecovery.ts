/**
 * Recovery codes for the TOTP second factor (B1). Supabase has no recovery codes of its own: a user who loses the phone
 * with the authenticator app would be locked out for good. This module is the way back, and it is deliberately small:
 *
 * - `generate` (needs a session with the code step done, aal2): 8 single-use codes of 10 characters (alphabet without
 *   I, O, 0, 1; 50 bits each), shown ONCE. Only HMAC-SHA-256 hashes are stored (key = server secret + user id), in
 *   `mfa_recovery_codes` (migration 0015: cascade to auth.users, RLS on, no client right at all). Sets made before 0015
 *   live in `app_config` under `mfa-recovery:<user id>` and are still accepted; a NEW set always goes to the table and
 *   removes the old row (without the migration the old row is written – nothing breaks while it is pending). A new set
 *   replaces the old one.
 * - `redeem` (needs only the password session, aal1 – the user cannot give the code step): a matching unused code is
 *   consumed atomically (optimistic write on `updated_at`), every TOTP factor of the user is removed, the rest of the set
 *   is deleted, the event is audited. The account then works with the password alone until the user sets 2FA up again.
 *   Wrong codes: 5 tries per 15 minutes per user (fail closed) and 20 per hour per address pseudonym; the comparison runs
 *   over ALL codes in constant time, the answer is one generic text.
 * - account deletion removes the row (`removeRecovery`).
 *
 * Deliberately NOT here: any bypass without a code. Someone with neither the device nor a code goes through the
 * operator (identity check by hand, `docs/BETRIEB.md`) – the app cannot verify identity.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./account";
import { purposeKey } from "./audit";
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase";

export const RECOVERY_COUNT = 8;
export const RECOVERY_LENGTH = 10;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface CodeEntry {
  h: string;
  usedAt: string | null;
}
interface RecoveryValue {
  v: 1;
  createdAt: string;
  codes: CodeEntry[];
}
/** Where a set lives: its own table (migration 0015) or, for sets made before it, the `app_config` row (still accepted). */
interface Row {
  value: RecoveryValue;
  updated_at: string;
  where: "table" | "legacy";
}

const TABLE = "mfa_recovery_codes";

const keyOf = (userId: string): string => `mfa-recovery:${userId}`;

/** `ABCDE-FGHJK` – the way a code is shown. */
export function formatCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Upper-case, separators removed; `null` when it cannot be a code (no hashing, no database call for junk). */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${ALPHABET}]{${RECOVERY_LENGTH}}$`).test(c) ? c : null;
}

export function hashCode(userId: string, code: string): string {
  return createHmac("sha256", purposeKey("mfa-recovery")).update(`${userId}:${code}`).digest("hex");
}

export function newCodes(): string[] {
  const out = new Set<string>();
  while (out.size < RECOVERY_COUNT) {
    let c = "";
    for (let i = 0; i < RECOVERY_LENGTH; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    out.add(c);
  }
  return [...out];
}

function unavailable(): HttpError {
  return new HttpError(503, "recovery_unavailable", "Wiederherstellungscodes sind gerade nicht verfügbar.");
}

/** Is the table of migration 0015 there? (`false` while the migration is pending – the functions then use `app_config` only.) */
async function readTable(userId: string, sb: SupabaseClient): Promise<Row | null | "no-table"> {
  const { data, error } = await sb.from(TABLE).select("codes, created_at, updated_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return "no-table";
    console.error("[fn] recovery read failed", error.code);
    throw unavailable();
  }
  const row = data as { codes?: unknown; created_at?: unknown; updated_at?: unknown } | null;
  if (!row || !Array.isArray(row.codes)) return null;
  return { value: { v: 1, createdAt: String(row.created_at ?? ""), codes: row.codes as CodeEntry[] }, updated_at: String(row.updated_at ?? ""), where: "table" };
}

async function readLegacy(userId: string, sb: SupabaseClient): Promise<Row | null> {
  const { data, error } = await sb.from("app_config").select("value, updated_at").eq("key", keyOf(userId)).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] recovery read failed", error.code);
    throw unavailable();
  }
  const row = data as { value?: unknown; updated_at?: unknown } | null;
  const value = row?.value as Partial<RecoveryValue> | undefined;
  if (!row || !value || value.v !== 1 || !Array.isArray(value.codes)) return null;
  return { value: value as RecoveryValue, updated_at: String(row.updated_at ?? ""), where: "legacy" };
}

/** The table row wins; a user with only the old `app_config` row keeps working. */
async function readRow(userId: string, sb: SupabaseClient): Promise<Row | null> {
  const t = await readTable(userId, sb);
  if (t && t !== "no-table") return t;
  return readLegacy(userId, sb);
}

/** Writes `next` back where the row came from. Resolves the number of rows written (0 = lost the optimistic race). */
async function writeBack(userId: string, row: Row, next: RecoveryValue, nowIso: string | null, sb: SupabaseClient): Promise<number> {
  const q =
    row.where === "table"
      ? sb.from(TABLE).update({ codes: next.codes, ...(nowIso ? { updated_at: nowIso } : {}) }).eq("user_id", userId)
      : sb.from("app_config").update({ value: next, ...(nowIso ? { updated_at: nowIso } : {}) }).eq("key", keyOf(userId));
  const guarded = nowIso ? q.eq("updated_at", row.updated_at) : q;
  const { data, error } = await guarded.select(row.where === "table" ? "user_id" : "key");
  if (error) {
    console.error("[fn] recovery write failed", error.code);
    throw unavailable();
  }
  return Array.isArray(data) ? data.length : 0;
}

export interface RecoveryStatus {
  total: number;
  remaining: number;
  createdAt: string | null;
}

export async function recoveryStatus(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<RecoveryStatus> {
  const row = await readRow(userId, sb);
  if (!row) return { total: 0, remaining: 0, createdAt: null };
  return { total: row.value.codes.length, remaining: row.value.codes.filter((c) => !c.usedAt).length, createdAt: row.value.createdAt };
}

/** Stores a fresh set (replacing any old one) and returns the plain codes – the only time they exist outside the user's hands. */
export async function generateRecovery(userId: string, now: Date = new Date(), sb: SupabaseClient = supabaseAdmin()): Promise<{ codes: string[]; createdAt: string }> {
  const plain = newCodes();
  const value: RecoveryValue = { v: 1, createdAt: now.toISOString(), codes: plain.map((c) => ({ h: hashCode(userId, c), usedAt: null })) };
  // the table of migration 0015; while it is pending the old app_config row is written (and nothing breaks)
  const t = await sb.from(TABLE).upsert({ user_id: userId, codes: value.codes, created_at: value.createdAt, updated_at: value.createdAt }, { onConflict: "user_id" });
  if (t.error && isMissingTable(t.error)) {
    const { error } = await sb.from("app_config").upsert({ key: keyOf(userId), value, updated_at: now.toISOString() }, { onConflict: "key" });
    if (error) {
      console.error("[fn] recovery write failed", error.code);
      throw unavailable();
    }
  } else if (t.error) {
    console.error("[fn] recovery write failed", t.error.code);
    throw unavailable();
  } else {
    // migrated: a set made before the table existed is replaced by this one
    await sb.from("app_config").delete().eq("key", keyOf(userId));
  }
  return { codes: plain.map(formatCode), createdAt: value.createdAt };
}

/** Removes the user's recovery rows – the table row and a legacy one (account deletion, 2FA reset). Best effort, never throws. */
export async function removeRecovery(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<void> {
  try {
    await sb.from(TABLE).delete().eq("user_id", userId);
    await sb.from("app_config").delete().eq("key", keyOf(userId));
  } catch {
    console.error("[fn] recovery delete failed");
  }
}

export const INVALID_CODE = "Dieser Code passt nicht oder wurde schon benutzt.";

/**
 * Consumes a code. Resolves `true` when it matched an unused code and was marked used; `false` for everything else (no row,
 * junk, wrong, used, lost race) – the caller answers all of these the same.
 */
export async function consumeRecovery(userId: string, input: string, now: Date = new Date(), sb: SupabaseClient = supabaseAdmin()): Promise<boolean> {
  const code = normalizeCode(input);
  const row = await readRow(userId, sb);
  // always compare against every stored hash, also for junk input: the time does not tell which case it was
  const probe = Buffer.from(hashCode(userId, code ?? "INVALID000"), "hex");
  let hit = -1;
  row?.value.codes.forEach((c, i) => {
    const stored = Buffer.from(c.h, "hex");
    if (stored.length === probe.length && timingSafeEqual(stored, probe) && !c.usedAt && code) hit = i;
  });
  if (!row || hit < 0) return false;
  const next: RecoveryValue = { ...row.value, codes: row.value.codes.map((c, i) => (i === hit ? { ...c, usedAt: now.toISOString() } : c)) };
  return (await writeBack(userId, row, next, now.toISOString(), sb)) === 1;
}

/** Puts a consumed code back (the factor removal that should have followed failed). Best effort. */
export async function restoreRecovery(userId: string, input: string, sb: SupabaseClient = supabaseAdmin()): Promise<void> {
  try {
    const code = normalizeCode(input);
    const row = await readRow(userId, sb);
    if (!code || !row) return;
    const h = hashCode(userId, code);
    const next: RecoveryValue = { ...row.value, codes: row.value.codes.map((c) => (c.h === h ? { ...c, usedAt: null } : c)) };
    await writeBack(userId, row, next, null, sb);
  } catch {
    console.error("[fn] recovery restore failed");
  }
}

/** Removes every TOTP factor of the user (verified or half-finished). Returns how many were removed; throws 502 when one fails. */
export async function removeAllFactors(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<number> {
  const { data, error } = await sb.auth.admin.mfa.listFactors({ userId });
  if (error || !data) throw new HttpError(502, "mfa_unavailable", "Der Anmeldedienst antwortet gerade nicht.");
  let n = 0;
  for (const f of data.factors) {
    const { error: e } = await sb.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (e) {
      console.error("[fn] deleteFactor failed", e.status ?? "");
      throw new HttpError(502, "mfa_unavailable", "Der Anmeldedienst antwortet gerade nicht.");
    }
    n++;
  }
  return n;
}

export async function hasVerifiedFactor(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<boolean> {
  const { data, error } = await sb.auth.admin.mfa.listFactors({ userId });
  if (error || !data) throw new HttpError(502, "mfa_unavailable", "Der Anmeldedienst antwortet gerade nicht.");
  return data.factors.some((f) => f.status === "verified");
}
