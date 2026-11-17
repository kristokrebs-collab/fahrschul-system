/**
 * Signal store (Paket B3; table `signals`, migration 0013): one row per DELIVERY with its fate – processed / duplicate / rejected.
 * Dedup is the database's: the partial unique index on (user, source, signal id) where status = 'processed'. Two parallel deliveries
 * of one signal end in a unique violation (`23505`) for the second, which is recorded as 'duplicate' and changes nothing.
 * Retention (`prune`): processed signals 90 days / newest 1000 (that is the dedup window), tests and non-processed rows: newest 20 / 40.
 * No raw body, token or IP is stored.
 */
import { HttpError } from "../http";
import { isMissingTable } from "../account";
import { supabaseAdmin } from "../supabase";
import { clean, parseSignalBody, type Direction, type NormalizedSignal, type SchemaId } from "./schema";

export type SignalStatus = "processed" | "duplicate" | "rejected";

export interface SignalRow {
  id: string;
  kind: "signal" | "test";
  status: SignalStatus;
  reason: string | null;
  schemaId: SchemaId | null;
  source: string;
  signalId: string | null;
  strategy: string | null;
  market: string | null;
  symbol: string | null;
  direction: Direction | null;
  /** the time the signal names (ISO) */
  time: string | null;
  /** only the fields the screen and the paper bridge use */
  data: { zustand?: "gruen" | "rot"; kurs?: number } | null;
  via: "app" | "extern";
  receivedAt: string;
}

export const KEEP_PROCESSED = 1000;
export const KEEP_PROCESSED_DAYS = 90;
export const KEEP_TESTS = 20;
export const KEEP_OTHER = 40;

const COLUMNS = "id,kind,status,reason,schema_id,source,signal_id,strategy,market,symbol,direction,signal_time,data,via,received_at";

const rowOf = (r: Record<string, unknown>): SignalRow => {
  const d = r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : null;
  const data: SignalRow["data"] = d
    ? { ...(d.zustand === "gruen" || d.zustand === "rot" ? { zustand: d.zustand } : {}), ...(typeof d.kurs === "number" && Number.isFinite(d.kurs) ? { kurs: d.kurs } : {}) }
    : null;
  return {
    id: String(r.id),
    kind: r.kind === "test" ? "test" : "signal",
    status: r.status === "duplicate" || r.status === "rejected" ? r.status : "processed",
    reason: typeof r.reason === "string" ? r.reason : null,
    schemaId: r.schema_id === "signal/1" || r.schema_id === "branchen-trend/1" || r.schema_id === "legacy-action" ? r.schema_id : null,
    source: String(r.source ?? ""),
    signalId: typeof r.signal_id === "string" ? r.signal_id : null,
    strategy: typeof r.strategy === "string" ? r.strategy : null,
    market: typeof r.market === "string" ? r.market : null,
    symbol: typeof r.symbol === "string" ? r.symbol : null,
    direction: r.direction === "long" || r.direction === "flat" ? r.direction : null,
    time: typeof r.signal_time === "string" ? r.signal_time : null,
    data: data && Object.keys(data).length ? data : null,
    via: r.via === "app" ? "app" : "extern",
    receivedAt: String(r.received_at),
  };
};

export async function listSignals(userId: string, limit = 20): Promise<{ signals: SignalRow[]; available: boolean }> {
  const { data, error } = await supabaseAdmin().from("signals").select(COLUMNS).eq("user_id", userId).order("received_at", { ascending: false }).limit(limit);
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] signals read failed", error.code ?? "");
    return { signals: [], available: false };
  }
  return { signals: ((data ?? []) as Record<string, unknown>[]).map(rowOf), available: true };
}

export interface IngestOutcome {
  /** HTTP status the receiver answers with */
  http: 200 | 422;
  result: "processed" | "duplicate" | "rejected" | "test";
  /** the owner-facing reason for a refusal */
  reason?: string;
  signalId?: string | null;
}

