// @vitest-environment node
/// <reference types="node" />
/**
 * The candle relay (`netlify/functions/klines-proxy.mts`, `GET /api/v1/klines`) with a mocked upstream: only the two allow-listed
 * hosts are ever called, parameters are validated before anything goes out, a hanging / blocked / rate-limited Binance is
 * named in German with the right status (never an empty 200), a full page of old history is cached for a day, a fresh page for
 * 20 s, identical requests cost one upstream call, and one IP is limited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import klines, { INTERVALS, klinesTesting, RATE_MAX, ttlOf, UPSTREAM_TIMEOUT_MS, VENUES } from "../../netlify/functions/klines-proxy.mts";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof klines>[1];
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const H4 = 14_400_000;

/** `n` closed 4h rows in Binance's 12-field shape, the first opening at `from`. */
const rows = (n: number, from = NOW - 400 * H4): unknown[][] => Array.from({ length: n }, (_, i) => [from + i * H4, "100", "101", "99", "100.5", "12", from + (i + 1) * H4 - 1, "1200", 10, "6", "600", "0"]);
const ok = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const get = (qs: string, c = ctx) => klines(new Request(`https://app.test/api/v1/klines?${qs}`), c);

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  klinesTesting.clear();
  klinesTesting.now = () => NOW;
  upstream = vi.fn(async () => ok(rows(3)));
  klinesTesting.fetch = upstream as unknown as typeof fetch;
});
afterEach(() => {
  klinesTesting.clear();
  klinesTesting.fetch = undefined;
  klinesTesting.now = undefined;
});

