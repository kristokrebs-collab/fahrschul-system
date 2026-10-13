// @vitest-environment node
/// <reference types="node" />
/**
 * P11 exchange functions end to end (`netlify/functions/exchange-*.mts`, `hooks-tradingview.mts`, `trades-api.mts`)
 * against an in-memory Supabase admin fake (tables, JSON-path filters, `upsert_synced_trades` with the SQL semantics of
 * 0003_exchange.sql) and a fake Bitunix that VERIFIES every signature with the official demo algorithm – so a sync only
 * succeeds when the key stored encrypted at connect time is decrypted and signed correctly.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { setAdapterRuntimeForTests } from "../../netlify/functions/_lib/exchanges/registry";
import { mergeSyncedTrade, SYNC_FILL_KEYS } from "../../src/exchanges/syncFields";
import connectFn from "../../netlify/functions/exchange-connect.mts";
import disconnectFn from "../../netlify/functions/exchange-disconnect.mts";
import syncFn from "../../netlify/functions/exchange-sync.mts";
import positionsFn from "../../netlify/functions/exchange-positions.mts";
import backfillFn from "../../netlify/functions/exchange-backfill-background.mts";
import { runExchangeCron } from "../../netlify/functions/exchange-sync-cron.mts";
import hookFn from "../../netlify/functions/hooks-tradingview.mts";
import tradesFn from "../../netlify/functions/trades-api.mts";

type Row = Record<string, unknown>;
type Ctx = Parameters<typeof connectFn>[1];
const ctx = (params?: Record<string, string>) => ({ ip: "203.0.113.7", params: params ?? {} }) as unknown as Ctx;
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const KEY = "bxk9f3a1c2d4e5f60718293a4b5c6d7e";
const SECRET = "bxs0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c";
const fixture = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8")) as Row;

/* ------------------------------------------------------------------ admin fake */

interface State {
  tables: Record<string, Row[]>;
  claims: Row | null;
  rpcCalls: string[];
}

