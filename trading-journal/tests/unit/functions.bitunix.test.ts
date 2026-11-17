// @vitest-environment node
/// <reference types="node" />
/**
 * P11 Bitunix adapter (`netlify/functions/_lib/exchanges/bitunix.ts`): the signer against the vector of the official
 * docs ("Sign" page, Go / Python example inputs; expected outputs computed with the doc's own Python snippet), an
 * independent copy of the official Node demo (`Demo/Node/openApiHttpSign.js`), request building, pagination, rate
 * spacing, error codes and the read-only allowlist – all with a fake fetch, nothing leaves the process.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  authHeaders,
  BITUNIX_PATHS,
  BitunixClient,
  bitunixAdapter,
  bitunixError,
  canonicalQuery,
  cleanQuery,
  MIN_SPACING_MS,
  parseAccount,
  parseClosedPosition,
  READ_PATHS,
  signBitunix,
  toMs,
  urlQuery,
} from "../../netlify/functions/_lib/exchanges/bitunix";
import { ExchangeError, type AdapterRuntime } from "../../netlify/functions/_lib/exchanges/types";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;

/** Verbatim logic of the official Node demo's `generateSignature` + `sortParams` (BitunixOfficial/open-api). */
function officialDemoSign(apiKey: string, secretKey: string, nonce: string, timestamp: string, params: Record<string, string>, body = ""): string {
  const queryParams = !params || Object.keys(params).length === 0 ? "" : Object.keys(params).sort().map((key) => key + params[key]).join("");
  const digestInput = nonce + timestamp + apiKey + queryParams + body;
  const digest = createHash("sha256").update(digestInput).digest("hex");
  return createHash("sha256").update(digest + secretKey).digest("hex");
}

interface Call {
  url: URL;
  headers: Record<string, string>;
  method: string;
}

