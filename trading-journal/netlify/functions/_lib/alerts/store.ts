/**
 * Database access of the four alarms (service role, migration 0014). One interface (`AlertStore`) so the engine run and the worker are
 * tested against an in-memory twin (`tests/unit/alerts.fakes.ts`) and the real thing is a thin layer over the SQL functions, whose rules
 * (dedupe key, lease, fencing token, committed-before-dialed) are checked against a real Postgres by `supabase/tests/0014_alerts.test.sql`.
 * Errors carry codes only – never a row, a number or an address.
 */
import type { AlertChannel } from "../../../../src/domain/alerts/config";
import type { DeliveryStatus } from "../../../../src/domain/alerts/delivery";
import type { AlertEvent, AlertSourceKind } from "../../../../src/domain/alerts/types";
import { supabaseAdmin } from "../supabase";

export class AlertsMigrationMissing extends Error {
  constructor() {
    super("alerts migration missing");
    this.name = "AlertsMigrationMissing";
  }
}

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205", "PGRST200", "PGRST204"]);

function fail(op: string, e: { code?: string | null }): never {
  if (e.code && MISSING.has(e.code)) throw new AlertsMigrationMissing();
  throw new Error(`${op}: ${e.code ?? "failed"}`);
}

export interface Candidate {
  userId: string;
  prefs: unknown;
  tz: string;
}

export interface EventInput {
  userId: string;
  dedupKey: string;
  source: AlertSourceKind;
  marketKey: string;
  market: string;
  event: AlertEvent;
  value: number | null;
  detail: string;
  suppressed: "cooldown" | null;
  occurredAt: number;
  deliveries: { channel: AlertChannel; status: "queued" | "skipped"; reason: string | null; runAt: number }[];
}

export interface JobRecord {
  id: string;
  userId: string;
  deliveryId: string | null;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
}

export interface DeliveryRecord {
  id: string;
  userId: string;
  eventId: string | null;
  kind: "alarm" | "test";
  channel: AlertChannel;
  status: DeliveryStatus;
  reason: string | null;
  attempts: number;
  providerRef: string | null;
  /** set in the step that commits a call – the proof that it may be on its way */
  dialedAt: string | null;
  event: { event: AlertEvent; market: string; source: AlertSourceKind; detail: string | null; occurredAt: string } | null;
}

export interface DeliveryPatch {
  status?: DeliveryStatus;
  reason?: string | null;
  providerRef?: string | null;
  attempts?: number;
  /** only `null`: takes back the commitment of a call that was refused before it existed */
  dialedAt?: null;
}

export type ReserveResult = "ok" | "already" | "phone_opted_out" | "no_plan" | "month_limit" | "user_day_limit" | "global_day_limit";

export interface PhoneSecret {
  numberEnc: string;
  verified: boolean;
}

export interface AlertStore {
  candidates(limit: number, salt: string): Promise<Candidate[]>;
  loadMemory(userId: string): Promise<unknown>;
  saveMemory(userId: string, memory: unknown): Promise<void>;
  userKeyLevels(userId: string): Promise<unknown>;
  /** the new event id, or `null` when the dedupe key exists already */
  enqueue(e: EventInput): Promise<string | null>;
  /** a log row for a test (and a job when `job`) – returns the delivery id */
  enqueueTest(userId: string, channel: AlertChannel, job: boolean): Promise<string>;
  claim(limit: number, leaseSec: number, userId?: string): Promise<JobRecord[]>;
  complete(job: JobRecord, status: "done" | "dead", code: string | null): Promise<boolean>;
  retry(job: JobRecord, delaySec: number, code: string): Promise<boolean>;
  delivery(id: string): Promise<DeliveryRecord | null>;
  patchDelivery(id: string, patch: DeliveryPatch): Promise<void>;
  phoneReserve(deliveryId: string, userId: string, monthLimit: number, userDayMax: number, globalDayMax: number): Promise<ReserveResult>;
  advanceByRef(ref: string, status: DeliveryStatus, reason: string | null): Promise<string | null>;
  phoneSecret(userId: string): Promise<PhoneSecret | null>;
  /** calls with a provider id that are still queued / ringing and were last touched before `olderThanMs` (a lost callback) */
  openCalls(olderThanMs: number, limit: number): Promise<{ providerRef: string }[]>;
  prefsOf(userId: string): Promise<{ prefs: unknown; tz: string } | null>;
  prune(): Promise<void>;
  /** the cron's own bookkeeping (when each source was last read, the last run's counts) – `null` before the first run */
  runState(): Promise<Record<string, unknown> | null>;
  saveRunState(v: Record<string, unknown>): Promise<void>;
}