describe("klines-proxy", () => {
  it("relays spot rows from the allow-listed host with the parameters it validated", async () => {
    const res = await get("venue=spot&symbol=btcusdt&interval=4h&startTime=1700000000000&limit=1000");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-klines-venue")).toBe("spot");
    expect(res.headers.get("x-upstream-status")).toBe("200");
    expect(await res.json()).toEqual(rows(3));
    const url = new URL(String(upstream.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://data-api.binance.vision/api/v3/klines");
    expect(Object.fromEntries(url.searchParams)).toEqual({ symbol: "BTCUSDT", interval: "4h", limit: "1000", startTime: "1700000000000" });
  });

  it("serves the futures venue from fapi.binance.com and defaults to spot", async () => {
    await get("venue=futures&symbol=BTCUSDT&interval=1h&limit=1500");
    expect(String(upstream.mock.calls[0]![0])).toMatch(/^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?/);
    await get("symbol=ETHUSDT&interval=1h");
    expect(String(upstream.mock.calls[1]![0])).toMatch(/^https:\/\/data-api\.binance\.vision\/api\/v3\/klines\?/);
    expect(Object.values(VENUES).map((v) => new URL(v.url).host).sort()).toEqual(["data-api.binance.vision", "fapi.binance.com"]);
  });

  it("refuses everything outside the allow-list before it calls upstream", async () => {
    const bad = [
      "venue=evil&symbol=BTCUSDT&interval=1h", // a host / venue the caller invents
      "venue=https://evil.test&symbol=BTCUSDT&interval=1h",
      "venue=spot&symbol=BTC/USDT&interval=1h", // a path in the symbol
      "venue=spot&symbol=btc&interval=1h", // too short
      "venue=spot&symbol=BTCUSDT&interval=7m", // unknown interval
      "venue=spot&symbol=BTCUSDT&interval=1h&limit=1001", // beyond the spot page
      "venue=spot&symbol=BTCUSDT&interval=1h&limit=0",
      "venue=spot&symbol=BTCUSDT&interval=1h&startTime=abc",
      "venue=spot&symbol=BTCUSDT&interval=1h&startTime=-1",
      "venue=spot&symbol=BTCUSDT&interval=1h&endTime=99999999999999999999",
    ];
    for (const qs of bad) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.message.length, qs).toBeGreaterThan(5);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect([...INTERVALS]).toContain("4h");
  });

  it("answers GET only", async () => {
    const res = await klines(new Request("https://app.test/api/v1/klines?symbol=BTCUSDT&interval=1h", { method: "POST" }), ctx);
    expect(res.status).toBe(405);
  });

  it("a hanging Binance becomes a clear 504 after the time limit – never a hang, never an empty 200", async () => {
    upstream.mockImplementation((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" })))));
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      expect(ms).toBe(UPSTREAM_TIMEOUT_MS);
      const c = new AbortController();
      setTimeout(() => c.abort(), 5);
      return c.signal;
    });
    const res = await get("venue=spot&symbol=BTCUSDT&interval=1h");
    timeout.mockRestore();
    expect(res.status).toBe(504);
    expect(res.headers.get("x-upstream-status")).toBe("0");
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_timeout");
    expect(body.error.message).toContain("nicht innerhalb von 8 s");
  });

  it("names the other upstream failures: 451 region, 429 / 418 / 403 limit, 5xx, unreachable, not candles", async () => {
    const cases: [() => Response | Promise<Response>, number, string][] = [
      [() => ok({ code: 0, msg: "blocked" }, 451), 451, "upstream_blocked"],
      [() => ok({ code: -1003, msg: "too many" }, 429), 429, "upstream_rate_limited"],
      [() => ok({ code: -1003, msg: "banned" }, 418), 429, "upstream_rate_limited"],
      [() => new Response("<html>denied</html>", { status: 403 }), 429, "upstream_rate_limited"],
      [() => ok({ msg: "down" }, 503), 502, "upstream_error"],
      [() => ok({ code: 1, msg: "weird" }, 200), 502, "upstream_bad_answer"],
      [() => new Response("<html>ok</html>", { status: 200 }), 502, "upstream_bad_answer"],
    ];
    for (const [make, status, code] of cases) {
      klinesTesting.clear();
      upstream.mockImplementationOnce(async () => make());
      const res = await get("venue=spot&symbol=BTCUSDT&interval=1h");
      expect(res.status, code).toBe(status);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    upstream.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed");
    });
    const down = await get("venue=spot&symbol=BTCUSDT&interval=1h");
    expect(down.status).toBe(502);
    expect(((await down.json()) as { error: { code: string } }).error.code).toBe("upstream_unreachable");
  });

  it("passes Binance's own 400 on (the app reads -1121 as 'unknown market')", async () => {
    upstream.mockImplementationOnce(async () => ok({ code: -1121, msg: "Invalid symbol." }, 400));
    const res = await get("venue=spot&symbol=FOOUSDT&interval=1h");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: -1121, msg: "Invalid symbol." });
  });

  it("caches: old full pages for a day, fresh ones for 20 s, and identical requests cost one upstream call", async () => {
    upstream.mockImplementation(async () => ok(rows(1000, NOW - 2000 * H4)));
    const first = await get("venue=spot&symbol=BTCUSDT&interval=4h&startTime=1&limit=1000");
    expect(first.headers.get("x-klines-cache")).toBe("miss");
    expect(first.headers.get("netlify-cdn-cache-control")).toContain("s-maxage=86400");
    const again = await get("venue=spot&symbol=BTCUSDT&interval=4h&startTime=1&limit=1000");
    expect(again.headers.get("x-klines-cache")).toBe("hit");
    expect(upstream).toHaveBeenCalledTimes(1);
    // a page that runs up to now (short, or its last bar is recent) is not kept long
    upstream.mockImplementation(async () => ok(rows(10, NOW - 10 * H4)));
    const fresh = await get("venue=spot&symbol=BTCUSDT&interval=4h&startTime=2&limit=1000");
    expect(fresh.headers.get("netlify-cdn-cache-control")).toContain("s-maxage=20");
    // after the memo's time the upstream is asked again
    klinesTesting.now = () => NOW + 21_000;
    await get("venue=spot&symbol=BTCUSDT&interval=4h&startTime=2&limit=1000");
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(ttlOf("not json", "4h", 10, NOW)).toBe(20);
  });

  it("limits one IP per minute and tells it when to come back", async () => {
    for (let i = 0; i < RATE_MAX; i++) expect((await get(`venue=spot&symbol=BTCUSDT&interval=4h&startTime=${i + 1}`)).status).toBe(200);
    const res = await get("venue=spot&symbol=BTCUSDT&interval=4h&startTime=999999");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // another IP is not affected
    expect((await get("venue=spot&symbol=BTCUSDT&interval=4h", { ip: "198.51.100.4" } as typeof ctx)).status).toBe(200);
  });

  it("is routed under /api/v1/klines and carries no secret", async () => {
    const mod = await import("../../netlify/functions/klines-proxy.mts");
    expect(mod.config).toMatchObject({ path: "/api/v1/klines", method: ["GET"] });
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("netlify/functions/klines-proxy.mts", "utf8");
    expect(src).not.toMatch(/process\.env|Deno\.env|x-mbx-apikey|authorization:/i);
  });
});