const getPath = (row: Row, col: string): unknown => {
  const m = /^(\w+)((?:->>?\w+)+)$/.exec(col);
  if (!m) return row[col];
  let v: unknown = row[m[1]!];
  const parts = m[2]!.match(/->>?\w+/g)!;
  for (const p of parts) {
    const key = p.replace(/^->>?/, "");
    v = v && typeof v === "object" ? (v as Row)[key] : undefined;
    if (p.startsWith("->>") && v !== undefined && v !== null && typeof v !== "string") v = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return v;
};
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

function query(state: State, name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  let limit: number | null = null;
  let op: "select" | "update" | "delete" | "insert" | "upsert" = "select";
  let patch: Row | Row[] | null = null;
  let onConflict: string[] = [];
  let returning = false;
  const all = () => (state.tables[name] ??= []);
  const matches = () => all().filter((r) => filters.every((f) => f(r)));
  const exec = (): { data: unknown; error: unknown } => {
    if (op === "insert") {
      const rows = (Array.isArray(patch) ? patch : [patch!]).map((r): Row => ({ id: r.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      for (const r of rows) {
        if (name === "exchange_connections" && all().some((x) => x.user_id === r.user_id && x.exchange === r.exchange && x.label === r.label)) return { data: null, error: { code: "23505" } };
        if (name === "sync_runs") Object.assign(r, { started_at: r.started_at ?? new Date().toISOString(), fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0, meta: {} });
        if (name === "api_tokens") Object.assign(r, { revoked_at: null, last_used_at: null });
        if (name === "exchange_connections") Object.assign(r, { last_sync_at: null, last_error: null, meta: {} });
        all().push(r);
      }
      return { data: rows, error: null };
    }
    if (op === "upsert") {
      const r = patch as Row;
      const hit = all().find((x) => onConflict.every((k) => x[k] === r[k]));
      if (hit) Object.assign(hit, r);
      else all().push({ ...r });
      return { data: null, error: null };
    }
    if (op === "update") {
      const rows = matches();
      for (const r of rows) Object.assign(r, patch);
      return { data: rows, error: null };
    }
    if (op === "delete") {
      const rows = matches();
      state.tables[name] = all().filter((r) => !rows.includes(r));
      if (name === "exchange_connections") state.tables.sync_cursor = (state.tables.sync_cursor ?? []).filter((c) => !rows.some((r) => r.id === c.connection_id));
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    let rows = matches();
    for (const o of [...orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const va = getPath(a, o.col);
        const vb = getPath(b, o.col);
        if (va == null || vb == null) return va == null && vb == null ? 0 : (va == null ? -1 : 1) * (o.nullsFirst ? 1 : -1);
        return cmp(va, vb) * (o.asc ? 1 : -1);
      });
    }
    if (limit !== null) rows = rows.slice(0, limit);
    return { data: rows.map((r) => ({ ...r })), error: null };
  };
  const q = {
    select: () => ((returning = true), q),
    eq: (c: string, v: unknown) => (filters.push((r) => getPath(r, c) === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => getPath(r, c) !== v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(getPath(r, c))), q),
    gt: (c: string, v: unknown) => (filters.push((r) => cmp(getPath(r, c), v) > 0), q),
    gte: (c: string, v: unknown) => (filters.push((r) => cmp(getPath(r, c), v) >= 0), q),
    lt: (c: string, v: unknown) => (filters.push((r) => cmp(getPath(r, c), v) < 0), q),
    is: (c: string, v: unknown) => (filters.push((r) => (getPath(r, c) ?? null) === v), q),
    like: (c: string, p: string) => (filters.push((r) => new RegExp(`^${p.replace(/%/g, ".*")}$`).test(String(getPath(r, c) ?? ""))), q),
    order: (col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => (orders.push({ col, asc: o?.ascending !== false, nullsFirst: !!o?.nullsFirst }), q),
    limit: (n: number) => ((limit = n), q),
    insert: (r: Row | Row[]) => ((op = "insert"), (patch = r), q),
    update: (r: Row) => ((op = "update"), (patch = r), q),
    delete: () => ((op = "delete"), q),
    upsert: (r: Row, o?: { onConflict?: string }) => ((op = "upsert"), (patch = r), (onConflict = (o?.onConflict ?? "id").split(",")), q),
    maybeSingle: async () => {
      const r = exec();
      return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = exec();
      const row = (r.data as Row[] | null)?.[0] ?? null;
      return { data: row, error: r.error ?? (row ? null : { code: "PGRST116" }) };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      void returning;
      return Promise.resolve(exec()).then(res, rej);
    },
  };
  return q;
}

/** JS twin of public.upsert_synced_trade (0003_exchange.sql; the SQL itself is checked on PGlite). */
function upsertSynced(state: State, user: string, items: { id: string; set?: Row; fill?: Row; new?: Row }[]): Record<string, string> {
  const docs = (state.tables.journal_docs ??= []);
  const out: Record<string, string> = {};
  const nowIso = new Date().toISOString();
  const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  for (const it of items) {
    const cur = docs.find((d) => d.user_id === user && d.kind === "trade" && d.id === it.id);
    if (!cur) {
      docs.push({ user_id: user, kind: "trade", id: it.id, deleted: false, updated_at: nowIso, data: { ...it.new, ...it.fill, ...it.set, id: it.id, createdAt: (it.new?.createdAt as string) ?? nowIso, updatedAt: nowIso } });
      out[it.id] = "inserted";
      continue;
    }
    if (cur.deleted) {
      out[it.id] = "deleted";
      continue;
    }
    const merged: Row = { ...(cur.data as Row), ...it.set };
    for (const [k, v] of Object.entries(it.fill ?? {})) if (empty(merged[k])) merged[k] = v;
    const strip = (r: Row) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== "syncedAt" && k !== "updatedAt").sort(([a], [b]) => cmp(a, b))));
    if (strip(merged) === strip(cur.data as Row)) {
      out[it.id] = "unchanged";
      continue;
    }
    cur.data = { ...merged, updatedAt: nowIso };
    cur.updated_at = nowIso;
    out[it.id] = "updated";
  }
  return out;
}

function fakeAdmin(state: State): SupabaseClient {
  return {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      admin: { mfa: { listFactors: vi.fn(async () => ({ data: { factors: [] }, error: null })) } },
    },
    rpc: vi.fn(async (fn: string, args: Row) => {
      state.rpcCalls.push(fn);
      if (fn === "rate_hit") return { data: 1, error: null };
      if (fn === "upsert_synced_trades") return { data: upsertSynced(state, args.p_user as string, args.p_items as never), error: null };
      return { data: null, error: { code: "42883" } };
    }),
    from: (name: string) => query(state, name),
  } as unknown as SupabaseClient;
}

/* ------------------------------------------------------------------ Bitunix fake (verifies signatures) */

const officialSign = (apiKey: string, secret: string, nonce: string, ts: string, params: Record<string, string>) => {
  const qp = Object.keys(params).sort().map((k) => k + params[k]).join("");
  const digest = createHash("sha256").update(nonce + ts + apiKey + qp).digest("hex");
  return createHash("sha256").update(digest + secret).digest("hex");
};

interface Venue {
  key: string;
  secret: string;
  calls: string[];
  forceCode?: number;
  positions: Row[];
}

function venueRuntime(v: Venue) {
  return {
    now: () => Date.now(),
    sleep: async () => undefined,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const h = Object.fromEntries(new Headers(init?.headers).entries());
      const params = Object.fromEntries(url.searchParams.entries());
      v.calls.push(url.pathname);
      const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname !== "/api/v1/futures/market/tickers") {
        if (h["api-key"] !== v.key || h.sign !== officialSign(v.key, v.secret, h.nonce!, h.timestamp!, params)) return reply({ code: 10007, msg: "Sign signature error" });
        if (v.forceCode) return reply({ code: v.forceCode, msg: "x" });
      }
      const skip = Number(params.skip ?? 0);
      const limit = Number(params.limit ?? 10);
      switch (url.pathname) {
        case "/api/v1/futures/account":
          return reply(fixture("bitunix-account.json"));
        case "/api/v1/futures/position/get_history_positions": {
          const s = Number(params.startTime ?? 0);
          const e = Number(params.endTime ?? Infinity);
          const list = v.positions.filter((p) => Number(p.ctime) >= s && Number(p.ctime) <= e);
          return reply({ code: 0, data: { positionList: list.slice(skip, skip + limit), total: list.length } });
        }
        case "/api/v1/futures/trade/get_history_trades": {
          const list = params.positionId === "1846203915577018372" ? ((fixture("bitunix-history-trades.json").data as Row).tradeList as Row[]) : [];
          return reply({ code: 0, data: { tradeList: list.slice(skip, skip + limit), total: list.length } });
        }
        case "/api/v1/futures/tpsl/get_history_orders":
          return reply(fixture("bitunix-tpsl-history.json"));
        case "/api/v1/futures/position/get_pending_positions":
          return reply(fixture("bitunix-pending-positions.json"));
        case "/api/v1/futures/market/tickers":
          return reply({ code: 0, data: [{ symbol: "BTCUSDT", markPrice: "63920.5", lastPrice: "63921" }] });
        default:
          return reply({ code: 10002, msg: "Parameter Error" });
      }
    }) as typeof fetch,
  };
}

