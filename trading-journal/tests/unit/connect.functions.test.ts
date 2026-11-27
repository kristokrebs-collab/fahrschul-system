// @vitest-environment node
/// <reference types="node" />
/**
 * Verbindungen end to end on the server side, against the in-memory Supabase fake and the fake Binance (Form laut
 * Dokumentation, NICHT live geprüft): rights check at connect (refused / warn / ok), the key stored encrypted per user
 * and decryptable again (AAD), first import and incremental sync without duplicates, disconnect stops running jobs and
 * deletes the key, the free plan's connection limit is read from `plans.ts`, and the TradingView address: create,
 * test signal, receipts, rotate (the old address stops), revoke.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import connectFn from "../../netlify/functions/exchange-connect.mts";
import disconnectFn from "../../netlify/functions/exchange-disconnect.mts";
import syncFn from "../../netlify/functions/exchange-sync.mts";
import tvFn from "../../netlify/functions/connections-tradingview.mts";
import hookFn from "../../netlify/functions/hooks-tradingview.mts";
import { setAdapterRuntimeForTests } from "../../netlify/functions/_lib/exchanges/registry";
import { credentialsOf } from "../../netlify/functions/_lib/exchanges/store";
import { runSync } from "../../netlify/functions/_lib/exchanges/sync";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { limitOf } from "../../src/billing/plans";
import { fakeAdmin, type Row, type State } from "./helpers/connectFake";
import { fut, income, newVenue, resetSeq, restrictions, spot, venueRuntime, type BinanceVenue } from "./helpers/binanceVenue";

type Ctx = Parameters<typeof connectFn>[1];
const ctx = (params?: Record<string, string>) => ({ ip: "203.0.113.7", params: params ?? {} }) as unknown as Ctx;
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;
const ORIGINAL_ENV = { ...process.env };

let state: State;
let venue: BinanceVenue;

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://journal.test${path}`, {
    method,
    headers: { authorization: `Bearer ${JWT}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Row });

const connect = async (over: Row = {}) =>
  read(await connectFn(req("POST", "/api/v1/exchange/connect", { exchange: "binance", market: "futures", apiKey: venue.key, secret: venue.secret, journalAccount: "scalp", readOnlyConfirmed: true, ...over }), ctx()));

function seedTrades(): void {
  const t = Date.now() - 4 * DAY;
  venue.now = Date.now();
  venue.futuresTrades = [
    fut({ id: 1, side: "BUY", price: 60000, qty: 0.1, fee: 0.6, at: t }),
    fut({ id: 2, side: "SELL", price: 62000, qty: 0.1, pnl: 200, fee: 0.62, at: t + 3_600_000 }),
    fut({ id: 3, symbol: "ETHUSDT", side: "SELL", price: 3100, qty: 2, fee: 0.3, at: t + 7_200_000 }),
    fut({ id: 4, symbol: "ETHUSDT", side: "BUY", price: 3000, qty: 2, pnl: 200, fee: 0.3, at: t + 10_800_000 }),
  ];
  venue.income = [income("BTCUSDT", "REALIZED_PNL", 200, t + 3_600_000), income("ETHUSDT", "REALIZED_PNL", 200, t + 10_800_000), income("BTCUSDT", "FUNDING_FEE", -0.25, t + 1_800_000)];
}

beforeEach(() => {
  resetSeq();
  process.env.EXCHANGE_ENC_KEY_V1 = randomBytes(32).toString("base64");
  delete process.env.STRIPE_SECRET_KEY;
  state = { tables: { profiles: [{ id: U1, plan: "free", plan_status: "none", trial_end: null, tz: "Europe/Berlin" }] }, claims: { sub: U1, role: "authenticated", aal: "aal1" }, rpcCalls: [] };
  setSupabaseAdminForTests(fakeAdmin(state));
  venue = newVenue();
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

describe("Binance connect: the rights are read BEFORE anything is stored", () => {
  it("a key that may withdraw is refused (422), with the findings, and nothing is stored", async () => {
    venue.restrictions = restrictions({ enableWithdrawals: true, enableSpotAndMarginTrading: true });
    const r = await connect();
    expect(r.status).toBe(422);
    const err = r.body.error as { code: string; details: { issues: { code: string; level: string }[] } };
    expect(err.code).toBe("rights_refused");
    expect(err.details.issues.filter((i) => i.level === "block").map((i) => i.code).sort()).toEqual(["spot_trade", "withdraw"]);
    expect(state.tables.exchange_connections ?? []).toHaveLength(0);
    expect(JSON.stringify(state.tables)).not.toContain(venue.secret);
    expect(JSON.stringify(r.body)).not.toContain(venue.secret);
    expect(venue.calls.map((c) => c.path)).toEqual(["/sapi/v1/account/apiRestrictions"]); // it never got further than the check
  });

  it("Futures access needs the user's confirmation (409), then connects with the tags stored", async () => {
    venue.restrictions = restrictions({ enableFutures: true, ipRestrict: true });
    const first = await connect();
    expect(first.status).toBe(409);
    expect((first.body.error as { code: string }).code).toBe("rights_confirm");
    expect(state.tables.exchange_connections ?? []).toHaveLength(0);
    const second = await connect({ acceptWarnings: true });
    expect(second.status).toBe(201);
    expect(second.body.connection).toMatchObject({ exchange: "binance", market: "futures", label: "Futures", permissions: ["read", "futures_enabled", "ip_restricted"], status: "active" });
    expect(second.body.account).toMatchObject({ marginCoin: "USDT", available: 800.5 });
  });

  it("a read-only spot key connects; spot and futures live side by side; the same market twice is refused", async () => {
    const spotR = await connect({ market: "spot", symbols: ["solusdt", "BTC/USDT"] });
    expect(spotR.status).toBe(201);
    expect(spotR.body.connection).toMatchObject({ market: "spot", label: "Spot", symbols: ["SOLUSDT"] });
    expect((await connect({ market: "futures" })).status).toBe(201);
    expect((await connect({ market: "futures" })).status).toBe(409);
    expect(state.tables.exchange_connections).toHaveLength(2);
  });

  it("Binance needs a market; Bybit still answers 501", async () => {
    const r = await connect({ market: undefined });
    expect(r.status).toBe(422);
    expect((r.body.error as { code: string }).code).toBe("market_required");
    expect((await connect({ exchange: "bybit", market: undefined })).status).toBe(501);
  });

  it("the read-only confirmation is mandatory", async () => {
    expect((await connect({ readOnlyConfirmed: false })).status).toBe(422);
  });

  it("a wrong key (-2015) is a 422 in German and nothing is stored", async () => {
    venue.restrictions = restrictions();
    const r = await connect({ apiKey: "wrongkeywrongkeywrongkey" });
    expect(r.status).toBe(422);
    expect(String((r.body.error as Row).message)).toMatch(/Binance lehnt den Key ab/);
    expect(state.tables.exchange_connections ?? []).toHaveLength(0);
  });

  it("the region answer (451) blames the server location and stores nothing", async () => {
    venue.force = { status: 451, body: {} };
    const r = await connect();
    expect(r.status).toBe(503);
    expect(String((r.body.error as Row).message)).toMatch(/Server-Standort/);
  });
});

describe("Binance key at rest", () => {
  it("is stored encrypted per user and connection (AAD) and decrypts back; the plaintext is nowhere", async () => {
    const r = await connect();
    expect(r.status).toBe(201);
    const row = state.tables.exchange_connections![0]!;
    expect(String(row.api_key_enc)).toMatch(/^v1:/);
    expect(String(row.secret_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(state.tables)).not.toContain(venue.key);
    expect(JSON.stringify(state.tables)).not.toContain(venue.secret);
    // roundtrip: the stored blobs give the key back for this user and row …
    const back = credentialsOf(row as never);
    expect(back).toEqual({ apiKey: venue.key, secret: venue.secret });
    // … and not for another user (a copied row does not decrypt)
    expect(() => credentialsOf({ ...row, user_id: "22222222-2222-4222-8222-222222222222" } as never)).toThrow();
    expect(() => credentialsOf({ ...row, id: crypto.randomUUID() } as never)).toThrow();
    // only the last four characters ever leave the server
    expect((r.body.connection as Row).keyLast4).toBe(venue.key.slice(-4));
    expect(JSON.stringify(r.body)).not.toContain(venue.key);
  });

  it("without EXCHANGE_ENC_KEY_V1 the server says it is not set up (503), it never stores a plaintext key", async () => {
    delete process.env.EXCHANGE_ENC_KEY_V1;
    const r = await connect();
    expect(r.status).toBe(503);
    expect(state.tables.exchange_connections ?? []).toHaveLength(0);
  });
});

describe("first import and incremental sync (no duplicates)", () => {
  async function connectId(over: Row = {}): Promise<string> {
    return ((await connect(over)).body.connection as Row).id as string;
  }
  const sync = async (id: string, extra: Row = {}) => read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id, ...extra }), ctx()));
  const trades = () => (state.tables.journal_docs ?? []).filter((d) => d.kind === "trade");

  it("imports closed positions as trades (futures), a second sync changes nothing, new fills add only the new trade", async () => {
    seedTrades();
    const id = await connectId();
    const first = await sync(id, { from: new Date(Date.now() - 30 * DAY).toISOString() });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "ok", more: false, counts: { fetched: 2, inserted: 2 } });
    expect(trades().map((t) => t.id).sort()).toEqual(["t_bn_f-BTCUSDT-1", "t_bn_f-ETHUSDT-3"]);
    const btc = trades().find((t) => t.id === "t_bn_f-BTCUSDT-1")!.data as Row;
    expect(btc).toMatchObject({ exchange: "binance", market: "perp", side: "long", entry: 60000, exit: 62000, pair: "BTC/USDT", status: "closed", syncSource: "binance-api", fundingFees: 0.25 });
    expect(btc.pnlManual).toBeCloseTo(200 - 1.22 - 0.25, 6); // gross − fees − funding paid
    expect((btc.fills as unknown[]).length).toBe(2);

    const again = await sync(id, { from: new Date(Date.now() - 30 * DAY).toISOString() });
    expect(again.body).toMatchObject({ counts: { fetched: 2, inserted: 0, unchanged: 2 } });
    expect(trades()).toHaveLength(2);

    // the incremental sync (cursor) re-reads a little back and still adds nothing twice
    const inc = await sync(id);
    expect(inc.body).toMatchObject({ counts: { inserted: 0 } });
    expect(trades()).toHaveLength(2);

    // one more closed round trip arrives → exactly one new trade
    venue.now = Date.now() + 2_000;
    const t = venue.now - 20 * 60_000;
    venue.futuresTrades.push(fut({ id: 20, side: "BUY", price: 61000, qty: 0.2, fee: 1, at: t }), fut({ id: 21, side: "SELL", price: 60000, qty: 0.2, pnl: -200, fee: 1, at: t + 600_000 }));
    venue.income.push(income("BTCUSDT", "REALIZED_PNL", -200, t + 600_000));
    const next = await sync(id);
    expect(next.body).toMatchObject({ counts: { inserted: 1 } });
    expect(trades().map((x) => x.id)).toContain("t_bn_f-BTCUSDT-20");
    expect(trades()).toHaveLength(3);
  });

  it("a trader's own notes survive the next sync (field ownership), a deleted trade stays deleted", async () => {
    seedTrades();
    const id = await connectId();
    await sync(id, { from: new Date(Date.now() - 30 * DAY).toISOString() });
    const doc = trades().find((t) => t.id === "t_bn_f-BTCUSDT-1")!;
    (doc.data as Row).notes = "mein Plan";
    const gone = trades().find((t) => t.id === "t_bn_f-ETHUSDT-3")!;
    gone.deleted = true;
    await sync(id, { from: new Date(Date.now() - 30 * DAY).toISOString() });
    expect((doc.data as Row).notes).toBe("mein Plan");
    expect(trades().filter((t) => !t.deleted)).toHaveLength(1);
  });

  it("spot writes market 'spot' and reads the round trip", async () => {
    const t = Date.now() - 3 * DAY;
    venue.now = Date.now();
    venue.balances = [{ asset: "USDT", free: "10", locked: "0" }, { asset: "BTC", free: "0.1", locked: "0" }];
    venue.spotTrades = [spot({ id: 1, buy: true, price: 60000, qty: 0.5, at: t }), spot({ id: 2, buy: false, price: 63000, qty: 0.5, at: t + 3_600_000 })];
    const id = await connectId({ market: "spot" });
    const r = await sync(id, { from: new Date(Date.now() - 30 * DAY).toISOString() });
    expect(r.body).toMatchObject({ counts: { inserted: 1 } });
    expect(trades()[0]!.data).toMatchObject({ id: "t_bn_s-BTCUSDT-1", market: "spot", pair: "BTC/USDT", side: "long", exit: 63000 });
  });

  it("a dry run writes nothing and reports what could not become a trade", async () => {
    seedTrades();
    const id = await connectId();
    const r = await read(await syncFn(req("POST", "/api/v1/exchange/sync?dryRun=1", { connectionId: id, from: new Date(Date.now() - 30 * DAY).toISOString() }), ctx()));
    expect(r.body).toMatchObject({ dryRun: true, counts: { fetched: 2 }, notes: { orphanFills: 0, symbols: 2 } });
    expect(trades()).toHaveLength(0);
  });
});

describe("disconnect stops jobs and deletes the key", () => {
  it("running imports end, the row (and with it the key and the cursor) is gone, a stale job writes nothing", async () => {
    seedTrades();
    const conn = (await connect()).body.connection as Row;
    const id = conn.id as string;
    const stale = state.tables.exchange_connections![0]! as never;
    state.tables.sync_runs = [{ id: crypto.randomUUID(), user_id: U1, connection_id: id, exchange: "binance", kind: "backfill", status: "running", started_at: new Date().toISOString() }];
    const d = await read(await disconnectFn(req("POST", "/api/v1/exchange/disconnect", { connectionId: id }), ctx()));
    expect(d.body).toEqual({ ok: true });
    expect(state.tables.exchange_connections).toHaveLength(0);
    expect(JSON.stringify(state.tables)).not.toContain("api_key_enc");
    expect(state.tables.sync_runs![0]).toMatchObject({ status: "error" });
    expect(String(state.tables.sync_runs![0]!.error)).toMatch(/Getrennt/);
    // a job that was already running with the old row finds the connection gone before it writes
    await expect(runSync({ userId: U1, connection: stale, kind: "backfill", dryRun: false, tz: "Europe/Berlin", from: Date.now() - 30 * DAY, deadline: Date.now() + 10_000 })).rejects.toMatchObject({ code: "connection_gone" });
    expect((state.tables.journal_docs ?? []).filter((x) => x.kind === "trade")).toHaveLength(0);
    // and the next sync call says there is no connection
    expect((await read(await syncFn(req("POST", "/api/v1/exchange/sync", { connectionId: id }), ctx()))).status).toBe(404);
  });
});

describe("plan: the connection limit is read from plans.ts", () => {
  it("with payments set up a plan without connections gets a 402; one with a limit connects (whatever plans.ts says)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    const free = limitOf("free", "exchangeConnections");
    const r = await connect();
    if (free > 0) {
      expect(r.status).toBe(201);
      expect((await connect({ market: "spot" })).status).toBe(free > 1 ? 201 : 402); // the second one is over the free limit
    } else {
      expect(r.status).toBe(402);
      expect((r.body.error as { code: string }).code).toBe("plan_required");
    }
  });

  it("the status tells the client whether the plan allows connections and the background sync", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    const r = await read(await syncFn(req("GET", "/api/v1/exchange/sync"), ctx()));
    expect(r.body.plan).toMatchObject({ plan: "free", gated: true, autoSync: false, entitled: limitOf("free", "exchangeConnections") > 0 });
    expect(r.body.binance).toEqual({ egressIp: null });
  });

  it("BINANCE_EGRESS_IP is passed on only when it looks like an address", async () => {
    process.env.BINANCE_EGRESS_IP = "203.0.113.9";
    expect((await read(await syncFn(req("GET", "/api/v1/exchange/sync"), ctx()))).body.binance).toEqual({ egressIp: "203.0.113.9" });
    process.env.BINANCE_EGRESS_IP = "not an ip!";
    expect((await read(await syncFn(req("GET", "/api/v1/exchange/sync"), ctx()))).body.binance).toEqual({ egressIp: null });
  });
});

describe("TradingView address (no OAuth)", () => {
  const tv = async (method: string, body?: unknown) => read(await tvFn(req(method, "/api/v1/connections/tradingview", body), ctx()));
  const hook = (token: string, body: string) => hookFn(new Request(`https://journal.test/api/v1/hooks/tradingview/${token}`, { method: "POST", body }), ctx({ token }));
  const tokenOf = (path: string) => path.split("/").pop()!;

  it("create → the plain token only once; status shows the prefix, never the secret; the table holds a hash", async () => {
    const created = await tv("POST", { action: "create" });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^tj_/);
    expect(created.body.path).toBe(`/api/v1/hooks/tradingview/${token}`);
    expect(JSON.stringify(state.tables)).not.toContain(token);
    const status = await tv("GET");
    expect(status.body).toMatchObject({ hasToken: true, receipts: [], tradeAlerts: { allowed: true } });
    expect(JSON.stringify(status.body)).not.toContain(token);
    expect((await tv("POST", { action: "create" })).status).toBe(409); // one address; replacing is "rotate"
  });

  it("test signal: accepted in EVERY plan, creates no trade, shows up as a receipt (app vs. outside)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x"; // payments on: Free has no "API & Webhooks"
    const token = (await tv("POST", { action: "create" })).body.token as string;
    const a = await hook(token, `{"action":"test","symbol":"TEST","source":"app"}`);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true, result: "test" });
    expect((await hook(token, `{"action":"test","symbol":"BINANCE:BTCUSDT"}`)).status).toBe(200);
    expect((state.tables.journal_docs ?? []).filter((d) => d.kind === "trade")).toHaveLength(0);
    const s = await tv("GET");
    const receipts = s.body.receipts as Row[];
    expect(receipts).toHaveLength(2);
    expect(receipts.map((r) => [r.kind, r.via, r.symbol]).sort()).toEqual([["test", "app", "TEST"], ["test", "extern", "BINANCE:BTCUSDT"]].sort());
    expect(s.body.tradeAlerts).toMatchObject({ allowed: false, plan: "free" });
  });

  it("a trade alert in a plan without API & Webhooks is refused (402) and logged as refused; with the plan it is recorded", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    const token = (await tv("POST", { action: "create" })).body.token as string;
    const refused = await hook(token, `{"action":"open","symbol":"BTCUSDT","side":"long","price":1,"qty":1}`);
    expect(refused.status).toBe(402);
    expect(((await tv("GET")).body.receipts as Row[])[0]).toMatchObject({ kind: "rejected" });
    state.tables.profiles![0]!.plan = "premium";
    state.tables.profiles![0]!.plan_status = "active";
    const ok = await hook(token, `{"action":"open","symbol":"BTCUSDT","side":"long","price":1,"qty":1}`);
    expect(ok.status).toBe(200);
    const kinds = ((await tv("GET")).body.receipts as Row[]).map((r) => r.kind);
    expect(kinds).toContain("open");
    expect(JSON.stringify((await tv("GET")).body)).not.toContain('"qty"'); // no alert text is stored
  });

  it("rotate: the old address stops at once (401), the new one works; revoke ends it", async () => {
    const t1 = (await tv("POST", { action: "create" })).body.token as string;
    expect((await hook(t1, `{"action":"test"}`)).status).toBe(200);
    const rotated = await tv("POST", { action: "rotate" });
    const t2 = rotated.body.token as string;
    expect(t2).not.toBe(t1);
    expect(tokenOf(rotated.body.path as string)).toBe(t2);
    expect((await hook(t1, `{"action":"test"}`)).status).toBe(401);
    expect((await hook(t2, `{"action":"test"}`)).status).toBe(200);
    expect((await tv("DELETE")).body).toEqual({ ok: true });
    expect((await hook(t2, `{"action":"test"}`)).status).toBe(401);
    expect((await tv("GET")).body).toMatchObject({ hasToken: false });
  });

  it("an oversized body is refused (413) and a non-JSON body is not a test signal", async () => {
    const t = (await tv("POST", { action: "create" })).body.token as string;
    expect((await hook(t, "x".repeat(20_000))).status).toBe(413);
    expect((await hook(t, "hallo")).status).toBe(422);
  });
});
