// @vitest-environment node
/// <reference types="node" />
/**
 * Signal receiver end to end on the server side (B3), against the in-memory Supabase fake (the SQL itself – unique index, RLS – is checked
 * on PGlite in `supabase.signals.test.ts`): schema → stored row, Dedup per (user, source, signalId), the parallel double delivery, rejected
 * bodies with their reason, size limit (declared and streamed), rate limits per token and per address, the UNIFORM answer to a wrong token
 * (wrong shape / unknown / revoked / wrong scope), the token never in a response, a log or a table, the older hook taking the new formats,
 * retention, a missing table, and the card's list (`GET /connections/tradingview`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tvFn from "../../netlify/functions/connections-tradingview.mts";
import hookFn from "../../netlify/functions/hooks-tradingview.mts";
import signalsFn from "../../netlify/functions/signals-receive.mts";
import { createToken } from "../../netlify/functions/_lib/exchanges/tokens";
import { KEEP_OTHER, KEEP_TESTS } from "../../netlify/functions/_lib/signals/store";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { fakeAdmin, type Row, type State } from "./helpers/connectFake";

type Ctx = Parameters<typeof signalsFn>[1];
const ctx = (token: string, ip = "203.0.113.7") => ({ ip, params: { token } }) as unknown as Ctx;
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_ENV = { ...process.env };
const NOW = Date.parse("2026-11-07T12:00:00Z");

let state: State;
let tokenA: string;
let tokenB: string;
let logs: string[];

const post = (token: string, body: string, headers: Record<string, string> = {}) =>
  signalsFn(new Request(`https://journal.test/api/v1/signals/${token}`, { method: "POST", body, headers: { "content-type": "text/plain", ...headers } }), ctx(token));
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Row });
const v1 = (over: Record<string, unknown> = {}) => JSON.stringify({ schema: "signal/1", source: "tradingview", signalId: "s-1", strategy: "trend", symbol: "XLE", direction: "long", time: "2026-11-06T21:00:00Z", ...over });
const bt = (over: Record<string, unknown> = {}) => JSON.stringify({ schema: "branchen-trend/1", strategie: "s-20-40-2.8-0.02-2.0", signal: "KAUF", symbol: "XLE", datum: "2026-11-06T00:00:00Z", kurs: 91.2, modus: "DEMO/PAPIER", ...over });
const rows = (user = U1) => (state.tables.signals ?? []).filter((r) => r.user_id === user);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete process.env.STRIPE_SECRET_KEY;
  state = { tables: { profiles: [{ id: U1, plan: "free", plan_status: "none", trial_end: null, tz: "Europe/Berlin" }] }, claims: { sub: U1, role: "authenticated", aal: "aal1" }, rpcCalls: [] };
  setSupabaseAdminForTests(fakeAdmin(state));
  tokenA = (await createToken(U1, "TradingView-Assistent", ["webhook:tradingview"])).token;
  tokenB = (await createToken(U2, "TradingView-Assistent", ["webhook:tradingview"])).token;
  logs = [];
  for (const m of ["error", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});

afterEach(() => {
  vi.useRealTimers();
  setSupabaseAdminForTests(null);
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("receiving", () => {
  it("a signal/1 is stored for its owner, answered 200 processed, and the row has no body, token or size", async () => {
    const r = await read(await post(tokenA, v1({ market: "AMEX", data: { kurs: 91 } })));
    expect(r).toEqual({ status: 200, body: { ok: true, result: "processed", signalId: "s-1" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ user_id: U1, source: "tradingview", signal_id: "s-1", kind: "signal", status: "processed", schema_id: "signal/1", symbol: "XLE", direction: "long", market: "AMEX", via: "extern" });
    expect(JSON.stringify(state.tables.signals)).not.toContain(tokenA);
    expect(JSON.stringify(Object.keys(rows()[0]!))).not.toMatch(/qty|size|body|token/i);
    expect(rows(U2)).toHaveLength(0);
  });

  it("the same signal again is a DUPLICATE: 200 (the sender must not retry), one processed row, the delivery remembered", async () => {
    await post(tokenA, v1());
    const again = await read(await post(tokenA, v1()));
    expect(again).toEqual({ status: 200, body: { ok: true, result: "duplicate", signalId: "s-1" } });
    expect(rows().filter((r) => r.status === "processed")).toHaveLength(1);
    expect(rows().filter((r) => r.status === "duplicate")).toHaveLength(1);
    expect(rows().find((r) => r.status === "duplicate")).toMatchObject({ reason: expect.stringContaining("schon angekommen") });
  });

  it("two deliveries at the same moment end in ONE processed signal (the unique key decides)", async () => {
    const [a, b] = await Promise.all([post(tokenA, v1({ signalId: "race" })), post(tokenA, v1({ signalId: "race" }))]);
    const results = [(await a.json()) as Row, (await b.json()) as Row].map((x) => x.result).sort();
    expect(results).toEqual(["duplicate", "processed"]);
    expect(rows().filter((r) => r.status === "processed" && r.signal_id === "race")).toHaveLength(1);
  });

  it("dedup is per user and per source: the same id for another user or another source is a new signal", async () => {
    await post(tokenA, v1());
    expect(((await read(await post(tokenB, v1()))).body as Row).result).toBe("processed");
    expect(((await read(await post(tokenA, v1({ source: "n8n" })))).body as Row).result).toBe("processed");
    expect(((await read(await post(tokenA, v1({ signalId: "s-2" })))).body as Row).result).toBe("processed");
    expect(rows(U2)).toHaveLength(1);
  });

  it("Branchen-Trend: the alert as the Pine script sends it; a re-delivery on another hour is a duplicate (id from the day)", async () => {
    expect((await read(await post(tokenA, bt()))).body).toMatchObject({ result: "processed" });
    expect(rows()[0]).toMatchObject({ schema_id: "branchen-trend/1", direction: "long", strategy: "s-20-40-2.8-0.02-2.0", data: { zustand: "gruen", kurs: 91.2, modus: "DEMO/PAPIER" } });
    expect((await read(await post(tokenA, bt({ datum: "2026-11-06T18:00:00Z" })))).body).toMatchObject({ result: "duplicate" });
    expect((await read(await post(tokenA, bt({ signal: "VERKAUF" })))).body).toMatchObject({ result: "processed" });
    expect(rows().filter((r) => r.status === "processed").map((r) => (r.data as Row).zustand)).toEqual(["gruen", "rot"]);
  });

  it("the older message {action: open} is accepted through the adapter (no journal trade, quantity not stored)", async () => {
    const r = await read(await post(tokenA, JSON.stringify({ action: "open", symbol: "BTCUSDT", side: "long", price: 61000, qty: 3 })));
    expect(r.body).toMatchObject({ ok: true, result: "processed" });
    expect(rows()[0]).toMatchObject({ schema_id: "legacy-action", direction: "long" });
    expect(JSON.stringify(rows())).not.toContain('"qty"');
    expect((state.tables.journal_docs ?? []).filter((d) => d.kind === "trade")).toHaveLength(0);
  });

  it("the test signal is recorded as a test (no dedup, no direction); the app's own marks via=app", async () => {
    await post(tokenA, `{"action":"test","symbol":"TEST","source":"app"}`);
    await post(tokenA, `{"action":"test","symbol":"TEST","source":"app"}`);
    expect(rows().filter((r) => r.kind === "test")).toHaveLength(2);
    expect(rows()[0]).toMatchObject({ kind: "test", via: "app", status: "processed", direction: null, signal_id: null });
  });

  it("a refused body: 422 with the reason, recorded as rejected with that reason (no body kept)", async () => {
    const r = await read(await post(tokenA, v1({ direction: "short", qty: 5 })));
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: { code: "invalid_signal" } });
    expect(rows()[0]).toMatchObject({ status: "rejected", schema_id: "signal/1", reason: expect.any(String), });
    expect(rows()[0]!.symbol ?? null).toBeNull();
    expect(rows()[0]!.signal_id ?? null).toBeNull();
    expect(JSON.stringify(rows())).not.toContain("short");
    const junk = await read(await post(tokenA, "hallo"));
    expect(junk.status).toBe(422);
    expect(rows().filter((x) => x.status === "rejected")).toHaveLength(2);
  });

  it("only POST; GET is 405", async () => {
    const r = await signalsFn(new Request(`https://journal.test/api/v1/signals/${tokenA}`, { method: "GET" }), ctx(tokenA));
    expect(r.status).toBe(405);
  });
});

describe("limits", () => {
  it("a declared body over 8 KiB is 413 before anything is read; a streamed one is cut off at the limit", async () => {
    const big = "x".repeat(8193);
    expect((await post(tokenA, big, { "content-length": String(big.length) })).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode("y".repeat(1000)));
        c.close();
      },
    });
    const r = await signalsFn(new Request(`https://journal.test/api/v1/signals/${tokenA}`, { method: "POST", body: stream, duplex: "half" } as RequestInit), ctx(tokenA));
    expect(r.status).toBe(413);
    expect(rows()).toHaveLength(0);
  });

  it("exactly 8 KiB is still read (and then judged by the schema)", async () => {
    const pad = "z".repeat(8192 - v1({ data: { n: "" } }).length);
    const body = v1({ data: { n: pad.slice(0, 200) } }) + " ".repeat(8192 - v1({ data: { n: pad.slice(0, 200) } }).length);
    expect(new TextEncoder().encode(body).length).toBe(8192);
    expect((await post(tokenA, body)).status).toBe(200);
  });

  it("60 per minute per address and 300 per caller: the 61st delivery is 429 with Retry-After – the same for any token", async () => {
    let hits = 0;
    const sb = fakeAdmin(state);
    const rpc = sb.rpc.bind(sb);
    (sb as unknown as { rpc: unknown }).rpc = async (fn: string, args: Row) => (fn === "rate_hit" ? { data: ++hits, error: null } : rpc(fn, args));
    setSupabaseAdminForTests(sb);
    // the fake counts every rate_hit call: per delivery two calls (address and caller), so drive the counter directly
    hits = 59;
    const r = await post(tokenA, v1({ signalId: "r1" }));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toMatch(/^\d+$/);
    const other = await post("tj_" + "A".repeat(43), v1());
    expect(other.status).toBe(429); // identical for a token that does not exist
    expect(rows()).toHaveLength(0);
  });

  it("the counter keys hold a hash, never the token", async () => {
    const keys: string[] = [];
    const sb = fakeAdmin(state);
    const rpc = sb.rpc.bind(sb);
    (sb as unknown as { rpc: unknown }).rpc = async (fn: string, args: Row) => {
      if (fn === "rate_hit") keys.push(String(args.p_key));
      return rpc(fn, args);
    };
    setSupabaseAdminForTests(sb);
    await post(tokenA, v1());
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join()).not.toContain(tokenA);
    expect(keys.join()).not.toContain("203.0.113.7");
  });
});

describe("wrong token: one answer, no information", () => {
  it("wrong shape, unknown, revoked and a token without the scope answer byte for byte the same (401)", async () => {
    const readOnly = (await createToken(U1, "Nur lesen", ["trades:read"])).token;
    const revoked = (await createToken(U1, "alt", ["webhook:tradingview"])).token;
    for (const t of state.tables.api_tokens!) if (t.token_hash && (t as Row).name === "alt") (t as Row).revoked_at = new Date().toISOString();
    const unknown = `tj_${"Z".repeat(43)}`;
    const answers: string[] = [];
    for (const t of ["nonsense", "tj_short", unknown, revoked, readOnly, "", "tj_" + "!".repeat(43)]) {
      const r = await post(t || "x", v1());
      expect(r.status, t).toBe(401);
      answers.push(`${r.status}|${await r.text()}`);
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toContain("invalid_token");
    expect(answers[0]).not.toMatch(/scope|unbekannt|Form/i);
    expect(rows()).toHaveLength(0);
  });

  it("the same answer whatever the body is (a wrong token never reads or judges the body)", async () => {
    const a = await (await post("tj_" + "Q".repeat(43), v1())).text();
    const b = await (await post("tj_" + "Q".repeat(43), "x".repeat(50_000))).text();
    const c = await (await post("tj_" + "Q".repeat(43), "")).text();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("the token never appears in a response, a log line or a table", async () => {
    await post(tokenA, v1());
    await post(tokenA, "kaputt");
    await post(tokenA, v1(), { "content-length": "99999" });
    const wrong = `tj_${"W".repeat(43)}`;
    const r = await post(wrong, v1());
    expect(await r.text()).not.toContain(wrong);
    expect(logs.join("\n")).not.toContain(tokenA);
    expect(logs.join("\n")).not.toContain(wrong);
    expect(JSON.stringify(state.tables.signals)).not.toContain(tokenA);
    expect(JSON.stringify(state.tables.rate_hits ?? [])).not.toContain(tokenA);
    expect(JSON.stringify(state.tables.audit_log ?? [])).not.toContain(tokenA);
  });

  it("a valid token touches last_used_at, a wrong one touches nothing", async () => {
    const before = state.tables.api_tokens!.map((t) => t.last_used_at);
    await post("tj_" + "N".repeat(43), v1());
    expect(state.tables.api_tokens!.map((t) => t.last_used_at)).toEqual(before);
    await post(tokenA, v1());
    expect(state.tables.api_tokens!.some((t) => t.last_used_at)).toBe(true);
  });
});

describe("the older address takes the new formats", () => {
  const hook = (token: string, body: string) => hookFn(new Request(`https://journal.test/api/v1/hooks/tradingview/${token}`, { method: "POST", body }), ctx(token));

  it("signal/1 and branchen-trend/1 at /hooks/tradingview/:token: stored as signals, no journal trade, no plan gate", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x"; // payments on, Free has no "API & Webhooks": the signal formats are not gated
    const a = await read(await hook(tokenA, v1()));
    expect(a).toEqual({ status: 200, body: { ok: true, result: "processed", signalId: "s-1" } });
    expect((await read(await hook(tokenA, bt()))).body).toMatchObject({ result: "processed" });
    expect((await read(await hook(tokenA, v1()))).body).toMatchObject({ result: "duplicate" });
    expect((await read(await hook(tokenA, v1({ direction: "short" })))).status).toBe(422);
    expect((state.tables.journal_docs ?? []).filter((d) => d.kind === "trade")).toHaveLength(0);
  });

  it("a signal body above 8 KiB is 413 at the older address too (its own limit is 16 KiB for trade alerts)", async () => {
    const body = v1({ data: { n: "x" } }) + " ".repeat(9000);
    expect((await hook(tokenA, body)).status).toBe(413);
  });

  it("the older messages (test, open) still work and ALSO appear in the signal list", async () => {
    await hook(tokenA, `{"action":"test","symbol":"TEST","source":"app"}`);
    await hook(tokenA, `{"action":"open","symbol":"BTCUSDT","side":"long","price":1,"qty":1}`);
    expect(rows().map((r) => [r.kind, r.schema_id ?? null])).toEqual(expect.arrayContaining([["test", null], ["signal", "legacy-action"]]));
    expect((state.tables.journal_docs ?? []).filter((d) => d.kind === "trade")).toHaveLength(1);
    expect((state.tables.webhook_receipts ?? []).map((r) => r.kind).sort()).toEqual(["open", "test"]);
  });

  it("a short entry is journaled by the older function and NOT listed as a refused signal", async () => {
    const r = await hook(tokenA, `{"action":"open","symbol":"BTCUSDT","side":"short","price":1,"qty":1}`);
    expect(r.status).toBe(200);
    expect(rows().filter((x) => x.status === "rejected")).toHaveLength(0);
  });
});

describe("retention and availability", () => {
  it("tests and non-processed rows are trimmed to their caps; processed signals are kept (they are the dedup window)", async () => {
    let t = 0;
    const step = () => vi.setSystemTime(NOW + ++t * 1_000);
    for (let i = 0; i < KEEP_TESTS + 8; i++) {
      step();
      await post(tokenA, `{"action":"test","symbol":"T${i}"}`);
    }
    step();
    await post(tokenA, v1({ signalId: "keep-1" }));
    for (let i = 0; i < KEEP_OTHER + 8; i++) {
      step();
      await post(tokenA, "kaputt");
    }
    expect(rows().filter((r) => r.kind === "test").length).toBeLessThanOrEqual(KEEP_TESTS);
    expect(rows().filter((r) => r.status === "rejected").length).toBeLessThanOrEqual(KEEP_OTHER);
    expect(rows().filter((r) => r.status === "processed" && r.kind === "signal")).toHaveLength(1);
  });

  it("processed signals older than 90 days are removed, newer ones stay", async () => {
    await post(tokenA, v1({ signalId: "old" }));
    (rows()[0] as Row).received_at = new Date(NOW - 91 * 86_400_000).toISOString();
    await post(tokenA, v1({ signalId: "new" }));
    expect(rows().map((r) => r.signal_id)).toEqual(["new"]);
  });

  it("without the table (migration 0013 missing) nothing is accepted: 503, never a silent 200", async () => {
    const sb = fakeAdmin(state);
    const from = sb.from.bind(sb);
    (sb as unknown as { from: unknown }).from = (name: string) => {
      if (name !== "signals") return from(name);
      const q = from(name) as unknown as Record<string, unknown>;
      return { ...q, insert: () => Promise.resolve({ data: null, error: { code: "42P01" } }), select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { code: "42P01" } }) }) }) }) };
    };
    setSupabaseAdminForTests(sb);
    const r = await read(await post(tokenA, v1()));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: { code: "signals_unavailable" } });
  });
});

describe("the card's list (GET /connections/tradingview)", () => {
  const status = async () => read(await tvFn(new Request("https://journal.test/api/v1/connections/tradingview", { method: "GET", headers: { authorization: `Bearer ${JWT}` } }), { ip: "203.0.113.7" } as unknown as Ctx));

  it("lists the newest deliveries of THIS user with state and reason, newest first, nothing of another user, no token", async () => {
    const tick = (n: number) => vi.setSystemTime(NOW + n * 1_000);
    await post(tokenA, v1({ signalId: "a1" }));
    tick(1);
    await post(tokenA, v1({ signalId: "a1" }));
    tick(2);
    await post(tokenA, "kaputt");
    tick(3);
    await post(tokenB, v1({ signalId: "b1" }));
    tick(5);
    await post(tokenA, bt());
    const s = await status();
    const list = s.body.signals as Row[];
    expect(s.body.signalsAvailable).toBe(true);
    expect(list.map((x) => [x.status, x.schemaId])).toEqual([["processed", "branchen-trend/1"], ["rejected", null], ["duplicate", "signal/1"], ["processed", "signal/1"]]);
    expect(list[0]).toMatchObject({ direction: "long", data: { zustand: "gruen", kurs: 91.2 }, symbol: "XLE" });
    expect(list[1]!.reason).toEqual(expect.any(String));
    expect(JSON.stringify(s.body)).not.toContain(tokenA);
    expect(JSON.stringify(s.body)).not.toContain('"signalId":"b1"');
    expect(s.body.mcp).toMatchObject({ configured: false, connected: false });
  });
});
