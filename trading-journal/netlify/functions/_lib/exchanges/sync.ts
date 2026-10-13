/**
 * One exchange sync (P11): positions → trades → `upsert_synced_trades`, incremental and resumable.
 *
 * Window. Bitunix filters closed positions by their OPEN time (`ctime`). A position opened before the last sync and
 * closed after it would be missed by "since last sync", so the next window starts at the older of the last sync end and
 * the oldest position that was still open then (`oldestOpenMs`, from `get_pending_positions`), minus `LOOKBACK_MS`.
 * Re-reading a position is harmless: the upsert is idempotent ("unchanged" writes nothing).
 * Long windows are read in `SLICE_MS` slices (the venue's maximum window is undocumented). When the deadline hits, the
 * slice and offset are kept as `resume` and the next sync (manual, cron or the client's "weiter") continues there.
 *
 * Dry run: reads and maps everything, writes nothing to the journal and does not move the cursor – it returns the
 * mapped trades plus a per-position check (venue numbers next to the journal numbers) so the trader can compare them
 * with Bitunix before the first real import. Only the run itself is recorded.
 */
import { HttpError } from "../http";
import { supabaseAdmin } from "../supabase";
import { detectPnlConvention, mapClosedPosition, safeTz, type MappedPosition, type PnlConvention, type PositionCheck, type SyncedTrade } from "./mapping";
import { adapterFor } from "./registry";
import { credentialsOf, finishRun, getCursor, rotateIfNeeded, setCursor, startRun, updateConnection, upsertSyncedTrades, type ConnectionRow, type RunCounts, type RunKind, type RunStatus } from "./store";
import { ExchangeError, type ExchangeAdapter, type VenueClosedPosition, type VenueFill, type VenueTpSl } from "./types";

export const DAY_MS = 86_400_000;
/** Read window per request batch. */
export const SLICE_MS = 30 * DAY_MS;
/** Safety overlap before the cursor. */
export const LOOKBACK_MS = 60 * 60_000;
/** First sync without an explicit start: the last 30 days (the first import / backfill reaches further back). */
export const FIRST_SYNC_MS = 30 * DAY_MS;
/** Backfill reaches back at most this far. */
export const MAX_BACKFILL_MS = 366 * DAY_MS;
/** Per-position fill requests per run (manual / cron); the backfill passes a larger budget. */
export const DEFAULT_FILL_BUDGET = 25;
const CHECKS_MAX = 60;
const STREAM = "positions";

export interface SyncRequest {
  userId: string;
  connection: ConnectionRow;
  kind: RunKind;
  dryRun: boolean;
  tz: string;
  /** Explicit window start (backfill, "neu einlesen ab"). */
  from?: number;
  /** Stop starting venue requests after this (epoch ms). */
  deadline: number;
  runId?: string;
  now?: number;
  fillBudget?: number;
}

export interface SyncOutcome {
  runId: string;
  status: RunStatus;
  counts: RunCounts;
  /** The window was not finished (deadline) – call again to continue. */
  more: boolean;
  window: { from: number; to: number };
  dryRun: boolean;
  /** Dry run: the mapped trades (preview). Real runs: empty – devices get them via cloud sync or the pull. */
  trades: SyncedTrade[];
  /** Dry run: per-position comparison (≤ 60), newest first, with the journal state of each id. */
  checks: (PositionCheck & { state: "new" | "exists" | "deleted" })[];
  convention: PnlConvention & { used: boolean };
  /** Positions whose fills were not read (budget). */
  fillsSkipped: number;
  requests: number;
}

interface CursorMeta {
  resume?: { from: number; to: number; skip: number };
  oldestOpenMs?: number | null;
}

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** German, user-facing text of anything a sync can throw (never leaks internals). */
export function syncErrorMessage(e: unknown): { code: string; message: string; status: number; auth: boolean } {
  if (e instanceof ExchangeError) return { code: e.code, message: e.message, status: e.status === 401 || e.status === 403 ? 422 : e.status, auth: e.authFailure };
  if (e instanceof HttpError) return { code: e.code, message: e.message, status: e.status, auth: false };
  if (e instanceof Error && e.name === "CryptoError") {
    return { code: "key_unreadable", message: "Der gespeicherte Schlüssel lässt sich nicht mehr lesen. Bitte die Börse neu verbinden.", status: 409, auth: true };
  }
  return { code: "sync_failed", message: "Der Sync ist fehlgeschlagen. Bitte später erneut versuchen.", status: 500, auth: false };
}

/** Which ids of `ids` already exist in the journal (and which are tombstones). */
async function journalStates(userId: string, ids: string[]): Promise<Map<string, "exists" | "deleted">> {
  const out = new Map<string, "exists" | "deleted">();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin().from("journal_docs").select("id,deleted").eq("user_id", userId).eq("kind", "trade").in("id", ids.slice(i, i + 100));
    if (error) break;
    for (const r of (data ?? []) as { id: string; deleted: boolean }[]) out.set(r.id, r.deleted ? "deleted" : "exists");
  }
  return out;
}