function insertRow(userId: string, s: NormalizedSignal, status: SignalStatus, reason: string | null): Record<string, unknown> {
  return {
    user_id: userId,
    source: s.source,
    signal_id: s.signalId,
    kind: s.kind,
    status,
    reason: reason ? clean(reason, 200) : null,
    schema_id: s.schemaId,
    strategy: s.strategy,
    market: s.market,
    symbol: s.symbol,
    direction: s.direction,
    signal_time: s.time,
    data: s.data,
    via: s.via,
  };
}

/** Keeps the tables small. Best effort: a failure here never fails a delivery. */
export async function prune(userId: string, now: number = Date.now()): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const cutoff = new Date(now - KEEP_PROCESSED_DAYS * 86_400_000).toISOString();
    await sb.from("signals").delete().eq("user_id", userId).eq("kind", "signal").eq("status", "processed").lt("received_at", cutoff);
    const base = () => sb.from("signals").select("id").eq("user_id", userId);
    type Q = ReturnType<typeof base>;
    const trim = async (q: (b: Q) => Q, keep: number): Promise<void> => {
      const old = await q(base()).order("received_at", { ascending: false }).range(keep, keep + 200);
      const ids = ((old.data ?? []) as { id: string }[]).map((x) => x.id);
      if (ids.length) await sb.from("signals").delete().eq("user_id", userId).in("id", ids);
    };
    await trim((b) => b.eq("kind", "test"), KEEP_TESTS);
    await trim((b) => b.in("status", ["duplicate", "rejected"]), KEEP_OTHER);
    await trim((b) => b.eq("kind", "signal").eq("status", "processed"), KEEP_PROCESSED);
  } catch (e) {
    console.error("[fn] signals prune failed", e instanceof Error ? e.name : typeof e);
  }
}

/**
 * Parses and stores one delivery of an owner. A refused body is recorded with its reason (422 for the sender); a repeated signal is
 * recorded as 'duplicate' (200: the sender must not retry). A missing table (migration 0013 not applied) is a 503: without it nothing
 * can be de-duplicated, so nothing is accepted.
 */
export async function ingest(userId: string, body: string, nowMs: number, defer?: (p: Promise<unknown>) => void): Promise<IngestOutcome> {
  // after the answer is decided: with the platform's `waitUntil` the cleanup runs behind the response (TradingView gives up after 3 s), else it is awaited
  const after = async (p: Promise<unknown>): Promise<void> => (defer ? defer(p) : void (await p));
  const parsed = parseSignalBody(body, nowMs);
  const sb = supabaseAdmin();
  const unavailable = () => new HttpError(503, "signals_unavailable", "Der Signal-Empfang ist auf diesem Server noch nicht eingerichtet.");
  if (!parsed.ok) {
    const { error } = await sb.from("signals").insert({
      user_id: userId,
      source: "tradingview",
      kind: "signal",
      status: "rejected",
      reason: clean(parsed.reason, 200),
      schema_id: parsed.schemaId,
      via: "extern",
    });
    if (error) {
      if (isMissingTable(error)) throw unavailable();
      console.error("[fn] signal reject write failed", error.code ?? "");
    }
    await after(prune(userId, nowMs));
    return { http: 422, result: "rejected", reason: parsed.reason };
  }
  const s = parsed.signal;
  const first = await sb.from("signals").insert(insertRow(userId, s, "processed", null));
  if (!first.error) {
    await after(prune(userId, nowMs));
    return { http: 200, result: s.kind === "test" ? "test" : "processed", signalId: s.signalId };
  }
  if (isMissingTable(first.error)) throw unavailable();
  if (first.error.code !== "23505") {
    console.error("[fn] signal write failed", first.error.code ?? "");
    throw new HttpError(500, "db_error");
  }
  // the same signal arrived before: remember the delivery, change nothing
  const dup = await sb.from("signals").insert(insertRow(userId, s, "duplicate", "Dieses Signal ist schon angekommen."));
  if (dup.error) console.error("[fn] signal duplicate write failed", dup.error.code ?? "");
  await after(prune(userId, nowMs));
  return { http: 200, result: "duplicate", signalId: s.signalId };
}