/* ------------------------------------------------------------------ helpers */

let state: State;
let venue: Venue;
const ORIGINAL_ENV = { ...process.env };

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://journal.test${path}`, {
    method,
    headers: { authorization: `Bearer ${JWT}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Row });

async function connect(over: Row = {}) {
  return read(await connectFn(req("POST", "/api/v1/exchange/connect", { exchange: "bitunix", apiKey: KEY, secret: SECRET, journalAccount: "makro", readOnlyConfirmed: true, ...over }), ctx()));
}

beforeEach(() => {
  process.env.EXCHANGE_ENC_KEY_V1 = randomBytes(32).toString("base64");
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.SYNC_CRON_ENABLED;
  state = { tables: { profiles: [{ id: U1, plan: "free", plan_status: "none", trial_end: null, tz: "Europe/Berlin" }] }, claims: { sub: U1, role: "authenticated", aal: "aal1" }, rpcCalls: [] };
  setSupabaseAdminForTests(fakeAdmin(state));
  venue = { key: KEY, secret: SECRET, calls: [], positions: (fixture("bitunix-history-positions.json").data as Row).positionList as Row[] };
  setAdapterRuntimeForTests(venueRuntime(venue));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  setSupabaseAdminForTests(null);
  setAdapterRuntimeForTests(null);
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ tests */

describe("connect / disconnect", () => {
  it("validates the key, stores it encrypted (AAD-bound), returns only the last 4 chars", async () => {
    const r = await connect();
    expect(r.status).toBe(201);
    expect(r.body.connection).toMatchObject({ exchange: "bitunix", keyLast4: KEY.slice(-4), journalAccount: "makro", status: "active", permissions: [] });
    expect(r.body.account).toEqual({ marginCoin: "USDT", available: 4182.37, margin: 1366.8, unrealizedPnl: -12.4 });
    const stored = state.tables.exchange_connections![0]!;
    expect(stored.api_key_enc).toMatch(/^v1:/);
    expect(JSON.stringify(state.tables)).not.toContain(SECRET);
    expect(JSON.stringify(state.tables)).not.toContain(KEY);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(state.tables.audit_log?.[0]).toMatchObject({ action: "exchange.connect", user_id: U1 });
    expect(venue.calls).toEqual(["/api/v1/futures/account"]);
  });

  it("a wrong secret → 422 with the German Bitunix message, nothing stored", async () => {
    venue.secret = "different-secret-value";
    const r = await connect();
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "bitunix_10007" });
    expect(String((r.body.error as Row).message)).toMatch(/Signatur ungültig/);
    expect(state.tables.exchange_connections ?? []).toHaveLength(0);
  });

  it("requires the read-only confirmation and a server encryption key", async () => {
    expect((await connect({ readOnlyConfirmed: false })).status).toBe(422);
    delete process.env.EXCHANGE_ENC_KEY_V1;
    const r = await connect();
    expect(r.status).toBe(503);
    expect(String((r.body.error as Row).message)).toMatch(/noch nicht eingerichtet/);
  });

  it("plan gate once payments are set up: Free has no exchange connection", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_1";
    expect((await connect()).status).toBe(402);
    state.tables.profiles![0]!.plan = "pro";
    state.tables.profiles![0]!.plan_status = "active";
    expect((await connect()).status).toBe(201);
    // Pro allows one connection
    expect((await connect({ label: "Zweitkonto" })).status).toBe(402);
  });

  it("other venues answer an honest 501 until phase 2", async () => {
    const r = await connect({ exchange: "binance" });
    expect(r.status).toBe(501);
    expect(String((r.body.error as Row).message)).toMatch(/CSV-Import/);
  });

  it("PATCH changes the journal account / auto sync; disconnect removes key + cursor, keeps trades", async () => {
    const id = ((await connect()).body.connection as Row).id as string;
    const p = await read(await connectFn(req("PATCH", "/api/v1/exchange/connect", { connectionId: id, journalAccount: "scalp", syncEnabled: false }), ctx()));
    expect(p.body.connection).toMatchObject({ journalAccount: "scalp", syncEnabled: false });
    await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx());
    const trades = state.tables.journal_docs!.length;
    const d = await read(await disconnectFn(req("POST", "/api/v1/exchange/disconnect", { connectionId: id }), ctx()));
    expect(d.body).toEqual({ ok: true });
    expect(state.tables.exchange_connections).toHaveLength(0);
    expect(state.tables.sync_cursor).toHaveLength(0);
    expect(state.tables.journal_docs).toHaveLength(trades);
    expect((await disconnectFn(req("POST", "/api/v1/exchange/disconnect", { connectionId: id }), ctx())).status).toBe(404);
  });
});

describe("sync", () => {
  const firstId = async () => ((await connect()).body.connection as Row).id as string;

  it("dry run: maps and checks, writes nothing to the journal, does not move the cursor", async () => {
    const id = await firstId();
    const r = await read(await syncFn(req("POST", "/api/v1/exchange/sync?dryRun=1", { connectionId: id, tz: "Europe/Berlin" }), ctx()));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, status: "ok", more: false, counts: { fetched: 5 } });
    expect((r.body.trades as Row[]).map((t) => t.id)).toContain("t_bx_1844291077356544000");
    expect(r.body.convention).toMatchObject({ feesIncluded: false, used: true });
    const check = (r.body.checks as Row[]).find((c) => c.externalId === "1844291077356544000")!;
    expect(check).toMatchObject({ state: "new", realizedPnl: 62, fee: 2.5048, funding: -0.3123, net: 59.1829, stop: 61200 });
    expect(state.tables.journal_docs ?? []).toHaveLength(0);
    expect(state.tables.sync_cursor ?? []).toHaveLength(0);
    expect(state.tables.sync_runs![0]).toMatchObject({ kind: "dry_run", status: "ok", fetched: 5 });
  });

  it("real sync: inserts with the journal account, a second sync changes nothing, trader edits survive", async () => {
    const id = await firstId();
    const r = await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id, tz: "Europe/Berlin" }), ctx()));
    expect(r.body.counts).toEqual({ fetched: 5, inserted: 5, updated: 0, unchanged: 0, skipped: 0 });
    expect(r.body.trades).toEqual([]);
    const doc = state.tables.journal_docs!.find((d) => d.id === "t_bx_1846203915577018372")!;
    expect(doc.data).toMatchObject({ account: "makro", pair: "BTC/USDT", side: "short", pnlManual: 39.94, origin: { kind: "api" } });
    expect((doc.data as Row).fills).toHaveLength(4);
    expect(state.tables.sync_cursor![0]).toMatchObject({ stream: "positions", connection_id: id });
    expect(state.tables.exchange_connections![0]).toMatchObject({ last_error: null, status: "active" });
    expect(typeof state.tables.exchange_connections![0]!.last_sync_at).toBe("string");

    // trader works on a trade
    const btc = state.tables.journal_docs!.find((d) => d.id === "t_bx_1844291077356544000")!;
    Object.assign(btc.data as Row, { notes: "Sauber nach Plan", setups: ["s_mtf"], emotion: "Ruhig", stop: 61500, account: "scalp" });
    state.tables.sync_runs = []; // no running-guard interference

    // incremental: the window starts at the oldest still-open position (pending fixture: 2026-10-11) → nothing new
    const inc = await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx()));
    expect(inc.body.counts).toMatchObject({ fetched: 0, inserted: 0 });
    expect((inc.body.window as Row).from).toBe(Date.parse("2026-10-11T12:00:00Z") - 3_600_000);
    state.tables.sync_runs = [];
    // re-read from a date: everything comes again and nothing changes
    const again = await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id, from: "2026-10-01T00:00:00Z" }), ctx()));
    expect(again.body.counts).toMatchObject({ fetched: 5, inserted: 0, unchanged: 5 });

    // the exchange corrects a number → only exchange fields change
    venue.positions = venue.positions.map((p) => (p.positionId === "1844291077356544000" ? { ...p, fee: "2.6", ctime: Date.now() - 3_600_000 } : p));
    state.tables.sync_runs = [];
    const upd = await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id, from: new Date(Date.parse("2026-10-01T00:00:00Z")).toISOString() }), ctx()));
    expect(upd.body.counts).toMatchObject({ updated: 1 });
    expect(btc.data).toMatchObject({ notes: "Sauber nach Plan", setups: ["s_mtf"], emotion: "Ruhig", stop: 61500, account: "scalp", fees: 2.6 });
  });

  it("a deleted synced trade is never resurrected", async () => {
    const id = await firstId();
    await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx());
    const doc = state.tables.journal_docs!.find((d) => d.id === "t_bx_1845710492211843077")!;
    Object.assign(doc, { deleted: true, data: { deletedAt: "x" } });
    state.tables.sync_runs = [];
    const r = await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id, from: "2026-10-01T00:00:00Z" }), ctx()));
    expect(r.body.counts).toMatchObject({ skipped: 1 });
    expect(doc.deleted).toBe(true);
  });

  it("a revoked key marks the connection invalid with the German reason", async () => {
    const id = await firstId();
    venue.forceCode = 10007;
    const r = await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx()));
    expect(r.status).toBe(422);
    expect(state.tables.exchange_connections![0]).toMatchObject({ status: "invalid" });
    expect(String(state.tables.exchange_connections![0]!.last_error)).toMatch(/Signatur/);
    expect(state.tables.sync_runs![0]).toMatchObject({ status: "error" });
  });

  it("refuses a second sync while one is running; 404 without a connection", async () => {
    expect((await syncFn(req("POST", "/api/v1/exchange/sync", {}), ctx())).status).toBe(404);
    const id = await firstId();
    state.tables.sync_runs = [{ id: crypto.randomUUID(), user_id: U1, connection_id: id, exchange: "bitunix", kind: "manual", status: "running", started_at: new Date().toISOString() }];
    const r = await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx()));
    expect(r.status).toBe(409);
  });

  it("status lists connections (no secrets), runs, cron and plan; pull returns server-written trades since a time", async () => {
    const id = await firstId();
    await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx());
    const s = await read(await syncFn(req("GET", "/api/v1/exchange/sync"), ctx()));
    expect(s.body).toMatchObject({ configured: true, cron: { enabled: true, everyMin: 30 }, plan: { entitled: true, gated: false } });
    expect(JSON.stringify(s.body)).not.toMatch(/_enc|secret/i);
    expect((s.body.runs as Row[])[0]).toMatchObject({ kind: "manual", status: "ok", inserted: 5, dryRun: false });
    const all = await read(await syncFn(req("GET", "/api/v1/exchange/sync?pull=1"), ctx()));
    expect((all.body.trades as Row[]).length).toBe(5);
    expect(typeof all.body.serverAt).toBe("string");
    const none = await read(await syncFn(req("GET", `/api/v1/exchange/sync?since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`), ctx()));
    expect(none.body.trades).toEqual([]);
  });

  it("the trades a device merges locally keep the trader's fields (mergeSyncedTrade)", async () => {
    const id = await firstId();
    await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx());
    const pulled = (await read(await syncFn(req("GET", "/api/v1/exchange/sync?pull=1"), ctx()))).body.trades as { id: string; data: Row }[];
    const incoming = pulled.find((t) => t.id === "t_bx_1844291077356544000")!.data;
    const local = { ...incoming, notes: "lokal", stop: 61000, fees: 1 };
    const merged = mergeSyncedTrade(local, incoming, "2026-10-12T08:00:00.000Z")!;
    expect(merged).toMatchObject({ notes: "lokal", stop: 61000, fees: 2.5048, updatedAt: "2026-10-12T08:00:00.000Z" });
    expect(mergeSyncedTrade(merged, incoming, "x")).toBeNull();
    expect(SYNC_FILL_KEYS).toContain("stop");
  });
});

describe("positions, backfill, cron", () => {
  it("positions: live open positions with mark price, plan-gated", async () => {
    await connect();
    const r = await read(await positionsFn(req("GET", "/api/v1/exchange/positions"), ctx()));
    expect(r.body.errors).toEqual([]);
    expect((r.body.positions as Row[]).map((p) => [p.symbol, p.side, p.mark])).toEqual([
      ["BTCUSDT", "long", 63920.5],
      ["ETHUSDT", "short", 2475.5],
    ]);
  });

  it("backfill: first import from a date under the client's run id", async () => {
    const id = ((await connect()).body.connection as Row).id as string;
    const runId = crypto.randomUUID();
    const r = await read(await backfillFn(req("POST", "/api/v1/exchange/backfill", { connectionId: id, from: "2026-09-01T00:00:00.000Z", runId }), ctx()));
    expect(r.body).toEqual({ ok: true, runId });
    expect(state.tables.sync_runs!.find((x) => x.id === runId)).toMatchObject({ kind: "backfill", status: "ok", inserted: 5 });
  });

  it("cron: syncs due connections, skips fresh ones and switched-off auto sync", async () => {
    const id = ((await connect()).body.connection as Row).id as string;
    let s = await runExchangeCron();
    expect(s).toMatchObject({ enabled: true, synced: 1, failed: 0 });
    expect(state.tables.sync_runs!.at(-1)).toMatchObject({ kind: "cron", status: "ok" });
    s = await runExchangeCron();
    expect(s).toMatchObject({ synced: 0, skipped: 1 });
    await connectFn(req("PATCH", "/api/v1/exchange/connect", { connectionId: id, syncEnabled: false }), ctx());
    s = await runExchangeCron();
    expect(s.considered).toBe(0);
    process.env.SYNC_CRON_ENABLED = "0";
    expect((await runExchangeCron()).enabled).toBe(false);
  });
});

describe("API tokens, REST, TradingView webhook", () => {
  async function token(scopes: string[]) {
    const r = await read(await tradesFn(req("POST", "/api/v1/trades/tokens", { name: "Bot", scopes }), ctx()));
    expect(r.status).toBe(201);
    return r.body.token as string;
  }

  it("tokens: created once in plain, listed without hash, revocable", async () => {
    const t = await token(["trades:read"]);
    expect(t).toMatch(/^tj_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(state.tables.api_tokens)).not.toContain(t);
    const list = await read(await tradesFn(req("GET", "/api/v1/trades/tokens"), ctx()));
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/token_hash|tj_[A-Za-z0-9_-]{20,}/);
    const tid = ((list.body.tokens as Row[])[0]!).id as string;
    expect((await tradesFn(req("DELETE", `/api/v1/trades/tokens/${tid}`), ctx())).status).toBe(200);
    const after = await tradesFn(new Request("https://journal.test/api/v1/trades", { headers: { authorization: `Bearer ${t}` } }), ctx());
    expect(after.status).toBe(401);
  });

  it("REST: read with trades:read, create idempotently with trades:write, scopes enforced", async () => {
    const rw = await token(["trades:read", "trades:write"]);
    const ro = await token(["trades:read"]);
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
    const body = { externalId: "bot-42", pair: "BTC/USDT", side: "long", date: "2026-10-12T09:00", entry: 64000, exit: 64500, size: 6400, pnlManual: 50, notes: "Grid-Bot" };
    const c1 = await read(await tradesFn(new Request("https://journal.test/api/v1/trades", { method: "POST", headers: { ...auth(rw), "content-type": "application/json" }, body: JSON.stringify(body) }), ctx()));
    expect(c1).toMatchObject({ status: 201, body: { id: "t_api_bot-42", created: true } });
    const c2 = await read(await tradesFn(new Request("https://journal.test/api/v1/trades", { method: "POST", headers: { ...auth(rw), "content-type": "application/json" }, body: JSON.stringify({ ...body, notes: "anders" }) }), ctx()));
    expect(c2.body.created).toBe(false);
    const denied = await tradesFn(new Request("https://journal.test/api/v1/trades", { method: "POST", headers: { ...auth(ro), "content-type": "application/json" }, body: JSON.stringify(body) }), ctx());
    expect(denied.status).toBe(403);
    const list = await read(await tradesFn(new Request("https://journal.test/api/v1/trades?limit=10", { headers: auth(ro) }), ctx()));
    expect((list.body.trades as Row[])[0]).toMatchObject({ id: "t_api_bot-42", notes: "Grid-Bot", origin: { kind: "bot", botId: "Bot" } });
    const one = await read(await tradesFn(new Request("https://journal.test/api/v1/trades/t_api_bot-42", { headers: auth(ro) }), ctx()));
    expect(one.body.trade).toMatchObject({ pnlManual: 50 });
    expect((await tradesFn(new Request("https://journal.test/api/v1/trades"), ctx())).status).toBe(401);
  });

  it("TradingView: open matches the setup name, close by id; re-delivery changes nothing", async () => {
    state.tables.journal_docs = [{ user_id: U1, kind: "settings", id: "settings", deleted: false, data: { setups: [{ id: "s_box", name: "Box-Breakout" }] } }];
    const t = await token(["webhook:tradingview"]);
    const hook = (b: unknown) => hookFn(new Request(`https://journal.test/api/v1/hooks/tradingview/${t}`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(b) }), ctx({ token: t }));
    const open = await read(await hook({ action: "open", id: "L1", symbol: "BINANCE:BTCUSDT.P", side: "long", price: 64000, stop: 63000, target: 66000, setup: "box-breakout", timeframe: "240" }));
    expect(open.body).toMatchObject({ ok: true, result: "created" });
    const doc = state.tables.journal_docs!.find((d) => d.id === open.body.id)!;
    expect(doc.data).toMatchObject({ pair: "BTC/USDT", side: "long", status: "open", entry: 64000, stop: 63000, target: 66000, setups: ["s_box"], timeframe: "4h", origin: { kind: "webhook" } });
    expect((await read(await hook({ action: "open", id: "L1", symbol: "BTCUSDT", side: "long", price: 1 }))).body.result).toBe("exists");
    const close = await read(await hook({ action: "close", id: "L1", symbol: "BTCUSDT", price: 65500 }));
    expect(close.body).toMatchObject({ result: "closed" });
    expect(doc.data).toMatchObject({ status: "closed", exit: 65500, entry: 64000 });
    expect((await hook({ action: "close", id: "nope", symbol: "BTCUSDT", price: 1 })).status).toBe(404);
    const bad = await read(await hookFn(new Request(`https://journal.test/api/v1/hooks/tradingview/${t}`, { method: "POST", body: "BTC long now!" }), ctx({ token: t })));
    expect(bad.status).toBe(422);
    expect((await hookFn(new Request("https://journal.test/api/v1/hooks/tradingview/tj_wrong", { method: "POST", body: "{}" }), ctx({ token: "tj_wrong" }))).status).toBe(401);
  });
});