/** Reads positions of [from, to] in slices; stops at the deadline and reports where to resume. */
async function readPositions(
  adapter: ExchangeAdapter,
  from: number,
  to: number,
  startSkip: number,
  deadline: number,
): Promise<{ positions: VenueClosedPosition[]; resume: CursorMeta["resume"] | null; requests: number }> {
  const positions: VenueClosedPosition[] = [];
  let requests = 0;
  let sliceStart = from;
  let skip = startSkip;
  while (sliceStart <= to) {
    const sliceEnd = Math.min(to, sliceStart + SLICE_MS - 1);
    const res = await adapter.fetchClosedPositions({ startTime: sliceStart, endTime: sliceEnd }, { skip, deadline });
    requests += res.requests;
    positions.push(...res.items);
    if (!res.complete) return { positions, resume: { from: sliceStart, to, skip: Math.max(0, res.nextSkip - 100) }, requests };
    sliceStart = sliceEnd + 1;
    skip = 0;
  }
  return { positions, resume: null, requests };
}

/** TP/SL orders around the read positions (best effort: an incomplete read just leaves stops for later). */
async function readTpSl(adapter: ExchangeAdapter, positions: VenueClosedPosition[], deadline: number): Promise<{ orders: VenueTpSl[]; requests: number }> {
  if (!positions.length) return { orders: [], requests: 0 };
  const from = Math.min(...positions.map((p) => p.openedAt)) - 60_000;
  const to = Math.max(...positions.map((p) => p.closedAt)) + 60_000;
  const orders: VenueTpSl[] = [];
  let requests = 0;
  for (let s = from; s <= to; s += SLICE_MS) {
    if (Date.now() >= deadline) break;
    try {
      const res = await adapter.fetchTpSl({ startTime: s, endTime: Math.min(to, s + SLICE_MS - 1) }, { deadline });
      requests += res.requests;
      orders.push(...res.items);
      if (!res.complete) break;
    } catch (e) {
      // TP/SL is optional – a failing list must not fail the sync (auth errors surfaced already on the positions).
      if (e instanceof ExchangeError && e.authFailure) throw e;
      break;
    }
  }
  return { orders, requests };
}