// ------------------------------------------------------------------------------------------ Supabase

/** `app_config` key of the cron's bookkeeping. */
export const RUN_STATE_KEY = "alerts-run";

const iso = (ms: number): string => new Date(ms).toISOString();

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function deliveryOf(r: Row): DeliveryRecord | null {
  if (typeof r.id !== "string" || typeof r.user_id !== "string") return null;
  const ev = Array.isArray(r.alert_events) ? (r.alert_events[0] as Row | undefined) : (r.alert_events as Row | null | undefined);
  return {
    id: r.id,
    userId: r.user_id,
    eventId: str(r.event_id),
    kind: r.kind === "test" ? "test" : "alarm",
    channel: r.channel as AlertChannel,
    status: r.status as DeliveryStatus,
    reason: str(r.reason),
    attempts: typeof r.attempts === "number" ? r.attempts : 0,
    providerRef: str(r.provider_ref),
    dialedAt: str(r.dialed_at),
    event: ev && typeof ev.event === "string" ? { event: ev.event as AlertEvent, market: str(ev.market) ?? "", source: ev.source as AlertSourceKind, detail: str(ev.detail), occurredAt: str(ev.occurred_at) ?? "" } : null,
  };
}

export function supabaseAlertStore(): AlertStore {
  const db = supabaseAdmin;
  return {
    async candidates(limit, salt) {
      const { data, error } = await db().rpc("alert_candidates", { p_limit: limit, p_salt: salt });
      if (error) fail("candidates", error);
      return ((data ?? []) as Row[]).filter((r) => typeof r.user_id === "string").map((r) => ({ userId: r.user_id as string, prefs: r.prefs, tz: str(r.tz) ?? "" }));
    },
    async loadMemory(userId) {
      const { data, error } = await db().from("alert_state").select("memory").eq("user_id", userId).maybeSingle();
      if (error) fail("memory", error);
      return (data as Row | null)?.memory ?? {};
    },
    async saveMemory(userId, memory) {
      const { error } = await db().from("alert_state").upsert({ user_id: userId, memory }, { onConflict: "user_id" });
      if (error) fail("memory-save", error);
    },
    async userKeyLevels(userId) {
      const { data, error } = await db().rpc("alert_user_keylevels", { p_user: userId });
      if (error) fail("keylevels", error);
      return data ?? null;
    },
    async enqueue(e) {
      const { data, error } = await db().rpc("alert_enqueue", {
        p_user: e.userId,
        p_dedup_key: e.dedupKey,
        p_source: e.source,
        p_market_key: e.marketKey,
        p_market: e.market,
        p_event: e.event,
        p_value: e.value,
        p_detail: e.detail,
        p_suppressed: e.suppressed,
        p_occurred: iso(e.occurredAt),
        p_deliveries: e.deliveries.map((d) => ({ channel: d.channel, status: d.status, reason: d.reason, run_at: iso(d.runAt) })),
      });
      if (error) fail("enqueue", error);
      return typeof data === "string" ? data : null;
    },
    async enqueueTest(userId, channel, job) {
      const { data, error } = await db().rpc("alert_enqueue_test", { p_user: userId, p_channel: channel, p_job: job });
      if (error || typeof data !== "string") fail("enqueue-test", error ?? {});
      return data as string;
    },
    async claim(limit, leaseSec, userId) {
      const { data, error } = await db().rpc("jobs_claim", { p_kind: "alert.deliver", p_limit: limit, p_lease_sec: leaseSec, p_user: userId ?? null });
      if (error) fail("claim", error);
      return ((data ?? []) as Row[]).flatMap((r) =>
        typeof r.id === "string" && typeof r.user_id === "string" && typeof r.lease_token === "string"
          ? [{ id: r.id, userId: r.user_id, deliveryId: str((r.payload as Row | null)?.delivery_id), attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts), leaseToken: r.lease_token }]
          : [],
      );
    },
    async complete(job, status, code) {
      const { data, error } = await db().rpc("jobs_complete", { p_id: job.id, p_token: job.leaseToken, p_status: status, p_code: code });
      if (error) fail("complete", error);
      return data === true;
    },
    async retry(job, delaySec, code) {
      const { data, error } = await db().rpc("jobs_retry", { p_id: job.id, p_token: job.leaseToken, p_delay_sec: delaySec, p_code: code });
      if (error) fail("retry", error);
      return data === true;
    },
    async delivery(id) {
      const { data, error } = await db().from("alert_deliveries").select("*, alert_events(event, market, source, detail, occurred_at)").eq("id", id).maybeSingle();
      if (error) fail("delivery", error);
      return data ? deliveryOf(data as Row) : null;
    },
    async patchDelivery(id, patch) {
      const row: Row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.reason !== undefined) row.reason = patch.reason;
      if (patch.providerRef !== undefined) row.provider_ref = patch.providerRef;
      if (patch.attempts !== undefined) row.attempts = patch.attempts;
      if (patch.dialedAt === null) row.dialed_at = null;
      if (!Object.keys(row).length) return;
      const { error } = await db().from("alert_deliveries").update(row).eq("id", id);
      if (error) fail("patch", error);
    },
    async phoneReserve(deliveryId, userId, monthLimit, userDayMax, globalDayMax) {
      const { data, error } = await db().rpc("alert_phone_reserve", { p_delivery: deliveryId, p_user: userId, p_month_limit: monthLimit, p_user_day_max: userDayMax, p_global_day_max: globalDayMax });
      if (error) fail("reserve", error);
      return typeof data === "string" ? (data as ReserveResult) : "already";
    },
    async advanceByRef(ref, status, reason) {
      const { data, error } = await db().rpc("alert_delivery_advance", { p_ref: ref, p_status: status, p_reason: reason });
      if (error) fail("advance", error);
      return typeof data === "string" ? data : null;
    },
    async phoneSecret(userId) {
      const { data, error } = await db().from("alert_phone_secrets").select("number_enc, verified").eq("user_id", userId).maybeSingle();
      if (error) fail("phone-secret", error);
      const r = data as Row | null;
      return r && typeof r.number_enc === "string" ? { numberEnc: r.number_enc, verified: r.verified === true } : null;
    },
    async openCalls(olderThanMs, limit) {
      const { data, error } = await db()
        .from("alert_deliveries")
        .select("provider_ref")
        .eq("channel", "phone")
        .in("status", ["queued", "ringing"])
        .not("provider_ref", "is", null)
        .lt("updated_at", iso(olderThanMs))
        .limit(limit);
      if (error) fail("open-calls", error);
      return ((data ?? []) as Row[]).flatMap((r) => (typeof r.provider_ref === "string" ? [{ providerRef: r.provider_ref }] : []));
    },
    async prefsOf(userId) {
      const { data, error } = await db().from("alert_prefs").select("prefs").eq("user_id", userId).maybeSingle();
      if (error) fail("prefs", error);
      if (!data) return null;
      const p = await db().from("profiles").select("tz").eq("id", userId).maybeSingle();
      return { prefs: (data as Row).prefs, tz: str((p.data as Row | null)?.tz) ?? "" };
    },
    async runState() {
      const { data, error } = await db().from("app_config").select("value").eq("key", RUN_STATE_KEY).maybeSingle();
      if (error || !data) return null;
      const v = (data as Row).value;
      return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    },
    async saveRunState(v) {
      const { error } = await db().from("app_config").upsert({ key: RUN_STATE_KEY, value: v, updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error && !(error.code && MISSING.has(error.code))) console.error("[fn] alerts run state failed", error.code ?? "");
    },
    async prune() {
      const { error } = await db().rpc("alert_prune");
      if (error) fail("prune", error);
    },
  };
}