function fakeRuntime(respond: (call: Call, n: number) => unknown, opts: { status?: (n: number) => number } = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_791_789_300_000;
  const rt: AdapterRuntime = {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    nonce: () => "0123456789abcdef0123456789abcdef",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = { url: new URL(String(input)), headers: Object.fromEntries(new Headers(init?.headers).entries()), method: init?.method ?? "GET" };
      calls.push(call);
      const n = calls.length;
      const body = respond(call, n);
      if (body instanceof Error) throw body;
      const text = typeof body === "string" ? body : JSON.stringify(body);
      return new Response(text, { status: opts.status?.(n) ?? 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  };
  return { rt, calls, sleeps, advance: (ms: number) => (clock += ms) };
}

const CREDS = { apiKey: "yourApiKey", secret: "yourSecretKey" };

/** The error a promise rejects with (fails the test when it resolves). */
async function failure(p: Promise<unknown>): Promise<ExchangeError> {
  try {
    await p;
  } catch (e) {
    return e as ExchangeError;
  }
  throw new Error("expected a rejection");
}

describe("Bitunix signer", () => {
  it("matches the documented example vector (doc inputs, doc Python snippet outputs)", () => {
    const { digest, sign } = signBitunix({
      nonce: "123456",
      timestamp: "20241120123045",
      apiKey: "yourApiKey",
      secretKey: "yourSecretKey",
      queryParams: "id1uid200",
      body: '{"uid":"2899","arr":[{"id":1,"name":"maple"},{"id":2,"name":"lily"}]}',
    });
    expect(digest).toBe("75099831ac6803e9c5b79dd3cde2c3c529b4750bd3508186afdde0dd13599b38");
    expect(sign).toBe("00397cd1e52c7dce3258067324363b6361fabc9178a0912b330c138db8745655");
  });

  it("is double SHA-256 (not HMAC) with lowercase hex", () => {
    const { sign } = signBitunix({ nonce: "n", timestamp: "1", apiKey: "k", secretKey: "s", queryParams: "", body: "" });
    const digest = createHash("sha256").update("n1k").digest("hex");
    expect(sign).toBe(createHash("sha256").update(`${digest}s`).digest("hex"));
    expect(sign).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonical query = keys ASCII-sorted, key+value, no separators (doc: id=1&uid=200 → id1uid200)", () => {
    expect(canonicalQuery({ uid: "200", id: "1" })).toBe("id1uid200");
    expect(canonicalQuery({})).toBe("");
    // uppercase sorts before lowercase in ASCII
    expect(canonicalQuery({ b: "2", B: "1", a: "0" })).toBe("B1a0b2");
    expect(urlQuery({ uid: "200", id: "1" })).toBe("id=1&uid=200");
    expect(urlQuery({ symbols: "BTCUSDT,ETHUSDT" })).toBe("symbols=BTCUSDT%2CETHUSDT");
  });

  it("drops null / undefined / empty params before signing and stringifies numbers", () => {
    expect(cleanQuery({ a: undefined, b: null, c: "", d: 0, e: 10, f: false })).toEqual({ d: "0", e: "10", f: "false" });
  });

  it("agrees with the official Node demo for real GET requests", () => {
    const cases: Record<string, string>[] = [
      { marginCoin: "USDT" },
      { startTime: "1791185412000", endTime: "1791789300000", skip: "0", limit: "100" },
      { positionId: "1846203915577018372", limit: "100", skip: "200" },
      {},
    ];
    for (const q of cases) {
      const h = authHeaders({ apiKey: "ak_9f3", secret: "sk_77" }, q, "0123456789abcdef0123456789abcdef", "1791789300000");
      expect(h.sign).toBe(officialDemoSign("ak_9f3", "sk_77", "0123456789abcdef0123456789abcdef", "1791789300000", q));
    }
  });

  it("builds the documented headers (api-key, nonce, timestamp ms, sign, content-type, language)", () => {
    const h = authHeaders(CREDS, { marginCoin: "USDT" }, "0123456789abcdef0123456789abcdef", "1727000000000");
    expect(h).toEqual({
      "api-key": "yourApiKey",
      nonce: "0123456789abcdef0123456789abcdef",
      timestamp: "1727000000000",
      sign: "7aea16f8657297affb0a24cf06ac3d739b0297372d6aab5dbc7398b5b359b2aa",
      "content-type": "application/json",
      language: "en-US",
    });
  });
});

describe("BitunixClient", () => {
  it("sends a signed GET with the sorted query that it signed", async () => {
    const f = fakeRuntime(() => fixture("bitunix-account.json"));
    const client = new BitunixClient(CREDS, f.rt);
    const data = await client.get(BITUNIX_PATHS.account, { marginCoin: "USDT" });
    expect(parseAccount(data)?.available).toBe(4182.37);
    const c = f.calls[0]!;
    expect(c.method).toBe("GET");
    expect(c.url.origin + c.url.pathname).toBe("https://fapi.bitunix.com/api/v1/futures/account");
    expect(c.url.search).toBe("?marginCoin=USDT");
    expect(c.headers.timestamp).toBe("1791789300000");
    expect(c.headers.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(c.headers.sign).toBe(officialDemoSign("yourApiKey", "yourSecretKey", c.headers.nonce!, c.headers.timestamp!, { marginCoin: "USDT" }));
  });

  it("never sends the secret, and public tickers go out unsigned", async () => {
    const f = fakeRuntime(() => ({ code: 0, msg: "ok", data: [{ symbol: "BTCUSDT", markPrice: "63920.5", lastPrice: "63921" }] }));
    const a = bitunixAdapter(CREDS, f.rt);
    const t = await a.fetchTickers(["BTCUSDT", "BTCUSDT", "bad symbol!"]);
    expect(t).toEqual([{ symbol: "BTCUSDT", markPrice: 63920.5, lastPrice: 63921 }]);
    const c = f.calls[0]!;
    expect(c.headers["api-key"]).toBeUndefined();
    expect(c.url.searchParams.get("symbols")).toBe("BTCUSDT");
    expect(JSON.stringify(f.calls)).not.toContain("yourSecretKey");
  });

  it("refuses every path outside the read-only allowlist (no order / transfer call possible)", async () => {
    const f = fakeRuntime(() => ({ code: 0, data: null }));
    const client = new BitunixClient(CREDS, f.rt);
    await expect(client.get("/api/v1/futures/trade/place_order")).rejects.toMatchObject({ code: "forbidden_path" });
    await expect(client.get("/api/v1/futures/trade/cancel_orders")).rejects.toBeInstanceOf(ExchangeError);
    expect(f.calls).toHaveLength(0);
    for (const p of READ_PATHS) expect(p).not.toMatch(/place|cancel|modify|close|transfer|withdraw|adjust|change/);
  });

  it("spaces requests ≥ 110 ms apart (≤ 9 per second, limit 10/s/UID)", async () => {
    const f = fakeRuntime(() => ({ code: 0, data: [] }));
    const client = new BitunixClient(CREDS, f.rt);
    await client.get(BITUNIX_PATHS.pendingPositions);
    await client.get(BITUNIX_PATHS.pendingPositions);
    await client.get(BITUNIX_PATHS.pendingPositions);
    expect(f.sleeps).toEqual([MIN_SPACING_MS, MIN_SPACING_MS]);
    expect(client.stats.requests).toBe(3);
  });

  it("pages skip/limit until total is reached", async () => {
    const all = Array.from({ length: 230 }, (_, i) => ({ positionId: String(1000 + i), symbol: "BTCUSDT", side: "LONG", maxQty: "1", entryPrice: "1", closePrice: "2", ctime: 1791185412000 + i, mtime: 1791185412000 + i }));
    const f = fakeRuntime((c) => {
      const skip = Number(c.url.searchParams.get("skip"));
      const limit = Number(c.url.searchParams.get("limit"));
      return { code: 0, data: { positionList: all.slice(skip, skip + limit), total: all.length } };
    });
    const a = bitunixAdapter(CREDS, f.rt);
    const res = await a.fetchClosedPositions({ startTime: 1, endTime: 2 });
    expect(res.complete).toBe(true);
    expect(res.items).toHaveLength(230);
    expect(f.calls.map((c) => c.url.searchParams.get("skip"))).toEqual(["0", "100", "200"]);
    expect(f.calls.every((c) => c.url.searchParams.get("limit") === "100" && c.url.searchParams.get("startTime") === "1" && c.url.searchParams.get("endTime") === "2")).toBe(true);
  });

  it("stops at the deadline and reports where to resume", async () => {
    const f = fakeRuntime(() => ({ code: 0, data: { positionList: Array.from({ length: 100 }, (_, i) => ({ positionId: String(i), symbol: "X", side: "LONG" })), total: 1000 } }));
    const a = bitunixAdapter(CREDS, f.rt);
    const deadline = f.rt.now() + 250; // room for ~2 spaced requests
    const res = await a.fetchClosedPositions({ startTime: 1, endTime: 2 }, { deadline });
    expect(res.complete).toBe(false);
    expect(res.nextSkip).toBe(res.items.length);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.length).toBeLessThan(1000);
  });

  it("maps 10007 / 10004 / 10003 to German auth errors (never retried)", async () => {
    for (const [code, re] of [
      [10007, /Signatur ungültig/],
      [10004, /ohne IP-Bindung/],
      [10003, /keinen API-Key/],
    ] as const) {
      const f = fakeRuntime(() => ({ code, msg: "x" }));
      const err = await failure(new BitunixClient(CREDS, f.rt).get(BITUNIX_PATHS.account, { marginCoin: "USDT" }));
      expect(err).toBeInstanceOf(ExchangeError);
      expect(err.code).toBe(`bitunix_${code}`);
      expect(err.authFailure).toBe(true);
      expect(err.message).toMatch(re);
      expect(f.calls).toHaveLength(1);
    }
  });

  it("retries 10005 / 10006 once after a back-off, then gives up with a German message", async () => {
    const ok = fakeRuntime((_, n) => (n === 1 ? { code: 10006, msg: "Request too frequently" } : { code: 0, data: [] }));
    await expect(new BitunixClient(CREDS, ok.rt).get(BITUNIX_PATHS.pendingPositions)).resolves.toEqual([]);
    expect(ok.calls).toHaveLength(2);
    expect(ok.sleeps).toContain(1000);
    const bad = fakeRuntime(() => ({ code: 10005, msg: "Too many requests" }));
    const err = await failure(new BitunixClient(CREDS, bad.rt).get(BITUNIX_PATHS.pendingPositions));
    expect(err.code).toBe("bitunix_10005");
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/zu viele Anfragen/i);
    expect(bad.calls).toHaveLength(2);
  });

  it("network failure: one retry, then a German 502", async () => {
    const f = fakeRuntime(() => new TypeError("fetch failed"));
    const err = await failure(new BitunixClient(CREDS, f.rt).get(BITUNIX_PATHS.pendingPositions));
    expect(err.code).toBe("network");
    expect(err.status).toBe(502);
    expect(f.calls).toHaveLength(2);
  });

  it("non-JSON / HTTP errors become German errors (no body echoed)", async () => {
    const html = fakeRuntime(() => "<html>cloudflare</html>");
    await expect(new BitunixClient(CREDS, html.rt).get(BITUNIX_PATHS.pendingPositions)).rejects.toMatchObject({ code: "bad_response" });
    const limited = fakeRuntime(() => "", { status: () => 429 });
    await expect(new BitunixClient(CREDS, limited.rt).get(BITUNIX_PATHS.pendingPositions)).rejects.toMatchObject({ code: "bitunix_10005" });
    const forbidden = fakeRuntime(() => "", { status: () => 403 });
    const err = await failure(new BitunixClient(CREDS, forbidden.rt).get(BITUNIX_PATHS.pendingPositions));
    expect(err.message).toMatch(/Read-only/);
    expect(err.message).not.toContain("yourApiKey");
  });

  it("unknown codes: German text with the code, never a raw venue message with odd characters", () => {
    expect(bitunixError(20011, "Account not allowed to trade").message).toBe("Bitunix meldet einen Fehler (Code 20011) (Account not allowed to trade).");
    expect(bitunixError(99999, "<script>").message).toBe("Bitunix meldet einen Fehler (Code 99999).");
  });
});

describe("Bitunix parsing", () => {
  it("reads the documented history-position fields (numbers as strings, ms timestamps)", () => {
    const list = (fixture("bitunix-history-positions.json").data as { positionList: Record<string, unknown>[] }).positionList;
    const sol = parseClosedPosition(list[2]!)!;
    expect(sol).toMatchObject({ positionId: "1845011834093715461", symbol: "SOLUSDT", side: "long", maxQty: 40, entryPrice: 148.2, closePrice: 151.65, marginMode: "isolated", positionMode: "hedge", leverage: 8, fee: 4.8, funding: -1.25, realizedPnl: 138, liqPrice: 131.4, openedAt: 1791335109000, closedAt: 1791487360000 });
    const btc = parseClosedPosition(list[0]!)!;
    expect(btc.liqPrice).toBeNull(); // "0" = no liquidation price
    expect(btc.side).toBe("short");
    expect(parseClosedPosition({ symbol: "BTCUSDT" })).toBeNull();
  });

  it("toMs: ms stay, seconds are scaled, garbage is 0", () => {
    expect(toMs(1791185412000)).toBe(1791185412000);
    expect(toMs("1791185412000")).toBe(1791185412000);
    expect(toMs(1791185412)).toBe(1791185412000);
    expect(toMs("nope")).toBe(0);
    expect(toMs(null)).toBe(0);
  });

  it("adapter: open positions (bare array), fills by positionId, TP/SL list", async () => {
    const f = fakeRuntime((c) => {
      if (c.url.pathname === BITUNIX_PATHS.pendingPositions) return fixture("bitunix-pending-positions.json");
      if (c.url.pathname === BITUNIX_PATHS.historyTrades) return fixture("bitunix-history-trades.json");
      if (c.url.pathname === BITUNIX_PATHS.tpslHistory) return fixture("bitunix-tpsl-history.json");
      return { code: 0, data: null };
    });
    const a = bitunixAdapter(CREDS, f.rt);
    const open = await a.fetchOpenPositions();
    expect(open.map((p) => [p.symbol, p.side, p.qty, p.entryPrice])).toEqual([
      ["BTCUSDT", "long", 0.06, 63800],
      ["ETHUSDT", "short", 2, 2460],
    ]);
    const fills = await a.fetchFills({ positionId: "1846203915577018372" });
    expect(f.calls.at(-1)!.url.searchParams.get("positionId")).toBe("1846203915577018372");
    expect(fills.items.map((x) => x.side)).toEqual(["buy", "buy", "sell", "sell"]);
    const tpsl = await a.fetchTpSl({ startTime: 1, endTime: 2 });
    expect(tpsl.items).toHaveLength(5);
    expect(tpsl.items[0]).toMatchObject({ positionId: "1844291077356544000", slPrice: 62500, tpPrice: null });
  });

  it("validate() reads the USDT futures account", async () => {
    const f = fakeRuntime(() => fixture("bitunix-account.json"));
    const acc = await bitunixAdapter(CREDS, f.rt).validate();
    expect(acc).toEqual({ marginCoin: "USDT", available: 4182.37, frozen: 0, margin: 1366.8, unrealizedPnl: -12.4, positionMode: "one_way" });
    expect(f.calls[0]!.url.searchParams.get("marginCoin")).toBe("USDT");
  });
});