/** Runs one sync for one connection. Throws `HttpError` (German) on failure – the run is recorded either way. */
export async function runSync(req: SyncRequest): Promise<SyncOutcome> {
  const now = req.now ?? Date.now();
  const conn = req.connection;
  const tz = safeTz(req.tz);
  const kind: RunKind = req.dryRun ? "dry_run" : req.kind;
  const runId = await startRun(req.userId, conn.id, conn.exchange, kind, req.runId);
  const counts: RunCounts = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  let windowFrom = 0;
  let windowTo = now;
  try {
    const creds = credentialsOf(conn);
    const adapter = adapterFor(conn.exchange, creds);
    const cursor = req.from === undefined ? await getCursor(conn.id, STREAM) : null;
    const meta = (cursor?.meta ?? {}) as CursorMeta;
    const connMeta = (conn.meta ?? {}) as { feesIncluded?: boolean | null };

    // window
    let skip = 0;
    if (req.from !== undefined) {
      windowFrom = Math.max(now - MAX_BACKFILL_MS, Math.floor(req.from));
    } else if (meta.resume && isFiniteNum(meta.resume.from) && isFiniteNum(meta.resume.to)) {
      windowFrom = meta.resume.from;
      windowTo = Math.max(meta.resume.to, windowFrom);
      skip = isFiniteNum(meta.resume.skip) ? meta.resume.skip : 0;
    } else if (cursor && isFiniteNum(cursor.cursor_ms)) {
      const oldestOpen = isFiniteNum(meta.oldestOpenMs) ? meta.oldestOpenMs : cursor.cursor_ms;
      windowFrom = Math.max(0, Math.min(cursor.cursor_ms, oldestOpen) - LOOKBACK_MS);
    } else {
      windowFrom = now - FIRST_SYNC_MS;
    }

    const read = await readPositions(adapter, windowFrom, windowTo, skip, req.deadline);
    let requests = read.requests;
    // newest first, one entry per position id (a resumed page may repeat one)
    const byId = new Map<string, VenueClosedPosition>();
    for (const p of read.positions) byId.set(p.positionId, p);
    const positions = [...byId.values()].sort((a, b) => b.closedAt - a.closedAt);
    counts.fetched = positions.length;

    const tp = await readTpSl(adapter, positions, req.deadline);
    requests += tp.requests;

    // fills: newest positions first, within the budget and the deadline
    const budget = req.fillBudget ?? DEFAULT_FILL_BUDGET;
    const fills = new Map<string, VenueFill[] | null>();
    let fillsSkipped = 0;
    for (const p of positions) {
      if (fills.size >= budget || Date.now() >= req.deadline) {
        fillsSkipped++;
        continue;
      }
      try {
        const res = await adapter.fetchFills({ positionId: p.positionId }, { deadline: req.deadline, max: 500 });
        requests += res.requests;
        fills.set(p.positionId, res.complete ? res.items : null);
      } catch (e) {
        if (e instanceof ExchangeError && e.authFailure) throw e;
        fills.set(p.positionId, null);
      }
    }

    const detected = detectPnlConvention(positions);
    const feesIncluded = detected.feesIncluded ?? (typeof connMeta.feesIncluded === "boolean" ? connMeta.feesIncluded : false);
    const nowIso = new Date(now).toISOString();
    const mapped: MappedPosition[] = positions.map((p) =>
      mapClosedPosition(p, {
        exchange: conn.exchange,
        tz,
        journalAccount: conn.journal_account === "makro" ? "makro" : "scalp",
        exchangeAccount: conn.label || undefined,
        nowIso,
        feesIncluded,
        tpsl: tp.orders,
        fills: fills.get(p.positionId) ?? null,
      }),
    );

    const more = read.resume !== null;
    const convention = { ...detected, feesIncluded, used: detected.feesIncluded !== null };

    if (req.dryRun) {
      const states = await journalStates(req.userId, mapped.slice(0, CHECKS_MAX).map((m) => m.trade.id));
      const checks = mapped.slice(0, CHECKS_MAX).map((m) => ({ ...m.check, state: states.get(m.trade.id) ?? ("new" as const) }));
      counts.skipped = 0;
      await finishRun(req.userId, runId, more ? "partial" : "ok", counts, {
        windowFrom,
        windowTo,
        meta: { dryRun: true, more, requests, feesIncluded, samples: detected.samples },
      });
      return { runId, status: more ? "partial" : "ok", counts, more, window: { from: windowFrom, to: windowTo }, dryRun: true, trades: mapped.map((m) => m.trade), checks, convention, fillsSkipped, requests };
    }

    const results = await upsertSyncedTrades(req.userId, mapped.map((m) => m.item));
    for (const r of Object.values(results)) {
      if (r === "inserted") counts.inserted++;
      else if (r === "updated") counts.updated++;
      else if (r === "unchanged") counts.unchanged++;
      else counts.skipped++;
    }

    // where the next sync starts
    let oldestOpenMs: number | null = null;
    if (!more && Date.now() < req.deadline) {
      try {
        const open = await adapter.fetchOpenPositions();
        requests++;
        const opened = open.map((p) => p.openedAt).filter((t) => t > 0);
        oldestOpenMs = opened.length ? Math.min(...opened) : null;
      } catch (e) {
        if (e instanceof ExchangeError && e.authFailure) throw e;
        oldestOpenMs = windowTo - 7 * DAY_MS; // unknown: look a week back next time
      }
    }
    const nextMeta: CursorMeta = more ? { resume: read.resume ?? undefined, oldestOpenMs: meta.oldestOpenMs ?? null } : { oldestOpenMs };
    await setCursor(req.userId, conn.id, STREAM, more ? (cursor?.cursor_ms ?? null) : windowTo, nextMeta as Record<string, unknown>);
    const connPatch: Parameters<typeof updateConnection>[2] = { last_sync_at: nowIso, last_error: null, status: "active" };
    if (detected.feesIncluded !== null && detected.feesIncluded !== connMeta.feesIncluded) connPatch.meta = { ...(conn.meta ?? {}), feesIncluded: detected.feesIncluded };
    await updateConnection(req.userId, conn.id, connPatch);
    // the key just worked: blobs of an older key version move to the newest one (review KEY-01, best effort)
    await rotateIfNeeded(conn, creds);

    const status: RunStatus = more ? "partial" : "ok";
    await finishRun(req.userId, runId, status, counts, { windowFrom, windowTo, meta: { more, requests, feesIncluded, fillsSkipped } });
    return { runId, status, counts, more, window: { from: windowFrom, to: windowTo }, dryRun: false, trades: [], checks: [], convention, fillsSkipped, requests };
  } catch (e) {
    const err = syncErrorMessage(e);
    await finishRun(req.userId, runId, "error", counts, { error: err.message, windowFrom, windowTo, meta: { code: err.code } });
    if (!req.dryRun || err.auth) {
      const patch: Parameters<typeof updateConnection>[2] = { last_error: err.message };
      if (err.auth) patch.status = "invalid";
      await updateConnection(req.userId, conn.id, patch).catch(() => undefined);
    }
    throw new HttpError(err.status, err.code, err.message);
  }
}
